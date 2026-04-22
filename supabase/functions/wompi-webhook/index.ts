import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[WOMPI-WEBHOOK] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
};

const WOMPI_SANDBOX_URL = "https://sandbox.wompi.co/v1";
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
    const verifyRes = await fetch(`${WOMPI_SANDBOX_URL}/transactions/${transactionId}`, {
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

    return new Response("OK", { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response("Internal error", { status: 500 });
  }
});
