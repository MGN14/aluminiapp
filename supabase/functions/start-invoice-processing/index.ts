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
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

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
    const { invoice_id } = await req.json();
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

    // Mark as processing
    await supabase.from("invoices").update({ status: "processing", processing_error: null }).eq("id", invoice_id);

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

    if (!LOVABLE_API_KEY) {
      await supabase.from("invoices").update({ status: "error", processing_error: "IA no configurada" }).eq("id", invoice_id);
      return new Response(JSON.stringify({ error: "IA no configurada" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call AI for extraction (Phase 1: header only, no line items to avoid timeouts)
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `Eres un experto en facturación electrónica colombiana. Extrae SOLO los datos de cabecera de la factura del PDF.
Responde SOLO con un JSON válido (sin markdown, sin backticks) con esta estructura:
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
- items debe ser un array vacío [] por ahora (se extraerán en fase 2).`,
          },
          {
            role: "user",
            content: [
              {
                type: "file",
                file: {
                  filename: invoice.original_filename || "factura.pdf",
                  file_data: `data:application/pdf;base64,${base64}`,
                },
              },
              {
                type: "text",
                text: "Extrae SOLO los datos de cabecera de esta factura electrónica colombiana. NO extraigas ítems de línea. Responde SOLO con el JSON.",
              },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_invoice_header",
              description: "Extrae datos de cabecera de una factura electrónica colombiana",
              parameters: {
                type: "object",
                properties: {
                  invoice_number: { type: "string" },
                  prefix: { type: "string" },
                  number_int: { type: ["integer", "null"] },
                  type: { type: "string", enum: ["venta", "compra"] },
                  issue_date: { type: "string" },
                  due_date: { type: ["string", "null"] },
                  counterparty_name: { type: "string" },
                  counterparty_nit: { type: "string" },
                  seller_name: { type: "string" },
                  seller_nit: { type: "string" },
                  buyer_name: { type: "string" },
                  buyer_nit: { type: "string" },
                  city: { type: ["string", "null"] },
                  subtotal_base: { type: "number" },
                  iva_rate: { type: "number" },
                  iva_amount: { type: "number" },
                  total_amount: { type: "number" },
                  cufe: { type: ["string", "null"] },
                  payment_method: { type: ["string", "null"] },
                },
                required: [
                  "invoice_number", "type", "issue_date", "counterparty_name",
                  "subtotal_base", "iva_rate", "iva_amount", "total_amount",
                ],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_invoice_header" } },
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      const errMsg = status === 429
        ? "Demasiadas solicitudes, intenta de nuevo en un momento"
        : status === 402
        ? "Créditos de IA agotados"
        : "Error procesando con IA";
      console.error("AI error:", status);
      await supabase.from("invoices").update({ status: "error", processing_error: errMsg }).eq("id", invoice_id);
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await aiResponse.json();
    let extracted: any;
    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      extracted = typeof toolCall.function.arguments === "string"
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;
    } else {
      const content = aiResult.choices?.[0]?.message?.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[0]);
      } else {
        await supabase.from("invoices").update({ status: "error", processing_error: "No se pudo extraer datos" }).eq("id", invoice_id);
        return new Response(JSON.stringify({ error: "No se pudo extraer datos" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Ensure items is always an array
    if (!extracted.items) extracted.items = [];

    // Update invoice with extracted data → status='ready'
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

    return new Response(JSON.stringify({ success: true, invoice_id }), {
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
