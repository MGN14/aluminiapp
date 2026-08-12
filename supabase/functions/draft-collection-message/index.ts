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
import { computeReceivables } from "../_shared/receivables.ts";

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

    // 2) Cartera REAL del cliente — misma fórmula que la pantalla
    //    (_shared/receivables). CRÍTICO: este mensaje SALE hacia el cliente;
    //    con balance_pending crudo le estábamos cobrando facturas ya pagadas.
    const receivables = await computeReceivables(admin, user.id, new Date().getFullYear());
    const nameNorm = clientName.toLowerCase().trim();
    const clientRec = receivables.clients.find((c) =>
      (responsibleId && c.responsible_id === responsibleId)
      || c.client_name.toLowerCase().trim() === nameNorm,
    ) ?? receivables.clients.find((c) => c.client_name.toLowerCase().includes(nameNorm));

    if (!clientRec || clientRec.saldo_neto <= 0 || clientRec.invoices_pendientes.length === 0) {
      return json({ error: "Este cliente no tiene saldo pendiente real — nada que cobrar" }, 400);
    }

    const invoices = clientRec.invoices_pendientes.map((i) => ({
      number: i.invoice_number || null,
      issue_date: i.issue_date,
      total: i.total_neto,
      pending: Math.round(i.effective_pending),
      days_overdue: i.days_overdue,
    }));
    const totalOwed = Math.round(clientRec.saldo_neto);
    const oldestOverdue = clientRec.oldest_overdue_days;

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
