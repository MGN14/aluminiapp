import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function generateTempPassword(length = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => chars[b % chars.length]).join("");
}

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
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!resendApiKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      return new Response(JSON.stringify({ error: "Maximum of 2 collaborators (3 total users) reached" }), {
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

    // Generate temporary password
    const tempPassword = generateTempPassword();

    // Create user in Supabase Auth with temp password
    let userId: string | null = null;
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email: normalizedEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: name.trim(),
        invited_by: caller.id,
        collaborator_role: role,
      },
    });

    if (createError) {
      if (createError.message?.includes("already been registered") || createError.message?.includes("already exists")) {
        // User already exists — look them up
        const { data: { users } } = await adminClient.auth.admin.listUsers();
        const existing = users?.find(u => u.email === normalizedEmail);
        userId = existing?.id ?? null;
      } else {
        throw createError;
      }
    } else {
      userId = newUser?.user?.id ?? null;
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
        status: userId ? "active" : "pending",
        accepted_at: userId ? new Date().toISOString() : null,
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

    // Determine login URL
    const origin = req.headers.get("origin") || "https://aluminiapp.lovable.app";
    const loginUrl = `${origin}/login`;

    // Send invite email via Resend
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #1a1a2e; font-size: 24px;">Te invitaron a AluminIA</h1>
        <p style="color: #444; font-size: 16px; line-height: 1.6;">
          Hola <strong>${name.trim()}</strong>,
        </p>
        <p style="color: #444; font-size: 16px; line-height: 1.6;">
          Has sido invitado como <strong>${role}</strong> a AluminIA.
        </p>
        <div style="background: #f4f4f8; border-radius: 8px; padding: 16px; margin: 24px 0;">
          <p style="margin: 0 0 8px; color: #666; font-size: 14px;">Tu contraseña temporal:</p>
          <p style="margin: 0; font-size: 20px; font-weight: bold; color: #1a1a2e; letter-spacing: 1px;">${tempPassword}</p>
        </div>
        <p style="color: #444; font-size: 14px; line-height: 1.6;">
          Inicia sesión con tu correo electrónico y la contraseña temporal. Te recomendamos cambiarla después de iniciar sesión.
        </p>
        <a href="${loginUrl}" style="display: inline-block; background: #6366f1; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 16px; margin-top: 16px;">
          Iniciar sesión
        </a>
        <p style="color: #999; font-size: 12px; margin-top: 32px;">
          Si no esperabas esta invitación, puedes ignorar este correo.
        </p>
      </div>
    `;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: "onboarding@resend.dev",
        to: [normalizedEmail],
        subject: "Te invitaron a AluminIA",
        html: emailHtml,
      }),
    });

    if (!resendRes.ok) {
      const resendError = await resendRes.text();
      console.error("Resend API error:", resendError);
      // Don't fail the whole flow — collaborator record is created
    }

    return new Response(JSON.stringify({ success: true, collaborator_id: collab.id }), {
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
