// Edge function: dian-verify-rut
// Logs into MUISCA "A nombre de un tercero" flow via Browserless,
// scrapes RUT details, returns structured data and persists a verification
// snapshot in dian_verifications.
//
// Request:
//   POST /functions/v1/dian-verify-rut
//   Authorization: Bearer <user JWT>
//   Body: {} (uses stored credentials for the user)
//
// Response:
//   { ok: true, status: 'ok'|'warning'|'discrepancy'|'error', verification_id, summary, raw_data }
//   { ok: false, error: string }
//
// Env required:
//   BROWSERLESS_API_KEY     — token from browserless.io
//   BROWSERLESS_ENDPOINT    — optional, defaults to https://production-sfo.browserless.io
//   DIAN_ENCRYPTION_KEY     — see _shared/dian-crypto.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptDianSecret } from "../_shared/dian-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_BROWSERLESS_ENDPOINT = "https://production-sfo.browserless.io";
const MUISCA_LOGIN_URL = "https://muisca.dian.gov.co/WebIdentidadLogin/";

// Browserless /function script. Runs in a real Chromium with puppeteer-core.
// `context` carries our login data; we navigate, fill, submit, and scrape.
//
// IMPORTANT — selectors are best-effort first pass and MUST be calibrated
// against the live MUISCA flow with a real account (MGN Globaltrade) before
// trusting results. Any mismatch returns { ok:false, stage:'<step>' } so we
// know exactly where the script broke.
const BROWSERLESS_SCRIPT = `
export default async ({ page, context }) => {
  const { loginUrl } = context;
  const result = { ok: false, stage: 'init', meta: {} };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    // Setup anti-detection: viewport desktop + UA realista + override webdriver
    result.stage = 'setup_viewport';
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
    });

    // Hide automation signals BEFORE any page script runs
    if (page.evaluateOnNewDocument) {
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['es-CO', 'es', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      });
    }

    result.stage = 'goto_login';
    await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(5000); // dar tiempo a renders lazy

    // Forzar scroll para activar IntersectionObservers / lazy loads
    await page.evaluate(() => {
      window.scrollTo(0, 200);
      window.scrollTo(0, 0);
    });
    await sleep(1500);

    result.meta.viewport = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      docWidth: document.documentElement.clientWidth,
      webdriver: navigator.webdriver,
      bodyText: (document.body.innerText || '').slice(0, 1500),
    }));

    // Detectar y cerrar modal "Está intentando ingresar de manera incorrecta"
    result.stage = 'dismiss_warning_modal';
    const dismissed = await page.evaluate(() => {
      const dialog = document.querySelector('.container-dialog, .cdk-overlay-pane');
      if (!dialog) return { hadModal: false };
      const closeBtn = dialog.querySelector('button.mat-icon-button, [aria-label="close" i], button');
      if (closeBtn) {
        closeBtn.click();
        return { hadModal: true, closed: true };
      }
      return { hadModal: true, closed: false };
    });
    result.meta.modalDismissed = dismissed;
    if (dismissed.hadModal) await sleep(1500);

    // Click pestaña "A nombre de un tercero" — match permisivo (whitespace + case-insensitive)
    result.stage = 'click_tercero_tab';
    const tabClicked = await page.evaluate(() => {
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const targetNorm = 'a nombre de un tercero';
      const all = document.querySelectorAll('*');

      // Pase 1: match exacto normalizado
      let matched = null;
      for (const el of all) {
        const txt = norm(el.textContent);
        if (txt === targetNorm) { matched = el; break; }
      }
      // Pase 2: includes con longitud razonable
      if (!matched) {
        for (const el of all) {
          const txt = norm(el.textContent);
          if (txt.includes(targetNorm) && txt.length < 100) { matched = el; break; }
        }
      }

      if (!matched) {
        // Devolver candidatos parciales para debug — todo lo que tenga "nombre" o "tercero"
        const partial = [];
        for (const el of all) {
          const raw = (el.textContent || '');
          const t = raw.toLowerCase();
          if ((t.includes('nombre') || t.includes('tercero')) && raw.length < 200) {
            partial.push({
              tag: el.tagName,
              cls: (el.className || '').toString().slice(0, 80),
              text: raw.replace(/\s+/g, ' ').trim().slice(0, 100),
            });
            if (partial.length >= 25) break;
          }
        }
        return { found: false, partial };
      }

      // Subir hasta ancestro clickeable
      let cur = matched;
      for (let i = 0; i < 6 && cur; i++) {
        const tag = cur.tagName;
        const role = cur.getAttribute('role');
        const cursor = (typeof getComputedStyle === 'function') ? getComputedStyle(cur).cursor : '';
        if (tag === 'A' || tag === 'BUTTON' || role === 'tab' || role === 'button' || cursor === 'pointer') {
          cur.click();
          return { found: true, tag, role, cls: (cur.className || '').toString().slice(0, 100) };
        }
        cur = cur.parentElement;
      }
      matched.click();
      return { found: true, fallback: true, tag: matched.tagName, cls: (matched.className || '').toString().slice(0, 100) };
    });
    result.meta.tabClicked = tabClicked;
    // NO lanzar error — seguir al dump así sabemos qué hay aunque no se haya clickeado
    await sleep(2500);

    result.stage = 'capture_state';
    result.meta.url = page.url();
    result.meta.title = await page.title();

    // Captura COMPLETA de inputs/selects/buttons — sin filtrar por textContent
    // (los <input> reales no tienen texto, mi filtro anterior los perdió)
    result.meta.formFields = await page.evaluate(() => {
      const fields = [...document.querySelectorAll('input, select, textarea, mat-select, mat-checkbox, [role="combobox"], [role="checkbox"]')];
      return fields.map(el => {
        const rect = el.getBoundingClientRect();
        // Buscar label asociado: por for, ariadescribedby, o el label más cercano arriba
        let nearbyLabel = null;
        if (el.id) {
          const lbl = document.querySelector('label[for="' + el.id + '"]');
          if (lbl) nearbyLabel = (lbl.textContent || '').trim().slice(0, 80);
        }
        if (!nearbyLabel) {
          let p = el.parentElement;
          for (let i = 0; i < 5 && p; i++) {
            const lbl = p.querySelector('label, mat-label, .mat-form-field-label');
            if (lbl) { nearbyLabel = (lbl.textContent || '').trim().slice(0, 80); break; }
            p = p.parentElement;
          }
        }
        return {
          tag: el.tagName,
          type: el.type || null,
          name: el.name || null,
          id: el.id || null,
          placeholder: el.placeholder || null,
          ariaLabel: el.getAttribute('aria-label') || null,
          formControlName: el.getAttribute('formcontrolname') || null,
          ngReflectName: el.getAttribute('ng-reflect-name') || null,
          cls: (el.className || '').toString().slice(0, 100),
          label: nearbyLabel,
          visible: rect.width > 0 && rect.height > 0,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
        };
      });
    });

    // Buttons y mat-select-triggers visibles
    result.meta.buttons = await page.evaluate(() => {
      return [...document.querySelectorAll('button, .mat-select-trigger, [role="button"]')].map(el => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          id: el.id || null,
          cls: (el.className || '').toString().slice(0, 100),
          ariaLabel: el.getAttribute('aria-label') || null,
          text: (el.textContent || '').trim().slice(0, 60),
          visible: rect.width > 0 && rect.height > 0,
        };
      }).filter(b => b.visible);
    });

    result.stage = 'DIAGNOSTIC_DUMP_V6';
    result.meta.note = 'V6: stealth=true + override webdriver/languages/plugins + scroll forzado.';
    return { data: result, type: 'application/json' };
  } catch (err) {
    result.error = err && err.message ? err.message : String(err);
    return { data: result, type: 'application/json' };
  }
};
`;

interface VerifyResult {
  status: "ok" | "warning" | "discrepancy" | "error";
  raw_data: unknown;
  summary: { headline: string; details: string; recommended_action?: string };
  cross_check?: unknown;
  error_detail?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const BROWSERLESS_API_KEY = Deno.env.get("BROWSERLESS_API_KEY");
  const BROWSERLESS_ENDPOINT =
    Deno.env.get("BROWSERLESS_ENDPOINT") ?? DEFAULT_BROWSERLESS_ENDPOINT;

  const startedAt = Date.now();

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

    const { data: creds, error: credsErr } = await admin
      .from("user_dian_credentials")
      .select(
        "nit, rl_doc_type, rl_doc_number, muisca_password_encrypted, connection_status",
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (credsErr) {
      return json({ ok: false, error: "Error leyendo credenciales", detail: credsErr.message }, 500);
    }
    if (!creds) {
      return json(
        { ok: false, error: "No hay credenciales DIAN. Conectá la cuenta primero." },
        400,
      );
    }

    if (!BROWSERLESS_API_KEY) {
      const verifyResult: VerifyResult = {
        status: "error",
        raw_data: null,
        summary: {
          headline: "Browserless no configurado",
          details:
            "Falta BROWSERLESS_API_KEY en los secrets. Crear cuenta en browserless.io y setear el secret.",
        },
        error_detail: "Missing BROWSERLESS_API_KEY",
      };
      await persistVerification(admin, userId, verifyResult, Date.now() - startedAt);
      return json(
        { ok: false, error: "Browserless no configurado", ...verifyResult },
        503,
      );
    }

    let password: string;
    try {
      password = await decryptDianSecret(creds.muisca_password_encrypted);
    } catch (e) {
      const verifyResult: VerifyResult = {
        status: "error",
        raw_data: null,
        summary: {
          headline: "No pude descifrar tu clave",
          details:
            "El cifrado falló al recuperar la clave MUISCA. Reconectá la cuenta DIAN.",
        },
        error_detail: (e as Error).message,
      };
      await persistVerification(admin, userId, verifyResult, Date.now() - startedAt);
      return json({ ok: false, error: "Decryption failed" }, 500);
    }

    // Call Browserless /function endpoint
    // stealth=true: Browserless aplica puppeteer-extra-plugin-stealth (oculta
    // navigator.webdriver, fixes UA/plugins/languages — necesario para MUISCA
    // que detecta headless y sirve versión recortada sin las tabs).
    // blockAds=true: drops trackers que ralentizan render.
    const browserlessUrl =
      `${BROWSERLESS_ENDPOINT}/function?token=${encodeURIComponent(BROWSERLESS_API_KEY)}&stealth=true&blockAds=true`;
    const browserlessResp = await fetch(browserlessUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: BROWSERLESS_SCRIPT,
        context: {
          nit: creds.nit,
          rlDocType: creds.rl_doc_type,
          rlDocNumber: creds.rl_doc_number,
          password,
          loginUrl: MUISCA_LOGIN_URL,
        },
      }),
    });

    if (!browserlessResp.ok) {
      const detail = await browserlessResp.text().catch(() => "");
      const verifyResult: VerifyResult = {
        status: "error",
        raw_data: null,
        summary: {
          headline: "Browserless rechazó la sesión",
          details: `HTTP ${browserlessResp.status}. Revisar quota o token.`,
        },
        error_detail: detail.slice(0, 500),
      };
      await persistVerification(admin, userId, verifyResult, Date.now() - startedAt);
      return json({ ok: false, error: "Browserless error", ...verifyResult }, 502);
    }

    const browserlessData = await browserlessResp.json().catch(() => ({}));
    const scrapedRaw = (browserlessData as { data?: unknown })?.data ?? browserlessData;

    // Until selectors are calibrated against real MUISCA, scraping returns
    // { ok:false, stage:'CALIBRATION_PENDING' } — we surface that as a clear error.
    const stage = (scrapedRaw as { stage?: string })?.stage ?? "unknown";
    const scrapeError = (scrapedRaw as { error?: string })?.error;

    let verifyResult: VerifyResult;
    if (
      stage === "CALIBRATION_PENDING" ||
      stage === "DIAGNOSTIC_DUMP" ||
      stage === "DIAGNOSTIC_DUMP_V2" ||
      stage === "DIAGNOSTIC_DUMP_V3" ||
      stage === "DIAGNOSTIC_DUMP_V4" ||
      stage === "DIAGNOSTIC_DUMP_V5" ||
      stage === "DIAGNOSTIC_DUMP_V6"
    ) {
      verifyResult = {
        status: "warning",
        raw_data: scrapedRaw,
        summary: {
          headline:
            stage === "DIAGNOSTIC_DUMP"
              ? "Diagnóstico capturado — listo para calibrar"
              : "Verificación pendiente de calibración",
          details:
            "El scraper llegó al portal y capturó la estructura del DOM. Pegar raw_data->meta para mapear selectores reales.",
          recommended_action:
            "Mirar raw_data->meta->mainElements y raw_data->meta->frameDumps en Supabase Studio.",
        },
        error_detail: "diagnostic_dump",
      };
    } else if (scrapeError) {
      verifyResult = {
        status: "error",
        raw_data: scrapedRaw,
        summary: {
          headline: `Falló la verificación en paso "${stage}"`,
          details: scrapeError,
          recommended_action:
            "Verificar credenciales y que la pantalla del MUISCA no haya cambiado.",
        },
        error_detail: `${stage}: ${scrapeError}`,
      };
    } else {
      // Happy path will be implemented once selectors are mapped.
      verifyResult = {
        status: "ok",
        raw_data: scrapedRaw,
        summary: {
          headline: "RUT verificado contra DIAN",
          details: "TODO: render real summary after calibration.",
        },
      };
    }

    const verificationId = await persistVerification(
      admin,
      userId,
      verifyResult,
      Date.now() - startedAt,
    );

    // Update last_login_at / connection_status on the credentials row.
    await admin
      .from("user_dian_credentials")
      .update({
        last_login_at: new Date().toISOString(),
        last_verification_at: new Date().toISOString(),
        connection_status: verifyResult.status === "error" ? "error" : "connected",
        last_error:
          verifyResult.status === "error" ? verifyResult.error_detail ?? null : null,
      })
      .eq("user_id", userId);

    return json({
      ok: verifyResult.status !== "error",
      verification_id: verificationId,
      ...verifyResult,
    });
  } catch (e) {
    console.log("dian-verify-rut: unexpected", (e as Error).message);
    return json(
      { ok: false, error: "Error inesperado", detail: (e as Error).message },
      500,
    );
  }
});

async function persistVerification(
  // deno-lint-ignore no-explicit-any
  admin: any,
  userId: string,
  result: VerifyResult,
  durationMs: number,
): Promise<string | null> {
  const { data, error } = await admin
    .from("dian_verifications")
    .insert({
      user_id: userId,
      verification_type: "rut",
      status: result.status,
      raw_data: result.raw_data ?? null,
      summary: result.summary,
      cross_check: result.cross_check ?? null,
      triggered_by: "manual",
      duration_ms: durationMs,
      error_detail: result.error_detail ?? null,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    console.log("dian-verify-rut: persist failed", error.message);
    return null;
  }
  return data?.id ?? null;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
