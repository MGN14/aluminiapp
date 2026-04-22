// Edge Function: send-export-email
// Envía un Excel generado en el cliente al correo especificado usando Resend.
// Autorización:
//   - Owner siempre puede.
//   - Colaborador requiere collaborator_permissions.access_level = 'edit' para module_key='exportar'.

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

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const { to_email, message, file_base64, file_name, transaction_count } = body ?? {};

    if (!to_email || !file_base64 || !file_name) {
      return json({ error: "Missing required fields: to_email, file_base64, file_name" }, 400);
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
        .eq("module_key", "exportar")
        .maybeSingle();

      if (perm?.access_level !== "edit") {
        return json({ error: "No tenés permiso para enviar correos desde Exportar. Solicitalo al administrador." }, 403);
      }
    }
    // Si no es colaborador, asumimos que es owner de su propia cuenta → autorizado.

    // Info para el email
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, company_name")
      .eq("user_id", user.id)
      .maybeSingle();

    const senderName = profile?.full_name || user.email || "Usuario AluminIA";
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

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a2e;">
  <h1 style="color: #1a1a2e; font-size: 20px; margin-bottom: 8px;">📊 Movimientos contables de AluminIA</h1>
  <p style="color: #64748b; font-size: 14px; margin-top: 0;">
    Enviado por <strong>${senderName}</strong>${companyName ? ` — ${companyName}` : ""}
  </p>
  <div style="background:#f8fafc; border-left:3px solid #6366f1; padding:12px 16px; margin:20px 0; border-radius:4px;">
    ${escapedMessage || "Adjunto los movimientos contables."}
  </div>
  <p style="font-size: 13px; color: #64748b;">
    Se adjunta un archivo Excel con ${transaction_count ?? 0} transacción${transaction_count === 1 ? "" : "es"}
    organizado en tres hojas: Transacciones, Resumen DIAN y Resumen General.
  </p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
  <p style="font-size: 11px; color: #94a3b8;">
    Este correo fue enviado automáticamente desde AluminIA. Los datos son informativos y no reemplazan la asesoría de un contador público certificado.
  </p>
</div>
    `.trim();

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
        subject: `Movimientos contables${companyName ? ` — ${companyName}` : ""}`,
        html,
        attachments: [
          {
            filename: file_name,
            content: file_base64,
            content_type:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
    console.error("send-export-email error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
