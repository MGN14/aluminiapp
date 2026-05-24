// Edge Function: score-collection-clients
// Calcula con Claude un score 0-100 de probabilidad de pago por cada cliente
// con deuda viva del usuario. Cachea en client_collection_scores (upsert).
//
// Modos:
// - POST con Bearer JWT del usuario → score solo de ESE usuario
// - POST con x-cron-secret → corre para TODOS los usuarios con deuda (cron diario)
//
// Body opcional: { dry_run?: boolean } para testing sin escribir DB.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929"; // sonnet 4.5 (más barato que opus, calidad alta)
const MAX_CLIENTS_PER_USER = 50; // limit safety

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const cronSecret = Deno.env.get("COLLECTION_CRON_SECRET") || Deno.env.get("NICO_REPORT_CRON_SECRET");

    if (!anthropicKey) return json({ error: "ANTHROPIC_API_KEY not set" }, 500);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Modo cron (todos los users) vs modo usuario (1 user)
    const isCron = cronSecret && req.headers.get("x-cron-secret") === cronSecret;
    let targetUserIds: string[] = [];

    if (isCron) {
      // Identificar usuarios con deuda viva
      const { data: users } = await admin
        .from("invoices")
        .select("user_id")
        .eq("type", "venta")
        .gt("balance_pending", 0)
        .is("voided_at", null);
      const set = new Set<string>();
      for (const u of (users ?? []) as { user_id: string }[]) set.add(u.user_id);
      targetUserIds = [...set];
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json({ error: "No auth" }, 401);
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);
      targetUserIds = [user.id];
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = !!body?.dry_run;

    let totalScored = 0;
    const summary: Record<string, number> = {};

    for (const userId of targetUserIds) {
      const scored = await scoreUser(admin, anthropicKey, userId, dryRun);
      totalScored += scored;
      summary[userId] = scored;
    }

    return json({
      scored: totalScored,
      users_processed: targetUserIds.length,
      mode: isCron ? "cron" : "user",
      dry_run: dryRun,
      summary,
    });
  } catch (err) {
    console.error("score-collection-clients error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

interface InvoiceForScore {
  id: string;
  invoice_number: string | null;
  counterparty_name: string | null;
  issue_date: string;
  due_date: string | null;
  dias_credito: number | null;
  total_amount: number | null;
  balance_pending: number | null;
}

async function scoreUser(admin: ReturnType<typeof createClient>, anthropicKey: string, userId: string, dryRun: boolean): Promise<number> {
  // 1) Traer facturas vivas
  const { data: invs } = await admin
    .from("invoices")
    .select("id, invoice_number, counterparty_name, issue_date, due_date, dias_credito, total_amount, balance_pending, responsible_id")
    .eq("user_id", userId)
    .eq("type", "venta")
    .gt("balance_pending", 0)
    .is("voided_at", null);
  const invoices = ((invs ?? []) as (InvoiceForScore & { responsible_id: string | null })[]);

  if (invoices.length === 0) return 0;

  // 2) Agrupar por cliente
  type Bucket = {
    name: string;
    responsible_id: string | null;
    total_owed: number;
    oldest_overdue_days: number;
    invoices_count: number;
    invoices_detail: { number: string | null; total: number; pending: number; days_overdue: number }[];
  };
  const today = new Date();
  const groups = new Map<string, Bucket>();

  for (const inv of invoices) {
    const name = inv.counterparty_name?.trim() || "(sin nombre)";
    const key = inv.responsible_id ?? `__name:${name.toLowerCase()}`;
    // Días vencidos
    const issue = new Date(inv.issue_date);
    let venc = issue;
    if (inv.due_date) venc = new Date(inv.due_date);
    else if (inv.dias_credito && inv.dias_credito > 0) {
      venc = new Date(issue);
      venc.setDate(venc.getDate() + inv.dias_credito);
    }
    const daysOverdue = Math.floor((today.getTime() - venc.getTime()) / 86400000);
    const bucket = groups.get(key) ?? {
      name,
      responsible_id: inv.responsible_id ?? null,
      total_owed: 0,
      oldest_overdue_days: 0,
      invoices_count: 0,
      invoices_detail: [],
    };
    bucket.total_owed += Number(inv.balance_pending) || 0;
    bucket.invoices_count += 1;
    if (daysOverdue > bucket.oldest_overdue_days) bucket.oldest_overdue_days = daysOverdue;
    bucket.invoices_detail.push({
      number: inv.invoice_number,
      total: Number(inv.total_amount) || 0,
      pending: Number(inv.balance_pending) || 0,
      days_overdue: daysOverdue,
    });
    groups.set(key, bucket);
  }

  const clientList = [...groups.values()]
    .sort((a, b) => b.oldest_overdue_days - a.oldest_overdue_days || b.total_owed - a.total_owed)
    .slice(0, MAX_CLIENTS_PER_USER);

  if (clientList.length === 0) return 0;

  // 3) Traer touchpoints recientes de cada cliente (últimos 90 días) para contexto
  const since = new Date(); since.setDate(since.getDate() - 90);
  const { data: tps } = await admin
    .from("collection_touchpoints")
    .select("responsible_id, client_name, channel, outcome, notes, contacted_at")
    .eq("user_id", userId)
    .gte("contacted_at", since.toISOString());
  const tpsByKey = new Map<string, typeof tps>();
  for (const t of (tps ?? []) as any[]) {
    const k = t.responsible_id ?? `__name:${t.client_name.toLowerCase()}`;
    const arr = tpsByKey.get(k) ?? [];
    arr.push(t);
    tpsByKey.set(k, arr);
  }

  // 4) Construir prompt: una sola llamada Claude con TODOS los clientes del user
  const prompt = buildPrompt(clientList, tpsByKey);

  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!aiRes.ok) {
    const errText = await aiRes.text();
    console.error("Anthropic error:", aiRes.status, errText);
    return 0;
  }

  const aiData = await aiRes.json();
  const text = aiData?.content?.[0]?.text ?? "";

  // 5) Parse del JSON que devuelve Claude
  const parsed = parseScores(text);
  if (parsed.length === 0) {
    console.error("Could not parse Claude response:", text.slice(0, 500));
    return 0;
  }

  if (dryRun) {
    console.log(`[dry_run] User ${userId}: ${parsed.length} scores parseados`);
    return parsed.length;
  }

  // 6) Upsert scores (por user_id + responsible_id-or-name)
  let written = 0;
  for (const p of parsed) {
    const matchingClient = clientList.find(c =>
      c.name.toLowerCase() === p.client_name.toLowerCase()
    );
    if (!matchingClient) continue;

    const { error } = await admin.from("client_collection_scores").upsert({
      user_id: userId,
      responsible_id: matchingClient.responsible_id,
      client_name: matchingClient.name,
      score: clampScore(p.score),
      category: validCategory(p.category),
      reasoning: p.reasoning ?? null,
      recommended_action: p.recommended_action ?? null,
      total_owed: matchingClient.total_owed,
      oldest_overdue_days: matchingClient.oldest_overdue_days,
      invoices_count: matchingClient.invoices_count,
      scored_at: new Date().toISOString(),
    }, {
      onConflict: "user_id",
      ignoreDuplicates: false,
    });
    if (error) {
      // Si falla por conflict (responsible_id null), intentamos delete+insert
      console.warn("upsert error, fallback:", error.message);
      await admin.from("client_collection_scores")
        .delete()
        .eq("user_id", userId)
        .eq("client_name", matchingClient.name);
      const { error: e2 } = await admin.from("client_collection_scores").insert({
        user_id: userId,
        responsible_id: matchingClient.responsible_id,
        client_name: matchingClient.name,
        score: clampScore(p.score),
        category: validCategory(p.category),
        reasoning: p.reasoning ?? null,
        recommended_action: p.recommended_action ?? null,
        total_owed: matchingClient.total_owed,
        oldest_overdue_days: matchingClient.oldest_overdue_days,
        invoices_count: matchingClient.invoices_count,
        scored_at: new Date().toISOString(),
      });
      if (!e2) written++;
    } else {
      written++;
    }
  }

  return written;
}

function buildPrompt(clients: any[], tpsByKey: Map<string, any>): string {
  const today = new Date().toISOString().slice(0, 10);
  const clientBlocks = clients.map((c) => {
    const key = c.responsible_id ?? `__name:${c.name.toLowerCase()}`;
    const tps = tpsByKey.get(key) ?? [];
    const tpsSummary = tps.length === 0
      ? "Sin contactos registrados"
      : tps.slice(0, 5).map((t: any) =>
          `  - ${t.contacted_at.slice(0,10)} [${t.channel}/${t.outcome}]${t.notes ? `: ${t.notes.slice(0,120)}` : ''}`
        ).join("\n");
    return `Cliente: ${c.name}
- Total adeudado: $${c.total_owed.toLocaleString('es-CO', { maximumFractionDigits: 0 })} COP
- Factura más vencida: ${c.oldest_overdue_days} días
- # facturas pendientes: ${c.invoices_count}
- Contactos recientes (90 días):
${tpsSummary}`;
  }).join("\n\n");

  return `Sos un asesor experto de cobranza para PyMEs colombianas del sector aluminio. Hoy es ${today}.

Te paso la cartera viva de un cliente AluminIA. Para cada deudor, asigná:
1. score: número entero 0-100 (probabilidad de pago en próximos 30 días; 100 = paga seguro, 0 = no paga nunca).
2. category: una de [excelente, bueno, medio, riesgo, critico].
   - excelente (90-100): cliente sólido, paga rápido, sin historial de retraso largo
   - bueno (70-89): paga pero con cierto atraso normal
   - medio (50-69): paga tarde, requiere recordatorio activo
   - riesgo (30-49): atraso preocupante, contacto firme necesario
   - critico (0-29): probable incobrable, requiere acción legal/escalado
3. reasoning: 1 oración corta explicando POR QUÉ ese score (basate en días vencido + monto + comportamiento histórico).
4. recommended_action: 1 acción concreta para los próximos 7 días (e.g. "Llamar hoy y proponer plan de cuotas a 3 meses", "Email firme recordando saldo y proponiendo descuento por pronto pago").

Considerá:
- Si tiene contactos recientes con outcome='prometio_pago' que no se cumplieron → bajá el score (incumplió)
- Si responde rápido y paga (contactado/prometio_pago bien) → score alto
- Si nunca contesta → riesgo
- Si tiene mucha plata vencida hace +60 días → critico

DEUDORES:

${clientBlocks}

Respondé SOLO con JSON array (sin texto adicional, sin markdown):
[
  {"client_name": "<nombre exacto del cliente>", "score": 75, "category": "bueno", "reasoning": "...", "recommended_action": "..."},
  ...
]`;
}

function parseScores(text: string): Array<{ client_name: string; score: number; category: string; reasoning?: string; recommended_action?: string }> {
  // Sacar el JSON entre [...] (Claude a veces lo envuelve)
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p: any) => p?.client_name && typeof p.score === "number" && p.category);
  } catch (e) {
    console.error("JSON parse failed:", (e as Error).message);
    return [];
  }
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function validCategory(c: string): string {
  const valid = ["excelente", "bueno", "medio", "riesgo", "critico"];
  return valid.includes(c) ? c : "medio";
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
