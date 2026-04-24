// Edge function: siigo-sync-invoices
// Pulls the user's Siigo invoices (venta = /v1/invoices, compra = /v1/purchases)
// and upserts them into public.invoices with source='siigo' and a stable
// siigo_id for idempotency.
//
// Request:
//   POST /functions/v1/siigo-sync-invoices
//   Authorization: Bearer <user JWT>
//   Body (optional):
//     { since?: 'YYYY-MM-DD', until?: 'YYYY-MM-DD', kinds?: ['venta','compra'] }
//
// Defaults: kinds = ['venta','compra'], since = last_invoice_pulled_at or
//           90 days ago, until = today.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptSecret } from "../_shared/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SIIGO_BASE = "https://api.siigo.com";
const PAGE_SIZE = 100;

type Kind = "venta" | "compra";

interface SiigoLine {
  code?: string;
  product?: { code?: string; description?: string };
  description?: string;
  quantity?: number;
  price?: number;
  discount?: number | { value?: number; percentage?: number };
  taxes?: Array<{ id?: number; name?: string; percentage?: number; value?: number }>;
  total?: number;
}

interface SiigoInvoice {
  id: string;
  document?: { id?: number; code?: string };
  number?: number;
  name?: string;
  date?: string;
  due_date?: string;
  customer?: { identification?: string; name?: string | string[] };
  supplier?: { identification?: string; name?: string | string[] };
  total?: number;
  balance?: number;
  taxes?: Array<{ id?: number; name?: string; percentage?: number; value?: number }>;
  stamp?: { cufe?: string };
  payments?: Array<{ name?: string }>;
  items?: SiigoLine[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } =
      await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return json({ error: "Sesión inválida" }, 401);
    }
    const userId = claimsData.claims.sub as string;

    const body = await req.json().catch(() => ({})) as {
      since?: string;
      until?: string;
      kinds?: Kind[];
    };

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: creds, error: credsErr } = await admin
      .from("user_siigo_credentials")
      .select("siigo_username, siigo_access_key_encrypted, partner_id, last_invoice_pulled_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (credsErr || !creds) {
      return json(
        { ok: false, error: "Sin credenciales de Siigo. Conecta primero en Configuración." },
        400,
      );
    }

    const accessKey = await decryptSecret(creds.siigo_access_key_encrypted);

    // Get a fresh Siigo token (24h TTL).
    const authRes = await fetch(`${SIIGO_BASE}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Partner-Id": creds.partner_id },
      body: JSON.stringify({ username: creds.siigo_username, access_key: accessKey }),
    });
    if (!authRes.ok) {
      const detail = await authRes.text().catch(() => "");
      await admin.from("user_siigo_credentials").update({
        connection_status: "error",
        last_error: `auth ${authRes.status}: ${detail.slice(0, 200)}`,
      }).eq("user_id", userId);
      return json({ ok: false, error: "Siigo auth falló", status: authRes.status }, 502);
    }
    const { access_token } = await authRes.json() as { access_token: string };

    // Re-sync uses a 30-day rolling window instead of last_invoice_pulled_at:
    // Siigo filters by document date (not API creation), and users often create
    // invoices backdated a day or two. Using the exact pulled_at timestamp
    // silently drops invoices with issue_date < pulled_at. First sync uses 90d.
    const since = body.since
      ?? (creds.last_invoice_pulled_at ? daysAgo(30) : daysAgo(90));
    const until = body.until ?? today();
    const kinds: Kind[] = body.kinds && body.kinds.length > 0
      ? body.kinds
      : ["venta", "compra"];

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let itemsInserted = 0;
    const errors: string[] = [];
    const debug: Record<string, unknown> = {};

    const apiHeaders = {
      Authorization: `Bearer ${access_token}`,
      "Partner-Id": creds.partner_id,
    };

    // Siigo /v1/invoices returns customer as {id, identification} only — no name.
    // We resolve the name via /v1/customers/{id}, cached per sync to avoid N+1.
    const customerNameCache = new Map<string, string | null>();
    async function resolveCustomerName(
      customer: SiigoInvoice["customer"] | SiigoInvoice["supplier"],
    ): Promise<string | null> {
      if (!customer) return null;
      const inline = Array.isArray(customer.name)
        ? customer.name.filter(Boolean).join(" ")
        : customer.name ?? null;
      if (inline) return inline;
      const cid = (customer as { id?: string }).id;
      if (!cid) return null;
      if (customerNameCache.has(cid)) return customerNameCache.get(cid) ?? null;
      try {
        const r = await fetch(`${SIIGO_BASE}/v1/customers/${cid}`, { headers: apiHeaders });
        if (!r.ok) {
          customerNameCache.set(cid, null);
          return null;
        }
        const c = await r.json() as {
          name?: string | string[];
          commercial_name?: string;
          person_type?: string;
        };
        const resolved = c.commercial_name
          ?? (Array.isArray(c.name) ? c.name.filter(Boolean).join(" ") : c.name)
          ?? null;
        customerNameCache.set(cid, resolved);
        return resolved;
      } catch {
        customerNameCache.set(cid, null);
        return null;
      }
    }

    for (const kind of kinds) {
      const path = kind === "venta" ? "/v1/invoices" : "/v1/purchases";
      let page = 1;
      while (true) {
        const url = new URL(SIIGO_BASE + path);
        url.searchParams.set("created_start", since);
        url.searchParams.set("created_end", until);
        url.searchParams.set("page", String(page));
        url.searchParams.set("page_size", String(PAGE_SIZE));

        const res = await fetch(url.toString(), { headers: apiHeaders });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          errors.push(`${kind} page ${page}: ${res.status} ${detail.slice(0, 200)}`);
          break;
        }
        const payload = await res.json() as { results?: SiigoInvoice[]; pagination?: { total_results?: number } };
        const results = payload.results ?? [];
        if (page === 1) {
          const pageDebug = {
            total_results: payload.pagination?.total_results ?? null,
            returned: results.length,
            numbers: results.map(r => r.number ?? r.name ?? r.id).slice(0, 10),
            url: url.toString(),
          };
          debug[`${kind}_page1`] = pageDebug;
          console.log(`[siigo-sync-invoices] ${kind} page1:`, JSON.stringify(pageDebug));
        }
        if (results.length === 0) break;

        for (const inv of results) {
          try {
            // Fetch detail if items are missing so we get everything in one shape.
            let items: SiigoLine[] = inv.items ?? [];
            if (items.length === 0) {
              try {
                const detailRes = await fetch(`${SIIGO_BASE}${path}/${inv.id}`, { headers: apiHeaders });
                if (detailRes.ok) {
                  const detail = await detailRes.json() as SiigoInvoice;
                  items = detail.items ?? [];
                }
              } catch {
                // best-effort
              }
            }

            const counterparty = kind === "venta" ? inv.customer : inv.supplier;
            const counterpartyName = await resolveCustomerName(counterparty);
            const row = mapSiigoInvoice(inv, kind, userId, items, counterpartyName);
            const { data: upserted, error } = await admin
              .from("invoices")
              .upsert(row, { onConflict: "user_id,siigo_id" })
              .select("id")
              .single();
            if (error || !upserted) {
              errors.push(`${kind} ${inv.id}: ${error?.message ?? "upsert returned no row"}`);
              skipped++;
              continue;
            }
            inserted++;

            if (items.length > 0) {
              // Idempotent: replace any prior items for this invoice on re-sync.
              await admin.from("invoice_items")
                .delete()
                .eq("invoice_id", upserted.id)
                .eq("user_id", userId);
              const lineRows = items
                .map(line => mapSiigoLine(line, upserted.id, userId, row.iva_rate))
                .filter(r => r.quantity > 0 || r.unit_price > 0);
              if (lineRows.length > 0) {
                const { error: itemsErr } = await admin.from("invoice_items").insert(lineRows);
                if (itemsErr) {
                  errors.push(`${kind} ${inv.id} items: ${itemsErr.message}`);
                } else {
                  itemsInserted += lineRows.length;
                }
              }
            }
          } catch (mapErr) {
            errors.push(`${kind} ${inv.id}: ${(mapErr as Error).message}`);
            skipped++;
          }
        }

        if (results.length < PAGE_SIZE) break;
        page++;
      }
    }

    await admin.from("user_siigo_credentials").update({
      connection_status: "connected",
      last_sync_at: new Date().toISOString(),
      last_invoice_pulled_at: new Date().toISOString(),
      last_error: errors.length > 0 ? errors.slice(0, 5).join(" | ") : null,
    }).eq("user_id", userId);

    return json({
      ok: true,
      synced: inserted,
      updated,
      skipped,
      items_inserted: itemsInserted,
      errors: errors.slice(0, 20),
      since,
      until,
      kinds,
      debug,
    });
  } catch (e) {
    return json({ ok: false, error: "Error inesperado", detail: (e as Error).message }, 500);
  }
});

function mapSiigoInvoice(
  inv: SiigoInvoice,
  kind: Kind,
  userId: string,
  items: SiigoLine[],
  resolvedCounterpartyName: string | null,
) {
  const counterparty = kind === "venta" ? inv.customer : inv.supplier;

  const total = num(inv.total);

  // Prefer header-level taxes when Siigo provides them; fall back to summing
  // from items (Siigo's /v1/invoices returns taxes only inside items).
  let ivaTax = (inv.taxes ?? []).find(
    (t) => /iva/i.test(t.name ?? "") || t.percentage === 19,
  );
  let ivaAmount = num(ivaTax?.value);
  let ivaRate = ivaTax?.percentage ? ivaTax.percentage / 100 : 0;

  if (ivaAmount === 0 && items.length > 0) {
    let sumIva = 0;
    let ratePick = 0;
    for (const line of items) {
      const lineIva = (line.taxes ?? []).find(
        (t) => /iva/i.test(t.name ?? "") || t.percentage === 19,
      );
      if (lineIva) {
        sumIva += num(lineIva.value);
        if (ratePick === 0 && lineIva.percentage) ratePick = lineIva.percentage / 100;
      }
    }
    if (sumIva > 0) {
      ivaAmount = sumIva;
      ivaRate = ratePick;
    }
  }

  const subtotal = Math.max(total - ivaAmount, 0);

  const prefix = inv.document?.code ?? null;
  const number = inv.number ?? null;
  const invoiceNumber = inv.name
    ?? (prefix && number ? `${prefix}-${number}` : (number ? String(number) : inv.id));

  return {
    user_id: userId,
    source: "siigo",
    siigo_id: inv.id,
    type: kind,
    status: "confirmed",
    invoice_number: invoiceNumber,
    prefix,
    number_int: number,
    issue_date: inv.date ?? today(),
    due_date: inv.due_date ?? null,
    counterparty_name: resolvedCounterpartyName,
    counterparty_nit: counterparty?.identification ?? null,
    subtotal_base: subtotal,
    iva_rate: ivaRate,
    iva_amount: ivaAmount,
    total_amount: total,
    cufe: inv.stamp?.cufe ?? null,
    payment_method: inv.payments?.[0]?.name ?? null,
    extracted_data: inv as unknown as Record<string, unknown>,
    confidence_score: 1,
  };
}

function mapSiigoLine(
  line: SiigoLine,
  invoiceId: string,
  userId: string,
  fallbackIvaRate: number,
) {
  const code = line.product?.code ?? line.code ?? null;
  const description = line.product?.description ?? line.description ?? code ?? "";
  const quantity = num(line.quantity) || 1;
  const unitPrice = num(line.price);
  const grossBase = quantity * unitPrice;

  // Discount can be a flat number or {value, percentage}
  let discountAmount = 0;
  if (typeof line.discount === "number") {
    discountAmount = num(line.discount);
  } else if (line.discount && typeof line.discount === "object") {
    if (line.discount.value != null) discountAmount = num(line.discount.value);
    else if (line.discount.percentage != null) discountAmount = grossBase * (num(line.discount.percentage) / 100);
  }
  const lineBase = Math.max(0, grossBase - discountAmount);

  const ivaTax = (line.taxes ?? []).find(
    (t) => /iva/i.test(t.name ?? "") || t.percentage === 19,
  );
  const ivaRate = ivaTax?.percentage != null
    ? num(ivaTax.percentage) / 100
    : fallbackIvaRate ?? 0;
  const ivaAmount = ivaTax?.value != null
    ? num(ivaTax.value)
    : Math.round(lineBase * ivaRate);
  const lineTotal = num(line.total) || (lineBase + ivaAmount);

  return {
    invoice_id: invoiceId,
    user_id: userId,
    item_code: code,
    reference: code,
    description,
    quantity,
    unit_price: unitPrice,
    line_base: lineBase,
    iva_rate: ivaRate,
    iva_amount: ivaAmount,
    line_total: lineTotal,
  };
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(d: number): string {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() - d);
  return t.toISOString().slice(0, 10);
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
