// notify-founder — telemetría interna + alertas inmediatas al founder.
//
// Recibe un evento desde el cliente (o desde otra edge function), lo persiste
// en app_events, y si es un evento crítico (signup, payment_failed,
// subscription_canceled) le manda un email a ngrm14@gmail.com vía Resend.
//
// Eventos no críticos (login, nico_query, extracto_uploaded, etc.) sólo se
// registran — el reporte semanal los agrega.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FOUNDER_EMAIL = "ngrm14@gmail.com";
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "onboarding@resend.dev";

const IMMEDIATE_EVENTS = new Set([
  "signup",
  "payment_success",
  "payment_failed",
  "subscription_canceled",
  "subscription_expired",
]);

interface EventPayload {
  event_type: string;
  user_id?: string | null;
  user_email?: string | null;
  user_name?: string | null;
  props?: Record<string, unknown>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function buildEmailHtml(event_type: string, payload: EventPayload): { subject: string; html: string } {
  const userBlock = `
    <p style="margin:8px 0;font-size:14px;color:#1d1d1f">
      <strong>Cliente:</strong> ${payload.user_name ?? "—"} ${payload.user_email ? `&lt;${payload.user_email}&gt;` : ""}<br>
      <strong>User ID:</strong> ${payload.user_id ?? "—"}<br>
      <strong>Cuándo:</strong> ${new Date().toISOString()}
    </p>`;
  const propsJson = JSON.stringify(payload.props ?? {}, null, 2);
  const propsBlock = propsJson === "{}" ? "" : `
    <p style="margin:12px 0 4px;font-size:12px;color:#6e6e73;text-transform:uppercase;letter-spacing:0.5px">Propiedades</p>
    <pre style="background:#f5f5f7;padding:12px;border-radius:8px;font-size:12px;overflow-x:auto">${propsJson}</pre>`;

  const headers: Record<string, { subject: string; banner: string }> = {
    signup: {
      subject: `🎉 Nuevo signup en AluminIA: ${payload.user_email ?? "—"}`,
      banner: "background:linear-gradient(135deg,oklch(0.43 0.14 155),oklch(0.60 0.14 155));color:#fff",
    },
    payment_success: {
      subject: `💰 Pago recibido: ${payload.user_email ?? "—"}`,
      banner: "background:#0f5132;color:#fff",
    },
    payment_failed: {
      subject: `⚠️ Pago FALLIDO: ${payload.user_email ?? "—"}`,
      banner: "background:#842029;color:#fff",
    },
    subscription_canceled: {
      subject: `❌ Cancelación de plan: ${payload.user_email ?? "—"}`,
      banner: "background:#842029;color:#fff",
    },
    subscription_expired: {
      subject: `⏰ Plan vencido sin renovar: ${payload.user_email ?? "—"}`,
      banner: "background:#664d03;color:#fff",
    },
  };
  const meta = headers[event_type] ?? {
    subject: `Evento AluminIA: ${event_type}`,
    banner: "background:#1d1d1f;color:#fff",
  };

  const html = `<!DOCTYPE html>
<html><body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:540px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
    <div style="${meta.banner};padding:20px 24px">
      <h1 style="margin:0;font-size:18px;font-weight:600;letter-spacing:-0.3px">${meta.subject}</h1>
    </div>
    <div style="padding:20px 24px">
      ${userBlock}
      ${propsBlock}
      <p style="margin:20px 0 0;font-size:11px;color:#a1a1a6">AluminIA · telemetría interna · ${event_type}</p>
    </div>
  </div>
</body></html>`;

  return { subject: meta.subject, html };
}

async function sendFounderEmail(event_type: string, payload: EventPayload): Promise<{ ok: boolean; error?: string }> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    console.warn("[notify-founder] RESEND_API_KEY missing — email skipped");
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const { subject, html } = buildEmailHtml(event_type, payload);

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
    console.error("[notify-founder] Resend error:", res.status, txt.slice(0, 300));
    return { ok: false, error: `Resend ${res.status}` };
  }
  return { ok: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: EventPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!payload.event_type || typeof payload.event_type !== "string") {
    return json({ error: "event_type required" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // 1) Persist event (always, even if email fails)
  const { error: insertErr } = await supabase
    .from("app_events" as never)
    .insert({
      user_id: payload.user_id ?? null,
      event_type: payload.event_type,
      props: {
        ...(payload.props ?? {}),
        ...(payload.user_email ? { user_email: payload.user_email } : {}),
        ...(payload.user_name ? { user_name: payload.user_name } : {}),
      },
    } as never);

  if (insertErr) {
    console.error("[notify-founder] insert error:", insertErr.message);
    // Don't fail the request — telemetry shouldn't block app flow.
  }

  // 2) Email if critical event
  let emailResult: { ok: boolean; error?: string } = { ok: true };
  if (IMMEDIATE_EVENTS.has(payload.event_type)) {
    emailResult = await sendFounderEmail(payload.event_type, payload);
  }

  return json({
    ok: true,
    persisted: !insertErr,
    email_sent: IMMEDIATE_EVENTS.has(payload.event_type) ? emailResult.ok : null,
    email_error: emailResult.error ?? null,
  });
});
