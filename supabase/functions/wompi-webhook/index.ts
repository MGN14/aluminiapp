import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[WOMPI-WEBHOOK] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
};

const WOMPI_SANDBOX_URL = "https://sandbox.wompi.co/v1";
const PLAN_AMOUNT_CENTS = 39900000; // $399,000 COP

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

    // Step 3: Find user from customer_data or reference
    // Try to extract user_id from customer_references or payment link reference
    let userId: string | null = null;

    // Check reference field (format: aluminia-basico-{userId}-{timestamp})
    const reference = verifyData?.data?.reference || transaction?.reference || "";
    const refMatch = reference.match(/aluminia-basico-([a-f0-9-]{36})-/);
    if (refMatch) {
      userId = refMatch[1];
    }

    // Also check customer_data references
    if (!userId) {
      const customerRefs = verifyData?.data?.customer_data?.customer_references || [];
      const userIdRef = customerRefs.find((r: any) => r.label === "user_id");
      if (userIdRef?.value) {
        userId = userIdRef.value;
      }
    }

    // Also check payment_link_id and look up from payment link
    if (!userId) {
      const paymentLinkId = verifyData?.data?.payment_link_id;
      if (paymentLinkId) {
        const linkRes = await fetch(`${WOMPI_SANDBOX_URL}/payment_links/${paymentLinkId}`, {
          headers: { Authorization: `Bearer ${wompiPrivateKey}` },
        });
        if (linkRes.ok) {
          const linkData = await linkRes.json();
          const refs = linkData?.data?.customer_data?.customer_references || [];
          const ref = refs.find((r: any) => r.label === "user_id");
          if (ref?.value) userId = ref.value;
        }
      }
    }

    if (!userId) {
      logStep("Could not determine user_id from transaction");
      return new Response("User not found", { status: 400 });
    }

    logStep("User identified", { userId });

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
