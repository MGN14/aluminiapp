import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

  try {
    // Auth: verify user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Sesión inválida" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    // Get invoice_id from body
    const body = await req.json();
    const invoice_id = body?.invoice_id;
    const only_items = body?.only_items === true;
    if (!invoice_id) {
      return new Response(JSON.stringify({ error: "invoice_id requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role to read/update the invoice
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Fetch the invoice and verify ownership
    const { data: invoice, error: fetchErr } = await supabase
      .from("invoices")
      .select("id, storage_path, user_id, original_filename")
      .eq("id", invoice_id)
      .single();

    if (fetchErr || !invoice) {
      return new Response(JSON.stringify({ error: "Factura no encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (invoice.user_id !== userId) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!invoice.storage_path) {
      await supabase.from("invoices").update({ status: "error", processing_error: "Sin archivo PDF asociado" }).eq("id", invoice_id);
      return new Response(JSON.stringify({ error: "Sin archivo PDF" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark as processing (skip when only re-extracting items for a confirmed invoice)
    if (!only_items) {
      await supabase.from("invoices").update({ status: "processing", processing_error: null }).eq("id", invoice_id);
    }

    // Download PDF from storage
    const { data: fileData, error: dlErr } = await supabase.storage
      .from("invoices")
      .download(invoice.storage_path);

    if (dlErr || !fileData) {
      console.error("Download error:", dlErr);
      await supabase.from("invoices").update({ status: "error", processing_error: "No se pudo descargar el PDF" }).eq("id", invoice_id);
      return new Response(JSON.stringify({ error: "Error descargando PDF" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Convert to base64 (chunked to avoid stack overflow)
    const bytes = new Uint8Array(await fileData.arrayBuffer());
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    const base64 = btoa(binary);

    if (!GEMINI_API_KEY) {
      await supabase.from("invoices").update({ status: "error", processing_error: "IA no configurada" }).eq("id", invoice_id);
      return new Response(JSON.stringify({ error: "IA no configurada" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build AI request based on mode. We use the OpenAI-compatible Gemini endpoint
    // with image_url (data URL) and inline JSON (no tool-calling), matching the pattern
    // that reliably works in parse-bancolombia-pdf.
    const headerSystemPrompt = `Eres un experto en facturación electrónica colombiana. Extrae SOLO los datos de cabecera de la factura del PDF.
Responde SOLO con un JSON válido (sin markdown, sin backticks) con esta estructura exacta:
{
  "invoice_number": "FMGN 276",
  "prefix": "FMGN",
  "number_int": 276,
  "type": "venta",
  "issue_date": "2025-01-15",
  "due_date": "2025-02-15",
  "counterparty_name": "Cliente o Proveedor SAS",
  "counterparty_nit": "900123456-7",
  "seller_name": "Empresa SAS",
  "seller_nit": "900123456-7",
  "buyer_name": "Cliente SAS",
  "buyer_nit": "800987654-3",
  "city": "Bogotá",
  "subtotal_base": 51668151.28,
  "iva_rate": 0.19,
  "iva_amount": 9816948.72,
  "total_amount": 61485100,
  "cufe": "abc123...",
  "payment_method": "Crédito",
  "items": []
}
Reglas:
- type: "venta" si la empresa emite, "compra" si la recibe.
- counterparty_name: si es venta, es el comprador; si es compra, es el vendedor.
- Fechas en YYYY-MM-DD.
- Montos numéricos sin separadores de miles.
- Si no encuentras un campo, usa null o string vacío.
- iva_rate como decimal (0.19 = 19%).
- items debe ser un array vacío [] por ahora (se extraerán después).`;

    const itemsSystemPrompt = `Eres un experto en facturación electrónica colombiana. Extrae SOLO las líneas de ítems de la factura del PDF.
Responde SOLO con un JSON válido (sin markdown, sin backticks) con esta estructura exacta:
{
  "items": [
    { "item_code": "001", "reference": "REF-001", "description": "Producto", "quantity": 10, "unit_price": 5000, "line_base": 50000, "iva_rate": 0.19, "iva_amount": 9500, "line_total": 59500 }
  ]
}
Reglas CRÍTICAS:
- Extrae ABSOLUTAMENTE TODAS las filas de la tabla de productos/servicios. No resumas, no agrupes, no omitas.
- Si la tabla sigue en varias páginas, recórrela entera.
- Cada fila con su propio código/descripción/cantidad/valor es un ítem independiente.
- Si no hay código o referencia en una fila, usa "" (string vacío), pero siempre incluye description, quantity, unit_price, line_base y line_total.
- Montos sin separadores de miles. iva_rate como decimal (0.19).`;

    const userPromptText = only_items
      ? "Extrae SOLO todas las líneas de ítems de esta factura electrónica colombiana. No resumas ni omitas ninguna línea. Responde SOLO con el JSON."
      : "Extrae SOLO los datos de cabecera de esta factura electrónica colombiana. NO extraigas ítems de línea. Responde SOLO con el JSON.";

    // [v2] Retry con backoff + fallback multi-modelo contra 503 UNAVAILABLE y 429 RATE LIMIT.
    //   1. gemini-2.5-flash (primario) 3 intentos con backoff 0/600/1500ms.
    //   2. gemini-2.0-flash (fallback) 1 intento con 500ms. Pool independiente
    //      en Google (15 RPM / 1500 RPD vs 10 RPM / 250 RPD del 2.5), por lo
    //      que cuando el primario satura, el secundario suele responder.
    //   3. Si ambos fallan, devolvemos 503 con mensaje claro.
    // NO reintentamos 401/403/400 (auth/payload) ni 402 (billing).
    const PRIMARY_MODEL = "gemini-2.5-flash";
    const FALLBACK_MODEL = "gemini-2.0-flash";
    const RETRYABLE = new Set([429, 500, 502, 503, 504]);

    function buildBody(model: string): string {
      return JSON.stringify({
        model,
        messages: [
          { role: "system", content: only_items ? itemsSystemPrompt : headerSystemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userPromptText },
              {
                type: "image_url",
                image_url: { url: `data:application/pdf;base64,${base64}` },
              },
            ],
          },
        ],
      });
    }

    async function callGemini(model: string): Promise<Response> {
      return await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GEMINI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: buildBody(model),
      });
    }

    const attempts: Array<{ model: string; delayMs: number; label: string }> = [
      { model: PRIMARY_MODEL, delayMs: 0, label: "primary-1" },
      { model: PRIMARY_MODEL, delayMs: 600, label: "primary-2" },
      { model: PRIMARY_MODEL, delayMs: 1500, label: "primary-3" },
      { model: FALLBACK_MODEL, delayMs: 500, label: "fallback-1" },
    ];

    let aiResponse!: Response;
    let lastStatus = 0;
    let lastBody = "";
    let modelUsed = PRIMARY_MODEL;

    for (const { model, delayMs, label } of attempts) {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      aiResponse = await callGemini(model);
      if (aiResponse.ok) {
        modelUsed = model;
        if (model !== PRIMARY_MODEL) {
          console.log(`start-invoice-processing [v2]: sirvió con ${model} (fallback OK tras saturación)`);
        }
        break;
      }
      lastStatus = aiResponse.status;
      if (!RETRYABLE.has(aiResponse.status)) break;
      lastBody = await aiResponse.text().catch(() => "");
      console.warn(
        `start-invoice-processing [v2] ${label}: ${model} devolvió ${aiResponse.status}. Siguiente intento…`,
      );
    }

    if (!aiResponse.ok) {
      const finalStatus = lastStatus || aiResponse.status;
      const errBody = lastBody || (await aiResponse.text().catch(() => ""));
      console.error(`start-invoice-processing [v2] AI error tras primario+fallback (${finalStatus}):`, errBody);
      let errMsg: string;
      if (finalStatus === 402) {
        errMsg = "Créditos de IA agotados";
      } else if (finalStatus === 429) {
        errMsg = "Gemini free tier saturado (primario y fallback). Esperá 1–2 min e intentá de nuevo.";
      } else if (RETRYABLE.has(finalStatus)) {
        errMsg = "Gemini saturado (probamos 2.5-flash y 2.0-flash). Intentá de nuevo en unos segundos.";
      } else {
        errMsg = `Error procesando con IA (HTTP ${finalStatus})`;
      }
      if (!only_items) {
        await supabase.from("invoices").update({ status: "error", processing_error: errMsg }).eq("id", invoice_id);
      }
      // Devolvemos 503 cuando fue saturación real; 500 para errores no-retryable.
      const respStatus = RETRYABLE.has(finalStatus) || finalStatus === 402 ? 503 : 500;
      return new Response(JSON.stringify({ error: errMsg, details: errBody.slice(0, 500) }), {
        status: respStatus,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`start-invoice-processing [v2]: OK con ${modelUsed}. Parseando…`);
    const aiResult = await aiResponse.json();
    const rawContent: string = aiResult.choices?.[0]?.message?.content || "";
    let extracted: any = null;
    try {
      let clean = rawContent.trim();
      if (clean.startsWith("```json")) clean = clean.slice(7);
      else if (clean.startsWith("```")) clean = clean.slice(3);
      if (clean.endsWith("```")) clean = clean.slice(0, -3);
      clean = clean.trim();
      extracted = JSON.parse(clean);
    } catch {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { extracted = JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
      }
    }

    if (!extracted) {
      console.error("Failed to parse AI response:", rawContent.slice(0, 500));
      if (!only_items) {
        await supabase.from("invoices").update({ status: "error", processing_error: "No se pudo extraer datos" }).eq("id", invoice_id);
      }
      return new Response(JSON.stringify({ error: "No se pudo extraer datos" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ensure items is always an array
    if (!Array.isArray(extracted.items)) extracted.items = [];

    // Re-extract items only: replace invoice_items in DB, don't touch invoice header/status.
    if (only_items) {
      await supabase.from("invoice_items").delete().eq("invoice_id", invoice_id);
      if (extracted.items.length > 0) {
        const rows = extracted.items.map((it: Record<string, unknown>) => ({
          invoice_id,
          user_id: userId,
          item_code: (it.item_code as string) || null,
          reference: (it.reference as string) || null,
          description: (it.description as string) || null,
          quantity: (it.quantity as number) ?? 1,
          unit_price: (it.unit_price as number) ?? 0,
          line_base: (it.line_base as number) ?? 0,
          iva_rate: (it.iva_rate as number) ?? 0.19,
          iva_amount: (it.iva_amount as number) ?? 0,
          line_total: (it.line_total as number) ?? 0,
        }));
        const { error: itemsErr } = await supabase.from("invoice_items").insert(rows);
        if (itemsErr) {
          console.error("Insert items error:", itemsErr);
          return new Response(JSON.stringify({ error: "Error guardando ítems" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // [v2] Persistir marker de última re-extracción dentro de extracted_data
      // (JSONB existente). Evita migración de schema y permite al frontend
      // mostrar "re-extraída el X" por factura. Merge con el JSONB previo.
      const reextractedAt = new Date().toISOString();
      const { data: existingInv } = await supabase
        .from("invoices")
        .select("extracted_data")
        .eq("id", invoice_id)
        .single();
      const prev = (existingInv?.extracted_data as Record<string, unknown> | null) || {};
      const mergedExtractedData = { ...prev, items_reextracted_at: reextractedAt };
      await supabase
        .from("invoices")
        .update({ extracted_data: mergedExtractedData })
        .eq("id", invoice_id);

      return new Response(
        JSON.stringify({
          success: true,
          invoice_id,
          items_count: extracted.items.length,
          items_reextracted_at: reextractedAt,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Normal flow: update invoice with extracted data → status='ready'
    const updateData: Record<string, unknown> = {
      status: "ready",
      processing_error: null,
      extracted_data: extracted,
      invoice_number: extracted.invoice_number || "Pendiente",
      prefix: extracted.prefix || null,
      number_int: extracted.number_int ?? null,
      type: extracted.type || "compra",
      issue_date: extracted.issue_date || new Date().toISOString().slice(0, 10),
      due_date: extracted.due_date || null,
      counterparty_name: extracted.counterparty_name || "",
      counterparty_nit: extracted.counterparty_nit || "",
      seller_name: extracted.seller_name || "",
      seller_nit: extracted.seller_nit || "",
      buyer_name: extracted.buyer_name || "",
      buyer_nit: extracted.buyer_nit || "",
      city: extracted.city || null,
      subtotal_base: extracted.subtotal_base || 0,
      iva_rate: extracted.iva_rate ?? 0.19,
      iva_amount: extracted.iva_amount || 0,
      total_amount: extracted.total_amount || 0,
      cufe: extracted.cufe || null,
      payment_method: extracted.payment_method || null,
    };

    const { error: updateErr } = await supabase
      .from("invoices")
      .update(updateData)
      .eq("id", invoice_id);

    if (updateErr) {
      console.error("Update error:", updateErr);
      await supabase.from("invoices").update({ status: "error", processing_error: "Error guardando datos extraídos" }).eq("id", invoice_id);
      return new Response(JSON.stringify({ error: "Error guardando datos" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, invoice_id, items_count: extracted.items.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("start-invoice-processing error:", error);
    return new Response(
      JSON.stringify({ error: "Error interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
