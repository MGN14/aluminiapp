// Edge function: expire-quotations
// Pasa cotizaciones de status='sent' a 'expired' cuando valid_until < hoy.
// Pensada para correr 1x al día por pg_cron (ver supabase/cron-snippets/expire-quotations.sql).
//
// Auth (3 vías aceptadas):
//   1. Header `x-cron-secret: <QUOTE_CRON_SECRET>` (usado por pg_cron via net.http_post)
//   2. Authorization: Bearer <service_role>  (testing CLI)
//   3. Authorization: Bearer <QUOTE_TRIGGER_SECRET>  (manual testing custom)
//
// Body opcional: { dryRun?: boolean } — si true, devuelve el conteo sin actualizar.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const CRON_SECRET = Deno.env.get("QUOTE_CRON_SECRET");
  const TRIGGER_SECRET = Deno.env.get("QUOTE_TRIGGER_SECRET");

  // AuthN: 3 vías aceptadas (mismo patrón que sync-macro-indicators).
  const cronHeader = req.headers.get("x-cron-secret");
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  const isCron = !!CRON_SECRET && cronHeader === CRON_SECRET;
  const isServiceRole = !!SERVICE_ROLE_KEY && bearer === SERVICE_ROLE_KEY;
  const isTrigger = !!TRIGGER_SECRET && bearer === TRIGGER_SECRET;

  if (!isCron && !isServiceRole && !isTrigger) {
    console.log(
      `[expire-quotations] auth-denied cronHdr=${cronHeader ? "present" : "absent"} bearerLen=${bearer.length} srvKeySet=${!!SERVICE_ROLE_KEY} cronSecretSet=${!!CRON_SECRET} triggerSet=${!!TRIGGER_SECRET}`,
    );
    return json({ error: "No autorizado" }, 401);
  }

  const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean };
  const dryRun = !!body.dryRun;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const today = new Date().toISOString().slice(0, 10);

  try {
    // Conteo previo para reportar
    const { count: candidateCount, error: countErr } = await admin
      .from("quotations")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent")
      .lt("valid_until", today);

    if (countErr) {
      console.error("expire-quotations count error:", countErr);
      return json({ error: countErr.message }, 500);
    }

    if (dryRun) {
      return json({ ok: true, dryRun: true, would_expire: candidateCount ?? 0 }, 200);
    }

    if (!candidateCount) {
      return json({ ok: true, expired: 0 }, 200);
    }

    const { error: updErr, count: updatedCount } = await admin
      .from("quotations")
      .update({ status: "expired" }, { count: "exact" })
      .eq("status", "sent")
      .lt("valid_until", today);

    if (updErr) {
      console.error("expire-quotations update error:", updErr);
      return json({ error: updErr.message }, 500);
    }

    console.log(`[expire-quotations] expired=${updatedCount ?? 0}`);
    return json({ ok: true, expired: updatedCount ?? 0 }, 200);
  } catch (err) {
    console.error("expire-quotations unexpected error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
