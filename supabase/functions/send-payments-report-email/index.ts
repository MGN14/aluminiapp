// Edge Function: send-payments-report-email
//
// Envía por email un Excel con la "Relación de Pagos" + estado de cuenta
// resumido en el cuerpo HTML. Pensado para que el dueño de PYME mande a
// su cliente (ej: "Aluminios JH te debe X, acá está el detalle").
//
// Patrón: clonado de send-export-email para reutilizar el flujo probado
// (chunks base64 en frontend, fetch directo, Resend con attachment).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_FROM = Deno.env.get("RESEND_FROM") || "onboarding@resend.dev";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatCOP(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency", currency: "COP",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Math.round(n));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const {
      to_email,
      to_name,
      message,
      file_base64,
      file_name,
      summary,
      // PDF opcional: cuando el dueño elige una remisión a adjuntar en el
      // reporte, se manda también el PDF (estado de cuenta + páginas de
      // remisión) como segundo attachment. Si no, queda solo Excel como hoy.
      pdf_base64,
      pdf_file_name,
    } = body ?? {};

    if (!to_email || !file_base64 || !file_name) {
      return json({ error: "Faltan campos requeridos: to_email, file_base64, file_name" }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to_email)) {
      return json({ error: "Email destinatario inválido" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, company_name")
      .eq("user_id", user.id)
      .maybeSingle();

    const senderName = profile?.full_name || user.email || "Tu proveedor";
    const companyName = profile?.company_name || "";
    const senderLabel = companyName ? `${senderName} — ${companyName}` : senderName;

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return json({ error: "RESEND_API_KEY no configurada en el servidor" }, 500);
    }

    const safeMessage = escapeHtml(String(message || "")).replace(/\n/g, "<br/>");
    const safeToName = escapeHtml(String(to_name || ""));
    const safeSenderLabel = escapeHtml(senderLabel);

    let summaryHtml = "";
    if (summary && typeof summary === "object") {
      const s = summary as {
        facturado?: number; cobrado?: number; pendiente?: number;
        periodo?: string; count?: number;
      };
      const facturado = Number(s.facturado ?? 0);
      const cobrado = Number(s.cobrado ?? 0);
      const pendiente = Number(s.pendiente ?? 0);
      const periodo = String(s.periodo || "");
      summaryHtml = `
  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
    ${periodo ? `
    <tr><td colspan="2" style="padding:10px 16px;background:#1d1d1f;color:#fff;font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">
      Estado de cuenta — ${escapeHtml(periodo)}
    </td></tr>` : ""}
    <tr><td style="padding:10px 16px;color:#64748b;font-size:13px;">Total facturado</td>
        <td style="padding:10px 16px;text-align:right;font-weight:600;color:#1d1d1f;font-size:14px;">${formatCOP(facturado)}</td></tr>
    <tr style="background:#fff;"><td style="padding:10px 16px;color:#64748b;font-size:13px;">Total cobrado</td>
        <td style="padding:10px 16px;text-align:right;font-weight:600;color:#16a34a;font-size:14px;">−${formatCOP(cobrado)}</td></tr>
    <tr><td style="padding:12px 16px;color:#1d1d1f;font-size:14px;font-weight:600;border-top:2px solid #e2e8f0;">Saldo pendiente</td>
        <td style="padding:12px 16px;text-align:right;font-weight:700;color:${pendiente > 0 ? "#dc2626" : "#16a34a"};font-size:18px;border-top:2px solid #e2e8f0;">${formatCOP(pendiente)}</td></tr>
  </table>`;
    }

    const greeting = safeToName ? `Hola ${safeToName} 👋` : "Hola 👋";

    const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1d1d1f;">
  <h1 style="color: #1d1d1f; font-size: 22px; margin: 0 0 4px 0; letter-spacing: -0.5px;">${greeting}</h1>
  <p style="color: #64748b; font-size: 14px; margin: 0 0 18px 0;">
    Te paso la <strong>relación de pagos y estado de cuenta</strong>.
  </p>
  ${summaryHtml}
  ${safeMessage ? `
  <div style="background:#f8fafc;border-left:3px solid #1d1d1f;padding:12px 16px;margin:18px 0;border-radius:4px;color:#1d1d1f;font-size:14px;line-height:1.55;">
    ${safeMessage}
  </div>` : ""}
  <p style="font-size: 13px; color: #64748b; margin: 18px 0 6px;">
    ${pdf_base64
      ? "Adjuntamos el Excel con el detalle completo y el PDF con el estado de cuenta y la remisión asociada."
      : "Adjuntamos el Excel con el detalle completo de los movimientos."}
  </p>
  <p style="font-size: 13px; color: #64748b; margin: 6px 0;">
    Cualquier duda, respondé este correo y te contesto.
  </p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
  <p style="font-size: 12px; color: #94a3b8; margin: 0;">
    Enviado por <strong>${safeSenderLabel}</strong> a través de <strong>AluminIA</strong>.
  </p>
</div>
    `.trim();

    const subject = safeToName
      ? `Estado de cuenta${summary?.periodo ? ` — ${escapeHtml(String(summary.periodo))}` : ""} — ${safeToName}`
      : `Estado de cuenta${summary?.periodo ? ` — ${escapeHtml(String(summary.periodo))}` : ""}`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: `AluminIA <${RESEND_FROM}>`,
        to: [to_email],
        reply_to: user.email || undefined,
        subject,
        html,
        attachments: [
          {
            filename: file_name,
            content: file_base64,
            content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
          ...(pdf_base64 && pdf_file_name ? [{
            filename: pdf_file_name,
            content: pdf_base64,
            content_type: "application/pdf",
          }] : []),
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Resend error:", res.status, errText);
      return json({ error: `Resend devolvió ${res.status}: ${errText}` }, 502);
    }

    const resendData = await res.json().catch(() => ({}));
    return json({ success: true, email_id: resendData?.id ?? null }, 200);
  } catch (err) {
    console.error("send-payments-report-email error:", err);
    return json({ error: (err as Error)?.message ?? "Internal error" }, 500);
  }
});
