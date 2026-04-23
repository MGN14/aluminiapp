// Edge function: siigo-connect
// Validates a user's Siigo credentials by hitting POST https://api.siigo.com/auth.
// On success, encrypts the access_key with AES-GCM and upserts into
// public.user_siigo_credentials.
//
// Request:
//   POST /functions/v1/siigo-connect
//   Authorization: Bearer <user JWT>
//   Body: { username: string, access_key: string, partner_id?: string }
//
// Response: { ok: true, connection_status: 'connected' } | { ok: false, error: string }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptSecret } from "../_shared/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SIIGO_AUTH_URL = "https://api.siigo.com/auth";
const DEFAULT_PARTNER = "aluminiapp";

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
    const username = (body?.username ?? "").trim();
    const accessKey = (body?.access_key ?? "").trim();
    const partnerId = (body?.partner_id ?? DEFAULT_PARTNER).trim();

    if (!username || !accessKey) {
      return json({ error: "username y access_key son requeridos" }, 400);
    }

    // 1) Validate against Siigo.
    const siigoRes = await fetch(SIIGO_AUTH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Partner-Id": partnerId,
      },
      body: JSON.stringify({ username, access_key: accessKey }),
    });

    if (!siigoRes.ok) {
      const detail = await siigoRes.text().catch(() => "");
      return json(
        {
          ok: false,
          error: "Siigo rechazó las credenciales",
          status: siigoRes.status,
          detail: detail.slice(0, 500),
        },
        400,
      );
    }

    const siigoBody = (await siigoRes.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!siigoBody.access_token) {
      return json({ ok: false, error: "Siigo no devolvió access_token" }, 502);
    }

    // 2) Encrypt and persist via service role (RLS-safe).
    const encrypted = await encryptSecret(accessKey);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { error: upsertErr } = await admin
      .from("user_siigo_credentials")
      .upsert(
        {
          user_id: userId,
          siigo_username: username,
          siigo_access_key_encrypted: encrypted,
          partner_id: partnerId,
          connection_status: "connected",
          last_error: null,
        },
        { onConflict: "user_id" },
      );

    if (upsertErr) {
      return json(
        { ok: false, error: "No se pudo guardar la conexión", detail: upsertErr.message },
        500,
      );
    }

    return json({ ok: true, connection_status: "connected" });
  } catch (e) {
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
