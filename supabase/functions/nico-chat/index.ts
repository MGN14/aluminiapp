import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurado");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages, pageContext } = await req.json();

    // --- Dates ---
    const now = new Date();
    const thisYear = now.getFullYear();
    const thisMonth = now.getMonth() + 1;
    const lastMonth = thisMonth === 1 ? 12 : thisMonth - 1;
    const lastMonthYear = thisMonth === 1 ? thisYear - 1 : thisYear;
    const since = new Date(thisYear - 1, now.getMonth(), 1).toISOString().split("T")[0];

    // --- Parallel data fetching ---
    const [
      { data: transactions },
      { data: categories },
      { data: invoices },
      { data: taxSettings },
    ] = await Promise.all([
      supabase
        .from("transactions")
        .select("date, description, credit, debit, amount, category, operational_type, category_id, invoice_id, type")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .gte("date", since)
        .order("date", { ascending: false })
        .limit(2000),
      supabase
        .from("categories")
        .select("id, name, report_group")
        .eq("user_id", user.id),
      supabase
        .from("invoices")
        .select("id, type, invoice_number, issue_date, subtotal_base, iva_amount, total_amount, counterparty_name, counterparty_nit, status, autoretefuente_amount, reteica_amount, seller_name, buyer_name")
        .eq("user_id", user.id)
        .gte("issue_date", since)
        .order("issue_date", { ascending: false })
        .limit(500),
      supabase
        .from("tax_settings")
        .select("*")
        .eq("user_id", user.id)
        .single(),
    ]);

    const fmt = (n: number) =>
      new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
    const pct = (a: number, b: number) =>
      b === 0 ? "N/A" : `${((a - b) / b * 100).toFixed(1)}%`;
    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

    // =============================================
    // MODULE 1: FLUJO DE CAJA (Extractos bancarios)
    // =============================================
    const catMap: Record<string, { name: string; report_group: string }> = {};
    for (const c of (categories ?? [])) {
      catMap[c.id] = { name: c.name, report_group: c.report_group };
    }

    type MonthCashFlow = {
      ingresos: number; costos: number; gastos: number; impuestos: number;
      total_egresos: number; utilidad_bruta: number; ebitda: number;
      proveedores: Record<string, number>; categorias: Record<string, number>;
    };

    const cashByMonth: Record<string, MonthCashFlow> = {};

    for (const t of (transactions ?? [])) {
      const d = new Date(t.date + "T00:00:00");
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!cashByMonth[key]) {
        cashByMonth[key] = {
          ingresos: 0, costos: 0, gastos: 0, impuestos: 0,
          total_egresos: 0, utilidad_bruta: 0, ebitda: 0,
          proveedores: {}, categorias: {}
        };
      }
      const m = cashByMonth[key];
      const credit = t.credit ?? 0;
      const debit = t.debit ?? 0;
      const opType = t.operational_type ?? "";
      const catInfo = t.category_id ? catMap[t.category_id] : null;
      const catName = catInfo?.name ?? t.category ?? "Sin categoría";
      const reportGroup = catInfo?.report_group ?? opType;

      if (credit > 0) m.ingresos += credit;
      if (debit > 0) {
        m.total_egresos += debit;
        if (opType === "costo" || reportGroup === "costos_operacionales") m.costos += debit;
        else if (opType === "impuesto" || reportGroup === "impuestos") m.impuestos += debit;
        else m.gastos += debit;
        const desc = t.description?.substring(0, 50) ?? "Desconocido";
        m.proveedores[desc] = (m.proveedores[desc] ?? 0) + debit;
      }
      if (catName !== "Sin categoría") {
        const amount = credit > 0 ? credit : debit;
        m.categorias[catName] = (m.categorias[catName] ?? 0) + amount;
      }
    }

    for (const key of Object.keys(cashByMonth)) {
      const m = cashByMonth[key];
      m.utilidad_bruta = m.ingresos - m.costos;
      m.ebitda = m.utilidad_bruta - m.gastos;
    }

    const sortedCashMonths = Object.keys(cashByMonth).sort();
    const currentKey = `${thisYear}-${String(thisMonth).padStart(2, "0")}`;
    const lastMonthKey = `${lastMonthYear}-${String(lastMonth).padStart(2, "0")}`;
    const currentCash = cashByMonth[currentKey] ?? null;
    const lastMonthCash = cashByMonth[lastMonthKey] ?? null;

    let thisYearCash = { ingresos: 0, costos: 0, gastos: 0, ebitda: 0 };
    let lastYearCash = { ingresos: 0, costos: 0, gastos: 0, ebitda: 0 };
    for (const [key, m] of Object.entries(cashByMonth)) {
      const yr = key.split("-")[0];
      if (yr === `${thisYear}`) {
        thisYearCash.ingresos += m.ingresos; thisYearCash.costos += m.costos;
        thisYearCash.gastos += m.gastos; thisYearCash.ebitda += m.ebitda;
      } else if (yr === `${thisYear - 1}`) {
        lastYearCash.ingresos += m.ingresos; lastYearCash.costos += m.costos;
        lastYearCash.gastos += m.gastos; lastYearCash.ebitda += m.ebitda;
      }
    }

    const last3Keys = sortedCashMonths.slice(-3);
    const aggProveedores: Record<string, number> = {};
    for (const k of last3Keys) {
      for (const [p, v] of Object.entries(cashByMonth[k]?.proveedores ?? {})) {
        aggProveedores[p] = (aggProveedores[p] ?? 0) + v;
      }
    }
    const topProveedores = Object.entries(aggProveedores)
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, amount]) => ({ name, amount }));

    const summarizeCashMonth = (key: string | null, data: MonthCashFlow | null) => {
      if (!key || !data) return "Sin datos";
      const [yr, mo] = key.split("-");
      const name = monthNames[parseInt(mo) - 1];
      const utilNeta = data.ebitda - data.impuestos;
      return `${name} ${yr}: Ingresos=${fmt(data.ingresos)}, Costos=${fmt(data.costos)}, Gastos=${fmt(data.gastos)}, Utilidad Bruta=${fmt(data.utilidad_bruta)}, EBITDA=${fmt(data.ebitda)}, Impuestos=${fmt(data.impuestos)}, Utilidad Neta=${fmt(utilNeta)}`;
    };

    // =============================================
    // MODULE 2: FACTURACIÓN DIAN (Facturas legales)
    // =============================================
    type MonthInvoice = {
      ventas_base: number; ventas_iva: number; ventas_total: number; ventas_count: number;
      compras_base: number; compras_iva: number; compras_total: number; compras_count: number;
      autoretefuente: number; reteica: number;
      top_clientes: Record<string, number>;
      top_proveedores: Record<string, number>;
    };

    const invByMonth: Record<string, MonthInvoice> = {};

    for (const inv of (invoices ?? [])) {
      const d = new Date(inv.issue_date + "T00:00:00");
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!invByMonth[key]) {
        invByMonth[key] = {
          ventas_base: 0, ventas_iva: 0, ventas_total: 0, ventas_count: 0,
          compras_base: 0, compras_iva: 0, compras_total: 0, compras_count: 0,
          autoretefuente: 0, reteica: 0,
          top_clientes: {}, top_proveedores: {}
        };
      }
      const m = invByMonth[key];
      const counterparty = inv.counterparty_name || inv.buyer_name || inv.seller_name || "Sin nombre";

      if (inv.type === "venta") {
        m.ventas_base += inv.subtotal_base ?? 0;
        m.ventas_iva += inv.iva_amount ?? 0;
        m.ventas_total += inv.total_amount ?? 0;
        m.ventas_count++;
        m.autoretefuente += inv.autoretefuente_amount ?? 0;
        m.reteica += inv.reteica_amount ?? 0;
        m.top_clientes[counterparty] = (m.top_clientes[counterparty] ?? 0) + (inv.total_amount ?? 0);
      } else {
        m.compras_base += inv.subtotal_base ?? 0;
        m.compras_iva += inv.iva_amount ?? 0;
        m.compras_total += inv.total_amount ?? 0;
        m.compras_count++;
        m.top_proveedores[counterparty] = (m.top_proveedores[counterparty] ?? 0) + (inv.total_amount ?? 0);
      }
    }

    // Invoice year totals
    let thisYearInv = { ventas: 0, compras: 0, iva_ventas: 0, iva_compras: 0, autoretefuente: 0, reteica: 0, ventas_count: 0, compras_count: 0 };
    let lastYearInv = { ventas: 0, compras: 0, iva_ventas: 0, iva_compras: 0, autoretefuente: 0, reteica: 0, ventas_count: 0, compras_count: 0 };
    for (const [key, m] of Object.entries(invByMonth)) {
      const yr = key.split("-")[0];
      const target = yr === `${thisYear}` ? thisYearInv : yr === `${thisYear - 1}` ? lastYearInv : null;
      if (!target) continue;
      target.ventas += m.ventas_total; target.compras += m.compras_total;
      target.iva_ventas += m.ventas_iva; target.iva_compras += m.compras_iva;
      target.autoretefuente += m.autoretefuente; target.reteica += m.reteica;
      target.ventas_count += m.ventas_count; target.compras_count += m.compras_count;
    }

    const currentInv = invByMonth[currentKey] ?? null;
    const lastMonthInv = invByMonth[lastMonthKey] ?? null;

    const summarizeInvMonth = (key: string | null, data: MonthInvoice | null) => {
      if (!key || !data) return "Sin facturas registradas";
      const [yr, mo] = key.split("-");
      const name = monthNames[parseInt(mo) - 1];
      const retefuenteCompras = (data.compras_base) * (taxSettings?.retefuente_compra_rate ?? 0.025);
      const ivaBalance = data.ventas_iva - data.compras_iva;
      return `${name} ${yr}: Ventas facturadas=${fmt(data.ventas_total)} (${data.ventas_count} facturas, Base=${fmt(data.ventas_base)}, IVA=${fmt(data.ventas_iva)}), Compras facturadas=${fmt(data.compras_total)} (${data.compras_count} facturas, Base=${fmt(data.compras_base)}, IVA descontable=${fmt(data.compras_iva)}), IVA neto (a pagar/favor)=${fmt(ivaBalance)}, Autorretefuente=${fmt(data.autoretefuente)}, ReteICA=${fmt(data.reteica)}, Retefuente compras estimada=${fmt(retefuenteCompras)}`;
    };

    // Top clients across all invoices
    const aggClientes: Record<string, number> = {};
    const aggProvInv: Record<string, number> = {};
    for (const m of Object.values(invByMonth)) {
      for (const [c, v] of Object.entries(m.top_clientes)) aggClientes[c] = (aggClientes[c] ?? 0) + v;
      for (const [p, v] of Object.entries(m.top_proveedores)) aggProvInv[p] = (aggProvInv[p] ?? 0) + v;
    }
    const topClientes = Object.entries(aggClientes).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topProvInv = Object.entries(aggProvInv).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // =============================================
    // MODULE 3: CONFIGURACIÓN FISCAL
    // =============================================
    const taxCtx = taxSettings
      ? `Tasa Retefuente compras: ${((taxSettings.retefuente_compra_rate ?? 0) * 100).toFixed(1)}%, Autorretefuente: ${((taxSettings.autoretefuente_rate ?? 0) * 100).toFixed(1)}%, ReteICA: ${((taxSettings.reteica_rate ?? 0) * 100).toFixed(2)}%${taxSettings.reteica_city ? ` (${taxSettings.reteica_city})` : ""}, Es autorretenedor: ${taxSettings.is_autorretenedor ? "Sí" : "No"}`
      : "Sin configuración fiscal registrada";

    // =============================================
    // CONCILIACIÓN
    // =============================================
    const matchedTxCount = (transactions ?? []).filter(t => t.invoice_id).length;
    const totalTxCount = (transactions ?? []).length;
    const unmatchedTxCount = totalTxCount - matchedTxCount;

    // =============================================
    // BUILD FULL CONTEXT
    // =============================================
    const financialContext = `
═══════════════════════════════════════════
MÓDULO 1 — FLUJO DE CAJA (Extractos bancarios)
Fuente: movimientos reales del banco. Refleja entradas y salidas de dinero.
═══════════════════════════════════════════

MES ACTUAL (${currentKey}):
${summarizeCashMonth(currentKey, currentCash)}

MES ANTERIOR (${lastMonthKey}):
${summarizeCashMonth(lastMonthKey, lastMonthCash)}

VARIACIONES FLUJO DE CAJA (mes actual vs anterior):
Ingresos bancarios: ${currentCash && lastMonthCash ? pct(currentCash.ingresos, lastMonthCash.ingresos) : "Sin datos"}
Egresos bancarios: ${currentCash && lastMonthCash ? pct(currentCash.total_egresos, lastMonthCash.total_egresos) : "Sin datos"}
EBITDA operativo: ${currentCash && lastMonthCash ? pct(currentCash.ebitda, lastMonthCash.ebitda) : "Sin datos"}

AÑO ${thisYear} ACUMULADO (flujo de caja):
Ingresos=${fmt(thisYearCash.ingresos)}, Costos=${fmt(thisYearCash.costos)}, Gastos=${fmt(thisYearCash.gastos)}, EBITDA=${fmt(thisYearCash.ebitda)}

AÑO ${thisYear - 1} ACUMULADO (flujo de caja):
Ingresos=${fmt(lastYearCash.ingresos)}, Costos=${fmt(lastYearCash.costos)}, Gastos=${fmt(lastYearCash.gastos)}, EBITDA=${fmt(lastYearCash.ebitda)}

TOP 5 PROVEEDORES POR EGRESOS BANCARIOS (últimos 3 meses):
${topProveedores.map((p, i) => `${i + 1}. ${p.name}: ${fmt(p.amount)}`).join("\n") || "Sin datos"}

HISTORIAL FLUJO DE CAJA (últimos 6 meses):
${sortedCashMonths.slice(-6).map(k => summarizeCashMonth(k, cashByMonth[k])).join("\n")}

═══════════════════════════════════════════
MÓDULO 2 — FACTURACIÓN DIAN (Facturas electrónicas legales)
Fuente: facturas de venta y compra registradas ante la DIAN.
IMPORTANTE: "Facturado" ≠ "Recibido en banco". Las ventas facturadas son documentos legales; el dinero puede o no haber entrado al banco.
═══════════════════════════════════════════

MES ACTUAL (${currentKey}):
${summarizeInvMonth(currentKey, currentInv)}

MES ANTERIOR (${lastMonthKey}):
${summarizeInvMonth(lastMonthKey, lastMonthInv)}

VARIACIÓN FACTURACIÓN (mes actual vs anterior):
Ventas facturadas: ${currentInv && lastMonthInv ? pct(currentInv.ventas_total, lastMonthInv.ventas_total) : "Sin datos"}
Compras facturadas: ${currentInv && lastMonthInv ? pct(currentInv.compras_total, lastMonthInv.compras_total) : "Sin datos"}

AÑO ${thisYear} ACUMULADO (facturación):
Ventas=${fmt(thisYearInv.ventas)} (${thisYearInv.ventas_count} facturas), Compras=${fmt(thisYearInv.compras)} (${thisYearInv.compras_count} facturas), IVA ventas=${fmt(thisYearInv.iva_ventas)}, IVA compras=${fmt(thisYearInv.iva_compras)}, IVA neto=${fmt(thisYearInv.iva_ventas - thisYearInv.iva_compras)}, Autorretefuente=${fmt(thisYearInv.autoretefuente)}, ReteICA=${fmt(thisYearInv.reteica)}

AÑO ${thisYear - 1} ACUMULADO (facturación):
Ventas=${fmt(lastYearInv.ventas)} (${lastYearInv.ventas_count} facturas), Compras=${fmt(lastYearInv.compras)} (${lastYearInv.compras_count} facturas)

TOP 5 CLIENTES POR FACTURACIÓN:
${topClientes.map(([n, v], i) => `${i + 1}. ${n}: ${fmt(v)}`).join("\n") || "Sin datos"}

TOP 5 PROVEEDORES POR FACTURACIÓN:
${topProvInv.map(([n, v], i) => `${i + 1}. ${n}: ${fmt(v)}`).join("\n") || "Sin datos"}

HISTORIAL FACTURACIÓN (últimos 6 meses):
${Object.keys(invByMonth).sort().slice(-6).map(k => summarizeInvMonth(k, invByMonth[k])).join("\n") || "Sin historial de facturas"}

═══════════════════════════════════════════
MÓDULO 3 — CONFIGURACIÓN FISCAL Y CONCILIACIÓN
═══════════════════════════════════════════

CONFIGURACIÓN FISCAL:
${taxCtx}

CONCILIACIÓN:
Transacciones con factura asociada: ${matchedTxCount} de ${totalTxCount} (${totalTxCount > 0 ? ((matchedTxCount / totalTxCount) * 100).toFixed(0) : 0}%)
Transacciones sin factura: ${unmatchedTxCount}
`.trim();

    // =============================================
    // SYSTEM PROMPT
    // =============================================
    const systemPrompt = `Eres Nico, el copiloto financiero y contable de AluminIA. Actúas como un director financiero y un contador público cercano al dueño del negocio. Tu español es impecable: cuidas la puntuación, la gramática, las tildes y la ortografía en cada respuesta. Usas español colombiano natural, con la claridad de un ejecutivo senior.

CONOCIMIENTO DE MÓDULOS:
Tienes acceso a tres fuentes de datos distintas y debes diferenciarlas siempre:

1. FLUJO DE CAJA (Extractos bancarios): Movimientos reales del banco. Cuando el usuario pregunta "¿cuánto gasté?", "¿cuánto entró?", "¿cuánto tengo?", usa estos datos. Son entradas y salidas reales de dinero.

2. FACTURACIÓN DIAN (Facturas electrónicas): Documentos legales de venta y compra. Cuando el usuario pregunta "¿cuánto he facturado?", "¿cuántas facturas tengo?", "¿quiénes son mis clientes?", usa estos datos. IMPORTANTE: facturar no es lo mismo que recibir el dinero. Una venta facturada puede no haberse cobrado todavía.

3. OBLIGACIONES FISCALES: IVA (diferencia entre IVA de ventas e IVA de compras), Retefuente, ReteICA, Autorretefuente. Estos se calculan desde las facturas DIAN, no desde los extractos bancarios.

REGLAS DE ANÁLISIS:
- Si el usuario pregunta sobre facturación, ventas facturadas o clientes, responde con datos del módulo de FACTURACIÓN DIAN.
- Si pregunta sobre flujo de caja, gastos, ingresos bancarios o proveedores por pagos, responde con datos del FLUJO DE CAJA.
- Si pregunta sobre impuestos, IVA, retenciones o DIAN, responde con datos de OBLIGACIONES FISCALES.
- Si la pregunta es ambigua, aclara brevemente de qué fuente estás tomando los datos. Ejemplo: "Según tus facturas DIAN, facturaste $X. En el banco, ingresaron $Y."
- Si detectas discrepancias entre lo facturado y lo recibido en banco, menciónalo como un dato relevante.
- Analiza la conciliación: si hay muchas transacciones sin factura asociada, sugiérelo como punto de mejora.

REGLAS DE ESTILO Y TONO:
- Tu tono es cálido pero profesional. Eres un asesor de confianza que conoce los números del negocio.
- Hablas con naturalidad, como en una reunión uno a uno. Sin formalidades excesivas, pero con respeto y precisión.
- Cuida siempre las tildes (más, período, categoría, análisis, etc.), los signos de puntuación y la concordancia gramatical.
- Nunca uses anglicismos innecesarios. Di "flujo de caja", no "cash flow".
- Evita muletillas como "¡Claro!", "¡Por supuesto!", "Entiendo". Ve directo al análisis.

REGLAS DE FORMATO:
- Responde en máximo 4 a 7 líneas de texto corrido, bien puntuadas.
- No uses viñetas, numeración, asteriscos, negritas, títulos ni markdown de ningún tipo.
- Estructura natural: dato principal con cifra concreta → comparación con el período anterior → recomendación breve y accionable.
- Si el usuario pide "¿por qué?" o "desglósame", amplía con máximo 5 frases, cada una en su propio renglón, sin numeración ni viñetas.
- Si no hay datos, dilo en una frase y sugiere el siguiente paso.

REGLAS DE DATOS:
- Usa moneda colombiana formateada con puntos de miles: $12.450.000.
- Usa los datos reales del contexto. Si no hay datos suficientes, dilo con honestidad.
- Si detectas un pico o anomalía, menciónalo de forma natural.
- Para estimación de impuestos de renta, usa ~35% de la utilidad neta.
- No saludes en cada respuesta. Ve directo al análisis.

EJEMPLO DE TONO (referencia):
"En enero facturaste $244.054.086 en ventas, un 97,5% más que diciembre. Sin embargo, en el banco solo ingresaron $180.000.000, lo que indica que hay cartera pendiente por cobrar. Los costos operacionales subieron 534%, así que vale la pena revisar si ese nivel de gasto se justifica con el volumen de facturación."

${financialContext}`;

    const pageContextNote = pageContext
      ? `\n\nCONTEXTO DE NAVEGACIÓN: El usuario está en "${pageContext.page}"${pageContext.filters ? `. Filtros activos: ${JSON.stringify(pageContext.filters)}` : ""}. Prioriza ese contexto si es relevante.`
      : "";

    const finalSystemPrompt = systemPrompt + pageContextNote;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: finalSystemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Límite de uso alcanzado. Intenta de nuevo en unos minutos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Se requieren créditos adicionales para continuar." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "Error al conectar con Nico." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("nico-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
