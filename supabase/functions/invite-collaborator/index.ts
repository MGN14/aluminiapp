import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    if (!existingUser) {
      // New user: send magic link invite via Supabase (no Resend needed)
      const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
        normalizedEmail,
        {
          redirectTo: `${origin}/login`,
          data: {
            full_name: name.trim(),
            invited_by: caller.id,
            collaborator_role: role,
          },
        }
      );
      if (inviteError) throw inviteError;
      userId = inviteData?.user?.id ?? null;
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

    // If user already exists, send a notification email via Resend (optional)
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (existingUser && resendApiKey) {
      const loginUrl = `${origin}/login`;
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: "onboarding@resend.dev",
          to: [normalizedEmail],
          subject: "Te agregaron a AluminIA",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h1 style="color: #1a1a2e;">Acceso a AluminIA</h1>
              <p>Hola <strong>${name.trim()}</strong>,</p>
              <p>Te han dado acceso como <strong>${role}</strong> en AluminIA.</p>
              <p>Ya podés iniciar sesión con tu cuenta existente:</p>
              <a href="${loginUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:16px;margin-top:16px;">
                Iniciar sesión
              </a>
            </div>
          `,
        }),
      }).catch(() => {}); // Silent fail — user already has access
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
