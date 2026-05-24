// Edge Function: weekly-collection-report
// Cron lunes 8am Bogotá. Para cada owner con deuda viva, envía email con:
//   - Recovered esta semana vs semana anterior
//   - DSO actual vs hace 4 semanas
//   - Top 5 deudores a accionar (con score IA + acción recomendada)
//   - Touchpoints registrados esta semana
//   - Alertas: facturas que cruzaron umbrales (30/60/90 días)
//
// Trigger:
//   POST /functions/v1/weekly-collection-report
//   Headers: x-cron-secret: <COLLECTION_CRON_SECRET>
//   Body opcional: { dry_run?: boolean, only_user_id?: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_FROM = Deno.env.get("RESEND_FROM") || "onboarding@resend.dev";

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const cronSecret = Deno.env.get("COLLECTION_CRON_SECRET") || Deno.env.get("NICO_REPORT_CRON_SECRET");
    if (!resendKey) return json({ error: "RESEND_API_KEY not set" }, 500);

    // Auth: cron secret O service_role
    const reqSecret = req.headers.get("x-cron-secret");
    const authHeader = req.headers.get("Authorization") ?? "";
    const isAuthed = (cronSecret && reqSecret === cronSecret)
      || authHeader === `Bearer ${serviceRoleKey}`;
    if (!isAuthed) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const dryRun = !!body?.dry_run;
    const onlyUserId = body?.only_user_id as string | undefined;

    // Identificar users con deuda
    let userIds: string[] = [];
    if (onlyUserId) {
      userIds = [onlyUserId];
    } else {
      const { data } = await admin
        .from("invoices")
        .select("user_id")
        .eq("type", "venta")
        .gt("balance_pending", 0)
        .is("voided_at", null);
      const set = new Set<string>();
      for (const r of (data ?? []) as { user_id: string }[]) set.add(r.user_id);
      userIds = [...set];
    }

    const sent: { user_id: string; email: string; success: boolean; error?: string }[] = [];

    for (const userId of userIds) {
      try {
        // Email del owner
        const { data: { user } } = await admin.auth.admin.getUserById(userId);
        if (!user?.email) continue;

        const html = await buildReport(admin, userId);
        if (!html) continue;

        if (dryRun) {
          sent.push({ user_id: userId, email: user.email, success: true });
          continue;
        }

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: `AluminIA Cobranza <${RESEND_FROM}>`,
            to: [user.email],
            subject: `📊 Reporte semanal de cobranza · ${new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}`,
            html,
          }),
        });
        sent.push({
          user_id: userId,
          email: user.email,
          success: res.ok,
          error: res.ok ? undefined : `${res.status}: ${await res.text().catch(() => '?')}`,
        });
      } catch (err) {
        sent.push({ user_id: userId, email: '?', success: false, error: (err as Error).message });
      }
    }

    return json({ sent: sent.filter(s => s.success).length, failed: sent.filter(s => !s.success).length, details: sent });
  } catch (err) {
    console.error("weekly-collection-report error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

async function buildReport(admin: any, userId: string): Promise<string | null> {
  // Profile + nombre empresa
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, company_name")
    .eq("user_id", userId)
    .maybeSingle();
  const empresa = profile?.company_name ?? "Tu empresa";

  // Facturas vivas
  const today = new Date();
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const twoWeeksAgo = new Date(); twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  const { data: invs } = await admin
    .from("invoices")
    .select("counterparty_name, issue_date, due_date, dias_credito, total_amount, balance_pending")
    .eq("user_id", userId)
    .eq("type", "venta")
    .is("voided_at", null)
    .gt("balance_pending", 0);
  const invoices = (invs ?? []) as any[];
  if (invoices.length === 0) return null; // sin deuda, no email

  // Aging
  let corriente = 0, d30 = 0, d60 = 0, d90 = 0, d90plus = 0, totalDeuda = 0;
  const overdueByName = new Map<string, { total: number; oldest: number; count: number }>();
  for (const i of invoices) {
    const pending = Number(i.balance_pending) || 0;
    if (pending <= 0) continue;
    const issue = new Date(i.issue_date);
    let venc = issue;
    if (i.due_date) venc = new Date(i.due_date);
    else if (i.dias_credito) { venc = new Date(issue); venc.setDate(venc.getDate() + i.dias_credito); }
    const overdue = Math.floor((today.getTime() - venc.getTime()) / 86400000);
    if (overdue <= 0) corriente += pending;
    else if (overdue <= 30) d30 += pending;
    else if (overdue <= 60) d60 += pending;
    else if (overdue <= 90) d90 += pending;
    else d90plus += pending;
    totalDeuda += pending;
    const name = i.counterparty_name ?? "(sin nombre)";
    const c = overdueByName.get(name) ?? { total: 0, oldest: 0, count: 0 };
    c.total += pending;
    c.count += 1;
    if (overdue > c.oldest) c.oldest = overdue;
    overdueByName.set(name, c);
  }

  // Top 5 priorities (más vencidos + más monto)
  const top5 = [...overdueByName.entries()]
    .map(([name, c]) => ({ name, ...c }))
    .sort((a, b) => b.oldest - a.oldest || b.total - a.total)
    .slice(0, 5);

  // Scores IA cacheados
  const { data: scores } = await admin
    .from("client_collection_scores")
    .select("client_name, score, category, recommended_action")
    .eq("user_id", userId);
  const scoreByName = new Map<string, any>();
  for (const s of (scores ?? []) as any[]) scoreByName.set(s.client_name.toLowerCase(), s);

  // Touchpoints última semana
  const { data: tpsWeek } = await admin
    .from("collection_touchpoints")
    .select("channel, outcome, contacted_at")
    .eq("user_id", userId)
    .gte("contacted_at", weekAgo.toISOString());
  const tpsCount = (tpsWeek ?? []).length;

  // Recovered últimos 7 días (cash_movements ingreso del periodo)
  const { data: cashRecent } = await admin
    .from("cash_movements")
    .select("amount, type")
    .eq("user_id", userId)
    .eq("type", "ingreso")
    .gte("date", weekAgo.toISOString().slice(0, 10));
  const recoveredWeek = (cashRecent ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);

  const { data: cashPrev } = await admin
    .from("cash_movements")
    .select("amount")
    .eq("user_id", userId)
    .eq("type", "ingreso")
    .gte("date", twoWeeksAgo.toISOString().slice(0, 10))
    .lt("date", weekAgo.toISOString().slice(0, 10));
  const recoveredPrev = (cashPrev ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);

  const recoveryDelta = recoveredPrev > 0
    ? ((recoveredWeek - recoveredPrev) / recoveredPrev) * 100
    : null;

  // HTML
  const semaforoColor = (overdue: number) => overdue > 60 ? "#dc2626" : overdue > 30 ? "#f59e0b" : "#0891b2";
  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #1a1a2e; background: #fff;">
  <h1 style="font-size: 22px; margin: 0 0 4px 0; color: #1a1a2e;">📊 Reporte semanal de cobranza</h1>
  <p style="color: #6b7280; font-size: 13px; margin: 0 0 24px 0;">${empresa} · semana del ${weekAgo.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })} al ${today.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}</p>

  <!-- KPIs -->
  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px;">
    <div style="padding: 16px; border: 1px solid #e5e7eb; border-radius: 8px;">
      <p style="font-size: 11px; color: #6b7280; margin: 0;">Cartera viva total</p>
      <p style="font-size: 22px; font-weight: bold; margin: 4px 0 0 0; color: #dc2626;">${fmtMoney(totalDeuda)}</p>
    </div>
    <div style="padding: 16px; border: 1px solid #e5e7eb; border-radius: 8px;">
      <p style="font-size: 11px; color: #6b7280; margin: 0;">Recuperado esta semana</p>
      <p style="font-size: 22px; font-weight: bold; margin: 4px 0 0 0; color: #16a34a;">${fmtMoney(recoveredWeek)}</p>
      ${recoveryDelta !== null ? `<p style="font-size: 11px; color: ${recoveryDelta >= 0 ? '#16a34a' : '#dc2626'}; margin: 4px 0 0 0;">${recoveryDelta >= 0 ? '↑' : '↓'} ${Math.abs(recoveryDelta).toFixed(0)}% vs semana anterior</p>` : ''}
    </div>
  </div>

  <!-- Aging -->
  <h2 style="font-size: 15px; margin: 24px 0 8px 0;">📈 Envejecimiento de cartera</h2>
  <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
    <tr style="background: #f9fafb;">
      <td style="padding: 8px; border: 1px solid #e5e7eb;">Corriente</td>
      <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right; font-family: monospace;">${fmtMoney(corriente)}</td>
    </tr>
    <tr>
      <td style="padding: 8px; border: 1px solid #e5e7eb;">1-30 días vencido</td>
      <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right; font-family: monospace; color: #f59e0b;">${fmtMoney(d30)}</td>
    </tr>
    <tr style="background: #f9fafb;">
      <td style="padding: 8px; border: 1px solid #e5e7eb;">31-60 días vencido</td>
      <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right; font-family: monospace; color: #ea580c;">${fmtMoney(d60)}</td>
    </tr>
    <tr>
      <td style="padding: 8px; border: 1px solid #e5e7eb;">61-90 días vencido</td>
      <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right; font-family: monospace; color: #c2410c;">${fmtMoney(d90)}</td>
    </tr>
    <tr style="background: #fef2f2;">
      <td style="padding: 8px; border: 1px solid #e5e7eb;">+90 días vencido ⚠️</td>
      <td style="padding: 8px; border: 1px solid #e5e7eb; text-align: right; font-family: monospace; color: #dc2626; font-weight: bold;">${fmtMoney(d90plus)}</td>
    </tr>
  </table>

  <!-- Top 5 -->
  <h2 style="font-size: 15px; margin: 24px 0 8px 0;">🎯 Top 5 para accionar esta semana</h2>
  <div style="space: 8px;">
  ${top5.map((c, idx) => {
    const score = scoreByName.get(c.name.toLowerCase());
    return `
    <div style="padding: 12px; border: 1px solid #e5e7eb; border-left: 4px solid ${semaforoColor(c.oldest)}; border-radius: 6px; margin-bottom: 8px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 600;">${idx + 1}. ${c.name}</span>
        <span style="font-family: monospace; color: #dc2626; font-weight: bold;">${fmtMoney(c.total)}</span>
      </div>
      <p style="font-size: 11px; color: #6b7280; margin: 4px 0 0 0;">
        ${c.count} factura${c.count > 1 ? 's' : ''} · más vencida hace ${c.oldest} días
        ${score ? ` · Score IA: <strong>${score.score}</strong> (${score.category})` : ''}
      </p>
      ${score?.recommended_action ? `<p style="font-size: 12px; margin: 6px 0 0 0; padding: 6px 8px; background: #f3f4f6; border-radius: 4px;"><strong>→ Acción:</strong> ${score.recommended_action}</p>` : ''}
    </div>
  `;}).join('')}
  </div>

  <!-- Touchpoints -->
  <h2 style="font-size: 15px; margin: 24px 0 8px 0;">📝 Contactos esta semana</h2>
  <p style="font-size: 13px; color: #6b7280;">${tpsCount === 0 ? '⚠️ No registraste ningún contacto esta semana. Empezá a usar el botón "Registrar contacto" en cada cliente para llevar la bitácora.' : `Registraste ${tpsCount} contacto${tpsCount > 1 ? 's' : ''}. Bien hecho. 👏`}</p>

  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px 0;" />
  <p style="font-size: 11px; color: #9ca3af; text-align: center;">
    Reporte enviado por AluminIA · <a href="https://aluminiapp.com/reportes/cuentas-por-cobrar" style="color: #0891b2;">Abrir Módulo de Cobranza</a>
  </p>
</div>
`.trim();

  return html;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
