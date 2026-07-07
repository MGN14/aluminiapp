// parse-bancolombia-card-pdf — extrae las COMPRAS del extracto PDF de una
// TARJETA DE CRÉDITO Bancolombia usando IA (Claude primario, Gemini fallback).
//
// ¿Por qué existe si ya hay CSV de tarjeta? El CSV del portal NO trae la
// descripción del comercio (solo producto/fecha/valor/cuotas) — el auxiliar ve
// "Compra TC *2047" y no puede categorizar ni asignar beneficiario. El PDF del
// extracto SÍ trae el comercio ("HOMECENTER CALLE 80", "EDS TERPEL...") por
// cada transacción.
//
// CONVENCIÓN CONTABLE (misma del CSV, confirmada con Nico): "solo compras =
// gasto". Se importan compras/intereses/comisiones/avances como EGRESOS; los
// abonos/pagos a la tarjeta NO se importan (son traslado desde el banco, ya
// figuran como egreso "PAGO TARJETA" en la cuenta → importarlos doble-contaría).
//
// Estructura calcada de parse-bancolombia-pdf (auth por token, límite de plan,
// cascada de providers, reparación de JSON truncado, processing_error).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface CardTx {
  date: string;
  /** Nombre del comercio tal como figura en el extracto. */
  description: string;
  /** Valor de la transacción, SIEMPRE positivo. */
  amount: number;
  /** "compra" | "abono" | "interes" | "comision" | "avance" | "seguro" */
  kind: string;
  /** Cuotas como figura en el extracto (ej "3/36"), o null. */
  installments: string | null;
  raw_line?: string;
}

interface ParsedCardStatement {
  card_product: string | null;
  transactions: CardTx[];
  period: { month: number | null; year: number | null; period_text: string | null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Fuera del try para que el catch global pueda marcar processing_error
  // (mismo patrón/lección que parse-bancolombia-pdf: el body solo se lee 1 vez).
  let capturedStatementId: string | null = null;

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY || (!GEMINI_API_KEY && !ANTHROPIC_API_KEY)) {
      return new Response(JSON.stringify({ error: "Service configuration error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Auth del caller ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const token = authHeader.replace("Bearer ", "").trim();
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!authRes.ok) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const authUser = await authRes.json() as { id?: string };
    if (!authUser?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { file_path, statement_id } = await req.json();
    capturedStatementId = statement_id ?? null;
    if (!file_path || !statement_id) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: statement, error: statementError } = await supabase
      .from("bank_statements")
      .select("user_id, account_number")
      .eq("id", statement_id)
      .single();
    if (statementError || !statement) {
      return new Response(JSON.stringify({ error: "Statement not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (statement.user_id !== authUser.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Límite de PDFs del plan (mismo RPC que el PDF de cuenta)
    const { data: limitCheck, error: limitError } = await supabase
      .rpc("check_pdf_upload_limit", { p_user_id: statement.user_id });
    if (limitError) console.error("Limit check error:", limitError);
    const parsedCheck = typeof limitCheck === "string" ? JSON.parse(limitCheck) : limitCheck;
    if (parsedCheck && !parsedCheck.can_upload) {
      return new Response(
        JSON.stringify({ error: "Límite de PDFs alcanzado", message: parsedCheck.message, limit_exceeded: true, plan: parsedCheck.plan }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Descargar PDF ──
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("bank-statements")
      .download(file_path);
    if (downloadError || !fileData) {
      throw new Error(`Failed to download PDF: ${downloadError?.message}`);
    }
    const arrayBuffer = await fileData.arrayBuffer();
    const base64Pdf = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
    );
    console.log("Card PDF downloaded, size:", arrayBuffer.byteLength, "bytes");

    // ── Prompt ──
    const systemPrompt = `Eres un experto en procesar extractos de TARJETA DE CRÉDITO de Bancolombia, Colombia.

Tu tarea es extraer TODAS las transacciones del extracto PDF de la tarjeta.

FORMATO DEL EXTRACTO DE TARJETA BANCOLOMBIA:
- Hay una o más secciones/tablas de movimientos (a veces separadas en "pesos" y "dólares").
- Columnas típicas: Número de autorización, Fecha de transacción, Descripción, Valor original, Tasa pactada, Tasa EA facturada, Cargos y abonos, Saldo a diferir, Cuotas.
- La columna Descripción trae el NOMBRE DEL COMERCIO (ej: "HOMECENTER CALLE 80", "EDS TERPEL LA 65"). Es el dato MÁS importante: extráelo completo y fiel.
- Cuotas viene como "N/M" (ej "3/36" = cuota 3 de 36). "1/1" = una sola cuota.
- Los ABONOS/PAGOS aparecen como "ABONO", "PAGO", "PAGO DEBITO AUTOMATICO", "GRACIAS POR SU PAGO" o con valor en negativo/entre paréntesis.
- También hay filas de INTERESES ("INTERESES CORRIENTES", "INTERES DE MORA"), COMISIONES/CUOTA DE MANEJO ("CUOTA DE MANEJO"), SEGUROS y AVANCES.

EXTRACCIÓN DEL PERIODO (MUY IMPORTANTE):
1. Busca el periodo facturado del extracto (ej "Estado de cuenta al 15/06/2026" o "Periodo facturado: 16/May/2026 - 15/Jun/2026").
2. Extrae MES y AÑO. Usa ese año para las fechas de transacciones que no lo traigan.

REGLAS:
1. Extrae CADA transacción de las tablas de movimientos. Fechas al formato YYYY-MM-DD.
2. "amount": SIEMPRE el valor en positivo (valor original de la transacción). Si la fila es en dólares y el extracto muestra el equivalente en pesos, usa el valor EN PESOS.
3. "kind": clasifica cada fila como "compra" (consumo en comercio), "abono" (pago/abono a la tarjeta), "interes", "comision" (incluye cuota de manejo), "seguro" o "avance" (retiro de efectivo).
4. "installments": el texto de cuotas tal cual (ej "3/36"), o null si no aplica.
5. "description": el nombre del comercio/concepto tal cual figura, sin inventar ni traducir.
6. NO incluyas filas de resumen, subtotales ni saldos.
7. raw_line: déjalo como "" salvo que la descripción sea ambigua (ahorra tokens).
8. card_product: los últimos 4 dígitos de la tarjeta con asterisco (ej "*2047") si figuran, o null.

RESPONDE ÚNICAMENTE con un JSON válido con esta estructura exacta:
{
  "card_product": "*2047",
  "transactions": [
    { "date": "2026-06-20", "description": "HOMECENTER CALLE 80", "amount": 349412, "kind": "compra", "installments": "1/36", "raw_line": "" }
  ],
  "period": { "month": 6, "year": 2026, "period_text": "16/May/2026 - 15/Jun/2026" }
}

NO incluyas explicaciones, solo el JSON.`;

    const userPromptText = "Extrae todas las transacciones de este extracto de tarjeta de crédito Bancolombia. Identifica el periodo y usa ese año para las fechas. Responde ÚNICAMENTE con el JSON especificado en el system prompt.";

    // ── Cascada de providers (idéntica a parse-bancolombia-pdf) ──
    const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);
    const CLAUDE_TIMEOUT_MS = 100_000;
    const GEMINI_TIMEOUT_MS = 40_000;

    function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort("timeout"), ms);
      return { signal: controller.signal, cancel: () => clearTimeout(timer) };
    }

    async function callClaude(signal: AbortSignal): Promise<Response> {
      return await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal,
        headers: {
          "x-api-key": ANTHROPIC_API_KEY ?? "",
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5",
          max_tokens: 16000,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: [
                { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Pdf } },
                { type: "text", text: userPromptText },
              ],
            },
            // Prefill "{" → JSON puro sin fences (la API no devuelve el prefill).
            { role: "assistant", content: "{" },
          ],
        }),
      });
    }

    function buildGeminiBody(model: string): string {
      return JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userPromptText },
              { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64Pdf}` } },
            ],
          },
        ],
      });
    }

    async function callGemini(model: string, signal: AbortSignal): Promise<Response> {
      return await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        signal,
        headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
        body: buildGeminiBody(model),
      });
    }

    type Attempt = { provider: "claude" | "gemini-2.0" | "gemini-2.5"; delayMs: number; label: string };
    const attempts: Attempt[] = [
      { provider: "claude", delayMs: 0, label: "claude-1" },
      { provider: "gemini-2.0", delayMs: 500, label: "gemini-2.0-fallback" },
      { provider: "gemini-2.5", delayMs: 500, label: "gemini-2.5-fallback" },
    ];
    const effectiveAttempts = ANTHROPIC_API_KEY ? attempts : attempts.filter((a) => a.provider !== "claude");

    let aiResponse!: Response;
    let lastStatus = 0;
    let lastErrorBody = "";
    let providerUsed = "";

    for (const { provider, delayMs, label } of effectiveAttempts) {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      const timeoutMs = provider === "claude" ? CLAUDE_TIMEOUT_MS : GEMINI_TIMEOUT_MS;
      const t = withTimeout(timeoutMs);
      try {
        aiResponse = provider === "claude"
          ? await callClaude(t.signal)
          : await callGemini(provider === "gemini-2.0" ? "gemini-2.0-flash" : "gemini-2.5-flash", t.signal);
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        const isAbort = msg.includes("aborted") || msg.includes("timeout");
        console.warn(`parse-card-pdf ${label}: ${isAbort ? "TIMEOUT" : "network error"} — ${msg}`);
        lastStatus = 0;
        lastErrorBody = isAbort ? `timeout after ${timeoutMs}ms` : msg;
        continue;
      } finally {
        t.cancel();
      }
      if (aiResponse.ok) {
        providerUsed = label;
        break;
      }
      lastStatus = aiResponse.status;
      lastErrorBody = await aiResponse.text().catch(() => "");
      // PDF protegido con clave: Claude devuelve 400 con error de documento.
      // Mensaje específico — es LA falla más probable con extractos de tarjeta
      // que llegan por email (los del portal vienen sin clave).
      if (!RETRYABLE.has(aiResponse.status)) {
        const lower = lastErrorBody.toLowerCase();
        if (aiResponse.status === 400 && (lower.includes("encrypt") || lower.includes("password") || lower.includes("could not process") || lower.includes("document"))) {
          return new Response(
            JSON.stringify({ error: "No pudimos abrir el PDF — suele pasar cuando está protegido con clave (los que llegan por email). Descargá el extracto desde la Sucursal Virtual (viene sin clave) y subilo de nuevo." }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        break;
      }
      console.warn(`parse-card-pdf ${label}: ${aiResponse.status}. Siguiente…`);
    }

    if (!aiResponse || !aiResponse.ok) {
      const finalStatus = lastStatus || aiResponse?.status || 0;
      console.error(`AI providers exhausted (${finalStatus}):`, lastErrorBody);
      let userMsg: string;
      if (finalStatus === 429) {
        userMsg = "Hay mucha demanda en este momento. Probá de nuevo en 1 minuto.";
      } else if (RETRYABLE.has(finalStatus) || finalStatus === 0) {
        userMsg = "Los modelos de IA están con problemas en este momento. Esperá 1–2 minutos y reintentá.";
      } else {
        userMsg = `No pudimos procesar el PDF de la tarjeta. (cód: ai-${finalStatus})`;
      }
      return new Response(JSON.stringify({ error: userMsg }), {
        status: finalStatus === 429 ? 429 : 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log(`parse-card-pdf: OK con ${providerUsed}`);

    // ── Extraer contenido (formatos distintos Claude/Gemini) ──
    const aiResult = await aiResponse.json();
    let content: string | null = null;
    if (providerUsed.startsWith("claude")) {
      const blocks = aiResult.content;
      if (Array.isArray(blocks)) {
        content = blocks.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
      }
      if (content && !content.trim().startsWith("{")) content = "{" + content;
    } else {
      content = aiResult.choices?.[0]?.message?.content ?? null;
    }
    if (!content) throw new Error(`No content returned from AI (${providerUsed})`);

    // ── Parseo robusto del JSON (fences → balanceado → reparar truncado) ──
    function extractBalancedJSON(s: string): string | null {
      const start = s.indexOf("{");
      if (start === -1) return null;
      let depth = 0, inString = false, escape = false;
      for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (escape) { escape = false; continue; }
        if (ch === "\\") { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) return s.slice(start, i + 1);
        }
      }
      return null;
    }

    let parsed: ParsedCardStatement;
    try {
      let cleanContent = content.trim();
      if (cleanContent.startsWith("```json")) cleanContent = cleanContent.slice(7);
      else if (cleanContent.startsWith("```")) cleanContent = cleanContent.slice(3);
      if (cleanContent.endsWith("```")) cleanContent = cleanContent.slice(0, -3);
      cleanContent = cleanContent.trim();

      try {
        parsed = JSON.parse(cleanContent);
      } catch {
        const extracted = extractBalancedJSON(cleanContent);
        if (extracted) {
          parsed = JSON.parse(extracted);
        } else {
          // JSON truncado por max_tokens: cortar en la última tx completa.
          const txStart = cleanContent.indexOf('"transactions"');
          const arrStart = txStart >= 0 ? cleanContent.indexOf("[", txStart) : -1;
          const lastClose = cleanContent.lastIndexOf("},");
          if (arrStart > 0 && lastClose > arrStart) {
            parsed = JSON.parse(cleanContent.slice(0, lastClose + 1) + "]}");
            console.warn(`parse-card-pdf: JSON truncado — recuperadas ${parsed.transactions?.length ?? 0} tx`);
          } else {
            throw new Error("no balanced JSON found in response");
          }
        }
      }
    } catch (parseError) {
      console.error(`Failed to parse AI response from ${providerUsed} (len ${content.length}):`, content.slice(0, 500), (parseError as Error).message);
      throw new Error(`La IA (${providerUsed}) devolvió una respuesta que no pudimos parsear. Probá subir el PDF de nuevo.`);
    }

    if (!parsed.transactions || !Array.isArray(parsed.transactions)) {
      throw new Error("Invalid response structure: missing transactions array");
    }

    // ── Filtrar: solo cargos (compras/intereses/comisiones/seguros/avances) ──
    const isValidDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? "");
    const charges = parsed.transactions.filter((tx) =>
      tx.kind !== "abono" && Number(tx.amount) > 0 && isValidDate(tx.date) && (tx.description ?? "").trim() !== "",
    );
    const abonos = parsed.transactions.length - charges.length;

    if (charges.length === 0) {
      const errMsg = parsed.transactions.length > 0
        ? "El extracto solo tiene abonos/pagos (que no se importan). No hay compras para cargar."
        : "El PDF se procesó pero no encontramos transacciones. Puede ser un extracto sin movimientos o un formato que el modelo no reconoció.";
      await supabase.from("bank_statements").update({ processing_error: errMsg }).eq("id", statement_id);
      return new Response(JSON.stringify({ error: errMsg, transactions_count: 0 }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Actualizar statement: periodo + producto ──
    const statementMonth = parsed.period?.month || null;
    const statementYear = parsed.period?.year || null;
    const periodStart = statementMonth && statementYear ? `${statementYear}-${String(statementMonth).padStart(2, "0")}-01` : null;
    const periodEnd = statementMonth && statementYear ? new Date(statementYear, statementMonth, 0).toISOString().split("T")[0] : null;

    await supabase
      .from("bank_statements")
      .update({
        statement_month: statementMonth,
        statement_year: statementYear,
        period_start: periodStart,
        period_end: periodEnd,
        account_number: statement.account_number ?? parsed.card_product ?? null,
      })
      .eq("id", statement_id);

    // ── Insertar compras como EGRESOS ──
    // Cuotas al final de la descripción (igual que el CSV) — el auxiliar ve de
    // una si es diferido. El comercio queda primero para reglas/búsqueda.
    const transactionsToInsert = charges.map((tx) => {
      const amountAbs = Math.abs(Number(tx.amount));
      const cuotasTotal = (() => {
        const m = /^\s*\d+\s*\/\s*(\d+)\s*$/.exec(tx.installments ?? "");
        return m ? Number(m[1]) : 0;
      })();
      const desc = cuotasTotal > 1 ? `${tx.description.trim()} (${cuotasTotal} cuotas)` : tx.description.trim();
      return {
        user_id: statement.user_id,
        statement_id,
        date: tx.date,
        description: desc,
        amount: -amountAbs, // compra → egreso (convención transactions: negativo)
        debit: amountAbs,
        credit: null,
        balance: null,
        sucursal: null,
        dcto: null,
        raw_line: tx.raw_line || null,
        category: null,
        category_id: null,
        responsible_id: null,
        type: "egreso",
        has_iva: false,
        has_retefuente: false,
        has_reteica: false,
        iva_rate: 0.19,
        retefuente_rate: 0.025,
        iva_amount: 0,
        retefuente_amount: 0,
        reteica_amount: 0,
      };
    });

    const { data: insertedRows, error: insertError } = await supabase
      .from("transactions")
      .insert(transactionsToInsert)
      .select("id");

    if (insertError) {
      await supabase.from("bank_statements").update({ processing_error: `Falló insertar transacciones: ${insertError.message}` }).eq("id", statement_id);
      throw new Error(`Failed to insert transactions: ${insertError.message}`);
    }

    const actuallyInserted = insertedRows?.length ?? 0;
    if (actuallyInserted === 0) {
      const errMsg = "El PDF se procesó pero no se insertaron transacciones. Revisá los permisos de tu cuenta o contactanos.";
      await supabase.from("bank_statements").update({ processing_error: errMsg }).eq("id", statement_id);
      return new Response(JSON.stringify({ error: errMsg, transactions_count: 0 }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("bank_statements").update({ processed: true }).eq("id", statement_id);

    const { error: incrementError } = await supabase.rpc("increment_pdf_upload", { p_user_id: statement.user_id });
    if (incrementError) console.error("Failed to increment PDF upload count:", incrementError);

    console.log(`parse-card-pdf: inserted ${actuallyInserted} compras (${abonos} abonos excluidos)`);

    return new Response(
      JSON.stringify({
        success: true,
        transactions_count: actuallyInserted,
        excluded_payments: abonos,
        card_product: parsed.card_product ?? null,
        period: { month: statementMonth, year: statementYear },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Parse card error:", error);
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    if (capturedStatementId) {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        await supabase.from("bank_statements").update({ processing_error: errMsg }).eq("id", capturedStatementId);
      }
    }
    return new Response(
      JSON.stringify({ error: `Hubo un error procesando el extracto de la tarjeta. (${errMsg.slice(0, 80)})` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
