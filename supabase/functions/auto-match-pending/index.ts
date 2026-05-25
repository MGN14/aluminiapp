// Edge Function: auto-match-pending
// Red de seguridad: re-aplica reglas a TX sin matchear (en caso que el
// trigger DB haya fallado en algún edge case, o que el user haya creado
// una nueva regla después de tener TX viejas).
//
// Modos:
// - POST con x-cron-secret (cron diario): corre para TODOS los users
// - POST con Bearer JWT (frontend): corre solo para EL user
//
// Body opcional: { dry_run?: boolean, limit?: number }

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

    let targetUserIds: string[] = [];
    if (isCron) {
      // Todos los users con TX sin matchear
      const { data: rows } = await admin
        .from("transactions")
        .select("user_id")
        .is("deleted_at", null)
        .or("category_id.is.null,responsible_id.is.null")
        .limit(5000);
      const set = new Set<string>();
      for (const r of (rows ?? []) as { user_id: string }[]) set.add(r.user_id);
      targetUserIds = [...set];
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

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(50000, Number(body?.limit ?? 5000)));
    const dryRun = !!body?.dry_run;

    const results: { user_id: string; processed: number; matched: number; error?: string }[] = [];

    for (const userId of targetUserIds) {
      if (dryRun) {
        // Solo contar sin aplicar
        const { count } = await admin
          .from("transactions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .is("deleted_at", null)
          .or("category_id.is.null,responsible_id.is.null");
        results.push({ user_id: userId, processed: count ?? 0, matched: 0 });
        continue;
      }

      const { data, error } = await admin.rpc("apply_pending_rules_for_user", {
        p_user_id: userId,
        p_limit: limit,
        p_source: isCron ? "retro_cron" : "frontend",
      });
      if (error) {
        results.push({ user_id: userId, processed: 0, matched: 0, error: error.message });
      } else {
        const stats = data as { processed: number; matched: number };
        results.push({ user_id: userId, processed: stats?.processed ?? 0, matched: stats?.matched ?? 0 });
      }
    }

    const totals = results.reduce(
      (acc, r) => ({ processed: acc.processed + r.processed, matched: acc.matched + r.matched }),
      { processed: 0, matched: 0 },
    );

    return json({
      mode: isCron ? "cron" : "user",
      users: targetUserIds.length,
      totals,
      dry_run: dryRun,
      details: results,
    });
  } catch (err) {
    console.error("auto-match-pending error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
