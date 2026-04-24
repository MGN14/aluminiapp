// Edge function: sync-macro-indicators
// Pulls Colombian macro indicators (currently TRM only) into public.macro_indicators.
// Designed to be called daily by pg_cron / scheduled-tasks.
//
// Sources:
//   - TRM:    datos.gov.co dataset 32sa-8pi3 (Superfinanciera, daily)
//   - DTF/IBR/IPC/PIB: blocked by BanRep/DANE bot managers; pending Firecrawl
//
// Request:
//   POST /functions/v1/sync-macro-indicators
//   Headers: x-cron-secret: <CRON_SECRET>   (or service-role bearer)
//   Body (optional): { indicators?: ['trm'] }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TRM_DATASET = "32sa-8pi3";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const CRON_SECRET = Deno.env.get("MACRO_CRON_SECRET");

  // AuthN: either a cron secret header OR a service-role bearer.
  const cronHeader = req.headers.get("x-cron-secret");
  const authHeader = req.headers.get("Authorization") ?? "";
  const isCron = !!CRON_SECRET && cronHeader === CRON_SECRET;
  const isServiceRole = authHeader === `Bearer ${SERVICE_ROLE_KEY}`;
  if (!isCron && !isServiceRole) {
    return json({ error: "No autorizado" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const body = await req.json().catch(() => ({})) as { indicators?: string[] };
  const wanted = body.indicators && body.indicators.length > 0
    ? body.indicators
    : ["trm"];

  const results: Record<string, unknown> = {};
  const errors: string[] = [];

  if (wanted.includes("trm")) {
    try {
      results.trm = await syncTrm(admin);
    } catch (e) {
      errors.push(`trm: ${(e as Error).message}`);
    }
  }

  return json({ ok: errors.length === 0, results, errors });
});

async function syncTrm(admin: ReturnType<typeof createClient>) {
  // Pull last 30 days so we backfill if cron missed runs.
  const url = `https://www.datos.gov.co/resource/${TRM_DATASET}.json?$limit=30&$order=vigenciadesde DESC`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`datos.gov.co ${res.status}`);
  const rows = await res.json() as Array<{
    valor: string;
    unidad: string;
    vigenciadesde: string;
  }>;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { inserted: 0, message: "no rows from datos.gov.co" };
  }

  const payload = rows.map(r => ({
    indicator_type: "trm",
    sector_code: "",
    sector_name: null,
    period_date: r.vigenciadesde.slice(0, 10),
    value: Number(r.valor),
    unit: r.unidad ?? "COP",
    source: "datos.gov.co",
    metadata: { dataset: TRM_DATASET },
  })).filter(r => Number.isFinite(r.value) && r.value > 0);

  if (payload.length === 0) return { inserted: 0, message: "no valid rows" };

  const { error } = await admin
    .from("macro_indicators")
    .upsert(payload, { onConflict: "indicator_type,sector_code,period_date" });

  if (error) throw new Error(error.message);

  return {
    inserted: payload.length,
    latest: { date: payload[0].period_date, value: payload[0].value },
  };
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
