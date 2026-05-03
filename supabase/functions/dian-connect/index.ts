// Edge function: dian-connect
// Stores user MUISCA credentials encrypted at rest.
// Validation against DIAN happens on first dian-verify-rut call (real browser
// session via Browserless is slow/expensive — not run on save).
//
// Request:
//   POST /functions/v1/dian-connect
//   Authorization: Bearer <user JWT>
//   Body: {
//     nit: string,             // sin DV
//     rl_doc_type: string,     // CC | CE | TI | PA | RC | NIT
//     rl_doc_number: string,
//     password: string,        // clave MUISCA del RL
//   }
//
// Response: { ok: true, connection_status: 'pending' } | { ok: false, error: string }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptDianSecret } from "../_shared/dian-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_DOC_TYPES = ["CC", "CE", "TI", "PA", "RC", "NIT"];

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

    const body = await req.json().catch(() => null);
    const nit = String(body?.nit ?? "").replace(/\D/g, "");
    const rlDocType = String(body?.rl_doc_type ?? "").trim().toUpperCase();
    const rlDocNumber = String(body?.rl_doc_number ?? "").replace(/\D/g, "");
    const password = String(body?.password ?? "");

    if (!nit) return json({ ok: false, error: "NIT es requerido" }, 400);
    if (!VALID_DOC_TYPES.includes(rlDocType)) {
      return json(
        { ok: false, error: "Tipo de documento inválido", valid: VALID_DOC_TYPES },
        400,
      );
    }
    if (!rlDocNumber) {
      return json({ ok: false, error: "Número de documento es requerido" }, 400);
    }
    if (!password) {
      return json({ ok: false, error: "Contraseña es requerida" }, 400);
    }

    let encrypted: string;
    try {
      encrypted = await encryptDianSecret(password);
    } catch (cryptErr) {
      console.log("dian-connect: encryption failed", (cryptErr as Error).message);
      return json(
        {
          ok: false,
          error: "Error de cifrado",
          detail: (cryptErr as Error).message,
        },
        500,
      );
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { error: upsertErr } = await admin
      .from("user_dian_credentials")
      .upsert(
        {
          user_id: userId,
          nit,
          rl_doc_type: rlDocType,
          rl_doc_number: rlDocNumber,
          muisca_password_encrypted: encrypted,
          connection_status: "pending",
          last_error: null,
          consent_signed_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

    if (upsertErr) {
      console.log("dian-connect: upsert failed", upsertErr.message);
      return json(
        {
          ok: false,
          error: "No se pudo guardar la conexión",
          detail: upsertErr.message,
        },
        500,
      );
    }

    console.log("dian-connect: success", { userId, nit, rlDocType });
    return json({ ok: true, connection_status: "pending" });
  } catch (e) {
    console.log("dian-connect: unexpected", (e as Error).message);
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
