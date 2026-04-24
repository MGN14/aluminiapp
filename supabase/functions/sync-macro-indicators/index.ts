// Edge function: sync-macro-indicators
// Pulls Colombian macro indicators into public.macro_indicators.
// Designed to be called daily by pg_cron / scheduled-tasks.
//
// Sources:
//   - TRM: datos.gov.co dataset 32sa-8pi3 (Superfinanciera, daily)
//   - DTF: BanRep vía Firecrawl (scrape del HTML público)
//   - IPC: DANE vía Firecrawl
//
// Request:
//   POST /functions/v1/sync-macro-indicators
//   Headers: x-cron-secret: <CRON_SECRET>   (or service-role bearer)
//   Body (optional): { indicators?: ['trm' | 'dtf' | 'ipc'] }

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
  const TRIGGER_SECRET = Deno.env.get("MACRO_TRIGGER_SECRET");

  // AuthN: 3 vías aceptadas.
  //   1. x-cron-secret = MACRO_CRON_SECRET     (usado por pg_cron)
  //   2. Authorization: Bearer <service_role>  (testing desde CLI)
  //   3. Authorization: Bearer <TRIGGER_SECRET> (manual testing, secret custom)
  const cronHeader = req.headers.get("x-cron-secret");
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  const isCron = !!CRON_SECRET && cronHeader === CRON_SECRET;
  const isServiceRole = !!SERVICE_ROLE_KEY && bearer === SERVICE_ROLE_KEY;
  const isTrigger = !!TRIGGER_SECRET && bearer === TRIGGER_SECRET;

  if (!isCron && !isServiceRole && !isTrigger) {
    console.log(`[auth-denied] cronHdr=${cronHeader ? "present" : "absent"} bearerLen=${bearer.length} srvKeySet=${!!SERVICE_ROLE_KEY} triggerSet=${!!TRIGGER_SECRET}`);
    return json({ error: "No autorizado" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const body = await req.json().catch(() => ({})) as {
    indicators?: string[];
    dryRun?: boolean;
  };
  const wanted = body.indicators && body.indicators.length > 0
    ? body.indicators
    : ["trm", "dtf", "ipc"];

  // Dry-run mode: scrape y devolvemos snippet del markdown sin intentar parse ni upsert.
  // Útil para ajustar los regex de DTF/IPC con data real.
  if (body.dryRun) {
    const dryResults: Record<string, unknown> = {};
    for (const ind of wanted) {
      if (ind === "dtf" || ind === "ipc") {
        const url = ind === "dtf"
          ? "https://www.banrep.gov.co/es/estadisticas/dtf"
          : "https://www.banrep.gov.co/es/estadisticas/inflacion-total-y-meta";
        try {
          const md = await firecrawlScrape(url);
          // Buscamos las primeras 6 ocurrencias de %  y devolvemos contexto alrededor
          const pctMatches: string[] = [];
          const re = /.{0,80}\d{1,3}[.,]\d{1,4}\s*%.{0,40}/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(md)) !== null && pctMatches.length < 8) {
            pctMatches.push(m[0].replace(/\s+/g, " ").trim());
          }
          dryResults[ind] = {
            totalChars: md.length,
            first800: md.slice(0, 800),
            pctContexts: pctMatches,
          };
        } catch (e) {
          dryResults[ind] = { error: (e as Error).message };
        }
      }
    }
    return json({ dryRun: true, results: dryResults });
  }

  const results: Record<string, unknown> = {};
  const errors: string[] = [];

  if (wanted.includes("trm")) {
    try {
      results.trm = await syncTrm(admin);
    } catch (e) {
      errors.push(`trm: ${(e as Error).message}`);
    }
  }

  if (wanted.includes("dtf")) {
    try {
      results.dtf = await syncDtf(admin);
    } catch (e) {
      errors.push(`dtf: ${(e as Error).message}`);
    }
  }

  if (wanted.includes("ipc")) {
    try {
      results.ipc = await syncIpc(admin);
    } catch (e) {
      errors.push(`ipc: ${(e as Error).message}`);
    }
  }

  return json({ ok: errors.length === 0, results, errors });
});

// ---------- Firecrawl helper ----------

async function firecrawlScrape(url: string): Promise<string> {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) throw new Error("FIRECRAWL_API_KEY no configurada");

  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      waitFor: 1500,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`firecrawl ${res.status}: ${text.slice(0, 300)}`);
  }

  const payload = await res.json() as {
    success?: boolean;
    data?: { markdown?: string };
    error?: string;
  };
  if (!payload.success) {
    throw new Error(`firecrawl error: ${payload.error ?? "unknown"}`);
  }
  return payload.data?.markdown ?? "";
}

// Extrae el primer número formato colombiano (coma decimal, punto miles)
// que aparezca cerca de un keyword. `anchor` es la regex que marca el contexto.
function extractNumberNear(md: string, anchor: RegExp, window = 400): number | null {
  const match = anchor.exec(md);
  if (!match) return null;
  const chunk = md.slice(match.index, match.index + window);
  // busca 2-3 dígitos . opcional miles , 2-4 decimales — o variantes más laxas
  const numMatch = chunk.match(/(\d{1,3}(?:[.,]\d{1,4})?)\s*%/);
  if (!numMatch) return null;
  // normalizar: si hay coma como decimal, convertir
  const normalized = numMatch[1].replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

// ---------- DTF (BanRep) ----------

async function syncDtf(admin: ReturnType<typeof createClient>) {
  const url = "https://www.banrep.gov.co/es/estadisticas/dtf";
  const md = await firecrawlScrape(url);

  // Anchors por especificidad. La página tiene "## Tasa actual: 11,25%" y
  // "## Effective rate 11.25%" como heading principal.
  const value =
    extractNumberNear(md, /Tasa\s+actual/i) ??
    extractNumberNear(md, /Effective\s+rate/i) ??
    extractNumberNear(md, /DTF\s*(?:a\s*90\s*d[ií]as|efectiva\s*anual)/i);

  if (value === null) {
    throw new Error(`no pude extraer DTF del markdown (${md.length} chars)`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const { error } = await admin.from("macro_indicators").upsert(
    [{
      indicator_type: "dtf",
      sector_code: "",
      sector_name: null,
      period_date: today,
      value,
      unit: "%",
      source: "banrep",
      metadata: { method: "firecrawl", url },
    }],
    { onConflict: "indicator_type,sector_code,period_date" },
  );
  if (error) throw new Error(error.message);

  return { value, period_date: today };
}

// ---------- IPC (DANE) ----------

// IPC cascada de 3 fuentes:
//   1. Trading Economics (scrape) — variación YoY mensual, es el valor más fresco
//   2. World Bank API (JSON) — inflación anual del último año cerrado
//   3. Hardcode fallback — última línea de defensa, valor actualizable en código
// Preferimos el más actual; si todas fallan tiramos el error agregado.

async function syncIpc(admin: ReturnType<typeof createClient>) {
  const attempts: Array<() => Promise<IpcResult>> = [
    ipcFromTradingEconomics,
    ipcFromWorldBank,
    ipcFromHardcode,
  ];

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await admin.from("macro_indicators").upsert(
        [{
          indicator_type: "ipc_total",
          sector_code: "",
          sector_name: null,
          period_date: today,
          value: result.value,
          unit: "%",
          source: result.source,
          metadata: {
            ...result.metadata,
            fallbacks_tried: errors,
            measure: "variacion_anual",
          },
        }],
        { onConflict: "indicator_type,sector_code,period_date" },
      );
      if (error) throw new Error(`upsert: ${error.message}`);
      return { value: result.value, period_date: today, source: result.source };
    } catch (e) {
      errors.push(`${attempt.name}: ${(e as Error).message}`);
    }
  }

  throw new Error(`todas las fuentes IPC fallaron — ${errors.join(" | ")}`);
}

interface IpcResult {
  value: number;
  source: string;
  metadata: Record<string, unknown>;
}

async function ipcFromTradingEconomics(): Promise<IpcResult> {
  const url = "https://tradingeconomics.com/colombia/inflation-cpi";
  const md = await firecrawlScrape(url);
  // TE suele mostrar "Colombia Inflation Rate" seguido del valor + unit
  const value =
    extractNumberNear(md, /Colombia\s+Inflation\s+Rate/i) ??
    extractNumberNear(md, /Inflation\s+Rate/i) ??
    extractNumberNear(md, /CPI/i);
  if (value === null) {
    throw new Error(`TE parse failed (${md.length} chars)`);
  }
  return { value, source: "tradingeconomics", metadata: { method: "firecrawl", url } };
}

async function ipcFromWorldBank(): Promise<IpcResult> {
  // World Bank publishes CPI annual inflation. Damos 2 años para cubrir el gap
  // entre cierre de año y publicación; quedamos con el más reciente con valor != null.
  const now = new Date();
  const year = now.getUTCFullYear();
  const startYear = year - 2;
  const url =
    `https://api.worldbank.org/v2/country/COL/indicator/FP.CPI.TOTL.ZG?format=json&date=${startYear}:${year}&per_page=5`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`worldbank ${res.status}`);
  const json = await res.json() as unknown;
  // Shape: [meta, [{ date: "2024", value: 5.2, ... }, ...]]
  if (!Array.isArray(json) || !Array.isArray(json[1])) {
    throw new Error("worldbank: unexpected shape");
  }
  const rows = json[1] as Array<{ date: string; value: number | null }>;
  const latest = rows.find((r) => r.value !== null && Number.isFinite(r.value));
  if (!latest || typeof latest.value !== "number") {
    throw new Error("worldbank: no rows with value");
  }
  return {
    value: latest.value,
    source: "worldbank",
    metadata: { method: "api", url, year_covered: latest.date },
  };
}

async function ipcFromHardcode(): Promise<IpcResult> {
  // Último valor conocido de inflación anual Colombia (DANE).
  // Actualizar este número manualmente cuando DANE publique nuevo boletín
  // mensual si por alguna razón las 2 fuentes de arriba siguen caídas.
  return {
    value: 5.20,
    source: "manual",
    metadata: {
      method: "hardcode",
      note: "fallback estático — actualizar desde código si TE + WorldBank fallan",
    },
  };
}

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
