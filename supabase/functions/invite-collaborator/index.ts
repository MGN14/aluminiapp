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
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: authError } = await userClient.auth.getUser();
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email, name, role, permissions } = await req.json();
    if (!email || !name || !role || !permissions) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const normalizedEmail = email.toLowerCase().trim();

    // Check collaborator limit
    const { count, error: countError } = await adminClient
      .from("collaborators")
      .select("*", { count: "exact", head: true })
      .eq("owner_user_id", caller.id);
    if (countError) throw countError;
    if ((count ?? 0) >= 2) {
      return new Response(JSON.stringify({ error: "Máximo de 2 colaboradores alcanzado." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check role uniqueness
    const { data: existingRole } = await adminClient
      .from("collaborators")
      .select("id")
      .eq("owner_user_id", caller.id)
      .eq("role", role)
      .maybeSingle();
    if (existingRole) {
      return new Response(JSON.stringify({ error: `Ya existe un usuario con el rol "${role}".` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const origin = req.headers.get("origin") || Deno.env.get("APP_URL") || "https://aluminiapp.com";

    // Check if user already exists in auth
    const { data: { users: allUsers } } = await adminClient.auth.admin.listUsers();
    const existingUser = allUsers?.find(u => u.email === normalizedEmail);

    let userId: string | null = existingUser?.id ?? null;

    let inviteActionLink: string | null = null;

    if (!existingUser) {
      // Generate the magic invite link but DON'T let Supabase send the email.
      // We send a custom Spanish email via Resend with a prominent CTA.
      // redirectTo apunta a /change-password porque profiles.force_password_change
      // estará en true para forzar al colaborador a setear su contraseña antes
      // de entrar a la app.
      const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "invite",
        email: normalizedEmail,
        options: {
          redirectTo: `${origin}/change-password`,
          data: {
            full_name: name.trim(),
            invited_by: caller.id,
            collaborator_role: role,
          },
        },
      });
      if (linkError) throw linkError;
      userId = linkData?.user?.id ?? null;
      inviteActionLink = (linkData as any)?.properties?.action_link ?? null;

      // Pre-crear el profile del colaborador con flags que lo guían al
      // flow correcto: skip onboarding (la empresa ya está configurada por
      // el owner) y force_password_change (debe setear su clave al entrar).
      if (userId) {
        await adminClient
          .from("profiles" as any)
          .upsert(
            {
              user_id: userId,
              onboarding_completed: true,
              force_password_change: true,
            },
            { onConflict: "user_id" },
          );
      }
    }

    // Insert collaborator record
    const { data: collab, error: collabError } = await adminClient
      .from("collaborators")
      .insert({
        owner_user_id: caller.id,
        collaborator_email: normalizedEmail,
        collaborator_user_id: userId,
        name: name.trim(),
        role,
        status: existingUser ? "active" : "pending",
        accepted_at: existingUser ? new Date().toISOString() : null,
      })
      .select()
      .single();
    if (collabError) throw collabError;

    // Insert permissions
    const permRows = Object.entries(permissions).map(([module_key, access_level]) => ({
      collaborator_id: collab.id,
      module_key,
      access_level: access_level as string,
    }));
    const { error: permError } = await adminClient
      .from("collaborator_permissions")
      .insert(permRows);
    if (permError) throw permError;

    // Send custom Spanish email via Resend. Para usuarios nuevos: con el
    // magic link de Supabase. Para usuarios existentes: solo notificación
    // con link a /login.
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (resendApiKey) {
      const ownerEmail = caller.email || "el administrador";
      const isNew = !existingUser;
      const ctaUrl = isNew && inviteActionLink ? inviteActionLink : `${origin}/login`;
      const ctaLabel = isNew ? "Aceptar invitación" : "Iniciar sesión";
      const subject = isNew
        ? `${name.trim()}, te invitaron a AluminIA`
        : "Te dieron acceso a AluminIA";

      const intro = isNew
        ? `<strong>${ownerEmail}</strong> te invitó a colaborar en su cuenta de <strong>AluminIA</strong> como <strong>${role}</strong>.`
        : `<strong>${ownerEmail}</strong> te dio acceso como <strong>${role}</strong> en su cuenta de <strong>AluminIA</strong>.`;

      const nextStep = isNew
        ? `Hacé click en el botón para aceptar la invitación, crear tu contraseña y entrar directo a los datos de la empresa.`
        : `Iniciá sesión con tu cuenta existente para acceder.`;

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: `AluminIA <${RESEND_FROM}>`,
          to: [normalizedEmail],
          subject,
          html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Inter','Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <tr><td style="padding:32px 32px 0 32px;">
          <div style="display:inline-flex;align-items:center;gap:10px;">
            <div style="width:36px;height:36px;border-radius:9px;background:oklch(0.43 0.14 155);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;">A</div>
            <span style="font-size:18px;font-weight:700;color:#1d1d1f;letter-spacing:-0.3px;">AluminIA</span>
          </div>
        </td></tr>
        <tr><td style="padding:24px 32px 8px 32px;">
          <h1 style="margin:0 0 16px;font-size:26px;font-weight:700;color:#1d1d1f;letter-spacing:-0.5px;line-height:1.2;">
            Hola ${name.trim()},
          </h1>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#3a3a3c;">
            ${intro}
          </p>
          <p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:#3a3a3c;">
            ${nextStep}
          </p>
        </td></tr>
        <tr><td align="center" style="padding:0 32px 32px 32px;">
          <a href="${ctaUrl}"
             style="display:inline-block;background:oklch(0.43 0.14 155);color:#ffffff;padding:16px 40px;border-radius:999px;text-decoration:none;font-size:16px;font-weight:600;letter-spacing:-0.2px;box-shadow:0 4px 12px rgba(36,209,100,0.25);">
            ${ctaLabel} →
          </a>
          <p style="margin:16px 0 0;font-size:13px;color:#86868b;">
            ${isNew ? "Si el botón no funciona, copiá este link en tu navegador:" : ""}
          </p>
          ${isNew ? `<p style="margin:8px 0 0;font-size:12px;color:#86868b;word-break:break-all;">${ctaUrl}</p>` : ""}
        </td></tr>
        <tr><td style="padding:24px 32px;border-top:1px solid #e5e5e7;background:#fafafa;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#86868b;">
            Si no esperabas esta invitación, podés ignorar este correo.
            Solo el administrador puede agregarte como colaborador.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
        }),
      }).catch((err) => {
        console.error("[invite-collaborator] resend send failed:", err);
      });
    }

    return new Response(JSON.stringify({
      success: true,
      collaborator_id: collab.id,
      method: existingUser ? "existing_user" : "invite_link_sent"
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Error in invite-collaborator:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
