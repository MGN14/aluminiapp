import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CREATE-WOMPI-CHECKOUT] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
};

const WOMPI_SANDBOX_URL = "https://sandbox.wompi.co/v1";
const PLAN_AMOUNT_CENTS = 39900000; // $399,000 COP in cents

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  try {
    logStep("Function started");

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
    });

    if (!authRes.ok) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const userJson = await authRes.json() as { id?: string; email?: string };
    if (!userJson.id || !userJson.email) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    logStep("User authenticated", { userId: userJson.id });

    const wompiPrivateKey = Deno.env.get("WOMPI_PRIVATE_KEY");
    if (!wompiPrivateKey) throw new Error("WOMPI_PRIVATE_KEY is not set");

    // Create a single-use payment link via Wompi API
    const origin = req.headers.get("origin") || "https://aluminia.app";
    const reference = `aluminia-basico-${userJson.id}-${Date.now()}`;

    const linkRes = await fetch(`${WOMPI_SANDBOX_URL}/payment_links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${wompiPrivateKey}`,
      },
      body: JSON.stringify({
        name: "Plan Básico - AluminIA",
        description: "Acceso por 30 días al plan Básico de AluminIA",
        single_use: true,
        collect_shipping: false,
        currency: "COP",
        amount_in_cents: PLAN_AMOUNT_CENTS,
        redirect_url: `${origin}/dashboard?payment=success`,
        customer_data: {
          customer_references: [
            { label: "user_id", value: userJson.id },
            { label: "email", value: userJson.email },
          ],
        },
      }),
    });

    if (!linkRes.ok) {
      const errorBody = await linkRes.text();
      logStep("Wompi API error", { status: linkRes.status, body: errorBody.slice(0, 300) });
      return new Response(JSON.stringify({ error: "No se pudo crear el enlace de pago." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const linkData = await linkRes.json();
    const paymentLinkId = linkData?.data?.id;

    if (!paymentLinkId) {
      logStep("No payment link ID returned", { response: JSON.stringify(linkData).slice(0, 300) });
      return new Response(JSON.stringify({ error: "No se pudo crear el enlace de pago." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const checkoutUrl = `https://checkout.wompi.co/l/${paymentLinkId}`;
    logStep("Payment link created", { paymentLinkId, checkoutUrl });

    return new Response(JSON.stringify({ url: checkoutUrl, reference }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: "Error al crear el pago." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
