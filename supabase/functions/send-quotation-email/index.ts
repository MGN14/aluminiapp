// Edge Function: send-quotation-email
// Envía un PDF de cotización generado en el cliente al correo del cliente
// (responsible.email) usando Resend.
// Autorización:
//   - Owner siempre puede.
//   - Colaborador requiere collaborator_permissions.access_level = 'edit'
//     para module_key='cotizaciones'.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_FROM = Deno.env.get("RESEND_FROM") || "onboarding@resend.dev";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "No authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const {
      quote_id,
      to_email,
      message,
      file_base64,
      file_name,
      cc_self,
    } = body ?? {};

    if (!quote_id || !to_email || !file_base64 || !file_name) {
      return json(
        { error: "Missing required fields: quote_id, to_email, file_base64, file_name" },
        400,
      );
    }

    // Validar email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to_email)) {
      return json({ error: "Invalid to_email format" }, 400);
    }

    // Chequear permiso. Primero: ¿es colaborador de algún owner?
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: asCollaborator } = await admin
      .from("collaborators")
      .select("id, owner_user_id")
      .eq("collaborator_user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (asCollaborator) {
      const { data: perm } = await admin
        .from("collaborator_permissions")
        .select("access_level")
        .eq("collaborator_id", asCollaborator.id)
        .eq("module_key", "cotizaciones")
        .maybeSingle();

      if (perm?.access_level !== "edit") {
        return json(
          {
            error:
              "No tenés permiso para enviar cotizaciones. Pedile al administrador acceso 'edit' al módulo Cotizaciones.",
          },
          403,
        );
      }
    }

    // Validar que la cotización pertenece al usuario (o al owner si es colaborador)
    const ownerId = asCollaborator?.owner_user_id ?? user.id;
    const { data: quote, error: qErr } = await admin
      .from("quotations")
      .select("id, user_id, quote_number, total, valid_until")
      .eq("id", quote_id)
      .maybeSingle();

    if (qErr || !quote) {
      return json({ error: "Cotización no encontrada" }, 404);
    }
    if (quote.user_id !== ownerId) {
      return json({ error: "No tenés acceso a esta cotización" }, 403);
    }

    // Info del remitente para el cuerpo del email
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, company_name, company_phone, accounting_email")
      .eq("user_id", ownerId)
      .maybeSingle();

    const senderName = profile?.full_name || user.email || "AluminIA";
    const companyName = profile?.company_name || "";

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      return json({ error: "RESEND_API_KEY no configurada en el servidor" }, 500);
    }

    // Sanitize message for HTML
    const escapedMessage = String(message || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br/>");

    const fmtMoney = (n: number) =>
      new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        minimumFractionDigits: 0,
      }).format(Number(n) || 0);

    const validUntilHuman = (() => {
      if (!quote.valid_until) return "";
      const [y, m, d] = String(quote.valid_until).split("-");
      return `${d}/${m}/${y}`;
    })();

    const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1d1d1f;">
  <div style="background: linear-gradient(135deg, #36694e 0%, #2d5a3f 100%); padding: 24px; border-radius: 12px 12px 0 0; color: #fff;">
    <div style="font-size: 11px; opacity: 0.85; letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 6px;">
      Cotización
    </div>
    <div style="font-size: 22px; font-weight: 700;">${quote.quote_number}</div>
    ${companyName ? `<div style="font-size: 13px; opacity: 0.9; margin-top: 6px;">${companyName}</div>` : ""}
  </div>
  <div style="background: #fff; border: 1px solid #e5e5ea; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
    <p style="margin: 0 0 16px 0; font-size: 15px;">Hola,</p>
    <p style="margin: 0 0 16px 0; font-size: 14px; color: #424245;">
      Adjuntamos la cotización <strong>${quote.quote_number}</strong> por valor de
      <strong style="color: #36694e;">${fmtMoney(quote.total)}</strong>${validUntilHuman ? `, válida hasta el <strong>${validUntilHuman}</strong>` : ""}.
    </p>
    ${
      escapedMessage
        ? `<div style="background:#f5f5f7; border-left:3px solid #36694e; padding:12px 16px; margin:20px 0; border-radius:6px; font-size: 14px; color: #1d1d1f;">${escapedMessage}</div>`
        : ""
    }
    <p style="margin: 24px 0 8px 0; font-size: 14px; color: #424245;">
      Cualquier consulta o ajuste, respondé este correo y lo conversamos.
    </p>
    <p style="margin: 0 0 0 0; font-size: 14px; font-weight: 600;">${senderName}</p>
    ${companyName ? `<p style="margin: 2px 0 0 0; font-size: 13px; color: #6e6e73;">${companyName}</p>` : ""}
    ${profile?.company_phone ? `<p style="margin: 2px 0 0 0; font-size: 13px; color: #6e6e73;">${profile.company_phone}</p>` : ""}
  </div>
  <p style="font-size: 11px; color: #94a3b8; text-align: center; margin-top: 16px;">
    Cotización generada con AluminIA · aluminiapp.co
  </p>
</div>
    `.trim();

    const toList: string[] = [to_email];
    if (cc_self && profile?.accounting_email && profile.accounting_email !== to_email) {
      toList.push(profile.accounting_email);
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: `AluminIA <${RESEND_FROM}>`,
        to: toList,
        reply_to: profile?.accounting_email || user.email || undefined,
        subject: `Cotización ${quote.quote_number}${companyName ? ` — ${companyName}` : ""}`,
        html,
        attachments: [
          {
            filename: file_name,
            content: file_base64,
            content_type: "application/pdf",
          },
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
    console.error("send-quotation-email error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
