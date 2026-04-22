import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[CREATE-WOMPI-CHECKOUT] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
};

const WOMPI_SANDBOX_URL = "https://sandbox.wompi.co/v1";

// HMAC-SHA256 sobre `${userId}-${plan}-${timestamp}` usando WOMPI_EVENTS_SECRET.
// Se anexa al reference para que wompi-webhook pueda verificar que el user_id
// no fue adulterado por el pagador (sin esto, un atacante podría inyectar un
// user_id ajeno vía customer_references y activar el plan de otra cuenta).
async function signReference(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 16);
}

interface PlanConfig {
  name: string;
  description: string;
  amount_in_cents: number;
}

const PLAN_CONFIGS: Record<string, PlanConfig> = {
  basico: {
    name: "Plan Básico - AluminIA",
    description: "Acceso por 30 días al plan Básico de AluminIA",
    amount_in_cents: 39900000, // $399,000 COP
  },
  "basico-anual": {
    name: "Plan Básico Anual - AluminIA",
    description: "Acceso por 12 meses al plan Básico de AluminIA",
    amount_in_cents: 383040000, // $399,000 * 12 * 0.8 = $3,830,400 COP
  },
  empresarial: {
    name: "Plan Empresarial - AluminIA",
    description: "Acceso por 30 días al plan Empresarial de AluminIA",
    amount_in_cents: 69900000, // $699,000 COP
  },
  "empresarial-anual": {
    name: "Plan Empresarial Anual - AluminIA",
    description: "Acceso por 12 meses al plan Empresarial de AluminIA",
    amount_in_cents: 671040000, // $699,000 * 12 * 0.8 = $6,710,400 COP
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  try {
    logStep("Function started");

    // Parse request body for plan selection
    let planKey = "basico";
    try {
      const body = await req.json();
      if (body?.plan && typeof body.plan === "string") {
        planKey = body.plan;
      }
    } catch {
      // No body or invalid JSON, default to basico
    }

    const planConfig = PLAN_CONFIGS[planKey];
    if (!planConfig) {
      return new Response(JSON.stringify({ error: `Plan no válido: ${planKey}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    logStep("Plan selected", { planKey, amount: planConfig.amount_in_cents });

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

    const eventsSecret = Deno.env.get("WOMPI_EVENTS_SECRET") ?? "";
    if (!eventsSecret) throw new Error("WOMPI_EVENTS_SECRET is not set");

    const origin = req.headers.get("origin") || "https://aluminia.app";
    const basePlan = planKey.replace("-anual", "");
    const timestamp = Date.now();
    const payload = `${userJson.id}-${basePlan}-${timestamp}`;
    const sig = await signReference(payload, eventsSecret);
    const reference = `aluminia-${basePlan}-${userJson.id}-${timestamp}-${sig}`;

    const linkRes = await fetch(`${WOMPI_SANDBOX_URL}/payment_links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${wompiPrivateKey}`,
      },
      body: JSON.stringify({
        name: planConfig.name,
        description: planConfig.description,
        single_use: true,
        collect_shipping: false,
        currency: "COP",
        amount_in_cents: planConfig.amount_in_cents,
        redirect_url: `${origin}/dashboard?payment=success`,
        // reference: lo atamos al payment_link para que viaje firmado hasta el webhook.
        // Wompi lo propaga al transaction.reference cuando el usuario paga.
        reference,
        customer_data: {
          customer_references: [
            { label: "user_id", is_required: true },
            { label: "email", is_required: true },
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
    logStep("Payment link created", { paymentLinkId, checkoutUrl, planKey });

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
