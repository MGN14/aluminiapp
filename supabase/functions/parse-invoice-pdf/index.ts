import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey: Deno.env.get("SUPABASE_ANON_KEY")! },
    });
    if (!userResp.ok) {
      return new Response(JSON.stringify({ error: "Sesión inválida" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return new Response(JSON.stringify({ error: "No se recibió archivo PDF" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    // Chunk the conversion to avoid "Maximum call stack size exceeded"
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    const base64 = btoa(binary);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI no configurada" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
            content: `Eres un experto en facturación electrónica colombiana. Extrae los datos de la factura del PDF proporcionado.
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
  "items": [
    {
      "item_code": "001",
      "reference": "REF-001",
      "description": "Producto ejemplo",
      "quantity": 10,
      "unit_price": 5000,
      "line_base": 50000,
      "iva_rate": 0.19,
      "iva_amount": 9500,
      "line_total": 59500
    }
  ]
}
Reglas:
- type debe ser "venta" si la empresa emite la factura, o "compra" si la empresa la recibe.
- counterparty_name: si es venta, es el comprador; si es compra, es el vendedor.
- Fechas en formato YYYY-MM-DD.
- Montos numéricos sin separadores de miles.
- Si no encuentras un campo, usa null o string vacío.
- iva_rate como decimal (0.19 = 19%).
- Extrae TODOS los ítems de la factura.`,
          },
          {
            role: "user",
            content: [
              {
                type: "file",
                file: {
                  filename: file.name,
                  file_data: `data:application/pdf;base64,${base64}`,
                },
              },
              {
                type: "text",
                text: "Extrae todos los datos de esta factura electrónica colombiana. Responde SOLO con el JSON.",
              },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_invoice",
              description: "Extrae los datos estructurados de una factura electrónica colombiana",
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
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        item_code: { type: "string" },
                        reference: { type: "string" },
                        description: { type: "string" },
                        quantity: { type: "number" },
                        unit_price: { type: "number" },
                        line_base: { type: "number" },
                        iva_rate: { type: "number" },
                        iva_amount: { type: "number" },
                        line_total: { type: "number" },
                      },
                      required: ["description", "quantity", "unit_price", "line_base", "line_total"],
                    },
                  },
                },
                required: [
                  "invoice_number", "type", "issue_date", "counterparty_name",
                  "subtotal_base", "iva_rate", "iva_amount", "total_amount", "items",
                ],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "extract_invoice" } },
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Demasiadas solicitudes, intenta de nuevo en un momento" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA agotados" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("AI error:", status);
      return new Response(JSON.stringify({ error: "Error procesando con IA" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await aiResponse.json();
    let extracted;
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
        throw new Error("No se pudo extraer datos de la factura");
      }
    }

    return new Response(JSON.stringify(extracted), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("parse-invoice-pdf error:", error);
    return new Response(
      JSON.stringify({ error: "Error interno al procesar la factura" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
