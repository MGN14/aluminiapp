import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CHECK-SUBSCRIPTION] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
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
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
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

    logStep("User authenticated", { userId });

    // Check FOUNDER
    const founderEmail = Deno.env.get("FOUNDER_EMAIL");
    const isFounder = founderEmail && email.toLowerCase() === founderEmail.toLowerCase();

    if (isFounder) {
      logStep("User is FOUNDER");
      const { data: existingRole } = await supabaseClient
        .from("user_roles").select("id").eq("user_id", userId).eq("role", "admin").single();
      if (!existingRole) {
        await supabaseClient.from("user_roles")
          .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });
      }
      const { data: sub } = await supabaseClient
        .from("user_subscriptions").select("pdf_uploads_total, pdf_uploads_this_month")
        .eq("user_id", userId).single();
      return new Response(JSON.stringify({
        subscribed: true, plan: "basico", plan_source: "founder", status: "active",
        is_admin: true, is_founder: true, subscription_end: null,
        pdf_uploads_total: sub?.pdf_uploads_total || 0,
        pdf_uploads_this_month: sub?.pdf_uploads_this_month || 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }

    // Check admin
    const { data: isAdmin } = await supabaseClient.rpc("is_admin", { _user_id: userId });
    if (isAdmin) {
      logStep("User is admin");
      const { data: sub } = await supabaseClient
        .from("user_subscriptions").select("pdf_uploads_total, pdf_uploads_this_month")
        .eq("user_id", userId).single();
      return new Response(JSON.stringify({
        subscribed: true, plan: "admin", status: "active",
        is_admin: true, is_founder: false, subscription_end: null,
        pdf_uploads_total: sub?.pdf_uploads_total || 0,
        pdf_uploads_this_month: sub?.pdf_uploads_this_month || 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }

    // Regular user: read from database + check expiration
    let { data: dbSub } = await supabaseClient
      .from("user_subscriptions").select("*").eq("user_id", userId).single();

    if (!dbSub) {
      await supabaseClient.from("user_subscriptions")
        .insert({ user_id: userId, plan: "demo", status: "active" });
      const { data: newSub } = await supabaseClient
        .from("user_subscriptions").select("*").eq("user_id", userId).single();
      dbSub = newSub;
    }

    // Check if plan has expired
    let plan = dbSub?.plan || "demo";
    if (plan !== "demo" && dbSub?.plan_expires_at) {
      const expiresAt = new Date(dbSub.plan_expires_at);
      if (expiresAt < new Date()) {
        logStep("Plan expired, reverting to demo", { expiresAt: dbSub.plan_expires_at });
        await supabaseClient.from("user_subscriptions").update({
          plan: "demo", plan_expires_at: null, wompi_transaction_id: null, updated_at: new Date().toISOString(),
        }).eq("user_id", userId);
        plan = "demo";
        dbSub = { ...dbSub, plan: "demo", plan_expires_at: null };
      }
    }

    const subscribed = plan !== "demo";

    return new Response(JSON.stringify({
      subscribed, plan, status: dbSub?.status || "active",
      subscription_end: dbSub?.plan_expires_at || null,
      pdf_uploads_total: dbSub?.pdf_uploads_total || 0,
      pdf_uploads_this_month: dbSub?.pdf_uploads_this_month || 0,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: "Subscription check failed." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});
