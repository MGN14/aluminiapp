// admin-stats — endpoint privado del founder. Devuelve KPIs agregados sobre
// app_events + auth.users + user_subscriptions para alimentar la página /admin.
//
// AuthN: el caller debe ser el founder (email hardcoded). El bearer del usuario
// se valida contra auth.users; si el email no matchea, 403.
//
// Si el equipo crece, mover el check a una tabla founder_users (mismo lugar
// que la RLS policy de app_events).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const FOUNDER_EMAIL = "niko14_gomez@hotmail.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface AppEventRow {
  id: string;
  user_id: string | null;
  event_type: string;
  props: Record<string, unknown>;
  occurred_at: string;
}

interface AuthUser {
  id: string;
  email: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  user_metadata?: { full_name?: string };
}

interface SubscriptionRow {
  user_id: string;
  plan: string | null;
  status: string | null;
  plan_expires_at: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // Validar caller — debe ser founder
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice(7);
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
  });
  if (!userRes.ok) {
    return json({ error: "Unauthorized" }, 401);
  }
  const callerUser = await userRes.json() as { id?: string; email?: string };
  if ((callerUser.email ?? "").toLowerCase() !== FOUNDER_EMAIL) {
    return json({ error: "Forbidden — founder only" }, 403);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const now = new Date();
  const day7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const day90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // === 1. App events (últimos 90 días — suficiente para todos los cortes) ===
  const { data: eventsRaw } = await admin
    .from("app_events" as never)
    .select("id, user_id, event_type, props, occurred_at")
    .gte("occurred_at", day90.toISOString())
    .order("occurred_at", { ascending: false })
    .limit(10000);
  const events = (eventsRaw ?? []) as AppEventRow[];

  // === 2. Todos los usuarios ===
  const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const allUsers: AuthUser[] = (usersList?.users ?? []).map(u => ({
    id: u.id,
    email: u.email ?? null,
    last_sign_in_at: u.last_sign_in_at ?? null,
    created_at: u.created_at,
    user_metadata: u.user_metadata as { full_name?: string } | undefined,
  }));

  // === 3. Subscriptions ===
  const { data: subsRaw } = await admin
    .from("user_subscriptions")
    .select("user_id, plan, status, plan_expires_at");
  const subs = (subsRaw ?? []) as SubscriptionRow[];
  const subByUser = new Map(subs.map(s => [s.user_id, s]));

  // === 4. Helpers ===
  const inWindow = (events: AppEventRow[], since: Date) =>
    events.filter(e => new Date(e.occurred_at).getTime() >= since.getTime());
  const byType = (t: string) => events.filter(e => e.event_type === t);

  // === 5. Métricas globales ===
  const signups = byType("signup");
  const signups7d = inWindow(signups, day7).length;
  const signups30d = inWindow(signups, day30).length;
  const signupsTotal = allUsers.length;

  const logins = byType("login");
  const logins7d = inWindow(logins, day7);
  const logins30d = inWindow(logins, day30);
  const dauByDay = new Map<string, Set<string>>();
  logins7d.forEach(e => {
    const day = e.occurred_at.split("T")[0];
    if (!dauByDay.has(day)) dauByDay.set(day, new Set());
    if (e.user_id) dauByDay.get(day)!.add(e.user_id);
  });
  const dauValues = Array.from(dauByDay.values()).map(s => s.size);
  const dau7dAvg = dauValues.length > 0 ? Math.round(dauValues.reduce((a, b) => a + b, 0) / 7) : 0;
  const mau30d = new Set(logins30d.map(e => e.user_id).filter(Boolean)).size;

  const nicoQueries = byType("nico_query");
  const nico7d = inWindow(nicoQueries, day7);
  const nico30d = inWindow(nicoQueries, day30);

  const errors = byType("flow_error");
  const errors7d = inWindow(errors, day7);

  const paymentsOk = byType("payment_success");
  const paymentsFail = byType("payment_failed");
  const paymentsOk30d = inWindow(paymentsOk, day30);
  const paymentsFail30d = inWindow(paymentsFail, day30);

  // === 6. Lista de clientes con stats ===
  // Para cada usuario: email, nombre, plan, signed_up, last_login, # extractos,
  // # facturas, siigo conectado, # nico queries (90d), # errores (90d).
  const extractoCountByUser = new Map<string, number>();
  byType("extracto_uploaded").forEach(e => {
    if (e.user_id) extractoCountByUser.set(e.user_id, (extractoCountByUser.get(e.user_id) ?? 0) + 1);
  });
  const invoiceCountByUser = new Map<string, number>();
  byType("invoice_uploaded").forEach(e => {
    if (e.user_id) invoiceCountByUser.set(e.user_id, (invoiceCountByUser.get(e.user_id) ?? 0) + 1);
  });
  const siigoConnectedSet = new Set<string>();
  byType("siigo_connected").forEach(e => {
    if (e.user_id) siigoConnectedSet.add(e.user_id);
  });
  const nicoCountByUser = new Map<string, number>();
  nicoQueries.forEach(e => {
    if (e.user_id) nicoCountByUser.set(e.user_id, (nicoCountByUser.get(e.user_id) ?? 0) + 1);
  });
  const errorsCountByUser = new Map<string, number>();
  errors.forEach(e => {
    if (e.user_id) errorsCountByUser.set(e.user_id, (errorsCountByUser.get(e.user_id) ?? 0) + 1);
  });

  const customers = allUsers
    .map(u => {
      const sub = subByUser.get(u.id);
      const lastSeenMs = u.last_sign_in_at ? new Date(u.last_sign_in_at).getTime() : 0;
      const daysSinceLogin = lastSeenMs > 0
        ? Math.floor((now.getTime() - lastSeenMs) / (24 * 60 * 60 * 1000))
        : -1;
      return {
        user_id: u.id,
        email: u.email ?? "—",
        full_name: u.user_metadata?.full_name ?? null,
        plan: sub?.plan ?? "demo",
        plan_status: sub?.status ?? "trialing",
        plan_expires_at: sub?.plan_expires_at ?? null,
        signed_up_at: u.created_at,
        last_login_at: u.last_sign_in_at,
        days_since_login: daysSinceLogin,
        extracto_count: extractoCountByUser.get(u.id) ?? 0,
        invoice_count: invoiceCountByUser.get(u.id) ?? 0,
        siigo_connected: siigoConnectedSet.has(u.id),
        nico_queries_90d: nicoCountByUser.get(u.id) ?? 0,
        errors_90d: errorsCountByUser.get(u.id) ?? 0,
      };
    })
    .sort((a, b) => new Date(b.signed_up_at).getTime() - new Date(a.signed_up_at).getTime());

  // === 7. Top users Nico (7d) ===
  const nico7dByUser = new Map<string, number>();
  nico7d.forEach(e => {
    if (e.user_id) nico7dByUser.set(e.user_id, (nico7dByUser.get(e.user_id) ?? 0) + 1);
  });
  const userIdToEmail = new Map(allUsers.map(u => [u.id, u.email ?? u.id.slice(0, 8)]));
  const topNicoUsers = Array.from(nico7dByUser.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([uid, count]) => ({
      user_id: uid,
      email: userIdToEmail.get(uid) ?? uid.slice(0, 8),
      queries_7d: count,
    }));

  // === 8. Nico breakdown por agente (30d) ===
  const nicoByAgent = new Map<string, number>();
  nico30d.forEach(e => {
    const agent = String(e.props?.agent_key ?? "unknown");
    nicoByAgent.set(agent, (nicoByAgent.get(agent) ?? 0) + 1);
  });
  const nicoAgentBreakdown = Array.from(nicoByAgent.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([agent, count]) => ({ agent, count }));

  // === 9. Errores recientes (30 más recientes, 7d) ===
  const recentErrors = errors7d.slice(0, 30).map(e => ({
    id: e.id,
    user_email: userIdToEmail.get(e.user_id ?? "") ?? "—",
    flow: String(e.props?.flow ?? "unknown"),
    error: String(e.props?.error ?? "—"),
    occurred_at: e.occurred_at,
  }));

  // === 10. Recent signups (últimos 20) ===
  const recentSignups = signups.slice(0, 20).map(e => ({
    user_email: String(e.props?.user_email ?? "—"),
    user_name: String(e.props?.user_name ?? "—"),
    provider: String(e.props?.provider ?? "—"),
    occurred_at: e.occurred_at,
  }));

  return json({
    ok: true,
    generated_at: now.toISOString(),
    kpis: {
      signups_total: signupsTotal,
      signups_7d: signups7d,
      signups_30d: signups30d,
      dau_7d_avg: dau7dAvg,
      mau_30d: mau30d,
      nico_queries_7d: nico7d.length,
      nico_queries_30d: nico30d.length,
      errors_7d: errors7d.length,
      payments_ok_30d: paymentsOk30d.length,
      payments_failed_30d: paymentsFail30d.length,
    },
    customers,
    top_nico_users: topNicoUsers,
    nico_by_agent: nicoAgentBreakdown,
    recent_errors: recentErrors,
    recent_signups: recentSignups,
  });
});
