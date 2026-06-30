// Edge function: validate-cufe
// Consulta el catálogo público DIAN para confirmar que un CUFE existe y está
// validado. Endpoint: https://catalogo-vpfe.dian.gov.co/document/searchqr
// Sin auth, sin captcha, devuelve JSON.
//
// Modos de uso:
//   POST /functions/v1/validate-cufe
//   Authorization: Bearer <user JWT>
//   Body: { invoice_id: uuid }   → valida una factura específica
//   Body: { cufe: string }       → valida un CUFE suelto sin persistir
//   Body: { batch: true }        → valida TODAS las facturas del usuario sin validar aún
//
// Response:
//   { ok, status: 'validated'|'not_found'|'error', dian_response, count? }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Producción. La sandbox sería catalogo-vpfe-hab.dian.gov.co
const DIAN_QR_ENDPOINT = "https://catalogo-vpfe.dian.gov.co/document/searchqr";

// Browserless (navegador headless) — mismo proveedor que dian-verify-rut.
// Desde ~jun 2026 el catálogo público DIAN quedó detrás de un "Azure WAF JS
// Challenge" que exige ejecutar JavaScript para entregar el JSON. Un fetch
// plano (server-side, IP de datacenter) recibe el reto en vez de los datos →
// toda validación cae en "error". El fallback enruta por Browserless, que pasa
// el reto con un Chromium real y luego hace un fetch same-origin para obtener
// el JSON limpio.
const DEFAULT_BROWSERLESS_ENDPOINT = "https://production-sfo.browserless.io";

interface BrowserlessCfg {
  token: string;
  endpoint: string;
}

function getBrowserless(): BrowserlessCfg | null {
  const token = Deno.env.get("BROWSERLESS_API_KEY");
  if (!token) return null;
  return {
    token,
    endpoint: Deno.env.get("BROWSERLESS_ENDPOINT") ?? DEFAULT_BROWSERLESS_ENDPOINT,
  };
}

function looksLikeWafChallenge(text: string): boolean {
  const t = (text || "").toLowerCase();
  return (
    t.includes("azure waf") ||
    t.includes("waf js challenge") ||
    (t.includes("<html") && t.includes("challenge"))
  );
}

interface ValidationResult {
  status: "validated" | "not_found" | "error";
  dian_response: unknown;
  http_status?: number;
  error_detail?: string;
}

// Script Browserless /function: navega al endpoint searchqr, espera a que el
// reto Azure WAF se resuelva (recarga automática) y devuelve el JSON.
const BROWSERLESS_CUFE_SCRIPT = `
export default async ({ page, context }) => {
  const { targetUrl } = context;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { ok: false, stage: 'init', http_status: 0, body: '' };
  try {
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8' });
    if (page.evaluateOnNewDocument) {
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['es-CO', 'es', 'en'] });
      });
    }
    out.stage = 'goto';
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    // El reto Azure WAF se resuelve solo y recarga; esperar a que el body deje
    // de ser el reto y empiece a parecer JSON (o se agote el tiempo).
    out.stage = 'await_challenge';
    let bodyText = '';
    for (let i = 0; i < 12; i++) {
      bodyText = await page.evaluate(() => (document.body ? document.body.innerText : ''));
      const low = (bodyText || '').toLowerCase();
      const trimmed = (bodyText || '').trim();
      if (!low.includes('azure waf') && (trimmed.startsWith('{') || trimmed.startsWith('['))) break;
      await sleep(2000);
    }
    // Con la cookie del WAF ya seteada, fetch same-origin para JSON limpio
    // (evita el visor de JSON que Chrome envuelve en HTML).
    out.stage = 'fetch_json';
    const fetched = await page.evaluate(async (url) => {
      try {
        const r = await fetch(url, { headers: { Accept: 'application/json, */*' } });
        return { status: r.status, text: await r.text() };
      } catch (e) {
        return { status: 0, text: '', error: String(e) };
      }
    }, targetUrl);
    out.ok = true;
    out.stage = 'done';
    out.http_status = fetched.status || 0;
    out.body = fetched.text || bodyText || '';
    return { data: out, type: 'application/json' };
  } catch (e) {
    out.error = String((e && e.message) || e);
    return { data: out, type: 'application/json' };
  }
};
`;

function interpretCufeBody(parsed: unknown, bodyText: string, httpStatus?: number): ValidationResult {
  const body = parsed as Record<string, unknown> | null;
  const innerStatus = body && typeof body === "object" ? body["statusCode"] : null;
  if (innerStatus === 404 || innerStatus === "404" || httpStatus === 404) {
    return { status: "not_found", dian_response: parsed, http_status: httpStatus };
  }
  // Documento con datos reales → validated. Exigimos un objeto JSON con
  // contenido (no el {rawText} de un cuerpo no-JSON).
  if (body && typeof body === "object" && !("rawText" in body) && Object.keys(body).length > 0) {
    return { status: "validated", dian_response: parsed, http_status: httpStatus };
  }
  return {
    status: "error",
    dian_response: parsed ?? { rawText: bodyText.slice(0, 1500) },
    error_detail: "Respuesta DIAN no reconocida",
  };
}

async function validateCufeViaBrowserless(cufe: string, bl: BrowserlessCfg): Promise<ValidationResult> {
  const targetUrl = `${DIAN_QR_ENDPOINT}?documentkey=${encodeURIComponent(cufe.trim())}`;
  const url = `${bl.endpoint}/function?token=${encodeURIComponent(bl.token)}&stealth=true&blockAds=true`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: BROWSERLESS_CUFE_SCRIPT, context: { targetUrl } }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return {
        status: "error",
        dian_response: { browserless_http: resp.status, detail: detail.slice(0, 400) },
        error_detail: `Browserless HTTP ${resp.status}`,
      };
    }
    const blData = await resp.json().catch(() => ({}));
    const scraped = ((blData as { data?: unknown })?.data ?? blData) as Record<string, unknown>;
    const bodyText = String(scraped?.body ?? "");
    const httpStatus = typeof scraped?.http_status === "number" ? (scraped.http_status as number) : undefined;
    if (looksLikeWafChallenge(bodyText) || !bodyText) {
      return {
        status: "error",
        dian_response: { reason: "waf_challenge", via: "browserless", stage: scraped?.stage ?? null },
        error_detail: "DIAN WAF challenge no superado vía navegador",
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = { rawText: bodyText.slice(0, 1500) };
    }
    return interpretCufeBody(parsed, bodyText, httpStatus);
  } catch (e) {
    return {
      status: "error",
      dian_response: { exception: (e as Error).message },
      error_detail: (e as Error).message,
    };
  }
}

async function validateCufeDirect(cufe: string): Promise<ValidationResult> {
  const trimmed = cufe.trim();
  const url = `${DIAN_QR_ENDPOINT}?documentkey=${encodeURIComponent(trimmed)}`;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let last: ValidationResult = { status: "error", dian_response: null, error_detail: "sin respuesta" };

  // El catálogo público de la DIAN es intermitente para requests automáticos
  // (a veces 429/5xx o cuelga). Reintentamos hasta 3 veces con backoff antes de
  // dar la factura por "error", así no falla por un hipo transitorio del portal.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json, */*",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      const httpStatus = resp.status;
      const text = await resp.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { rawText: text.slice(0, 1500) };
      }

      // Reto WAF: cortar el loop, lo resuelve el fallback por navegador.
      if (looksLikeWafChallenge(text)) {
        return { status: "error", dian_response: { reason: "waf_challenge", via: "direct" }, http_status: httpStatus, error_detail: "Azure WAF challenge" };
      }

      if (resp.ok) {
        return interpretCufeBody(parsed, text, httpStatus);
      }

      if (resp.status === 404) {
        return { status: "not_found", dian_response: parsed, http_status: httpStatus };
      }

      last = { status: "error", dian_response: parsed, http_status: httpStatus, error_detail: `HTTP ${httpStatus}` };
      // 429 / 5xx = transitorio → reintentamos. Otro 4xx → devolvemos ya.
      if (httpStatus === 429 || httpStatus >= 500) { await sleep(700 * attempt); continue; }
      return last;
    } catch (e) {
      // Timeout / red caída: guardamos la excepción y reintentamos.
      last = { status: "error", dian_response: { exception: (e as Error).message }, error_detail: (e as Error).message };
      await sleep(700 * attempt);
    }
  }
  return last;
}

async function validateCufeAgainstDIAN(cufe: string, browserless: BrowserlessCfg | null): Promise<ValidationResult> {
  const trimmed = (cufe || "").trim();
  if (!trimmed) {
    return { status: "error", dian_response: null, error_detail: "Empty CUFE" };
  }

  const direct = await validateCufeDirect(trimmed);

  // ¿Bloqueó el WAF? (reto detectado, o 403/503 típicos del WAF). Reintentar
  // por navegador si Browserless está configurado.
  const dianStr = JSON.stringify(direct.dian_response ?? "");
  const wafHit =
    direct.status === "error" &&
    (looksLikeWafChallenge(dianStr) ||
      dianStr.includes("waf_challenge") ||
      direct.http_status === 403 ||
      direct.http_status === 503);

  if (!wafHit) return direct;

  if (browserless) {
    return await validateCufeViaBrowserless(trimmed, browserless);
  }

  // Sin navegador disponible: error claro y compacto (no guardamos el HTML
  // gigante del reto en la fila).
  return {
    status: "error",
    dian_response: { reason: "waf_challenge", via: "direct" },
    http_status: direct.http_status,
    error_detail: "DIAN bloqueó la consulta automática (Azure WAF) — falta BROWSERLESS_API_KEY para validar vía navegador",
  };
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

    const body = await req.json().catch(() => ({}));
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const browserless = getBrowserless();

    // Modo 1: validar una factura específica (escribir resultado en la fila)
    if (body?.invoice_id) {
      const { data: inv, error: invErr } = await admin
        .from("invoices")
        .select("id, user_id, cufe")
        .eq("id", body.invoice_id)
        .eq("user_id", userId)
        .maybeSingle();

      if (invErr) {
        return json({ ok: false, error: "Error leyendo factura", detail: invErr.message }, 500);
      }
      if (!inv) {
        return json({ ok: false, error: "Factura no encontrada o no es tuya" }, 404);
      }
      if (!inv.cufe) {
        await admin
          .from("invoices")
          .update({
            dian_validation_status: "error",
            dian_response: { reason: "no_cufe" },
            dian_validated_at: new Date().toISOString(),
          })
          .eq("id", inv.id);
        return json({
          ok: false,
          status: "error",
          error: "La factura no tiene CUFE — no se puede validar contra DIAN",
        });
      }

      const result = await validateCufeAgainstDIAN(inv.cufe, browserless);
      await admin
        .from("invoices")
        .update({
          dian_validation_status: result.status,
          dian_response: result.dian_response,
          dian_validated_at: new Date().toISOString(),
        })
        .eq("id", inv.id);

      return json({
        ok: result.status === "validated",
        status: result.status,
        dian_response: result.dian_response,
        http_status: result.http_status,
      });
    }

    // Modo 2: validar un CUFE suelto sin persistir (preview)
    if (body?.cufe) {
      const result = await validateCufeAgainstDIAN(body.cufe, browserless);
      return json({
        ok: result.status === "validated",
        status: result.status,
        dian_response: result.dian_response,
        http_status: result.http_status,
      });
    }

    // Modo 3: batch — validar TODAS las facturas del user que tengan CUFE
    // y aún no estén validated. Procesa hasta 50 por llamada para no timeout.
    if (body?.batch === true) {
      const { data: pending, error: pendingErr } = await admin
        .from("invoices")
        .select("id, cufe")
        .eq("user_id", userId)
        .not("cufe", "is", null)
        .or("dian_validation_status.is.null,dian_validation_status.eq.error,dian_validation_status.eq.pending")
        .limit(50);

      if (pendingErr) {
        return json({ ok: false, error: "Error listando facturas", detail: pendingErr.message }, 500);
      }
      if (!pending || pending.length === 0) {
        return json({ ok: true, count: 0, message: "No hay facturas pendientes de validar" });
      }

      let validatedCount = 0;
      let notFoundCount = 0;
      let errorCount = 0;

      for (const inv of pending) {
        if (!inv.cufe) continue;
        const result = await validateCufeAgainstDIAN(inv.cufe, browserless);
        await admin
          .from("invoices")
          .update({
            dian_validation_status: result.status,
            dian_response: result.dian_response,
            dian_validated_at: new Date().toISOString(),
          })
          .eq("id", inv.id);

        if (result.status === "validated") validatedCount++;
        else if (result.status === "not_found") notFoundCount++;
        else errorCount++;
      }

      return json({
        ok: true,
        count: pending.length,
        validated: validatedCount,
        not_found: notFoundCount,
        errors: errorCount,
      });
    }

    return json(
      {
        ok: false,
        error: "Body inválido. Esperaba { invoice_id }, { cufe } o { batch: true }",
      },
      400,
    );
  } catch (e) {
    console.log("validate-cufe: unexpected", (e as Error).message);
    return json(
      { ok: false, error: "Error inesperado", detail: (e as Error).message },
      500,
    );
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
