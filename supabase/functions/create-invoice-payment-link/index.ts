// Edge Function: create-invoice-payment-link
// Genera un Payment Link de Wompi para que el cliente pague una factura específica.
// Reusa credenciales y patrón HMAC del checkout de suscripciones.
//
// Body: { invoice_id: string, redirect_url?: string, amount_override?: number }
//
// Auth: Bearer JWT del owner (RLS valida que la factura sea suya).
//
// Devuelve: { url, reference, amount_in_cents, expires_at }
//
// El reference firmado permite al wompi-webhook conciliar el pago con la
// factura específica sin que el cliente pueda manipularlo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resolveWompiEnv(privateKey: string) {
  const explicit = (Deno.env.get("WOMPI_ENV") ?? "").toLowerCase().trim();
  const looksProd = privateKey.startsWith("prv_prod_") || privateKey.startsWith("prv_live_");
  const isProd = explicit === "production" || explicit === "prod" || (!explicit && looksProd);
  return isProd
    ? { apiUrl: "https://production.wompi.co/v1", checkoutHost: "https://checkout.wompi.co", isProd: true }
    : { apiUrl: "https://sandbox.wompi.co/v1", checkoutHost: "https://checkout.co.uat.wompi.dev", isProd: false };
}

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No auth" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const wompiPrivateKey = Deno.env.get("WOMPI_PRIVATE_KEY");
    const wompiEventsSecret = Deno.env.get("WOMPI_EVENTS_SECRET");
    if (!wompiPrivateKey) return json({ error: "WOMPI_PRIVATE_KEY no configurado" }, 500);
    if (!wompiEventsSecret) return json({ error: "WOMPI_EVENTS_SECRET no configurado" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const invoiceId = String(body?.invoice_id ?? "");
    const redirectUrl = body?.redirect_url ? String(body.redirect_url) : undefined;
    const amountOverride = body?.amount_override ? Number(body.amount_override) : null;

    if (!invoiceId) return json({ error: "invoice_id requerido" }, 400);

    // Leer factura del usuario (RLS valida ownership)
    const { data: invoice, error: invErr } = await userClient
      .from("invoices")
      .select("id, invoice_number, counterparty_name, total_amount, balance_pending, issue_date, due_date, voided_at, type")
      .eq("id", invoiceId)
      .maybeSingle();

    if (invErr || !invoice) {
      return json({ error: "Factura no encontrada o sin permiso" }, 404);
    }
    if (invoice.voided_at) {
      return json({ error: "Factura anulada — no se puede generar link" }, 400);
    }
    if (invoice.type !== "venta") {
      return json({ error: "Solo facturas de venta pueden generar link de pago" }, 400);
    }

    const balancePending = Number(invoice.balance_pending) || 0;
    const requestedAmount = amountOverride ?? balancePending;
    if (requestedAmount <= 0) {
      return json({ error: "Esta factura no tiene saldo pendiente" }, 400);
    }
    if (amountOverride && amountOverride > balancePending) {
      return json({ error: `El monto excede el saldo pendiente (${balancePending})` }, 400);
    }

    const amountInCents = Math.round(requestedAmount * 100);

    // Profile (nombre empresa para mostrar en checkout)
    const { data: profile } = await userClient
      .from("profiles")
      .select("company_name, company_nit")
      .eq("user_id", user.id)
      .maybeSingle();
    const empresa = profile?.company_name ?? "AluminIA";

    // Reference firmado: invoice-{invoice_id}-{user_id}-{timestamp}-{sig16}
    const timestamp = Date.now();
    const refPayload = `${invoiceId}-${user.id}-${timestamp}`;
    const sig16 = await signReference(refPayload, wompiEventsSecret);
    const reference = `invoice-${invoiceId}-${user.id}-${timestamp}-${sig16}`;

    // Wompi API
    const { apiUrl } = resolveWompiEnv(wompiPrivateKey);

    const invoiceLabel = invoice.invoice_number ? `factura ${invoice.invoice_number}` : "tu factura";
    const clientName = invoice.counterparty_name ?? "cliente";

    const wompiRes = await fetch(`${apiUrl}/payment_links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${wompiPrivateKey}`,
      },
      body: JSON.stringify({
        name: `Pago a ${empresa} — ${invoiceLabel}`,
        description: `Pago de ${invoiceLabel} de ${clientName}`,
        single_use: true,
        collect_shipping: false,
        currency: "COP",
        amount_in_cents: amountInCents,
        redirect_url: redirectUrl,
        // El reference se inyecta en la transacción cuando el cliente paga
        // — Wompi lo propaga al webhook.
        reference,
      }),
    });

    if (!wompiRes.ok) {
      const errText = await wompiRes.text();
      console.error("Wompi error:", wompiRes.status, errText);
      return json({ error: `Wompi devolvió ${wompiRes.status}: ${errText.slice(0, 300)}` }, 502);
    }

    const wompiData = await wompiRes.json();
    const linkId = wompiData?.data?.id;
    // El payment_link de Wompi se accede vía https://checkout.wompi.co/l/{id}
    const { checkoutHost } = resolveWompiEnv(wompiPrivateKey);
    const checkoutUrl = `${checkoutHost}/l/${linkId}`;

    return json({
      url: checkoutUrl,
      link_id: linkId,
      reference,
      amount_in_cents: amountInCents,
      amount_cop: requestedAmount,
      invoice_number: invoice.invoice_number,
      counterparty_name: invoice.counterparty_name,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("create-invoice-payment-link error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
