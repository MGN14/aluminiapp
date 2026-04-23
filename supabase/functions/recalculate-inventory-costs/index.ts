// Edge function: recalculate-inventory-costs
// Computes weighted-average cost per inventory product from the user's purchase
// invoices (invoices.type='compra' + invoice_items) and writes it back to
// inventory_products.cost_per_unit. This is Plan B for getting unit cost when
// Siigo's API doesn't expose the "Saldo de productos y valoración de inventarios"
// report — we calculate it from data we already have.
//
// Match key: invoice_items.reference == inventory_products.reference (case-insensitive).
//
// Request:
//   POST /functions/v1/recalculate-inventory-costs
//   Authorization: Bearer <user JWT>
//
// Response: { ok, updated, skipped, sources_used }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1) Pull all purchase-invoice line items for this user.
    //    We join via two queries (no FK syntax in PostgREST without alias).
    const { data: purchaseInvoices, error: invErr } = await admin
      .from("invoices")
      .select("id")
      .eq("user_id", userId)
      .eq("type", "compra");
    if (invErr) return json({ ok: false, error: invErr.message }, 500);

    const purchaseIds = (purchaseInvoices ?? []).map(i => i.id);
    if (purchaseIds.length === 0) {
      return json({
        ok: true,
        updated: 0,
        skipped: 0,
        sources_used: 0,
        message: "Sin facturas de compra para calcular costos.",
      });
    }

    // Fetch items in chunks (PostgREST .in() can balk at very large arrays).
    const items: Array<{ reference: string | null; quantity: number; unit_price: number }> = [];
    const CHUNK = 500;
    for (let i = 0; i < purchaseIds.length; i += CHUNK) {
      const slice = purchaseIds.slice(i, i + CHUNK);
      const { data, error } = await admin
        .from("invoice_items")
        .select("reference, quantity, unit_price")
        .eq("user_id", userId)
        .in("invoice_id", slice)
        .not("reference", "is", null);
      if (error) return json({ ok: false, error: error.message }, 500);
      for (const it of data ?? []) {
        items.push({
          reference: it.reference,
          quantity: Number(it.quantity) || 0,
          unit_price: Number(it.unit_price) || 0,
        });
      }
    }

    // 2) Group by normalized reference, compute weighted average.
    //    weighted_avg = Σ(qty * unit_price) / Σ(qty)
    const totals = new Map<string, { qtySum: number; valSum: number; lines: number }>();
    for (const it of items) {
      if (!it.reference || it.quantity <= 0 || it.unit_price <= 0) continue;
      const key = norm(it.reference);
      const cur = totals.get(key) ?? { qtySum: 0, valSum: 0, lines: 0 };
      cur.qtySum += it.quantity;
      cur.valSum += it.quantity * it.unit_price;
      cur.lines += 1;
      totals.set(key, cur);
    }

    if (totals.size === 0) {
      return json({
        ok: true,
        updated: 0,
        skipped: 0,
        sources_used: 0,
        message: "Las facturas de compra no tienen líneas con referencia + cantidad + precio.",
      });
    }

    // 3) Pull all active inventory products for this user, match by normalized ref.
    const { data: products, error: prodErr } = await admin
      .from("inventory_products")
      .select("id, reference, cost_per_unit")
      .eq("user_id", userId)
      .eq("active", true);
    if (prodErr) return json({ ok: false, error: prodErr.message }, 500);

    let updated = 0;
    let skipped = 0;
    const sourcesUsed = new Set<string>();
    for (const p of products ?? []) {
      const key = norm(p.reference || "");
      const agg = totals.get(key);
      if (!agg || agg.qtySum <= 0) {
        skipped++;
        continue;
      }
      const newCost = Math.round((agg.valSum / agg.qtySum) * 100) / 100;
      if (newCost <= 0) { skipped++; continue; }
      // Skip if essentially unchanged (avoid noisy updates).
      if (Math.abs(newCost - Number(p.cost_per_unit || 0)) < 0.005) {
        sourcesUsed.add(key);
        continue;
      }
      const { error: upErr } = await admin
        .from("inventory_products")
        .update({ cost_per_unit: newCost, updated_at: new Date().toISOString() })
        .eq("id", p.id)
        .eq("user_id", userId);
      if (upErr) { skipped++; continue; }
      updated++;
      sourcesUsed.add(key);
    }

    return json({
      ok: true,
      updated,
      skipped,
      sources_used: sourcesUsed.size,
      total_purchase_invoices: purchaseIds.length,
      total_purchase_lines: items.length,
    });
  } catch (e) {
    return json(
      { ok: false, error: "Error inesperado", detail: (e as Error).message },
      500,
    );
  }
});

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
