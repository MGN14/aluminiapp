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
  /** Saldo pendiente según Siigo. Si la factura está totalmente pagada,
   *  Siigo manda 0. Si no se ha cobrado nada, manda total_amount. */
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
      /** Sincronización completa: ignora last_invoice_pulled_at y trae
       *  desde 1 ene del año actual. Útil para recuperar facturas borradas
       *  o forzar re-import tras cambios estructurales. */
      full?: boolean;
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

    // ── Carga de responsibles + aliases para resolver responsible_id ──
    // 3 índices in-memory:
    //   - byNit: NIT normalizado (solo dígitos) → más confiable
    //   - byName: nombre canónico del responsible (lower + trim)
    //   - byAlias: cualquier alias asociado al responsible (lower + trim)
    //
    // Match prioriza NIT > byName > byAlias. Si nada matchea, auto-crea.
    const [respListRes, aliasListRes] = await Promise.all([
      admin
        .from("responsibles")
        .select("id, name, nit")
        .eq("user_id", userId)
        .eq("active", true),
      admin
        .from("responsible_aliases")
        .select("responsible_id, alias")
        .eq("user_id", userId),
    ]);

    const respByNit = new Map<string, string>();
    const respByName = new Map<string, string>();
    const respByAlias = new Map<string, string>();
    for (const r of (respListRes.data ?? []) as Array<{ id: string; name: string; nit: string | null }>) {
      if (r.nit) {
        const norm = String(r.nit).replace(/[^0-9]/g, "");
        if (norm.length >= 6) respByNit.set(norm, r.id);
      }
      if (r.name) {
        respByName.set(r.name.trim().toLowerCase(), r.id);
      }
    }
    for (const a of (aliasListRes.data ?? []) as Array<{ responsible_id: string; alias: string }>) {
      if (a.alias) {
        respByAlias.set(a.alias.trim().toLowerCase(), a.responsible_id);
      }
    }
    let respAutoCreated = 0;
    let aliasesAutoCreated = 0;

    // Re-sync uses a 30-day rolling window instead of last_invoice_pulled_at:
    // Siigo filters by document date (not API creation), and users often create
    // invoices backdated a day or two. Using the exact pulled_at timestamp
    // silently drops invoices with issue_date < pulled_at. First sync uses 90d.
    //
    // body.full=true → ignora todo y trae desde 1 ene del año actual (caso
    // típico: el user borró una factura y necesita re-traerla, o quiere
    // re-importar todo después de cambios estructurales).
    const since = body.full
      ? `${new Date().getFullYear()}-01-01`
      : (body.since
          ?? (creds.last_invoice_pulled_at ? daysAgo(30) : daysAgo(90)));
    const until = body.until ?? tomorrow();
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
        // Leemos SIEMPRE el body como texto primero: si compra falla o viene
        // vacío, necesitamos el crudo para distinguir la rama del bug
        // (401/403 = scope del plan, 404 = ruta, 200 con otra key = shape,
        // 200 vacío = ventana/filtro). Ver fix-siigo-compras.md.
        const rawText = await res.text().catch(() => "");
        if (!res.ok) {
          errors.push(`${kind} page ${page}: ${res.status} ${rawText.slice(0, 300)}`);
          debug[`${kind}_error_p${page}`] = {
            status: res.status,
            body: rawText.slice(0, 500),
            url: url.toString(),
          };
          console.log(`[siigo-sync-invoices] ${kind} ERROR p${page}: ${res.status} ${rawText.slice(0, 500)}`);
          break;
        }
        let payload: { results?: SiigoInvoice[]; pagination?: { total_results?: number } };
        try {
          payload = JSON.parse(rawText) as typeof payload;
        } catch {
          errors.push(`${kind} page ${page}: respuesta no-JSON ${rawText.slice(0, 200)}`);
          debug[`${kind}_nojson_p${page}`] = { body: rawText.slice(0, 500), url: url.toString() };
          break;
        }
        const results = payload.results ?? [];
        if (page === 1) {
          const pageDebug = {
            total_results: payload.pagination?.total_results ?? null,
            returned: results.length,
            numbers: results.map(r => r.number ?? r.name ?? r.id).slice(0, 10),
            url: url.toString(),
            payload_keys: Object.keys(payload ?? {}),
            // Body crudo solo cuando compra viene vacía — ahí está la evidencia
            ...(kind === "compra" && results.length === 0
              ? { raw: rawText.slice(0, 500) }
              : {}),
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

            // 1) Resolver responsible_id (match por NIT > nombre > alias > auto-crear)
            const resolved = await resolveOrCreateResponsible(
              admin,
              counterparty,
              counterpartyName,
              userId,
              respByNit,
              respByName,
              respByAlias,
            );
            const resolvedResponsibleId = resolved.id;
            if (resolved.autoCreated) respAutoCreated++;
            if (resolved.aliasCreated) aliasesAutoCreated++;

            // 2) Preservar responsible_id manual: si la factura ya existe en BD
            //    con un responsible asignado, no sobre-escribir (puede ser una
            //    corrección manual del usuario que no queremos perder).
            const { data: existingInv } = await admin
              .from("invoices")
              .select("responsible_id")
              .eq("user_id", userId)
              .eq("siigo_id", inv.id)
              .maybeSingle();
            const finalResponsibleId =
              (existingInv as { responsible_id: string | null } | null)?.responsible_id
              ?? resolvedResponsibleId;

            const row = mapSiigoInvoice(inv, kind, userId, items, counterpartyName, finalResponsibleId);
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

    // ── Sync de notas crédito (NC) — solo si se incluyó 'venta' en kinds.
    // Razón: una factura Siigo puede ser anulada con NC. La NC referencia la
    // factura origen y reduce su valor efectivo. La app debe excluir las
    // facturas voided (total) de KPIs de facturación, IVA, etc.
    let creditNotesProcessed = 0;
    let invoicesVoided = 0;
    if (kinds.includes("venta")) {
      try {
        const ncResult = await syncCreditNotes({
          admin,
          userId,
          since,
          until,
          apiHeaders,
        });
        creditNotesProcessed = ncResult.processed;
        invoicesVoided = ncResult.voided;
        debug.credit_notes = ncResult.debug;
        if (ncResult.errors.length > 0) {
          errors.push(...ncResult.errors.map(e => `NC: ${e}`));
        }
      } catch (e) {
        errors.push(`NC sync error: ${(e as Error).message}`);
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
      responsibles_auto_created: respAutoCreated,
      aliases_auto_created: aliasesAutoCreated,
      credit_notes_processed: creditNotesProcessed,
      invoices_voided: invoicesVoided,
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

/**
 * Resuelve el responsible_id para una factura Siigo. Estrategia:
 *   1) Match por NIT normalizado (solo dígitos, sin DV) — más confiable
 *   2) Match por nombre normalizado (lower + trim)
 *   3) Auto-crear si no existe (decisión del usuario)
 *
 * Mantiene los maps in-memory actualizados para que próximas facturas del
 * mismo cliente en el mismo batch resuelvan rápido.
 */
async function resolveOrCreateResponsible(
  admin: ReturnType<typeof createClient>,
  counterparty: { identification?: string; name?: string | string[] } | undefined,
  resolvedName: string | null,
  userId: string,
  byNit: Map<string, string>,
  byName: Map<string, string>,
  byAlias: Map<string, string>,
): Promise<{ id: string | null; autoCreated: boolean; aliasCreated: boolean }> {
  const nit = counterparty?.identification ?? null;
  const name = (resolvedName ?? "").trim() || null;
  const nameKey = name ? name.toLowerCase() : null;
  if (!nit && !name) return { id: null, autoCreated: false, aliasCreated: false };

  // Helper: registrar el nombre Siigo como alias si difiere del canónico
  const ensureAlias = async (responsibleId: string): Promise<boolean> => {
    if (!nameKey) return false;
    if (byName.get(nameKey) === responsibleId) return false; // ya es el canónico
    if (byAlias.get(nameKey) === responsibleId) return false; // ya hay alias
    // Crear alias auto desde Siigo
    const { error } = await admin
      .from("responsible_aliases")
      .insert({
        user_id: userId,
        responsible_id: responsibleId,
        alias: name!,
        source: "siigo",
      });
    if (!error) {
      byAlias.set(nameKey, responsibleId);
      return true;
    }
    // Conflict (ya existía con otro responsible) — ignoramos silenciosamente
    return false;
  };

  // 1) Match por NIT normalizado (más confiable)
  if (nit) {
    const norm = String(nit).replace(/[^0-9]/g, "");
    if (norm.length >= 6 && byNit.has(norm)) {
      const id = byNit.get(norm)!;
      const aliasCreated = await ensureAlias(id);
      return { id, autoCreated: false, aliasCreated };
    }
  }

  // 2) Match por nombre canónico
  if (nameKey && byName.has(nameKey)) {
    return { id: byName.get(nameKey)!, autoCreated: false, aliasCreated: false };
  }

  // 3) Match por alias (un nombre alternativo previo)
  if (nameKey && byAlias.has(nameKey)) {
    return { id: byAlias.get(nameKey)!, autoCreated: false, aliasCreated: false };
  }

  // 4) Auto-crear responsible nuevo
  const insertName = name ?? `Cliente NIT ${nit}`;
  const { data: created, error } = await admin
    .from("responsibles")
    .insert({
      user_id: userId,
      name: insertName,
      nit: nit ?? null,
      active: true,
      responsible_type: "banking",
    })
    .select("id")
    .single();
  if (error || !created) {
    console.warn(`[siigo-sync-invoices] auto-create responsible failed`, error);
    return { id: null, autoCreated: false, aliasCreated: false };
  }

  // Actualizar caches in-memory
  if (nit) {
    const norm = String(nit).replace(/[^0-9]/g, "");
    if (norm.length >= 6) byNit.set(norm, created.id);
  }
  byName.set(insertName.trim().toLowerCase(), created.id);

  // Crear alias canónico (= mismo nombre) en aliases para consistencia
  await admin
    .from("responsible_aliases")
    .insert({
      user_id: userId,
      responsible_id: created.id,
      alias: insertName,
      source: "siigo",
    })
    .then(({ error: aliasErr }) => {
      if (!aliasErr) byAlias.set(insertName.trim().toLowerCase(), created.id);
    });

  return { id: created.id, autoCreated: true, aliasCreated: true };
}

function mapSiigoInvoice(
  inv: SiigoInvoice,
  kind: Kind,
  userId: string,
  items: SiigoLine[],
  resolvedCounterpartyName: string | null,
  responsibleId: string | null,
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
    responsible_id: responsibleId,
    // Saldo pendiente según Siigo — source of truth para "Lo que me deben".
    // Si Siigo no manda balance, asumimos total (factura sin cobrar).
    balance_pending: typeof inv.balance === "number" ? inv.balance : total,
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

// Siigo interpreta `created_end=YYYY-MM-DD` como "antes de las 00:00 UTC
// de ese día", lo que excluye TODO el día indicado. Usamos mañana como
// upper bound para asegurar que el día de hoy se incluye completo.
function tomorrow(): string {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
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

// ────────────────────────────────────────────────────────────────────────────
// Sync de notas crédito (NCs) desde Siigo
//
// Las NCs anulan o reducen el valor de una factura. Cada NC referencia la
// factura origen vía `invoice.id` (siigo_id) o vía `number` (fallback).
// Marcamos la factura como voided cuando la suma de NCs >= total.
// ────────────────────────────────────────────────────────────────────────────
interface SiigoCreditNote {
  id: string;
  document?: { id?: number; code?: string };
  number?: number;
  name?: string;
  date?: string;
  total?: number;
  invoice?: {
    id?: string;        // siigo_id de la factura origen
    number?: number;
    prefix?: string;
  };
  // Algunos tenants exponen el link como array de "references"
  references?: Array<{
    document?: { id?: string };
    number?: number;
  }>;
  items?: SiigoLine[];
}

async function syncCreditNotes(opts: {
  admin: ReturnType<typeof createClient>;
  userId: string;
  since: string;
  until: string;
  apiHeaders: Record<string, string>;
}): Promise<{
  processed: number;
  voided: number;
  errors: string[];
  debug: Record<string, unknown>;
}> {
  const { admin, userId, since, until, apiHeaders } = opts;
  let processed = 0;
  let voided = 0;
  const errors: string[] = [];
  const debug: Record<string, unknown> = {};

  // Acumulador en memoria: invoice_siigo_id → { amount_total_nc, last_nc_id, last_nc_number }
  // Se aplica al final como UPDATE por factura.
  const ncByInvoice = new Map<string, {
    totalNc: number;
    lastNcSiigoId: string;
    lastNcNumber: string | null;
  }>();

  let page = 1;
  while (true) {
    const url = new URL(SIIGO_BASE + "/v1/credit-notes");
    url.searchParams.set("created_start", since);
    url.searchParams.set("created_end", until);
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", String(PAGE_SIZE));

    const res = await fetch(url.toString(), { headers: apiHeaders });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      errors.push(`page ${page}: ${res.status} ${detail.slice(0, 200)}`);
      break;
    }
    const payload = await res.json() as {
      results?: SiigoCreditNote[];
      pagination?: { total_results?: number };
    };
    const results = payload.results ?? [];
    if (page === 1) {
      debug.page1 = {
        total_results: payload.pagination?.total_results ?? null,
        returned: results.length,
        numbers: results.map(r => r.number ?? r.name ?? r.id).slice(0, 10),
        url: url.toString(),
      };
    }
    if (results.length === 0) break;

    for (const nc of results) {
      processed++;
      // Resolver siigo_id de la factura origen (prioridad: invoice.id, references)
      const invoiceSiigoId =
        nc.invoice?.id
        ?? (nc.references ?? [])
          .map(r => r.document?.id)
          .find((id): id is string => !!id)
        ?? null;
      if (!invoiceSiigoId) {
        errors.push(`${nc.id}: sin referencia a factura origen`);
        continue;
      }
      const ncTotal = num(nc.total);
      if (ncTotal <= 0) continue;
      const ncNumber = nc.name ?? (nc.number != null ? String(nc.number) : null);
      const prev = ncByInvoice.get(invoiceSiigoId);
      ncByInvoice.set(invoiceSiigoId, {
        totalNc: (prev?.totalNc ?? 0) + ncTotal,
        lastNcSiigoId: nc.id,
        lastNcNumber: ncNumber,
      });
    }

    if (results.length < PAGE_SIZE) break;
    page++;
  }

  // Aplicar a cada factura: leer total_amount, calcular si es total o parcial,
  // hacer UPDATE.
  for (const [invSiigoId, agg] of ncByInvoice.entries()) {
    const { data: inv } = await admin
      .from("invoices")
      .select("id, total_amount")
      .eq("user_id", userId)
      .eq("siigo_id", invSiigoId)
      .maybeSingle();
    if (!inv) {
      // La factura origen no está sincronizada en la app (rara). Skip.
      continue;
    }
    const totalAmount = num((inv as { total_amount: number }).total_amount);
    // total NC >= 99% del total factura → consideramos anulación total
    // (Siigo a veces tiene diferencias de centavos por redondeo)
    const isTotal = totalAmount > 0 && agg.totalNc >= totalAmount * 0.99;
    const { error: updErr } = await admin
      .from("invoices")
      .update({
        voided_at: new Date().toISOString(),
        voided_amount: agg.totalNc,
        voided_by_credit_note_id: agg.lastNcSiigoId,
        voided_by_credit_note_number: agg.lastNcNumber,
        void_type: isTotal ? "total" : "partial",
      })
      .eq("id", (inv as { id: string }).id);
    if (updErr) {
      errors.push(`update invoice ${invSiigoId}: ${updErr.message}`);
    } else if (isTotal) {
      voided++;
    }
  }

  return { processed, voided, errors, debug };
}
