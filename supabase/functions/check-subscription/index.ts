import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CHECK-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  const supabaseClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    logStep("Function started");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    if (!anonKey) throw new Error("SUPABASE_ANON_KEY is not set");

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
    });

    if (!authRes.ok) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const userJson = (await authRes.json().catch(() => ({}))) as { id?: string; email?: string };
    const userId = userJson.id ?? "";
    const email = userJson.email ?? "";

    if (!userId || !email) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const user = { id: userId, email };
    logStep("User authenticated", { userId: user.id });

    // Check if user is FOUNDER
    const founderEmail = Deno.env.get("FOUNDER_EMAIL");
    const isFounder = founderEmail && user.email.toLowerCase() === founderEmail.toLowerCase();

    if (isFounder) {
      logStep("User is FOUNDER");

      const { data: existingRole } = await supabaseClient
        .from("user_roles")
        .select("id")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .single();

      if (!existingRole) {
        await supabaseClient
          .from("user_roles")
          .upsert({ user_id: user.id, role: "admin" }, { onConflict: "user_id,role" });
      }

      const { data: dbSubscription } = await supabaseClient
        .from("user_subscriptions")
        .select("pdf_uploads_total, pdf_uploads_this_month")
        .eq("user_id", user.id)
        .single();

      return new Response(JSON.stringify({
        subscribed: true,
        plan: "basico",
        plan_source: "founder",
        status: "active",
        is_admin: true,
        is_founder: true,
        subscription_end: null,
        pdf_uploads_total: dbSubscription?.pdf_uploads_total || 0,
        pdf_uploads_this_month: dbSubscription?.pdf_uploads_this_month || 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Check if user is admin
    const { data: isAdmin } = await supabaseClient
      .rpc("is_admin", { _user_id: user.id });

    if (isAdmin) {
      logStep("User is admin");

      const { data: dbSubscription } = await supabaseClient
        .from("user_subscriptions")
        .select("pdf_uploads_total, pdf_uploads_this_month")
        .eq("user_id", user.id)
        .single();

      return new Response(JSON.stringify({
        subscribed: true,
        plan: "admin",
        status: "active",
        is_admin: true,
        is_founder: false,
        subscription_end: null,
        pdf_uploads_total: dbSubscription?.pdf_uploads_total || 0,
        pdf_uploads_this_month: dbSubscription?.pdf_uploads_this_month || 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Regular user: read plan from database only (no Stripe)
    const { data: dbSubscription } = await supabaseClient
      .from("user_subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!dbSubscription) {
      await supabaseClient
        .from("user_subscriptions")
        .insert({ user_id: user.id, plan: "demo", status: "active" });
    }

    const plan = dbSubscription?.plan || "demo";
    const status = dbSubscription?.status || "active";
    const subscribed = plan !== "demo" && status === "active";

    return new Response(JSON.stringify({
      subscribed,
      plan,
      status,
      subscription_end: dbSubscription?.current_period_end || null,
      pdf_uploads_total: dbSubscription?.pdf_uploads_total || 0,
      pdf_uploads_this_month: dbSubscription?.pdf_uploads_this_month || 0,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: "Subscription check failed. Please try again." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
