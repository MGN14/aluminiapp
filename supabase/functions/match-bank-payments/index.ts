// Edge Function: match-bank-payments
// Corre run_bank_matching_for_user en batch.
// - Modo cron (x-cron-secret): procesa todos los users con TX ingreso sin invoice_id.
// - Modo user (Bearer JWT): procesa solo al usuario actual.
//
// Body opcional: { limit?: number, only_user_id?: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const cronSecret = Deno.env.get("COLLECTION_CRON_SECRET") || Deno.env.get("NICO_REPORT_CRON_SECRET");

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const isCron = cronSecret && req.headers.get("x-cron-secret") === cronSecret;
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(10000, Number(body?.limit ?? 1000)));

    let targetUserIds: string[] = [];

    if (isCron) {
      // Users con TX ingreso sin invoice_id
      const { data } = await admin
        .from("transactions")
        .select("user_id")
        .is("deleted_at", null)
        .is("invoice_id", null)
        .or("type.eq.ingreso,amount.gt.0")
        .limit(5000);
      const set = new Set<string>();
      for (const r of (data ?? []) as { user_id: string }[]) set.add(r.user_id);
      targetUserIds = body?.only_user_id ? [body.only_user_id] : [...set];
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json({ error: "No auth" }, 401);
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error } = await userClient.auth.getUser();
      if (error || !user) return json({ error: "Unauthorized" }, 401);
      targetUserIds = [user.id];
    }

    const results: any[] = [];

    for (const userId of targetUserIds) {
      const { data, error } = await admin.rpc("run_bank_matching_for_user", {
        p_user_id: userId,
        p_limit: limit,
      });
      if (error) {
        results.push({ user_id: userId, error: error.message });
      } else {
        results.push(data);
      }
    }

    const totals = results.reduce(
      (acc, r) => ({
        processed: acc.processed + (r?.processed ?? 0),
        auto_applied: acc.auto_applied + (r?.auto_applied ?? 0),
        suggested: acc.suggested + (r?.suggested ?? 0),
        skipped: acc.skipped + (r?.skipped ?? 0),
      }),
      { processed: 0, auto_applied: 0, suggested: 0, skipped: 0 },
    );

    return json({
      mode: isCron ? "cron" : "user",
      users: targetUserIds.length,
      totals,
      details: results,
    });
  } catch (err) {
    console.error("match-bank-payments error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
