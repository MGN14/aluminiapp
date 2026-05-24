// Edge Function: manage-api-keys
// CRUD de API keys del usuario para MCP server / API pública.
// Solo OWNER (no colaboradores). La key plaintext se devuelve UNA sola vez al crear.
//
// Acciones (body.action):
//   - "list"   → devuelve [{ id, name, key_prefix, last_used_at, created_at, revoked_at }]
//   - "create" → body.name (string). Devuelve { id, key_prefix, key, ... } (key = plaintext).
//   - "revoke" → body.id (uuid). Marca revoked_at = now().

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError("No authorization header", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonError("Unauthorized", 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Bloquear a colaboradores: solo owner puede gestionar keys.
    const { data: asCollaborator } = await admin
      .from("collaborators")
      .select("id")
      .eq("collaborator_user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (asCollaborator) {
      return jsonError(
        "Las API keys son solo para el administrador de la cuenta.",
        403,
      );
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "list") {
      const { data, error } = await admin
        .from("api_keys")
        .select("id, name, key_prefix, scopes, last_used_at, created_at, revoked_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) return jsonError(error.message, 500);
      return json({ keys: data ?? [] });
    }

    if (action === "create") {
      const name = String(body?.name ?? "").trim();
      if (!name) return jsonError("name es requerido", 400);
      if (name.length > 80) return jsonError("name muy largo (max 80)", 400);

      // Genera una key alm_live_<48 hex chars>
      const random = crypto.getRandomValues(new Uint8Array(24));
      const hex = Array.from(random).map((b) => b.toString(16).padStart(2, "0")).join("");
      const fullKey = `alm_live_${hex}`;
      const keyPrefix = `alm_live_${hex.slice(0, 8)}`; // visible
      const keyHash = await sha256Hex(fullKey);

      const { data, error } = await admin
        .from("api_keys")
        .insert({
          user_id: user.id,
          key_prefix: keyPrefix,
          key_hash: keyHash,
          name,
          scopes: ["read"],
        })
        .select("id, name, key_prefix, scopes, created_at")
        .single();

      if (error) return jsonError(error.message, 500);

      return json({
        ...data,
        key: fullKey, // plaintext SOLO en esta respuesta. Nunca más se devuelve.
        warning: "Guardá esta key ahora. No se mostrará de nuevo.",
      });
    }

    if (action === "revoke") {
      const id = String(body?.id ?? "");
      if (!id) return jsonError("id es requerido", 400);

      const { data, error } = await admin
        .from("api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", user.id) // doble safety
        .is("revoked_at", null)
        .select("id, revoked_at")
        .maybeSingle();

      if (error) return jsonError(error.message, 500);
      if (!data) return jsonError("Key no encontrada o ya revocada", 404);
      return json({ id: data.id, revoked_at: data.revoked_at });
    }

    return jsonError(`action desconocida: ${action}`, 400);
  } catch (err) {
    console.error("manage-api-keys error:", err);
    return jsonError((err as Error).message, 500);
  }
});

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
