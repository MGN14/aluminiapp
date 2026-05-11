// Edge function: siigo-sync-products
// Pulls the user's Siigo product catalog (/v1/products) with full pagination
// and upserts into public.inventory_products with source='siigo' and a stable
// siigo_id for idempotency.
//
// Cost mapping: Siigo doesn't expose unit cost in /v1/products by default.
// We probe several common locations (additional_fields.cost, a price_list entry
// labeled "Costo", or any second price entry) and fall back to 0 — preserving
// any existing manual cost on update via a COALESCE-style merge.
//
// Request:
//   POST /functions/v1/siigo-sync-products
//   Authorization: Bearer <user JWT>
//   Body (optional): { active_only?: boolean }   defaults to true
//
// Response: { ok, synced, skipped, errors[] }

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

interface SiigoPriceEntry {
  position?: number;
  value?: number;
  name?: string;
}
interface SiigoPriceList {
  currency_code?: string;
  price_list?: SiigoPriceEntry[];
}
interface SiigoWarehouse {
  id?: number | string;
  name?: string;
  quantity?: number;
}
interface SiigoProduct {
  id: string;
  code?: string;
  reference?: string;
  name?: string;
  description?: string;
  active?: boolean;
  type?: string;
  stock_control?: boolean;
  unit?: { code?: string; name?: string };
  unit_label?: string;
  prices?: SiigoPriceList[];
  available_quantity?: number;
  warehouses?: SiigoWarehouse[];
  additional_fields?: Record<string, unknown>;
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

    const body = await req.json().catch(() => ({})) as { active_only?: boolean };
    const activeOnly = body.active_only !== false;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: creds, error: credsErr } = await admin
      .from("user_siigo_credentials")
      .select("siigo_username, siigo_access_key_encrypted, partner_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (credsErr || !creds) {
      return json(
        { ok: false, error: "Sin credenciales de Siigo. Conecta primero en Configuración." },
        400,
      );
    }

    const accessKey = await decryptSecret(creds.siigo_access_key_encrypted);

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

    // Pre-load ALL existing products so we can:
    // 1. Preserve manual cost overrides (never overwrite a non-zero manual cost with 0).
    // 2. Link manual rows (siigo_id=null) to their Siigo counterpart BY reference —
    //    otherwise the upsert creates duplicates and leaves the manual row orphaned.
    // 3. Detectar incrementos de stock entre syncs para registrar entradas
    //    sintéticas en inventory_movements (caso importador: el contenedor
    //    se carga directo en Siigo sin factura de compra DIAN).
    const { data: existing } = await admin
      .from("inventory_products")
      .select("id, siigo_id, reference, cost_per_unit, stock_system")
      .eq("user_id", userId);
    const existingBySiigoId = new Map<string, { id: string; cost: number; stock: number }>();
    const manualByReference = new Map<string, { id: string; cost: number; stock: number }>();
    for (const row of existing ?? []) {
      const cost = Number(row.cost_per_unit) || 0;
      const stock = Number(row.stock_system) || 0;
      if (row.siigo_id) {
        existingBySiigoId.set(row.siigo_id, { id: row.id, cost, stock });
      } else if (row.reference) {
        manualByReference.set(row.reference.trim().toLowerCase(), { id: row.id, cost, stock });
      }
    }

    let synced = 0;
    let skipped = 0;
    let entriesLogged = 0;
    const errors: string[] = [];
    const nowIso = new Date().toISOString();
    const todayDate = nowIso.slice(0, 10);

    let page = 1;
    while (true) {
      const url = new URL(SIIGO_BASE + "/v1/products");
      url.searchParams.set("page", String(page));
      url.searchParams.set("page_size", String(PAGE_SIZE));
      if (activeOnly) url.searchParams.set("active", "true");

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Partner-Id": creds.partner_id,
        },
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        errors.push(`page ${page}: ${res.status} ${detail.slice(0, 200)}`);
        break;
      }
      const payload = await res.json() as { results?: SiigoProduct[] };
      const results = payload.results ?? [];
      if (results.length === 0) break;

      for (const p of results) {
        try {
          // Prefer reusing a manual row that matches by reference — this adopts
          // the existing product instead of creating a Siigo duplicate next to it.
          const refKey = (p.code ?? p.reference ?? p.id).trim().toLowerCase();
          const manualMatch = manualByReference.get(refKey);
          const existingSiigo = existingBySiigoId.get(p.id);
          const carriedCost = existingSiigo?.cost
            ?? (manualMatch?.cost && manualMatch.cost > 0 ? manualMatch.cost : undefined);
          const row = mapSiigoProduct(p, userId, nowIso, carriedCost);

          // Stock anterior y nuevo — para detectar entradas (caso importador:
          // contenedor cargado directo en Siigo, sin factura de compra DIAN).
          // Solo registramos entrada si el producto YA existía y el delta es
          // positivo. Productos nuevos no generan entrada (es initial load).
          const previousProduct = existingSiigo ?? manualMatch ?? null;
          const oldStock = previousProduct?.stock ?? 0;
          const newStock = row.stock_system;
          const delta = newStock - oldStock;
          let productId: string | null = previousProduct?.id ?? null;

          let error: { message: string } | null = null;
          if (manualMatch) {
            const res = await admin
              .from("inventory_products")
              .update(row)
              .eq("id", manualMatch.id);
            error = res.error;
            if (!error) manualByReference.delete(refKey);
          } else {
            const res = await admin
              .from("inventory_products")
              .upsert(row, { onConflict: "user_id,siigo_id" })
              .select("id")
              .single();
            error = res.error;
            if (!error && res.data?.id) productId = res.data.id;
          }

          if (error) {
            errors.push(`${p.id}: ${error.message}`);
            skipped++;
          } else {
            synced++;
            // Registrar entrada sintética en inventory_movements si:
            // - El producto ya existía en DB (no es initial load)
            // - El stock subió (delta > 0)
            // - Tenemos product_id válido
            if (previousProduct && delta > 0 && productId) {
              const cost = Number(row.cost_per_unit) || 0;
              const { error: movErr } = await admin
                .from("inventory_movements")
                .insert({
                  user_id: userId,
                  product_id: productId,
                  movement_type: "entrada",
                  quantity: delta,
                  unit_cost: cost,
                  total_cost: delta * cost,
                  movement_date: todayDate,
                  notes: `[Auto: ajuste stock Siigo ${oldStock} → ${newStock}]`,
                });
              if (movErr) {
                errors.push(`${p.id} mov: ${movErr.message}`);
              } else {
                entriesLogged++;
              }
            }
          }
        } catch (mapErr) {
          errors.push(`${p.id}: ${(mapErr as Error).message}`);
          skipped++;
        }
      }

      if (results.length < PAGE_SIZE) break;
      page++;
    }

    await admin.from("user_siigo_credentials").update({
      last_sync_at: nowIso,
      last_products_pulled_at: nowIso,
      last_error: errors.length > 0 ? errors.slice(0, 5).join(" | ") : null,
    }).eq("user_id", userId);

    return json({ ok: true, synced, skipped, entriesLogged, errors: errors.slice(0, 20) });
  } catch (e) {
    return json({ ok: false, error: "Error inesperado", detail: (e as Error).message }, 500);
  }
});

function mapSiigoProduct(
  p: SiigoProduct,
  userId: string,
  nowIso: string,
  existingCost: number | undefined,
) {
  const reference = p.code ?? p.reference ?? p.id;
  const name = p.name ?? reference;
  const unit = p.unit_label ?? p.unit?.name ?? "und";

  // Stock: prefer warehouses sum (most accurate), fall back to available_quantity.
  const warehouseTotal = (p.warehouses ?? []).reduce(
    (sum, w) => sum + (Number(w.quantity) || 0),
    0,
  );
  const stock = warehouseTotal > 0 ? warehouseTotal : (Number(p.available_quantity) || 0);

  // Sale price: first price list, first entry.
  const firstPriceList = p.prices?.[0]?.price_list ?? [];
  const salePrice = Number(firstPriceList[0]?.value) || 0;

  // Cost: best-effort. Siigo's /v1/products doesn't always include cost.
  // Probe in order: additional_fields.cost, price entry named /costo/i, second
  // price entry. If nothing is found AND we have a previous manual cost, keep it.
  const probedCost = probeCost(p);
  const cost = probedCost > 0
    ? probedCost
    : (existingCost && existingCost > 0 ? existingCost : 0);

  return {
    user_id: userId,
    source: "siigo",
    siigo_id: p.id,
    reference,
    name,
    unit,
    stock_system: stock,
    cost_per_unit: cost,
    sale_price: salePrice,
    active: p.active !== false,
    last_siigo_sync_at: nowIso,
  };
}

function probeCost(p: SiigoProduct): number {
  const af = p.additional_fields ?? {};
  const direct = Number(af.cost ?? af.unit_cost ?? af.costo);
  if (Number.isFinite(direct) && direct > 0) return direct;

  for (const list of p.prices ?? []) {
    for (const entry of list.price_list ?? []) {
      if (entry.name && /costo|cost/i.test(entry.name)) {
        const v = Number(entry.value);
        if (Number.isFinite(v) && v > 0) return v;
      }
    }
  }
  // Last resort: a second price entry, if present.
  const second = p.prices?.[0]?.price_list?.[1]?.value;
  return Number(second) || 0;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
