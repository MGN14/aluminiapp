// Edge Function: send-email-campaign
// MVP: solo founder/admin puede crear y disparar campañas masivas vía Resend.
//
// Body:
//   { subject, body_html, body_text?, from_name?, reply_to?,
//     audience_type: 'all_active_users' | 'by_plan' | 'custom_list' | 'single_test',
//     audience_filter?: { plans?: string[], emails?: string[] },
//     dry_run?: boolean,
//     test_email?: string  // para single_test
//   }
//
// Devuelve: { campaign_id, recipient_count, sent_count, failed_count }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_FROM = Deno.env.get("RESEND_FROM") || "onboarding@resend.dev";

// Rate limit conservador: Resend permite ~10/s. Hacemos 5/s para estar seguros.
const SEND_RATE_PER_SECOND = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No auth" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) return json({ error: "RESEND_API_KEY not set" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Gate: solo admins/founder
    const { data: adminRole } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!adminRole) {
      return json({ error: "Solo administradores pueden enviar campañas" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const {
      subject,
      body_html,
      body_text,
      from_name = "AluminIA",
      reply_to,
      audience_type,
      audience_filter,
      dry_run = false,
      test_email,
    } = body;

    if (!subject || !body_html) return json({ error: "subject y body_html son requeridos" }, 400);
    if (!audience_type) return json({ error: "audience_type es requerido" }, 400);

    // Resolver destinatarios
    let recipients: { email: string; user_id: string | null }[] = [];

    if (audience_type === "single_test") {
      if (!test_email) return json({ error: "test_email requerido para single_test" }, 400);
      recipients = [{ email: test_email, user_id: null }];
    } else if (audience_type === "custom_list") {
      const emails: string[] = audience_filter?.emails ?? [];
      if (!Array.isArray(emails) || emails.length === 0) {
        return json({ error: "audience_filter.emails requerido para custom_list" }, 400);
      }
      recipients = emails
        .map(e => e.trim().toLowerCase())
        .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
        .map(email => ({ email, user_id: null }));
    } else if (audience_type === "all_active_users") {
      // Todos los users con suscripción activa (no demo expirada)
      const { data } = await admin
        .from("user_subscriptions")
        .select("user_id, status")
        .in("status", ["active", "trialing"]);
      const userIds = ((data ?? []) as { user_id: string }[]).map(r => r.user_id);
      // Obtener emails
      for (const uid of userIds) {
        const { data: { user: u } } = await admin.auth.admin.getUserById(uid);
        if (u?.email) recipients.push({ email: u.email, user_id: uid });
      }
    } else if (audience_type === "by_plan") {
      const plans: string[] = audience_filter?.plans ?? [];
      if (!Array.isArray(plans) || plans.length === 0) {
        return json({ error: "audience_filter.plans requerido para by_plan" }, 400);
      }
      const { data } = await admin
        .from("user_subscriptions")
        .select("user_id, plan")
        .in("plan", plans);
      const userIds = ((data ?? []) as { user_id: string }[]).map(r => r.user_id);
      for (const uid of userIds) {
        const { data: { user: u } } = await admin.auth.admin.getUserById(uid);
        if (u?.email) recipients.push({ email: u.email, user_id: uid });
      }
    } else {
      return json({ error: `audience_type desconocido: ${audience_type}` }, 400);
    }

    // Dedup por email
    const seen = new Set<string>();
    recipients = recipients.filter(r => {
      if (seen.has(r.email)) return false;
      seen.add(r.email);
      return true;
    });

    if (recipients.length === 0) {
      return json({ error: "No hay destinatarios válidos" }, 400);
    }

    // Crear registro de campaign
    const { data: campaign, error: campErr } = await admin
      .from("email_campaigns")
      .insert({
        created_by: user.id,
        subject,
        body_html,
        body_text: body_text ?? null,
        from_name,
        reply_to: reply_to ?? null,
        audience_type,
        audience_filter: audience_filter ?? null,
        recipient_count: recipients.length,
        status: dry_run ? "draft" : "sending",
      })
      .select("id")
      .single();
    if (campErr || !campaign) {
      return json({ error: `Error creando campaign: ${campErr?.message}` }, 500);
    }

    if (dry_run) {
      return json({
        campaign_id: campaign.id,
        recipient_count: recipients.length,
        sent_count: 0,
        failed_count: 0,
        dry_run: true,
        sample_recipients: recipients.slice(0, 5).map(r => r.email),
      });
    }

    // Enviar
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: `${from_name} <${RESEND_FROM}>`,
            to: [r.email],
            reply_to: reply_to || undefined,
            subject,
            html: body_html,
            text: body_text || undefined,
          }),
        });
        if (!res.ok) {
          failed++;
          const errText = await res.text();
          errors.push(`${r.email}: ${res.status} ${errText.slice(0, 100)}`);
          await admin.from("email_campaign_sends").insert({
            campaign_id: campaign.id,
            recipient_email: r.email,
            recipient_user_id: r.user_id,
            status: "failed",
            error_message: errText.slice(0, 500),
          });
        } else {
          sent++;
          const data = await res.json();
          await admin.from("email_campaign_sends").insert({
            campaign_id: campaign.id,
            recipient_email: r.email,
            recipient_user_id: r.user_id,
            status: "sent",
            resend_email_id: data?.id ?? null,
            sent_at: new Date().toISOString(),
          });
        }
        // Rate limit
        if ((i + 1) % SEND_RATE_PER_SECOND === 0) {
          await new Promise(resolve => setTimeout(resolve, 1100));
        }
      } catch (err) {
        failed++;
        errors.push(`${r.email}: ${(err as Error).message}`);
      }
    }

    // Update campaign
    await admin.from("email_campaigns").update({
      status: failed === 0 ? "sent" : (sent === 0 ? "failed" : "partial"),
      sent_count: sent,
      failed_count: failed,
      sent_at: new Date().toISOString(),
      error_log: errors.length > 0 ? errors.slice(0, 20).join("\n") : null,
    }).eq("id", campaign.id);

    return json({
      campaign_id: campaign.id,
      recipient_count: recipients.length,
      sent_count: sent,
      failed_count: failed,
      first_errors: errors.slice(0, 5),
    });
  } catch (err) {
    console.error("send-email-campaign error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
