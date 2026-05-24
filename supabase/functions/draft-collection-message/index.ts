// Edge Function: draft-collection-message
// Genera con Claude un mensaje de cobranza adaptado a un cliente específico.
// On-demand desde la UI (botón "Sugerir mensaje con IA").
//
// Body:
//   { client_name: string, responsible_id?: string | null,
//     channel: 'email' | 'whatsapp' | 'llamada_guion',
//     tone: 'amable' | 'recordatorio' | 'firme' | 'escalado' }
//
// Responde: { message: string, tokens_used: number, model: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_MODEL = "claude-sonnet-4-5-20250929";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No auth" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) return json({ error: "ANTHROPIC_API_KEY not set" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const clientName = String(body?.client_name ?? "").trim();
    const responsibleId = body?.responsible_id ?? null;
    const channel = String(body?.channel ?? "email") as "email" | "whatsapp" | "llamada_guion";
    const tone = String(body?.tone ?? "recordatorio") as "amable" | "recordatorio" | "firme" | "escalado";

    if (!clientName) return json({ error: "client_name requerido" }, 400);

    // 1) Traer profile (empresa) del owner
    const { data: profile } = await admin
      .from("profiles")
      .select("company_name, full_name")
      .eq("user_id", user.id)
      .maybeSingle();
    const empresaName = profile?.company_name ?? "Nuestra empresa";
    const senderName = profile?.full_name ?? "el equipo de cobranza";

    // 2) Traer facturas pendientes del cliente
    let invQ = admin.from("invoices")
      .select("id, invoice_number, issue_date, due_date, dias_credito, total_amount, balance_pending")
      .eq("user_id", user.id)
      .eq("type", "venta")
      .gt("balance_pending", 0)
      .is("voided_at", null);
    if (responsibleId) invQ = invQ.eq("responsible_id", responsibleId);
    else invQ = invQ.ilike("counterparty_name", clientName);
    const { data: invs } = await invQ.order("issue_date", { ascending: true });

    const today = new Date();
    const invoices = ((invs ?? []) as any[]).map(i => {
      const issue = new Date(i.issue_date);
      let venc = issue;
      if (i.due_date) venc = new Date(i.due_date);
      else if (i.dias_credito) { venc = new Date(issue); venc.setDate(venc.getDate() + i.dias_credito); }
      return {
        number: i.invoice_number,
        issue_date: i.issue_date,
        total: Number(i.total_amount) || 0,
        pending: Number(i.balance_pending) || 0,
        days_overdue: Math.floor((today.getTime() - venc.getTime()) / 86400000),
      };
    });

    if (invoices.length === 0) {
      return json({ error: "Este cliente no tiene facturas vivas" }, 400);
    }

    const totalOwed = invoices.reduce((s, i) => s + i.pending, 0);
    const oldestOverdue = Math.max(...invoices.map(i => i.days_overdue));

    // 3) Traer touchpoints recientes
    let tpQ = admin.from("collection_touchpoints")
      .select("channel, outcome, notes, contacted_at")
      .eq("user_id", user.id)
      .order("contacted_at", { ascending: false })
      .limit(5);
    if (responsibleId) tpQ = tpQ.eq("responsible_id", responsibleId);
    else tpQ = tpQ.ilike("client_name", clientName);
    const { data: tps } = await tpQ;

    // 4) Construir prompt
    const channelDesc = {
      email: "EMAIL formal (incluir asunto sugerido al inicio con 'Asunto: ...')",
      whatsapp: "WhatsApp (mensaje corto, 2-3 párrafos máximo, sin saltos formales)",
      llamada_guion: "GUIÓN DE LLAMADA telefónica (incluir saludo, mensaje principal, manejo de objeciones, cierre)",
    }[channel];

    const toneDesc = {
      amable: "Amable y cordial — cliente VIP o primer recordatorio. Sin presión.",
      recordatorio: "Profesional y neutral — recordar saldo sin tono punitivo.",
      firme: "Firme pero respetuoso — ya pasó tiempo razonable. Pedir compromiso de fecha.",
      escalado: "Escalado — último aviso antes de acciones legales / suspender crédito. Tono serio pero educado.",
    }[tone];

    const invDetail = invoices.slice(0, 10).map(i =>
      `  · Factura ${i.number ?? '?'} del ${i.issue_date}: $${i.pending.toLocaleString('es-CO', { maximumFractionDigits: 0 })} pendiente (${i.days_overdue > 0 ? `${i.days_overdue}d vencida` : 'aún no vencida'})`
    ).join("\n");

    const tpsDesc = (tps ?? []).length === 0
      ? "Sin contactos previos registrados."
      : (tps as any[]).map(t => `  - ${t.contacted_at.slice(0,10)} [${t.channel}/${t.outcome}]${t.notes ? `: ${t.notes.slice(0,150)}` : ''}`).join("\n");

    const prompt = `Sos un experto en cobranza para PyMEs colombianas del sector aluminio. Redactá un mensaje en español colombiano (formal pero natural, sin "vosotros" ni españolismos).

CONTEXTO:
- Empresa que cobra: ${empresaName}
- Firmado por: ${senderName}
- Cliente: ${clientName}
- Total adeudado: $${totalOwed.toLocaleString('es-CO', { maximumFractionDigits: 0 })} COP
- Factura más vencida: ${oldestOverdue > 0 ? `${oldestOverdue} días` : 'aún no vencida'}
- # facturas pendientes: ${invoices.length}

DETALLE FACTURAS:
${invDetail}

HISTORIAL CONTACTOS RECIENTES:
${tpsDesc}

FORMATO REQUERIDO:
- Tipo de mensaje: ${channelDesc}
- Tono: ${toneDesc}

REGLAS:
1. Personalizado al cliente (no genérico).
2. Mencionar montos y fechas específicas (no inventes números).
3. Si hay touchpoints donde prometió pagar y no cumplió, mencionar diplomáticamente.
4. Cerrar con próximo paso CLARO (e.g. "Esperamos su confirmación al correo X para el viernes 30").
5. Si es WhatsApp: máximo 3 párrafos cortos, usar saltos de línea pero sin exceso.
6. Si es email: incluir "Asunto: ..." al inicio.
7. NO inventes información que no esté en el contexto (e.g. no inventes nombre de contacto si no aparece).

Devolvé SOLO el mensaje, sin explicaciones previas, sin markdown decorativo.`;

    // 5) Llamar Claude
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("Anthropic error:", aiRes.status, errText);
      return json({ error: `Claude devolvió ${aiRes.status}` }, 502);
    }

    const aiData = await aiRes.json();
    const message = aiData?.content?.[0]?.text ?? "(sin contenido)";
    const usage = aiData?.usage ?? {};

    return json({
      message,
      tokens_used: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      model: ANTHROPIC_MODEL,
      client_summary: {
        total_owed: totalOwed,
        oldest_overdue_days: oldestOverdue,
        invoices_count: invoices.length,
      },
    });
  } catch (err) {
    console.error("draft-collection-message error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
