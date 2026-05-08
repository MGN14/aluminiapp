import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[WOMPI-WEBHOOK] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
};

// Wompi sandbox vs production. Detección por prefijo de la private key
// (prv_prod_/prv_live_ → prod). Override con WOMPI_ENV=production|sandbox.
function resolveWompiApiUrl(privateKey: string): string {
  const explicit = (Deno.env.get("WOMPI_ENV") ?? "").toLowerCase().trim();
  const looksProd = privateKey.startsWith("prv_prod_") || privateKey.startsWith("prv_live_");
  const isProd = explicit === "production" || explicit === "prod" || (!explicit && looksProd);
  return isProd ? "https://production.wompi.co/v1" : "https://sandbox.wompi.co/v1";
}

const PLAN_AMOUNT_CENTS = 39900000; // $399,000 COP

// Debe coincidir con signReference() en create-wompi-checkout.
async function computeReferenceSig(payload: string, secret: string): Promise<string> {
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

serve(async (req) => {
  // Webhooks are POST only, no CORS needed (server-to-server)
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const eventsSecret = Deno.env.get("WOMPI_EVENTS_SECRET") ?? "";

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    logStep("Webhook received");

    const body = await req.json();
    const event = body.event;
    const data = body.data;
    const signature = body.signature;
    const timestamp = body.timestamp;

    logStep("Event parsed", { event, transactionId: data?.transaction?.id });

    if (event !== "transaction.updated") {
      logStep("Ignored event type", { event });
      return new Response("OK", { status: 200 });
    }

    // Step 1: Validate signature
    const checksumHeader = req.headers.get("X-Event-Checksum") || signature?.checksum;
    if (!checksumHeader) {
      logStep("Missing checksum");
      return new Response("Invalid signature", { status: 401 });
    }

    // Build the string to hash from signature.properties
    const properties = signature?.properties || [];
    let concatenated = "";
    for (const prop of properties) {
      // Navigate the data object using dot notation (e.g., "transaction.id")
      const parts = prop.split(".");
      let value: any = data;
      for (const part of parts) {
        value = value?.[part];
      }
      concatenated += String(value ?? "");
    }
    concatenated += String(timestamp);
    concatenated += eventsSecret;

    // SHA256 hash
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(concatenated);
    const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const computedChecksum = hashArray.map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();

    if (computedChecksum !== checksumHeader.toUpperCase()) {
      logStep("Signature mismatch", { computed: computedChecksum, received: checksumHeader });
      return new Response("Invalid signature", { status: 401 });
    }

    logStep("Signature validated");

    const transaction = data.transaction;
    const transactionId = transaction?.id;
    const status = transaction?.status;
    const amountInCents = transaction?.amount_in_cents;

    logStep("Transaction details", { transactionId, status, amountInCents });

    // Step 2: Backend verification - fetch transaction from Wompi API
    const wompiPrivateKey = Deno.env.get("WOMPI_PRIVATE_KEY") ?? "";
    const wompiApiUrl = resolveWompiApiUrl(wompiPrivateKey);
    const verifyRes = await fetch(`${wompiApiUrl}/transactions/${transactionId}`, {
      headers: { Authorization: `Bearer ${wompiPrivateKey}` },
    });

    if (!verifyRes.ok) {
      logStep("Failed to verify transaction with Wompi API", { status: verifyRes.status });
      return new Response("Verification failed", { status: 500 });
    }

    const verifyData = await verifyRes.json();
    const verifiedStatus = verifyData?.data?.status;
    const verifiedAmount = verifyData?.data?.amount_in_cents;

    logStep("Wompi API verification", { verifiedStatus, verifiedAmount });

    if (verifiedStatus !== "APPROVED") {
      logStep("Transaction not approved", { verifiedStatus });
      // Telemetría: aviso inmediato al founder de pago fallido.
      // Intentamos extraer userId del reference para el email; si no se puede,
      // mandamos sin user_id (se ve igual en el inbox).
      try {
        const failedRef: string = verifyData?.data?.reference || transaction?.reference || "";
        const failedRefMatch = failedRef.match(
          /^aluminia-(basico|empresarial)-([a-f0-9-]{36})-(\d+)-([a-f0-9]{16})$/,
        );
        const failedUserId = failedRefMatch?.[2] ?? null;
        const failedEmail = verifyData?.data?.customer_email ?? transaction?.customer_email ?? null;
        await fetch(`${supabaseUrl}/functions/v1/notify-founder`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
          body: JSON.stringify({
            event_type: "payment_failed",
            user_id: failedUserId,
            user_email: failedEmail,
            props: {
              wompi_status: verifiedStatus,
              transaction_id: transactionId,
              amount_cop: (verifiedAmount ?? 0) / 100,
              reference: failedRef.slice(0, 80),
            },
          }),
        }).catch((e) => logStep("notify-founder failed (payment_failed)", { error: String(e) }));
      } catch (e) {
        logStep("notify-founder threw (payment_failed)", { error: String(e) });
      }
      return new Response("OK", { status: 200 });
    }

    if (verifiedAmount !== PLAN_AMOUNT_CENTS) {
      logStep("Amount mismatch", { expected: PLAN_AMOUNT_CENTS, got: verifiedAmount });
      return new Response("Amount mismatch", { status: 400 });
    }

    // Step 3: Find user via HMAC-signed reference.
    // El reference se genera server-side en create-wompi-checkout firmando
    // `${userId}-${plan}-${timestamp}` con WOMPI_EVENTS_SECRET y anexando 16 hex.
    // Formato: `aluminia-{plan}-{uuid}-{timestamp}-{sig16}`
    // Descartamos customer_references.user_id porque lo rellena el pagador
    // (manipulable) y payment_link_id porque apunta al mismo dato inseguro.
    const reference: string = verifyData?.data?.reference || transaction?.reference || "";
    const refMatch = reference.match(
      /^aluminia-(basico|empresarial)-([a-f0-9-]{36})-(\d+)-([a-f0-9]{16})$/
    );

    if (!refMatch) {
      logStep("Reference format invalid or unsigned", { reference: reference.slice(0, 80) });
      return new Response("Invalid reference", { status: 400 });
    }

    const [, refPlan, refUserId, refTimestamp, refSig] = refMatch;
    const expectedSig = await computeReferenceSig(
      `${refUserId}-${refPlan}-${refTimestamp}`,
      eventsSecret,
    );

    if (expectedSig !== refSig) {
      logStep("Reference signature mismatch", { expected: expectedSig, got: refSig });
      return new Response("Invalid reference signature", { status: 401 });
    }

    const userId: string = refUserId;
    logStep("User identified via signed reference", { userId, plan: refPlan });

    // Step 3.5: Idempotency — si ya activamos este transactionId, no repetimos.
    // Evita que reintentos de Wompi (timeouts, 5xx transitorios) extiendan el
    // periodo ni dupliquen logs. Comparamos por wompi_transaction_id que es único
    // por transacción en Wompi.
    const { data: existingSub } = await supabase
      .from("user_subscriptions")
      .select("wompi_transaction_id, plan_expires_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (existingSub?.wompi_transaction_id === transactionId) {
      logStep("Webhook replay ignored (already processed)", {
        userId,
        transactionId,
        expiresAt: existingSub.plan_expires_at,
      });
      return new Response("OK", { status: 200 });
    }

    // Step 4: Activate plan
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days

    const { error: updateError } = await supabase
      .from("user_subscriptions")
      .upsert({
        user_id: userId,
        plan: "basico",
        status: "active",
        plan_expires_at: expiresAt.toISOString(),
        wompi_transaction_id: transactionId,
        pdf_uploads_this_month: 0,
        current_period_start: now.toISOString(),
        current_period_end: expiresAt.toISOString(),
        updated_at: now.toISOString(),
      }, { onConflict: "user_id" });

    if (updateError) {
      logStep("DB update error", { error: updateError.message });
      return new Response("DB error", { status: 500 });
    }

    logStep("Plan activated successfully", { userId, expiresAt: expiresAt.toISOString() });

    // Step 5: Guardar payment_source_id (token de tarjeta) para cobros recurrentes.
    // Wompi devuelve el payment_source en el body del transaction si fue tokenizado
    // (single_use:false en el payment_link). Si el cliente pagó con PSE u otro método
    // sin tokenizar, payment_source viene null y simplemente no guardamos nada — el
    // próximo mes habrá que mandarle el link de nuevo.
    try {
      const paymentSource = (verifyData?.data?.payment_source ?? transaction?.payment_source) as
        | {
            id?: number | string;
            type?: string;
            token?: string;
            customer_email?: string;
            public_data?: {
              card_brand?: string;
              card_last_four?: string;
              exp_month?: number | string;
              exp_year?: number | string;
            };
          }
        | null
        | undefined;

      const paymentSourceId = paymentSource?.id ? String(paymentSource.id) : null;

      if (paymentSourceId) {
        const customerEmail = paymentSource.customer_email
          ?? verifyData?.data?.customer_email
          ?? transaction?.customer_email
          ?? null;
        const publicData = paymentSource.public_data ?? {};
        const expMonth = publicData.exp_month ? Number(publicData.exp_month) : null;
        const expYear = publicData.exp_year ? Number(publicData.exp_year) : null;

        const { error: pmErr } = await supabase
          .from("user_payment_methods")
          .upsert({
            user_id: userId,
            wompi_payment_source_id: paymentSourceId,
            wompi_customer_email: customerEmail,
            card_last_four: publicData.card_last_four ?? null,
            card_brand: publicData.card_brand ?? null,
            card_exp_month: expMonth,
            card_exp_year: expYear,
            status: 'active',
            last_used_at: now.toISOString(),
            last_error: null,
          }, { onConflict: 'user_id' });

        if (pmErr) {
          logStep("Could not save payment method", { error: pmErr.message });
        } else {
          logStep("Payment method saved for recurring", { userId, paymentSourceId });
        }
      } else {
        logStep("No payment_source — no recurring possible (PSE or other method)");
      }
    } catch (e) {
      logStep("payment_source capture threw", { error: String(e) });
    }

    // Telemetría: aviso inmediato al founder de pago exitoso.
    try {
      const customerEmail = verifyData?.data?.customer_email ?? transaction?.customer_email ?? null;
      await fetch(`${supabaseUrl}/functions/v1/notify-founder`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({
          event_type: "payment_success",
          user_id: userId,
          user_email: customerEmail,
          props: {
            plan: refPlan,
            transaction_id: transactionId,
            amount_cop: verifiedAmount / 100,
            expires_at: expiresAt.toISOString(),
          },
        }),
      }).catch((e) => logStep("notify-founder failed (payment_success)", { error: String(e) }));
    } catch (e) {
      logStep("notify-founder threw (payment_success)", { error: String(e) });
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response("Internal error", { status: 500 });
  }
});
