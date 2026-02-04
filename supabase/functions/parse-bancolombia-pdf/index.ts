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
  raw_line?: string;
}

interface ParsedStatement {
  transactions: Transaction[];
  summary: {
    saldo_anterior: number | null;
    total_abonos: number | null;
    total_cargos: number | null;
    saldo_actual: number | null;
  };
  period: {
    month: number | null;
    year: number | null;
    period_text: string | null;
  };
}

// Parse Spanish month name to number (1-12)
function parseSpanishMonth(monthStr: string): number | null {
  const monthMap: Record<string, number> = {
    'ene': 1, 'enero': 1,
    'feb': 2, 'febrero': 2,
    'mar': 3, 'marzo': 3,
    'abr': 4, 'abril': 4,
    'may': 5, 'mayo': 5,
    'jun': 6, 'junio': 6,
    'jul': 7, 'julio': 7,
    'ago': 8, 'agosto': 8,
    'sep': 9, 'sept': 9, 'septiembre': 9,
    'oct': 10, 'octubre': 10,
    'nov': 11, 'noviembre': 11,
    'dic': 12, 'diciembre': 12,
  };
  
  return monthMap[monthStr.toLowerCase().trim()] || null;
}

// Fix transaction date to use the correct year from statement period
function fixTransactionDate(dateStr: string, statementMonth: number | null, statementYear: number | null): string {
  // If we have a full date with year, use it
  const fullDateMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (fullDateMatch) {
    const [, year, month, day] = fullDateMatch;
    // If AI returned a future date (2026) but statement is 2025, fix it
    if (statementYear && parseInt(year) > statementYear) {
      return `${statementYear}-${month}-${day}`;
    }
    return dateStr;
  }
  
  // If we don't have statement period info, return as-is
  if (!statementMonth || !statementYear) {
    return dateStr;
  }
  
  // Try to parse DD/MMM format (e.g., "15/Dic")
  const shortDateMatch = dateStr.match(/^(\d{1,2})\/(\w+)$/i);
  if (shortDateMatch) {
    const [, day, monthStr] = shortDateMatch;
    const month = parseSpanishMonth(monthStr);
    if (month) {
      // Determine correct year - if transaction month is different from statement month
      // and would result in a future date, adjust accordingly
      let year = statementYear;
      
      // Handle year boundary (e.g., statement is Dec 2025, transaction is Jan)
      if (month > statementMonth && month - statementMonth > 6) {
        year = statementYear - 1;
      } else if (month < statementMonth && statementMonth - month > 6) {
        year = statementYear + 1;
      }
      
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  
  // Fallback: try to extract day and use statement month/year
  const dayMatch = dateStr.match(/^(\d{1,2})/);
  if (dayMatch && statementMonth && statementYear) {
    const day = parseInt(dayMatch[1]);
    return `${statementYear}-${String(statementMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  
  return dateStr;
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

    // Get user_id from statement first to check limits
    const { data: statement, error: statementError } = await supabase
      .from("bank_statements")
      .select("user_id")
      .eq("id", statement_id)
      .single();

    if (statementError || !statement) {
      throw new Error("Statement not found");
    }

    // Check if user can upload (verify limits at backend level)
    const { data: limitCheck, error: limitError } = await supabase
      .rpc("check_pdf_upload_limit", { p_user_id: statement.user_id });
    
    if (limitError) {
      console.error("Limit check error:", limitError);
    }
    
    const parsedCheck = typeof limitCheck === 'string' ? JSON.parse(limitCheck) : limitCheck;
    if (parsedCheck && !parsedCheck.can_upload) {
      // Return limit exceeded error
      return new Response(
        JSON.stringify({ 
          error: "Límite de PDFs alcanzado", 
          message: parsedCheck.message,
          limit_exceeded: true,
          plan: parsedCheck.plan
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
- Las fechas están en formato DD/MMM (ej: 02/Ene, 15/Feb) o DD/MMM/YYYY
- Los valores negativos son DÉBITOS (gastos)
- Los valores positivos son CRÉDITOS (ingresos)
- El saldo se actualiza después de cada transacción

EXTRACCIÓN DEL PERIODO (MUY IMPORTANTE):
1. Busca el encabezado del extracto que indica el periodo, ej: "DICIEMBRE 2025" o "Extracto del 01/Dic/2025 al 31/Dic/2025"
2. Extrae el MES y AÑO del extracto
3. Este periodo es CRÍTICO para asignar el año correcto a las transacciones

REGLAS DE EXTRACCIÓN:
1. Extrae CADA transacción individual de la tabla de movimientos
2. Para las fechas:
   - Si el PDF muestra solo DD/MMM (ej: 15/Dic), usa el año del periodo del extracto
   - Convierte al formato YYYY-MM-DD
3. Para el monto (amount): negativo para débitos, positivo para créditos
4. Incluye sucursal y dcto si están presentes
5. También extrae el resumen: saldo anterior, total abonos, total cargos, saldo actual
6. Incluye raw_line con la línea original del PDF para cada transacción

RESPONDE ÚNICAMENTE con un JSON válido con esta estructura exacta:
{
  "transactions": [
    {
      "date": "2025-12-15",
      "description": "TRANSFERENCIA RECIBIDA CLIENTE ABC",
      "sucursal": "BOGOTA CENTRO",
      "dcto": "001234",
      "amount": 5500000,
      "balance": 25500000,
      "raw_line": "15/Dic TRANSFERENCIA RECIBIDA CLIENTE ABC BOGOTA CENTRO 001234 5.500.000 25.500.000"
    }
  ],
  "summary": {
    "saldo_anterior": 20000000,
    "total_abonos": 17600000,
    "total_cargos": 12180000,
    "saldo_actual": 25420000
  },
  "period": {
    "month": 12,
    "year": 2025,
    "period_text": "Diciembre 2025"
  }
}

NO incluyas explicaciones, solo el JSON.
IMPORTANTE: Usa el año del periodo del extracto para las fechas, NO el año actual.`;

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
                text: "Extrae todas las transacciones de este extracto bancario de Bancolombia. IMPORTANTE: Identifica el periodo (mes y año) del extracto y usa ese año para todas las fechas de las transacciones."
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

    // Extract period info
    const statementMonth = parsed.period?.month || null;
    const statementYear = parsed.period?.year || null;

    console.log(`Extracted period: ${statementMonth}/${statementYear}`);
    console.log(`Extracted ${parsed.transactions.length} transactions`);

    // Use the user_id from the statement we already fetched at the beginning

    // Update statement with period info
    const periodStart = statementMonth && statementYear 
      ? `${statementYear}-${String(statementMonth).padStart(2, '0')}-01`
      : null;
    
    const periodEnd = statementMonth && statementYear
      ? new Date(statementYear, statementMonth, 0).toISOString().split('T')[0]
      : null;

    await supabase
      .from("bank_statements")
      .update({ 
        statement_month: statementMonth,
        statement_year: statementYear,
        period_start: periodStart,
        period_end: periodEnd,
      })
      .eq("id", statement_id);

    // Get or create categories and responsibles for auto-categorization
    let impuestosCategoryId: string | null = null;
    let otrosCategoryId: string | null = null;
    let dianResponsibleId: string | null = null;
    let bancoResponsibleId: string | null = null;
    
    // Check if user has "Impuestos" category
    const { data: existingImpuestos } = await supabase
      .from("categories")
      .select("id")
      .eq("user_id", statement.user_id)
      .ilike("name", "impuestos")
      .maybeSingle();
    
    if (existingImpuestos) {
      impuestosCategoryId = existingImpuestos.id;
    } else {
      const { data: newCategory } = await supabase
        .from("categories")
        .insert({ user_id: statement.user_id, name: "Impuestos", sort_order: 999 })
        .select("id")
        .single();
      impuestosCategoryId = newCategory?.id || null;
    }
    
    // Check if user has "Otros" category
    const { data: existingOtros } = await supabase
      .from("categories")
      .select("id")
      .eq("user_id", statement.user_id)
      .ilike("name", "otros")
      .maybeSingle();
    
    if (existingOtros) {
      otrosCategoryId = existingOtros.id;
    } else {
      const { data: newCategory } = await supabase
        .from("categories")
        .insert({ user_id: statement.user_id, name: "Otros", sort_order: 998 })
        .select("id")
        .single();
      otrosCategoryId = newCategory?.id || null;
    }
    
    // Check if user has "DIAN" responsible
    const { data: existingDian } = await supabase
      .from("responsibles")
      .select("id")
      .eq("user_id", statement.user_id)
      .ilike("name", "dian")
      .maybeSingle();
    
    if (existingDian) {
      dianResponsibleId = existingDian.id;
    } else {
      const { data: newResponsible } = await supabase
        .from("responsibles")
        .insert({ user_id: statement.user_id, name: "DIAN" })
        .select("id")
        .single();
      dianResponsibleId = newResponsible?.id || null;
    }
    
    // Check if user has "Banco" responsible
    const { data: existingBanco } = await supabase
      .from("responsibles")
      .select("id")
      .eq("user_id", statement.user_id)
      .ilike("name", "banco")
      .maybeSingle();
    
    if (existingBanco) {
      bancoResponsibleId = existingBanco.id;
    } else {
      const { data: newResponsible } = await supabase
        .from("responsibles")
        .insert({ user_id: statement.user_id, name: "Banco" })
        .select("id")
        .single();
      bancoResponsibleId = newResponsible?.id || null;
    }

    // Insert transactions into database
    // The database trigger will calculate iva_amount and retefuente_amount
    const transactionsToInsert = parsed.transactions.map((tx) => {
      // Fix the date using statement period
      const fixedDate = fixTransactionDate(tx.date, statementMonth, statementYear);
      
      // Check auto-categorization rules
      const isGMF = isGMFTransaction(tx.description);
      const isInterest = isInterestTransaction(tx.description);
      
      // Determine category and responsible based on rules
      let categoryText: string | null = inferCategory(tx.description);
      let categoryId: string | null = null;
      let responsibleId: string | null = null;
      let transactionType: string | null = null;
      
      if (isGMF) {
        categoryText = "impuestos";
        categoryId = impuestosCategoryId;
        responsibleId = dianResponsibleId;
        transactionType = "egreso";
      } else if (isInterest) {
        categoryText = "otros";
        categoryId = otrosCategoryId;
        responsibleId = bancoResponsibleId;
        transactionType = "ingreso";
      }
      
      return {
        user_id: statement.user_id,
        statement_id: statement_id,
        date: fixedDate,
        description: tx.description,
        amount: tx.amount,
        debit: tx.amount < 0 ? Math.abs(tx.amount) : null,
        credit: tx.amount > 0 ? tx.amount : null,
        balance: tx.balance,
        sucursal: tx.sucursal || null,
        dcto: tx.dcto || null,
        raw_line: tx.raw_line || null,
        category: categoryText,
        category_id: categoryId,
        responsible_id: responsibleId,
        type: transactionType || (tx.amount >= 0 ? "ingreso" : "egreso"),
        has_iva: shouldApplyIVA(tx.description, tx.amount),
        has_retefuente: shouldApplyRetefuente(tx.description, tx.amount),
        iva_rate: 0.19,
        retefuente_rate: 0.025,
      };
    });

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

    // Increment user's PDF upload count AFTER successful processing
    const { error: incrementError } = await supabase
      .rpc("increment_pdf_upload", { p_user_id: statement.user_id });
    
    if (incrementError) {
      console.error("Failed to increment PDF upload count:", incrementError);
      // Don't throw - the PDF was processed successfully, just log the error
    } else {
      console.log("PDF upload count incremented for user:", statement.user_id);
    }

    console.log("Transactions inserted successfully");

    return new Response(
      JSON.stringify({
        success: true,
        transactions_count: parsed.transactions.length,
        summary: parsed.summary,
        period: {
          month: statementMonth,
          year: statementYear,
        },
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

// Helper to detect GMF/4x1000 transactions
function isGMFTransaction(description: string): boolean {
  const desc = description.toLowerCase();
  return (
    desc.includes('4x1000') ||
    desc.includes('gmf') ||
    desc.includes('impto gobierno 4x1000') ||
    desc.includes('gravamen movimientos financieros') ||
    desc.includes('impuesto gmf')
  );
}

// Helper to detect interest deposit transactions
function isInterestTransaction(description: string): boolean {
  const desc = description.toLowerCase();
  return (
    desc.includes('abono intereses') ||
    desc.includes('intereses ahorros') ||
    desc.includes('intereses cuenta') ||
    desc.includes('intereses cta')
  );
}

// Helper functions to auto-categorize and detect tax applicability
function inferCategory(description: string): string | null {
  const desc = description.toUpperCase();
  
  // GMF is handled separately with auto-categorization
  if (isGMFTransaction(description)) return "impuestos";
  
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
  // IVA applies to expenses (negative amounts) from purchases
  if (amount >= 0) return false;
  
  const desc = description.toUpperCase();
  // Don't apply IVA to transfers between own accounts or tax payments
  if (/COBRO IVA|IVA PAGOS|PAGO PSE IMPUESTO/.test(desc)) return false;
  if (/TRANSFERENCIA|NOMINA|SALARIO/.test(desc)) return false;
  // Don't apply IVA to GMF
  if (isGMFTransaction(description)) return false;
  
  // Apply IVA to purchases from suppliers
  if (/PAGO PROVEEDOR|COMPRA|MATERIALES|INSUMOS|MERCANCIA/.test(desc)) return true;
  if (/SERVICIOS|EPM|ENERGIA|AGUA|GAS|INTERNET/.test(desc)) return true;
  
  return false;
}

function shouldApplyRetefuente(description: string, amount: number): boolean {
  // Retefuente applies to purchases of goods (negative amounts)
  if (amount >= 0) return false;
  
  // Don't apply retefuente to GMF
  if (isGMFTransaction(description)) return false;
  
  const desc = description.toUpperCase();
  // Apply retefuente to purchases from suppliers
  if (/PAGO PROVEEDOR|COMPRA|MATERIALES|INSUMOS|MERCANCIA/.test(desc)) return true;
  
  return false;
}
