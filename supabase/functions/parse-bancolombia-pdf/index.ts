import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Transaction {
  date: string;
  description: string;
  sucursal: string | null;
  dcto: string | null;
  amount: number;
  balance: number;
}

interface ParsedStatement {
  transactions: Transaction[];
  summary: {
    saldo_anterior: number | null;
    total_abonos: number | null;
    total_cargos: number | null;
    saldo_actual: number | null;
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { file_path, statement_id } = await req.json();
    
    if (!file_path || !statement_id) {
      throw new Error("file_path and statement_id are required");
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase configuration missing");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Download PDF from storage
    console.log("Downloading PDF from storage:", file_path);
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("bank-statements")
      .download(file_path);

    if (downloadError || !fileData) {
      console.error("Download error:", downloadError);
      throw new Error(`Failed to download PDF: ${downloadError?.message}`);
    }

    // Convert PDF to base64 for AI processing
    const arrayBuffer = await fileData.arrayBuffer();
    const base64Pdf = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    console.log("PDF downloaded, size:", arrayBuffer.byteLength, "bytes");

    // Use Lovable AI to extract transactions from PDF
    const systemPrompt = `Eres un experto en procesar extractos bancarios de Bancolombia, Colombia.

Tu tarea es extraer TODAS las transacciones del extracto bancario PDF.

FORMATO DEL EXTRACTO BANCOLOMBIA:
- La tabla de movimientos tiene columnas: FECHA, DESCRIPCIÓN, SUCURSAL, DCTO, DÉBITOS, CRÉDITOS, SALDO
- Las fechas están en formato DD/MMM (ej: 02/Ene, 15/Feb)
- Los valores negativos son DÉBITOS (gastos)
- Los valores positivos son CRÉDITOS (ingresos)
- El saldo se actualiza después de cada transacción

REGLAS DE EXTRACCIÓN:
1. Extrae CADA transacción individual de la tabla de movimientos
2. Convierte las fechas al formato YYYY-MM-DD (asume el año actual si no está especificado)
3. Para el monto (amount): negativo para débitos, positivo para créditos
4. Incluye sucursal y dcto si están presentes
5. También extrae el resumen: saldo anterior, total abonos, total cargos, saldo actual

RESPONDE ÚNICAMENTE con un JSON válido con esta estructura exacta:
{
  "transactions": [
    {
      "date": "2024-01-15",
      "description": "TRANSFERENCIA RECIBIDA CLIENTE ABC",
      "sucursal": "BOGOTA CENTRO",
      "dcto": "001234",
      "amount": 5500000,
      "balance": 25500000
    }
  ],
  "summary": {
    "saldo_anterior": 20000000,
    "total_abonos": 17600000,
    "total_cargos": 12180000,
    "saldo_actual": 25420000
  }
}

NO incluyas explicaciones, solo el JSON.`;

    console.log("Calling Lovable AI for PDF extraction...");
    
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { 
            role: "user", 
            content: [
              {
                type: "text",
                text: "Extrae todas las transacciones de este extracto bancario de Bancolombia:"
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:application/pdf;base64,${base64Pdf}`
                }
              }
            ]
          },
        ],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required, please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errorText);
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiResult = await aiResponse.json();
    const content = aiResult.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No content returned from AI");
    }

    console.log("AI response received, parsing JSON...");

    // Parse the JSON response
    let parsed: ParsedStatement;
    try {
      // Clean the response - remove markdown code blocks if present
      let cleanContent = content.trim();
      if (cleanContent.startsWith("```json")) {
        cleanContent = cleanContent.slice(7);
      } else if (cleanContent.startsWith("```")) {
        cleanContent = cleanContent.slice(3);
      }
      if (cleanContent.endsWith("```")) {
        cleanContent = cleanContent.slice(0, -3);
      }
      
      parsed = JSON.parse(cleanContent.trim());
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse AI response as JSON");
    }

    if (!parsed.transactions || !Array.isArray(parsed.transactions)) {
      throw new Error("Invalid response structure: missing transactions array");
    }

    console.log(`Extracted ${parsed.transactions.length} transactions`);

    // Get user_id from statement
    const { data: statement, error: statementError } = await supabase
      .from("bank_statements")
      .select("user_id")
      .eq("id", statement_id)
      .single();

    if (statementError || !statement) {
      throw new Error("Statement not found");
    }

    // Insert transactions into database
    const transactionsToInsert = parsed.transactions.map((tx) => ({
      user_id: statement.user_id,
      statement_id: statement_id,
      date: tx.date,
      description: tx.description,
      amount: tx.amount,
      debit: tx.amount < 0 ? Math.abs(tx.amount) : null,
      credit: tx.amount > 0 ? tx.amount : null,
      balance: tx.balance,
      sucursal: tx.sucursal || null,
      dcto: tx.dcto || null,
      category: inferCategory(tx.description),
      applies_iva: shouldApplyIVA(tx.description, tx.amount),
      applies_retefuente: shouldApplyRetefuente(tx.description, tx.amount),
      reconciled: false,
    }));

    const { error: insertError } = await supabase
      .from("transactions")
      .insert(transactionsToInsert);

    if (insertError) {
      console.error("Insert error:", insertError);
      throw new Error(`Failed to insert transactions: ${insertError.message}`);
    }

    // Update statement as processed
    await supabase
      .from("bank_statements")
      .update({ processed: true })
      .eq("id", statement_id);

    console.log("Transactions inserted successfully");

    return new Response(
      JSON.stringify({
        success: true,
        transactions_count: parsed.transactions.length,
        summary: parsed.summary,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Parse error:", error);
    
    // Update statement with error
    const { statement_id } = await req.json().catch(() => ({}));
    if (statement_id) {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        await supabase
          .from("bank_statements")
          .update({ processing_error: error instanceof Error ? error.message : "Unknown error" })
          .eq("id", statement_id);
      }
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Helper functions to auto-categorize and detect tax applicability
function inferCategory(description: string): string | null {
  const desc = description.toUpperCase();
  
  if (/COBRO IVA|IVA PAGOS|PAGO.*IVA/.test(desc)) return "impuestos";
  if (/PAGO PSE IMPUESTO DIAN|RETEFUENTE/.test(desc)) return "impuestos";
  if (/NOMINA|SALARIO|PRIMA|CESANTIA/.test(desc)) return "nomina";
  if (/ARRIENDO|ALQUILER/.test(desc)) return "gastos_operativos";
  if (/SERVICIOS|EPM|ENERGIA|AGUA|GAS|INTERNET|TELEFONO/.test(desc)) return "servicios";
  if (/TRANSFERENCIA RECIBIDA|FACTURA.*RECIB|VENTA|CLIENTE/.test(desc)) return "ventas";
  if (/PAGO PROVEEDOR|COMPRA|MATERIALES|INSUMOS/.test(desc)) return "proveedores";
  if (/TRANSFERENCIA ENVIADA|PAGO/.test(desc)) return "transferencias";
  
  return null;
}

function shouldApplyIVA(description: string, amount: number): boolean {
  // IVA applies to income from sales (positive amounts with sales-related descriptions)
  if (amount <= 0) return false;
  
  const desc = description.toUpperCase();
  // Don't apply IVA to transfers between own accounts or IVA payments themselves
  if (/COBRO IVA|IVA PAGOS/.test(desc)) return false;
  
  // Apply IVA to sales income
  if (/TRANSFERENCIA RECIBIDA|FACTURA|VENTA|CLIENTE/.test(desc)) return true;
  
  return false;
}

function shouldApplyRetefuente(description: string, amount: number): boolean {
  // Retefuente applies to purchases of goods (negative amounts)
  if (amount >= 0) return false;
  
  const desc = description.toUpperCase();
  // Apply retefuente to purchases from suppliers
  if (/PAGO PROVEEDOR|COMPRA|MATERIALES|INSUMOS|MERCANCIA/.test(desc)) return true;
  
  return false;
}
