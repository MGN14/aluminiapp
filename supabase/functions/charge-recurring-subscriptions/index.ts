// charge-recurring-subscriptions — corre cada día (cron) y cobra a los
// clientes cuyo plan vence hoy o mañana. Usa el payment_source_id de Wompi
// guardado en user_payment_methods.
//
// Flujo por cliente:
//   1. Crear fila en subscription_charges (status='pending').
//   2. POST a Wompi /transactions con el token + amount.
//   3. Esperar respuesta:
//      - APPROVED → extender plan_expires_at +30 días, status='success',
//        payment_success email al founder.
//      - DECLINED / VOIDED / ERROR → status='failed'. Programa reintento
//        a los 3 días vía attempt_number. Si attempt_number >= 3, marca
//        subscription como 'past_due' y manda payment_failed al founder.
//
// AuthN aceptada:
//   - x-cron-secret: <RECURRING_CRON_SECRET>   (cron pg)
//   - Authorization: Bearer <SERVICE_ROLE_KEY> (test manual)
//
// Body opcional: { dry_run?: boolean, user_id?: string } (para testear 1 user)

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

// Wompi sandbox vs production. Detección por prefijo de la private key
// (prv_prod_/prv_live_ → prod). Override con WOMPI_ENV=production|sandbox.
function resolveWompiApiUrl(privateKey: string): string {
  const explicit = (Deno.env.get("WOMPI_ENV") ?? "").toLowerCase().trim();
  const looksProd = privateKey.startsWith("prv_prod_") || privateKey.startsWith("prv_live_");
  const isProd = explicit === "production" || explicit === "prod" || (!explicit && looksProd);
  return isProd ? "https://production.wompi.co/v1" : "https://sandbox.wompi.co/v1";
}

// Misma tabla de planes que create-wompi-checkout. Si cambia ahí, cambia acá.
const PLAN_AMOUNTS_CENTS: Record<string, number> = {
  basico: 39900000,
  empresarial: 59900000,
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface SubscriptionRow {
  user_id: string;
  plan: string | null;
  status: string | null;
  plan_expires_at: string | null;
}

interface PaymentMethodRow {
  id: string;
  user_id: string;
  wompi_payment_source_id: string;
  wompi_customer_email: string | null;
  status: string;
}

interface AcceptanceTokenRes {
  data?: {
    presigned_acceptance?: {
      acceptance_token?: string;
    };
    presigned_personal_data_auth?: {
      acceptance_token?: string;
    };
  };
}

async function getAcceptanceTokens(publicKey: string, apiUrl: string): Promise<{ acceptance: string; personalData: string }> {
  // Wompi exige acceptance tokens en cada transaction (compliance habeas data).
  // Los tokens son de corta duración — los pedimos al vuelo en cada cobro.
  const res = await fetch(`${apiUrl}/merchants/${publicKey}`);
  if (!res.ok) throw new Error(`acceptance tokens HTTP ${res.status}`);
  const data = await res.json() as AcceptanceTokenRes;
  const acceptance = data.data?.presigned_acceptance?.acceptance_token;
  const personalData = data.data?.presigned_personal_data_auth?.acceptance_token;
  if (!acceptance || !personalData) throw new Error("acceptance tokens missing in merchant response");
  return { acceptance, personalData };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const wompiPrivateKey = Deno.env.get("WOMPI_PRIVATE_KEY") ?? "";
  const wompiPublicKey = Deno.env.get("WOMPI_PUBLIC_KEY") ?? "";
  const cronSecret = Deno.env.get("RECURRING_CRON_SECRET") ?? "";

  // AuthN
  const cronHeader = req.headers.get("x-cron-secret");
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const isCron = !!cronSecret && cronHeader === cronSecret;
  const isService = !!serviceKey && bearer === serviceKey;
  if (!isCron && !isService) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (!wompiPrivateKey || !wompiPublicKey) {
    return json({ error: "WOMPI_PRIVATE_KEY o WOMPI_PUBLIC_KEY no configurados" }, 500);
  }

  const body = await req.json().catch(() => ({})) as { dry_run?: boolean; user_id?: string };
  const dryRun = !!body.dry_run;

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // 1) Buscar subscriptions que vencen en las próximas 24 horas y aún no
  //    fueron renovadas. Damos margen para reintentos (1 día antes).
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  let query = supabase
    .from("user_subscriptions")
    .select("user_id, plan, status, plan_expires_at")
    .lte("plan_expires_at", tomorrow.toISOString())
    .in("status", ["active", "past_due"])
    .neq("plan", "demo");

  if (body.user_id) {
    query = query.eq("user_id", body.user_id);
  }

  const { data: subsRaw, error: subsErr } = await query;
  if (subsErr) {
    console.error("[recurring] subs fetch error:", subsErr);
    return json({ ok: false, error: subsErr.message }, 500);
  }

  const subs = (subsRaw ?? []) as SubscriptionRow[];
  const eligibleUserIds = subs.map(s => s.user_id);

  if (eligibleUserIds.length === 0) {
    return json({ ok: true, message: "No subscriptions due", processed: 0 });
  }

  // 2) Cargar payment methods de esos usuarios
  const { data: pmsRaw } = await supabase
    .from("user_payment_methods")
    .select("id, user_id, wompi_payment_source_id, wompi_customer_email, status")
    .in("user_id", eligibleUserIds)
    .eq("status", "active");

  const pms = (pmsRaw ?? []) as PaymentMethodRow[];
  const pmByUser = new Map(pms.map(pm => [pm.user_id, pm]));

  // 3) Acceptance tokens (válidos durante todo el batch). Resolvemos URL
  //    según ambiente — antes hardcoded a sandbox aunque la cuenta fuera prod.
  const wompiApiUrl = resolveWompiApiUrl(wompiPrivateKey);
  let acceptance: string;
  let personalData: string;
  try {
    const t = await getAcceptanceTokens(wompiPublicKey, wompiApiUrl);
    acceptance = t.acceptance;
    personalData = t.personalData;
  } catch (e) {
    console.error("[recurring] acceptance tokens failed:", e);
    return json({ ok: false, error: `acceptance tokens: ${(e as Error).message}` }, 500);
  }

  // 4) Procesar cada subscription
  const results: Array<{
    user_id: string;
    plan: string;
    status: 'success' | 'failed' | 'no_payment_method' | 'unknown_plan' | 'skipped';
    wompi_status?: string;
    error?: string;
  }> = [];

  for (const sub of subs) {
    const plan = sub.plan ?? '';
    const amount = PLAN_AMOUNTS_CENTS[plan];
    if (!amount) {
      results.push({ user_id: sub.user_id, plan, status: 'unknown_plan' });
      continue;
    }

    const pm = pmByUser.get(sub.user_id);
    if (!pm) {
      // Sin token: marcamos past_due y mandamos email al founder.
      results.push({ user_id: sub.user_id, plan, status: 'no_payment_method' });
      if (!dryRun) {
        await supabase.from("user_subscriptions")
          .update({ status: 'past_due', updated_at: now.toISOString() })
          .eq("user_id", sub.user_id);
        await fetch(`${supabaseUrl}/functions/v1/notify-founder`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            event_type: "payment_failed",
            user_id: sub.user_id,
            props: { plan, reason: "no_payment_method", amount_cop: amount / 100 },
          }),
        }).catch(() => {});
      }
      continue;
    }

    if (dryRun) {
      results.push({ user_id: sub.user_id, plan, status: 'skipped' });
      continue;
    }

    // Contar intentos previos para esta subscription en los últimos 7 días
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count: prevAttempts } = await supabase
      .from("subscription_charges")
      .select("id", { count: 'exact', head: true })
      .eq("user_id", sub.user_id)
      .eq("status", "failed")
      .gte("attempted_at", sevenDaysAgo);
    const attemptNumber = (prevAttempts ?? 0) + 1;

    // Crear fila pending
    const { data: chargeRow } = await supabase
      .from("subscription_charges")
      .insert({
        user_id: sub.user_id,
        payment_method_id: pm.id,
        plan,
        amount_in_cents: amount,
        status: 'pending',
        attempt_number: attemptNumber,
      })
      .select("id")
      .single();

    const chargeId = chargeRow?.id ?? null;

    // Llamar a Wompi /transactions con el token
    let wompiStatus: string | null = null;
    let wompiTxId: string | null = null;
    let wompiMsg: string | null = null;
    let success = false;

    try {
      const txRes = await fetch(`${wompiApiUrl}/transactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${wompiPrivateKey}`,
        },
        body: JSON.stringify({
          amount_in_cents: amount,
          currency: "COP",
          customer_email: pm.wompi_customer_email ?? "no-email@aluminia.app",
          payment_method: { type: "CARD", installments: 1 },
          payment_source_id: Number(pm.wompi_payment_source_id),
          reference: `recurring-${plan}-${sub.user_id}-${Date.now()}`,
          acceptance_token: acceptance,
          accept_personal_auth: personalData,
        }),
      });

      const txData = await txRes.json().catch(() => ({}));
      const tx = txData?.data;
      wompiTxId = tx?.id ? String(tx.id) : null;
      wompiStatus = tx?.status ?? null;
      wompiMsg = tx?.status_message ?? null;

      if (txRes.ok && wompiStatus === "APPROVED") {
        success = true;
      } else {
        // Algunas transacciones quedan PENDING al inicio. Wompi confirma vía webhook
        // después. En ese caso quedamos pending — el wompi-webhook ya está armado
        // para atrapar APPROVED y extender el plan automáticamente. Pero acá NO
        // marcamos success todavía.
        if (wompiStatus === "PENDING") {
          // Lo dejamos pending — el webhook resolverá.
          if (chargeId) {
            await supabase.from("subscription_charges").update({
              wompi_transaction_id: wompiTxId,
              wompi_status: wompiStatus,
              wompi_status_message: wompiMsg,
              status: 'pending',
            }).eq("id", chargeId);
          }
          results.push({ user_id: sub.user_id, plan, status: 'success', wompi_status: 'PENDING' });
          continue;
        }
      }
    } catch (e) {
      wompiMsg = `excepción: ${(e as Error).message}`;
    }

    if (success) {
      // Extender plan +30 días desde plan_expires_at actual (o desde hoy si ya venció)
      const currExpires = sub.plan_expires_at ? new Date(sub.plan_expires_at).getTime() : now.getTime();
      const baseExpires = currExpires > now.getTime() ? currExpires : now.getTime();
      const newExpires = new Date(baseExpires + 30 * 24 * 60 * 60 * 1000);

      await supabase.from("user_subscriptions").update({
        status: 'active',
        plan_expires_at: newExpires.toISOString(),
        wompi_transaction_id: wompiTxId,
        current_period_start: now.toISOString(),
        current_period_end: newExpires.toISOString(),
        updated_at: now.toISOString(),
      }).eq("user_id", sub.user_id);

      if (chargeId) {
        await supabase.from("subscription_charges").update({
          status: 'success',
          wompi_transaction_id: wompiTxId,
          wompi_status: wompiStatus,
          completed_at: now.toISOString(),
        }).eq("id", chargeId);
      }

      await supabase.from("user_payment_methods").update({
        last_used_at: now.toISOString(),
        last_error: null,
      }).eq("id", pm.id);

      // Notificar founder
      await fetch(`${supabaseUrl}/functions/v1/notify-founder`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          event_type: "payment_success",
          user_id: sub.user_id,
          user_email: pm.wompi_customer_email,
          props: {
            plan,
            transaction_id: wompiTxId,
            amount_cop: amount / 100,
            expires_at: newExpires.toISOString(),
            recurring: true,
            attempt: attemptNumber,
          },
        }),
      }).catch(() => {});

      results.push({ user_id: sub.user_id, plan, status: 'success', wompi_status: wompiStatus ?? 'APPROVED' });
    } else {
      // Fallido
      if (chargeId) {
        await supabase.from("subscription_charges").update({
          status: 'failed',
          wompi_transaction_id: wompiTxId,
          wompi_status: wompiStatus,
          wompi_status_message: wompiMsg,
          completed_at: now.toISOString(),
        }).eq("id", chargeId);
      }

      await supabase.from("user_payment_methods").update({
        last_error: wompiMsg ?? 'unknown',
      }).eq("id", pm.id);

      // Si llegamos a 3 fallos en 7 días, marcamos como past_due (siguen
      // pudiendo usar la app hasta que expire el plan_expires_at actual)
      if (attemptNumber >= 3) {
        await supabase.from("user_subscriptions").update({
          status: 'past_due',
          updated_at: now.toISOString(),
        }).eq("user_id", sub.user_id);
      }

      // Notificar founder
      await fetch(`${supabaseUrl}/functions/v1/notify-founder`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          event_type: "payment_failed",
          user_id: sub.user_id,
          user_email: pm.wompi_customer_email,
          props: {
            plan,
            attempt: attemptNumber,
            wompi_status: wompiStatus,
            wompi_message: wompiMsg,
            amount_cop: amount / 100,
            recurring: true,
          },
        }),
      }).catch(() => {});

      results.push({
        user_id: sub.user_id,
        plan,
        status: 'failed',
        wompi_status: wompiStatus ?? undefined,
        error: wompiMsg ?? undefined,
      });
    }
  }

  return json({
    ok: true,
    processed: results.length,
    dry_run: dryRun,
    results,
  });
});
