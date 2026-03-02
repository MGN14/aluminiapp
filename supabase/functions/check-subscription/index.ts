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
        is_trialing: false, trial_days_left: null, trial_expired: false,
        trial_checklist: null,
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
        is_trialing: false, trial_days_left: null, trial_expired: false,
        trial_checklist: null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }

    // Regular user: read from database
    let { data: dbSub } = await supabaseClient
      .from("user_subscriptions").select("*").eq("user_id", userId).single();

    if (!dbSub) {
      await supabaseClient.from("user_subscriptions")
        .insert({ 
          user_id: userId, plan: "demo", status: "trialing",
          trial_started_at: new Date().toISOString(),
          plan_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          trial_checklist: { statement_uploaded: false, invoice_uploaded: false, invoice_matched: false, dian_reviewed: false },
        });
      const { data: newSub } = await supabaseClient
        .from("user_subscriptions").select("*").eq("user_id", userId).single();
      dbSub = newSub;
    }

    // If demo user missing trial fields, backfill
    if (dbSub?.plan === "demo" && !dbSub.trial_started_at) {
      const trialStart = dbSub.created_at || new Date().toISOString();
      const trialExpires = new Date(new Date(trialStart).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
      await supabaseClient.from("user_subscriptions").update({
        trial_started_at: trialStart,
        plan_expires_at: dbSub.plan_expires_at || trialExpires,
        status: new Date(trialExpires) < new Date() ? "inactive" : "trialing",
      }).eq("user_id", userId);
      dbSub = { ...dbSub, trial_started_at: trialStart, plan_expires_at: dbSub.plan_expires_at || trialExpires };
    }

    let plan = dbSub?.plan || "demo";
    let status = dbSub?.status || "active";

    // Check expiration for paid plans
    if (plan !== "demo" && dbSub?.plan_expires_at) {
      const expiresAt = new Date(dbSub.plan_expires_at);
      if (expiresAt < new Date()) {
        logStep("Paid plan expired, reverting to demo inactive", { expiresAt: dbSub.plan_expires_at });
        await supabaseClient.from("user_subscriptions").update({
          plan: "demo", status: "inactive", plan_expires_at: dbSub.plan_expires_at,
          wompi_transaction_id: null, updated_at: new Date().toISOString(),
        }).eq("user_id", userId);
        plan = "demo";
        status = "inactive";
      }
    }

    // Check trial expiration for demo plans
    if (plan === "demo" && status === "trialing" && dbSub?.plan_expires_at) {
      const expiresAt = new Date(dbSub.plan_expires_at);
      if (expiresAt < new Date()) {
        logStep("Trial expired");
        await supabaseClient.from("user_subscriptions").update({
          status: "inactive", updated_at: new Date().toISOString(),
        }).eq("user_id", userId);
        status = "inactive";
      }
    }

    // Calculate trial info
    const isTrialing = plan === "demo" && status === "trialing";
    const trialExpired = plan === "demo" && status === "inactive";
    let trialDaysLeft: number | null = null;

    if (isTrialing && dbSub?.plan_expires_at) {
      const expiresAt = new Date(dbSub.plan_expires_at);
      trialDaysLeft = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    }

    const subscribed = plan !== "demo" || isTrialing;

    return new Response(JSON.stringify({
      subscribed, plan, status,
      subscription_end: dbSub?.plan_expires_at || null,
      pdf_uploads_total: dbSub?.pdf_uploads_total || 0,
      pdf_uploads_this_month: dbSub?.pdf_uploads_this_month || 0,
      is_trialing: isTrialing,
      trial_days_left: trialDaysLeft,
      trial_expired: trialExpired,
      trial_checklist: dbSub?.trial_checklist || null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: "Subscription check failed." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});
