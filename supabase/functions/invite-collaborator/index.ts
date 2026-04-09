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
    // Verify the caller is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Create a client with the user's token to verify identity
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

    // Create admin client
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

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

    // Insert the collaborator record first
    const { data: collab, error: collabError } = await adminClient
      .from("collaborators")
      .insert({
        owner_user_id: caller.id,
        collaborator_email: email.toLowerCase().trim(),
        name: name.trim(),
        role,
        status: "pending",
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

    // Invite the user via Supabase Auth admin API
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
      email.toLowerCase().trim(),
      {
        data: {
          full_name: name.trim(),
          invited_by: caller.id,
          collaborator_role: role,
          collaborator_id: collab.id,
        },
        redirectTo: `${req.headers.get("origin") || supabaseUrl}/login`,
      }
    );

    if (inviteError) {
      // If user already exists, that's fine — just link them
      if (inviteError.message?.includes("already been registered") || inviteError.message?.includes("already exists")) {
        // Look up the existing user
        const { data: { users }, error: listError } = await adminClient.auth.admin.listUsers();
        if (!listError) {
          const existingUser = users?.find(u => u.email === email.toLowerCase().trim());
          if (existingUser) {
            await adminClient
              .from("collaborators")
              .update({ collaborator_user_id: existingUser.id, status: "active", accepted_at: new Date().toISOString() })
              .eq("id", collab.id);
          }
        }
      } else {
        console.error("Invite error:", inviteError.message);
        // Don't fail — the collaborator record is created, invite can be resent
      }
    } else if (inviteData?.user) {
      // Link the invited user's auth id
      await adminClient
        .from("collaborators")
        .update({ collaborator_user_id: inviteData.user.id })
        .eq("id", collab.id);
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
