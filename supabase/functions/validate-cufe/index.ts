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

interface ValidationResult {
  status: "validated" | "not_found" | "error";
  dian_response: unknown;
  http_status?: number;
  error_detail?: string;
}

async function validateCufeAgainstDIAN(cufe: string): Promise<ValidationResult> {
  const trimmed = (cufe || "").trim();
  if (!trimmed) {
    return {
      status: "error",
      dian_response: null,
      error_detail: "Empty CUFE",
    };
  }

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

      if (resp.ok) {
        // 200 con datos del documento → validated
        // 200 con statusCode 404 en el body → not_found
        const body = parsed as Record<string, unknown> | null;
        const innerStatus = body && typeof body === "object" ? body["statusCode"] : null;
        if (innerStatus === 404 || innerStatus === "404") {
          return { status: "not_found", dian_response: parsed, http_status: httpStatus };
        }
        return { status: "validated", dian_response: parsed, http_status: httpStatus };
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

      const result = await validateCufeAgainstDIAN(inv.cufe);
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
      const result = await validateCufeAgainstDIAN(body.cufe);
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
        const result = await validateCufeAgainstDIAN(inv.cufe);
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
