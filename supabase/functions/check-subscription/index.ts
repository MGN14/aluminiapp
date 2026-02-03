import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CHECK-SUBSCRIPTION] ${step}${detailsStr}`);
};

// Map Stripe product IDs to our plan names
const PRODUCT_TO_PLAN: Record<string, string> = {
  "prod_Tudv1FQAicdT2k": "basico",
  "prod_TudvyomSp0nxmz": "empresarial",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    logStep("Stripe key verified");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id, email: user.email });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });

    // Get current subscription from database
    const { data: dbSubscription } = await supabaseClient
      .from("user_subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (customers.data.length === 0) {
      logStep("No Stripe customer found, user is on demo plan");
      
      // Ensure user has a subscription record
      if (!dbSubscription) {
        await supabaseClient
          .from("user_subscriptions")
          .insert({ user_id: user.id, plan: "demo", status: "active" });
      }
      
      return new Response(JSON.stringify({
        subscribed: false,
        plan: "demo",
        status: "active",
        pdf_uploads_total: dbSubscription?.pdf_uploads_total || 0,
        pdf_uploads_this_month: dbSubscription?.pdf_uploads_this_month || 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const customerId = customers.data[0].id;
    logStep("Found Stripe customer", { customerId });

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });

    const hasActiveSub = subscriptions.data.length > 0;
    let plan = "demo";
    let subscriptionEnd: string | null = null;
    let stripeSubscriptionId: string | null = null;

    if (hasActiveSub) {
      const subscription = subscriptions.data[0];
      subscriptionEnd = new Date(subscription.current_period_end * 1000).toISOString();
      stripeSubscriptionId = subscription.id;
      
      const productId = subscription.items.data[0].price.product as string;
      plan = PRODUCT_TO_PLAN[productId] || "basico";
      
      logStep("Active subscription found", { 
        subscriptionId: subscription.id, 
        plan,
        endDate: subscriptionEnd 
      });

      // Update database with Stripe subscription info
      await supabaseClient
        .from("user_subscriptions")
        .upsert({
          user_id: user.id,
          plan: plan,
          status: "active",
          stripe_customer_id: customerId,
          stripe_subscription_id: stripeSubscriptionId,
          current_period_end: subscriptionEnd,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

    } else {
      logStep("No active Stripe subscription");
      
      // Reset to demo if no active subscription
      await supabaseClient
        .from("user_subscriptions")
        .upsert({
          user_id: user.id,
          plan: "demo",
          status: "active",
          stripe_customer_id: customerId,
          stripe_subscription_id: null,
          current_period_end: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });
    }

    // Get updated subscription data
    const { data: updatedSub } = await supabaseClient
      .from("user_subscriptions")
      .select("*")
      .eq("user_id", user.id)
      .single();

    return new Response(JSON.stringify({
      subscribed: hasActiveSub,
      plan: updatedSub?.plan || plan,
      status: updatedSub?.status || "active",
      subscription_end: subscriptionEnd,
      pdf_uploads_total: updatedSub?.pdf_uploads_total || 0,
      pdf_uploads_this_month: updatedSub?.pdf_uploads_this_month || 0,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR in check-subscription", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
