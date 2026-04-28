// weekly-founder-report — corre semanalmente y manda email con resumen
// agregado a ngrm14@gmail.com.
//
// Trigger:
//   - Cron schedule (Supabase Cron: lunes 8am Bogotá = lunes 13:00 UTC)
//   - Manual: POST con body vacío al endpoint (útil para testear)
//
// Métricas que reporta:
//   - Signups en la última semana (lista con email + fecha)
//   - Logins en la última semana (DAU promedio + total)
//   - Onboarding completado (cuántos usuarios completaron)
//   - Activación: cuántos subieron extracto, conectaron Siigo, subieron factura
//   - Uso de Nico IA: total queries + breakdown por agent_key + por usuario
//   - Errores en flujos críticos: top errores con count
//   - Pagos: payment_success y payment_failed de la semana
//   - Clientes en riesgo: usuarios que no han logueado hace 7+ días
//
// Para extender: agregar más bloques en la sección AGGREGATIONS y en buildEmailHtml.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const FOUNDER_EMAIL = "ngrm14@gmail.com";
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "onboarding@resend.dev";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tableRows(rows: Array<Record<string, string | number>>, columns: string[]): string {
  if (rows.length === 0) return `<tr><td colspan="${columns.length}" style="padding:8px;color:#a1a1a6;font-size:12px;text-align:center">— Sin datos —</td></tr>`;
  return rows.map(r =>
    `<tr>${columns.map(c => `<td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:13px">${escapeHtml(String(r[c] ?? "—"))}</td>`).join("")}</tr>`
  ).join("");
}

function section(title: string, body: string): string {
  return `
    <h2 style="margin:24px 0 8px;font-size:14px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;color:#1d1d1f;border-bottom:2px solid oklch(0.43 0.14 155 / 0.30);padding-bottom:6px">${escapeHtml(title)}</h2>
    ${body}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAgoIso = weekAgo.toISOString();

  // === Cargar todos los eventos de la semana en un solo query ===
  const { data: eventsRaw, error: evtErr } = await supabase
    .from("app_events" as never)
    .select("id, user_id, event_type, props, occurred_at")
    .gte("occurred_at", weekAgoIso)
    .order("occurred_at", { ascending: false });

  if (evtErr) {
    console.error("[weekly-report] events fetch error:", evtErr);
    return json({ ok: false, error: evtErr.message }, 500);
  }

  const events = (eventsRaw ?? []) as AppEventRow[];
  const byType = (t: string) => events.filter(e => e.event_type === t);

  // === Usuarios de auth.users (para clientes en riesgo) ===
  const { data: usersList } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const allUsers: AuthUser[] = (usersList?.users ?? []).map(u => ({
    id: u.id,
    email: u.email ?? null,
    last_sign_in_at: u.last_sign_in_at ?? null,
    created_at: u.created_at,
  }));

  // === Agregaciones ===

  // Signups
  const signups = byType("signup");
  const signupRows = signups.map(e => ({
    Email: String(e.props?.user_email ?? "—"),
    Nombre: String(e.props?.user_name ?? "—"),
    Provider: String(e.props?.provider ?? "—"),
    Cuándo: fmtDate(e.occurred_at),
  }));

  // Logins (DAU promedio = usuarios únicos por día / 7)
  const logins = byType("login");
  const loginsByDay = new Map<string, Set<string>>();
  logins.forEach(e => {
    const day = e.occurred_at.split("T")[0];
    if (!loginsByDay.has(day)) loginsByDay.set(day, new Set());
    if (e.user_id) loginsByDay.get(day)!.add(e.user_id);
  });
  const dauValues = Array.from(loginsByDay.values()).map(s => s.size);
  const dauAvg = dauValues.length > 0 ? Math.round(dauValues.reduce((a, b) => a + b, 0) / 7) : 0;
  const totalLogins = logins.length;
  const uniqueLogins = new Set(logins.map(e => e.user_id).filter(Boolean)).size;

  // Onboarding completed
  const onboardings = byType("onboarding_completed");
  const onboardingRows = onboardings.map(e => ({
    Email: String(e.props?.user_email ?? "—"),
    Empresa: String(e.props?.company_name ?? "—"),
    Régimen: String(e.props?.regimen ?? "—"),
    Siigo: String(e.props?.siigo_choice ?? "—"),
    Cuándo: fmtDate(e.occurred_at),
  }));

  // Activación
  const extractos = byType("extracto_uploaded").length;
  const siigoConn = byType("siigo_connected").length;
  const invoices = byType("invoice_uploaded").length;

  // Uso de Nico IA
  const nicoQueries = byType("nico_query");
  const totalNicoQueries = nicoQueries.length;
  const nicoByAgent = new Map<string, number>();
  const nicoByUser = new Map<string, number>();
  nicoQueries.forEach(e => {
    const agent = String(e.props?.agent_key ?? "unknown");
    nicoByAgent.set(agent, (nicoByAgent.get(agent) ?? 0) + 1);
    if (e.user_id) {
      nicoByUser.set(e.user_id, (nicoByUser.get(e.user_id) ?? 0) + 1);
    }
  });
  const nicoAgentRows = Array.from(nicoByAgent.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([agent, count]) => ({ Agente: agent, Queries: count }));
  const userIdToEmail = new Map(allUsers.map(u => [u.id, u.email ?? "—"]));
  const nicoUserRows = Array.from(nicoByUser.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([uid, count]) => ({
      Usuario: userIdToEmail.get(uid) ?? uid.slice(0, 8),
      Queries: count,
    }));

  // Errores
  const errors = byType("flow_error");
  const errorsByFlow = new Map<string, number>();
  errors.forEach(e => {
    const flow = String(e.props?.flow ?? "unknown");
    errorsByFlow.set(flow, (errorsByFlow.get(flow) ?? 0) + 1);
  });
  const errorRows = Array.from(errorsByFlow.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([flow, count]) => ({ Flujo: flow, Errores: count }));

  // Pagos
  const paymentsOk = byType("payment_success");
  const paymentsFail = byType("payment_failed");
  const paymentsOkRows = paymentsOk.map(e => ({
    Email: String(e.props?.user_email ?? "—"),
    Plan: String(e.props?.plan ?? "—"),
    Monto: `$${Number(e.props?.amount_cop ?? 0).toLocaleString("es-CO")}`,
    Cuándo: fmtDate(e.occurred_at),
  }));
  const paymentsFailRows = paymentsFail.map(e => ({
    Email: String(e.props?.user_email ?? "—"),
    Status: String(e.props?.wompi_status ?? "—"),
    Monto: `$${Number(e.props?.amount_cop ?? 0).toLocaleString("es-CO")}`,
    Cuándo: fmtDate(e.occurred_at),
  }));

  // Clientes en riesgo: no logueados hace > 7 días
  const sevenDaysAgo = weekAgo.getTime();
  const atRisk = allUsers
    .filter(u => {
      if (!u.last_sign_in_at) return false;
      const lastSeen = new Date(u.last_sign_in_at).getTime();
      const accountAge = now.getTime() - new Date(u.created_at).getTime();
      // Sólo cuenta como "en riesgo" si la cuenta tiene > 7 días Y no entran hace > 7 días
      return accountAge > 7 * 24 * 60 * 60 * 1000 && lastSeen < sevenDaysAgo;
    })
    .sort((a, b) => {
      const aTime = a.last_sign_in_at ? new Date(a.last_sign_in_at).getTime() : 0;
      const bTime = b.last_sign_in_at ? new Date(b.last_sign_in_at).getTime() : 0;
      return aTime - bTime;
    })
    .slice(0, 20);
  const atRiskRows = atRisk.map(u => {
    const days = u.last_sign_in_at
      ? Math.floor((now.getTime() - new Date(u.last_sign_in_at).getTime()) / (24 * 60 * 60 * 1000))
      : 0;
    return {
      Email: u.email ?? "—",
      "Días sin entrar": days,
      "Última sesión": u.last_sign_in_at ? fmtDate(u.last_sign_in_at) : "Nunca",
    };
  });

  // === Build email HTML ===
  const periodFrom = weekAgo.toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "short" });
  const periodTo = now.toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "short" });

  const html = `<!DOCTYPE html>
<html><body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f7">
  <div style="max-width:680px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
    <div style="background:linear-gradient(135deg,oklch(0.43 0.14 155),oklch(0.60 0.14 155));padding:24px 28px;color:#fff">
      <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;opacity:0.85;margin-bottom:4px">Reporte semanal · AluminIA</div>
      <h1 style="margin:0;font-size:22px;font-weight:700;letter-spacing:-0.5px">${escapeHtml(periodFrom)} → ${escapeHtml(periodTo)}</h1>
    </div>
    <div style="padding:8px 28px 28px">

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:16px">
        <div style="background:#f5f5f7;padding:12px;border-radius:10px">
          <div style="font-size:10px;text-transform:uppercase;color:#6e6e73;letter-spacing:0.5px">Signups</div>
          <div style="font-size:24px;font-weight:700;color:#1d1d1f">${signups.length}</div>
        </div>
        <div style="background:#f5f5f7;padding:12px;border-radius:10px">
          <div style="font-size:10px;text-transform:uppercase;color:#6e6e73;letter-spacing:0.5px">DAU prom</div>
          <div style="font-size:24px;font-weight:700;color:#1d1d1f">${dauAvg}</div>
        </div>
        <div style="background:#f5f5f7;padding:12px;border-radius:10px">
          <div style="font-size:10px;text-transform:uppercase;color:#6e6e73;letter-spacing:0.5px">Pagos OK</div>
          <div style="font-size:24px;font-weight:700;color:oklch(0.43 0.14 155)">${paymentsOk.length}</div>
        </div>
        <div style="background:#f5f5f7;padding:12px;border-radius:10px">
          <div style="font-size:10px;text-transform:uppercase;color:#6e6e73;letter-spacing:0.5px">Errores</div>
          <div style="font-size:24px;font-weight:700;color:${errors.length > 0 ? "#842029" : "#1d1d1f"}">${errors.length}</div>
        </div>
      </div>

      ${section("Signups nuevos", `
        <table style="width:100%;border-collapse:collapse;margin-top:8px">
          <thead><tr>${["Email", "Nombre", "Provider", "Cuándo"].map(c => `<th style="text-align:left;padding:8px 10px;font-size:11px;color:#6e6e73;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #eee">${c}</th>`).join("")}</tr></thead>
          <tbody>${tableRows(signupRows, ["Email", "Nombre", "Provider", "Cuándo"])}</tbody>
        </table>
      `)}

      ${section("Actividad", `
        <p style="margin:8px 0;font-size:13px;color:#1d1d1f">
          <strong>${totalLogins}</strong> logins totales · <strong>${uniqueLogins}</strong> usuarios únicos · DAU promedio <strong>${dauAvg}</strong>
        </p>
      `)}

      ${section("Onboarding completado", `
        <table style="width:100%;border-collapse:collapse;margin-top:8px">
          <thead><tr>${["Email", "Empresa", "Régimen", "Siigo", "Cuándo"].map(c => `<th style="text-align:left;padding:8px 10px;font-size:11px;color:#6e6e73;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #eee">${c}</th>`).join("")}</tr></thead>
          <tbody>${tableRows(onboardingRows, ["Email", "Empresa", "Régimen", "Siigo", "Cuándo"])}</tbody>
        </table>
      `)}

      ${section("Activación", `
        <p style="margin:8px 0;font-size:13px;color:#1d1d1f">
          <strong>${extractos}</strong> extractos subidos · <strong>${siigoConn}</strong> conexiones Siigo · <strong>${invoices}</strong> facturas manuales
        </p>
      `)}

      ${section("Uso de Nico IA — total " + totalNicoQueries + " queries", `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px">
          <div>
            <div style="font-size:11px;color:#6e6e73;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Por agente</div>
            <table style="width:100%;border-collapse:collapse">
              <tbody>${tableRows(nicoAgentRows, ["Agente", "Queries"])}</tbody>
            </table>
          </div>
          <div>
            <div style="font-size:11px;color:#6e6e73;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Top usuarios</div>
            <table style="width:100%;border-collapse:collapse">
              <tbody>${tableRows(nicoUserRows, ["Usuario", "Queries"])}</tbody>
            </table>
          </div>
        </div>
      `)}

      ${section("Errores en flujos críticos", `
        <table style="width:100%;border-collapse:collapse;margin-top:8px">
          <thead><tr>${["Flujo", "Errores"].map(c => `<th style="text-align:left;padding:8px 10px;font-size:11px;color:#6e6e73;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #eee">${c}</th>`).join("")}</tr></thead>
          <tbody>${tableRows(errorRows, ["Flujo", "Errores"])}</tbody>
        </table>
      `)}

      ${section("Pagos exitosos", `
        <table style="width:100%;border-collapse:collapse;margin-top:8px">
          <thead><tr>${["Email", "Plan", "Monto", "Cuándo"].map(c => `<th style="text-align:left;padding:8px 10px;font-size:11px;color:#6e6e73;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #eee">${c}</th>`).join("")}</tr></thead>
          <tbody>${tableRows(paymentsOkRows, ["Email", "Plan", "Monto", "Cuándo"])}</tbody>
        </table>
      `)}

      ${section("Pagos fallidos", `
        <table style="width:100%;border-collapse:collapse;margin-top:8px">
          <thead><tr>${["Email", "Status", "Monto", "Cuándo"].map(c => `<th style="text-align:left;padding:8px 10px;font-size:11px;color:#6e6e73;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #eee">${c}</th>`).join("")}</tr></thead>
          <tbody>${tableRows(paymentsFailRows, ["Email", "Status", "Monto", "Cuándo"])}</tbody>
        </table>
      `)}

      ${section("Clientes en riesgo (no entran hace 7+ días)", `
        <table style="width:100%;border-collapse:collapse;margin-top:8px">
          <thead><tr>${["Email", "Días sin entrar", "Última sesión"].map(c => `<th style="text-align:left;padding:8px 10px;font-size:11px;color:#6e6e73;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #eee">${c}</th>`).join("")}</tr></thead>
          <tbody>${tableRows(atRiskRows, ["Email", "Días sin entrar", "Última sesión"])}</tbody>
        </table>
      `)}

      <p style="margin:32px 0 0;font-size:11px;color:#a1a1a6;border-top:1px solid #eee;padding-top:16px">AluminIA · telemetría interna · generado ${escapeHtml(now.toLocaleString("es-CO", { timeZone: "America/Bogota" }))}</p>
    </div>
  </div>
</body></html>`;

  // === Send via Resend ===
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    return json({ ok: false, error: "RESEND_API_KEY missing" }, 500);
  }

  const subject = `📊 AluminIA · resumen semanal · ${signups.length} signup${signups.length === 1 ? "" : "s"} · ${totalNicoQueries} Nico queries · ${errors.length} error${errors.length === 1 ? "" : "es"}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `AluminIA Telemetría <${RESEND_FROM}>`,
      to: [FOUNDER_EMAIL],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("[weekly-report] Resend error:", res.status, txt.slice(0, 300));
    return json({ ok: false, error: `Resend ${res.status}` }, 500);
  }

  return json({
    ok: true,
    period: { from: weekAgoIso, to: now.toISOString() },
    counts: {
      signups: signups.length,
      logins: totalLogins,
      onboardings: onboardings.length,
      extractos,
      siigo_connected: siigoConn,
      invoices,
      nico_queries: totalNicoQueries,
      errors: errors.length,
      payments_ok: paymentsOk.length,
      payments_failed: paymentsFail.length,
      at_risk: atRisk.length,
    },
  });
});
