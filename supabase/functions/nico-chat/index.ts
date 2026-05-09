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
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY no configurado");

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

    const body = await req.json();
    const messages = body.messages as Array<{ role: string; content: string }> | undefined;
    const pageContext = body.pageContext;
    const rawAgentKey = typeof body.agent_key === "string" ? body.agent_key : "cfo";
    const AGENT_KEYS = ["cfo", "contador", "visita_dian", "tesoreria", "inventario", "estrategia", "gerencial"] as const;
    type AgentKey = typeof AGENT_KEYS[number];
    const agent_key: AgentKey = (AGENT_KEYS as readonly string[]).includes(rawAgentKey) ? (rawAgentKey as AgentKey) : "cfo";

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Rate limit (flagged off por defecto) ---
    const RATE_LIMIT_ENABLED = Deno.env.get("NICO_RATE_LIMIT_ENABLED") === "true";
    const RATE_LIMIT_MAX = parseInt(Deno.env.get("NICO_RATE_LIMIT_MAX") || "500", 10);
    const todayBogota = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }))
      .toISOString().split("T")[0];
    if (RATE_LIMIT_ENABLED) {
      const { data: usage } = await supabase
        .from("nico_usage_daily" as never)
        .select("message_count")
        .eq("user_id", user.id)
        .eq("day", todayBogota)
        .maybeSingle();
      const used = (usage as { message_count?: number } | null)?.message_count ?? 0;
      if (used >= RATE_LIMIT_MAX) {
        return new Response(JSON.stringify({ error: `Alcanzaste el límite diario de ${RATE_LIMIT_MAX} mensajes con Nico. Se reinicia mañana.` }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // --- Load agent memory summary and recent messages ---
    // Filtramos historial a las últimas 12 horas. Antes traíamos los últimos 15
    // mensajes sin importar cuándo se enviaron, lo que provocaba que una pregunta
    // de ayer (ej: IVA, facturación) contaminara el contexto de una pregunta nueva
    // de hoy (ej: macro/aluminio). Gemini se quedaba pegado al hilo viejo.
    const HISTORY_WINDOW_HOURS = 12;
    const historySinceIso = new Date(Date.now() - HISTORY_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const [{ data: memoryRow }, { data: recentMsgs }] = await Promise.all([
      supabase
        .from("nico_agent_memory" as never)
        .select("summary, facts")
        .eq("user_id", user.id)
        .eq("agent_key", agent_key)
        .maybeSingle(),
      supabase
        .from("nico_messages" as never)
        .select("role, content, created_at")
        .eq("user_id", user.id)
        .eq("agent_key", agent_key)
        .gte("created_at", historySinceIso)
        .order("created_at", { ascending: false })
        .limit(15),
    ]);
    const memorySummary = (memoryRow as { summary?: string } | null)?.summary ?? "";
    const memoryFacts = ((memoryRow as { facts?: unknown[] } | null)?.facts ?? []) as unknown[];
    const dbHistory = ((recentMsgs ?? []) as Array<{ role: string; content: string }>).slice().reverse();

    // --- Dates ---
    const now = new Date();
    const thisYear = now.getFullYear();
    const thisMonth = now.getMonth() + 1;
    const lastMonth = thisMonth === 1 ? 12 : thisMonth - 1;
    const lastMonthYear = thisMonth === 1 ? thisYear - 1 : thisYear;
    const since = new Date(thisYear - 1, now.getMonth(), 1).toISOString().split("T")[0];
    const yearStart = `${thisYear}-01-01`;
    const yearEnd = `${thisYear}-12-31`;

    // --- Parallel data fetching (expanded) ---
    const [
      { data: transactions },
      { data: categories },
      { data: invoices },
      { data: taxSettings },
      { data: responsibles },
      { data: matches },
      { data: bankStatements },
      { data: profile },
      { data: initialState },
      { data: initialStateDetails },
      { data: inventoryProducts },
      { data: inventoryMovements },
      { data: businessMemory },
      { data: businessPatterns },
      { data: cashMovements },
      { data: businessObligations },
    ] = await Promise.all([
      supabase
        .from("transactions")
        .select("id, date, description, credit, debit, amount, category, operational_type, category_id, invoice_id, type, responsible_id, owner, has_retefuente, retefuente_amount, notes")
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
        .select("id, type, invoice_number, issue_date, due_date, subtotal_base, iva_amount, total_amount, counterparty_name, counterparty_nit, status, autoretefuente_amount, reteica_amount, retefuente_cliente_amount, retefuente_cliente_rate, seller_name, buyer_name, payment_method")
        .eq("user_id", user.id)
        .eq("status", "confirmed")
        .gte("issue_date", since)
        .order("issue_date", { ascending: false })
        .limit(500),
      supabase
        .from("tax_settings")
        .select("*")
        .eq("user_id", user.id)
        .single(),
      supabase
        .from("responsibles")
        .select("id, name")
        .eq("user_id", user.id)
        .eq("active", true),
      supabase
        .from("invoice_transaction_matches")
        .select("invoice_id, transaction_id, matched_amount")
        .eq("user_id", user.id),
      supabase
        .from("bank_statements")
        .select("id, file_name, bank_name, statement_month, statement_year, period_start, period_end, transaction_count, display_name")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("statement_year", { ascending: false })
        .limit(24),
      supabase
        .from("profiles")
        .select("company_name, full_name")
        .eq("user_id", user.id)
        .single(),
      supabase
        .from("initial_financial_state")
        .select("*")
        .eq("user_id", user.id)
        .single(),
      supabase
        .from("initial_state_details")
        .select("field_type, responsible_name, amount, responsible_id, invoice_id")
        .eq("user_id", user.id),
      supabase
        .from("inventory_products")
        .select("id, reference, name, unit, stock_system, stock_physical, cost_per_unit, sale_price, min_stock")
        .eq("user_id", user.id)
        .eq("active", true)
        .order("reference"),
      supabase
        .from("inventory_movements")
        .select("id, product_id, movement_type, quantity, movement_date")
        .eq("user_id", user.id)
        .gte("movement_date", since)
        .order("movement_date", { ascending: false })
        .limit(1000),
      supabase
        .from("business_memory")
        .select("metric_key, metric_value")
        .eq("user_id", user.id),
      supabase
        .from("business_patterns")
        .select("pattern_type, description, amount_min, amount_max, frequency_days, last_occurrence, entities, occurrences, confidence, status")
        .eq("user_id", user.id)
        .order("confidence", { ascending: false })
        .limit(30),
      // Movimientos en efectivo del año — input del MÓDULO 11 (Brecha DIAN).
      supabase
        .from("cash_movements")
        .select("amount, type, date")
        .eq("user_id", user.id)
        .gte("date", yearStart)
        .lte("date", yearEnd),
      // Obligaciones del negocio (calendario tributario + créditos + custom).
      // Trae monto_estimado y fecha para que Nico pueda responder cuánto se
      // debe en cada obligación y cuándo vence.
      supabase
        .from("business_obligations")
        .select("id, tipo, nombre, monto_estimado, fecha, periodo")
        .eq("user_id", user.id)
        .gte("fecha", yearStart)
        .order("fecha", { ascending: true })
        .limit(120),
    ]);

    // Indicadores macro (TRM + futuros). Tabla compartida read-only.
    // Subimos limit para tener histórico amplio (180 días por indicador) y poder
    // calcular tendencias, no sólo el último valor. Antes con limit=50 sólo había
    // 2-3 puntos por indicador y Nico no podía analizar comportamiento histórico.
    const macroSinceIso = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
      .toISOString().split("T")[0];
    const { data: macroRowsRaw } = await supabase
      .from("macro_indicators" as never)
      .select("indicator_type, sector_code, sector_name, period_date, value, unit")
      .gte("period_date", macroSinceIso)
      .order("period_date", { ascending: false })
      .limit(2000);
    const macroRows = (macroRowsRaw ?? []) as Array<{
      indicator_type: string;
      sector_code: string | null;
      sector_name: string | null;
      period_date: string;
      value: number;
      unit: string | null;
    }>;

    const fmt = (n: number) =>
      new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
    const pct = (a: number, b: number) =>
      b === 0 ? "N/A" : `${((a - b) / b * 100).toFixed(1)}%`;
    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

    // Responsible map
    const respMap: Record<string, string> = {};
    for (const r of (responsibles ?? [])) respMap[r.id] = r.name;

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
    let thisYearInv = { ventas: 0, ventas_base: 0, compras: 0, compras_base: 0, iva_ventas: 0, iva_compras: 0, autoretefuente: 0, reteica: 0, ventas_count: 0, compras_count: 0 };
    let lastYearInv = { ventas: 0, ventas_base: 0, compras: 0, compras_base: 0, iva_ventas: 0, iva_compras: 0, autoretefuente: 0, reteica: 0, ventas_count: 0, compras_count: 0 };
    for (const [key, m] of Object.entries(invByMonth)) {
      const yr = key.split("-")[0];
      const target = yr === `${thisYear}` ? thisYearInv : yr === `${thisYear - 1}` ? lastYearInv : null;
      if (!target) continue;
      target.ventas += m.ventas_total; target.ventas_base += m.ventas_base;
      target.compras += m.compras_total; target.compras_base += m.compras_base;
      target.iva_ventas += m.ventas_iva; target.iva_compras += m.compras_iva;
      target.autoretefuente += m.autoretefuente; target.reteica += m.reteica;
      target.ventas_count += m.ventas_count; target.compras_count += m.compras_count;
    }

    const currentInv = invByMonth[currentKey] ?? null;
    const lastMonthInv = invByMonth[lastMonthKey] ?? null;

    const retefuenteCompraRate = taxSettings?.retefuente_compra_rate ?? 0.025;

    const summarizeInvMonth = (key: string | null, data: MonthInvoice | null) => {
      if (!key || !data) return "Sin facturas registradas";
      const [yr, mo] = key.split("-");
      const name = monthNames[parseInt(mo) - 1];
      const retefuenteCompras = (data.compras_base) * retefuenteCompraRate;
      const ivaBalance = data.ventas_iva - data.compras_iva;
      return `${name} ${yr}: Ventas facturadas=${fmt(data.ventas_total)} (${data.ventas_count} facturas, Base=${fmt(data.ventas_base)}, IVA=${fmt(data.ventas_iva)}), Compras facturadas=${fmt(data.compras_total)} (${data.compras_count} facturas, Base=${fmt(data.compras_base)}, IVA descontable=${fmt(data.compras_iva)}), IVA neto (a pagar/favor)=${fmt(ivaBalance)}, Autorretefuente=${fmt(data.autoretefuente)}, ReteICA=${fmt(data.reteica)}, Retefuente compras estimada=${fmt(retefuenteCompras)}`;
    };

    // Top clients & providers across all invoices
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
    // MODULE 4: CONCILIACIÓN Y ANÁLISIS AVANZADO
    // =============================================
    
    // Build match maps
    const matchesByInvoice: Record<string, number> = {};
    const matchedTxIds = new Set<string>();
    for (const m of (matches ?? [])) {
      matchesByInvoice[m.invoice_id] = (matchesByInvoice[m.invoice_id] ?? 0) + (m.matched_amount ?? 0);
      matchedTxIds.add(m.transaction_id);
    }

    const matchedTxCount = matchedTxIds.size;
    const totalTxCount = (transactions ?? []).length;
    const unmatchedTxCount = totalTxCount - matchedTxCount;

    // --- Cuentas por Cobrar (FIXED: same logic as CFO insights + AccountsReceivableReport) ---
    // Includes retefuente deduction, initial state advances linked to invoices, and initial CxC balance
    const cuentasPorCobrar: { cliente: string; factura: string; total: number; pagado: number; saldo: number; fecha: string; vencimiento: string | null }[] = [];
    
    // Build payment map including direct payments, manual matches, and initial advance payments
    const paymentsByInvoice = new Map<string, number>();
    
    // Direct transaction payments (transactions linked to invoices)
    for (const t of (transactions ?? [])) {
      if (t.invoice_id) {
        paymentsByInvoice.set(t.invoice_id, (paymentsByInvoice.get(t.invoice_id) || 0) + Math.abs(t.amount ?? 0));
      }
    }
    // Manual matches
    for (const m of (matches ?? [])) {
      paymentsByInvoice.set(m.invoice_id, (paymentsByInvoice.get(m.invoice_id) || 0) + Math.abs(m.matched_amount ?? 0));
    }
    // Initial state advance payments linked to invoices
    const allInitialDetails = initialStateDetails ?? [];
    const anticiposDeClientes = allInitialDetails.filter((d: any) => d.field_type === "anticipos_de_clientes");
    for (const d of anticiposDeClientes) {
      if (d.invoice_id) {
        paymentsByInvoice.set(d.invoice_id, (paymentsByInvoice.get(d.invoice_id) || 0) + Math.abs(d.amount ?? 0));
      }
    }

    for (const inv of (invoices ?? [])) {
      if (inv.type !== "venta") continue;
      const total = inv.total_amount ?? 0;
      const paid = paymentsByInvoice.get(inv.id) || 0;
      
      // FIXED: Deduct retefuente (same logic as CFO insights)
      const savedRetefuente = inv.retefuente_cliente_amount ?? 0;
      const rawRate = inv.retefuente_cliente_rate;
      const hasExplicitRate = rawRate !== null && rawRate !== undefined;
      const effectiveRate = hasExplicitRate ? rawRate : 0.025;
      const retefuenteCliente = savedRetefuente > 0
        ? savedRetefuente
        : Math.round((inv.subtotal_base ?? 0) * effectiveRate);
      
      const totalDeducted = paid + retefuenteCliente;
      const saldo = Math.max(0, total - totalDeducted);
      
      if (saldo > 1000) {
        cuentasPorCobrar.push({
          cliente: inv.counterparty_name || inv.buyer_name || "Sin nombre",
          factura: inv.invoice_number,
          total, pagado: paid, saldo,
          fecha: inv.issue_date,
          vencimiento: inv.due_date,
        });
      }
    }
    cuentasPorCobrar.sort((a, b) => b.saldo - a.saldo);
    const totalPorCobrarFacturas = cuentasPorCobrar.reduce((s, c) => s + c.saldo, 0);
    // FIXED: Add initial CxC balance
    const initialCxC = initialState?.cuentas_por_cobrar ?? 0;
    const totalPorCobrar = totalPorCobrarFacturas + initialCxC;

    // --- Cuentas por Pagar (FIXED: deduct payments like CxC) ---
    const cuentasPorPagar: { proveedor: string; factura: string; total: number; pagado: number; saldo: number; fecha: string; vencimiento: string | null }[] = [];
    for (const inv of (invoices ?? [])) {
      if (inv.type !== "compra") continue;
      const total = inv.total_amount ?? 0;
      const paid = paymentsByInvoice.get(inv.id) || 0;
      const saldo = Math.max(0, total - paid);
      if (saldo > 1000) {
        cuentasPorPagar.push({
          proveedor: inv.counterparty_name || inv.seller_name || "Sin nombre",
          factura: inv.invoice_number,
          total, pagado: paid, saldo,
          fecha: inv.issue_date,
          vencimiento: inv.due_date,
        });
      }
    }
    cuentasPorPagar.sort((a, b) => b.saldo - a.saldo);
    const totalPorPagarFacturas = cuentasPorPagar.reduce((s, c) => s + c.saldo, 0);
    const initialCxP = initialState?.cuentas_por_pagar ?? 0;
    const totalPorPagar = totalPorPagarFacturas + initialCxP;

    // --- Anticipos (FIXED: same logic as AdvancesReport - category='ventas', resp!='otros', no invoice) ---
    const anticipos: { responsable: string; monto: number; fecha: string; descripcion: string }[] = [];
    let totalAnticiposTx = 0;
    const anticiposPorCliente: Record<string, number> = {};
    // NUEVO: agregación POR MES para que Nico AI pueda responder
    // "¿cuánto anticipo recibí en marzo?" — antes solo había totales del año.
    const anticiposPorMes: Record<string, { total: number; count: number; topCliente: string; topMonto: number }> = {};

    // Current year anticipos from transactions
    const yearTx = (transactions ?? []).filter((t: any) => {
      const d = new Date(t.date + "T00:00:00");
      return d.getFullYear() === thisYear;
    });

    for (const t of yearTx) {
      const credit = t.credit ?? 0;
      if (credit <= 0 || t.invoice_id) continue;
      if (!t.responsible_id) continue;

      const respName = respMap[t.responsible_id] ?? t.owner ?? "Sin responsable";
      // FIXED: Match AdvancesReport logic - filter by category "ventas" and exclude "otros"
      const catInfo = t.category_id ? catMap[t.category_id] : null;
      const catName = (catInfo?.name ?? t.category ?? "").toLowerCase();
      if (catName !== "ventas") continue;
      if (respName.toLowerCase() === "otros") continue;

      anticipos.push({
        responsable: respName,
        monto: credit,
        fecha: t.date,
        descripcion: t.description?.substring(0, 60) ?? "",
      });
      totalAnticiposTx += credit;
      anticiposPorCliente[respName] = (anticiposPorCliente[respName] ?? 0) + credit;

      // Agrupar por mes (YYYY-MM)
      const monthKey = t.date.slice(0, 7);
      const mb = anticiposPorMes[monthKey] ?? { total: 0, count: 0, topCliente: "", topMonto: 0 };
      mb.total += credit;
      mb.count += 1;
      if (credit > mb.topMonto) {
        mb.topMonto = credit;
        mb.topCliente = respName;
      }
      anticiposPorMes[monthKey] = mb;
    }

    // FIXED: Include initial state anticipos (unlinked ones from prior periods)
    const unlinkedInitialAnticipos = anticiposDeClientes.filter((d: any) => !d.invoice_id);
    const totalAnticiposInitial = unlinkedInitialAnticipos.reduce((s: number, d: any) => s + Math.abs(d.amount ?? 0), 0);
    for (const d of unlinkedInitialAnticipos) {
      const respName = d.responsible_name || "Sin responsable";
      anticiposPorCliente[respName] = (anticiposPorCliente[respName] ?? 0) + Math.abs(d.amount ?? 0);
    }

    const totalAnticipos = totalAnticiposTx + totalAnticiposInitial;
    const topAnticiposCliente = Object.entries(anticiposPorCliente)
      .sort((a, b) => b[1] - a[1]);

    // Anticipos del último mes con detalle (para que Nico tenga referencias específicas)
    const ultimoMesAnticiposKey = Object.keys(anticiposPorMes).sort().slice(-1)[0];
    const anticiposUltimoMes = ultimoMesAnticiposKey
      ? anticipos.filter(a => a.fecha.startsWith(ultimoMesAnticiposKey)).sort((a, b) => b.monto - a.monto).slice(0, 10)
      : [];

    // --- Inconsistencias fiscales ---
    const inconsistencias: string[] = [];

    // Facturas emitidas sin pago asociado (más de 60 días)
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const facturasViejasImpagas = cuentasPorCobrar.filter(c => c.fecha < sixtyDaysAgo);
    if (facturasViejasImpagas.length > 0) {
      inconsistencias.push(`Hay ${facturasViejasImpagas.length} factura(s) de venta con más de 60 días sin cobro total, por ${fmt(facturasViejasImpagas.reduce((s, c) => s + c.saldo, 0))}.`);
    }

    // Anticipos grandes sin facturar
    if (totalAnticipos > 0) {
      inconsistencias.push(`Hay ${fmt(totalAnticipos)} en anticipos recibidos sin factura asociada. Si no se facturan puede generar inconsistencias fiscales.`);
    }

    // IVA analysis
    const ivaNetoCuatrimestre = (() => {
      const cuatStart = thisMonth <= 4 ? 1 : thisMonth <= 8 ? 5 : 9;
      let ivaVentas = 0, ivaCompras = 0;
      for (let m = cuatStart; m <= thisMonth; m++) {
        const k = `${thisYear}-${String(m).padStart(2, "0")}`;
        const inv = invByMonth[k];
        if (inv) {
          ivaVentas += inv.ventas_iva;
          ivaCompras += inv.compras_iva;
        }
      }
      return { ivaVentas, ivaCompras, neto: ivaVentas - ivaCompras };
    })();

    // Saldo a favor from previous cuatrimestre
    const ivaSaldoFavorAnterior = (() => {
      const cuatStart = thisMonth <= 4 ? 1 : thisMonth <= 8 ? 5 : 9;
      let prevStart: number, prevEnd: number, prevYear: number;
      if (cuatStart === 1) { prevStart = 9; prevEnd = 12; prevYear = thisYear - 1; }
      else if (cuatStart === 5) { prevStart = 1; prevEnd = 4; prevYear = thisYear; }
      else { prevStart = 5; prevEnd = 8; prevYear = thisYear; }
      let ivaV = 0, ivaC = 0;
      for (let m = prevStart; m <= prevEnd; m++) {
        const k = `${prevYear}-${String(m).padStart(2, "0")}`;
        const inv = invByMonth[k];
        if (inv) { ivaV += inv.ventas_iva; ivaC += inv.compras_iva; }
      }
      const neto = ivaV - ivaC;
      return neto < 0 ? Math.abs(neto) : 0;
    })();

    const ivaNeto = ivaNetoCuatrimestre.neto - ivaSaldoFavorAnterior;

    if (ivaNetoCuatrimestre.neto > 5000000) {
      inconsistencias.push(`Tienes ${fmt(ivaNetoCuatrimestre.neto)} de IVA neto acumulado por pagar en este cuatrimestre. Conviene provisionar.`);
    }

    // Concentration risk
    const totalVentas = thisYearInv.ventas;
    if (topClientes.length > 0 && totalVentas > 0) {
      const topClientePercent = (topClientes[0][1] / totalVentas) * 100;
      if (topClientePercent > 60) {
        inconsistencias.push(`El ${topClientePercent.toFixed(0)}% de tu facturación depende de un solo cliente (${topClientes[0][0]}). Alta concentración de riesgo.`);
      }
    }

    // Facturación vs banco gap
    if (thisYearCash.ingresos > 0 && thisYearInv.ventas > 0) {
      const gap = thisYearInv.ventas - thisYearCash.ingresos;
      const gapPct = (gap / thisYearInv.ventas) * 100;
      if (Math.abs(gapPct) > 20) {
        if (gap > 0) {
          inconsistencias.push(`Hay una brecha del ${gapPct.toFixed(0)}% entre lo facturado (${fmt(thisYearInv.ventas)}) y lo recibido en banco (${fmt(thisYearCash.ingresos)}). Puede indicar cartera pendiente o facturas no cobradas.`);
        } else {
          inconsistencias.push(`Has recibido ${fmt(Math.abs(gap))} más en banco de lo que has facturado. Podrían ser anticipos sin facturar u otros ingresos no documentados.`);
        }
      }
    }

    // Facturas de compra vencidas
    const todayStr = now.toISOString().split("T")[0];
    const facturasVencidas = cuentasPorPagar.filter(c => c.vencimiento && c.vencimiento < todayStr);
    if (facturasVencidas.length > 0) {
      inconsistencias.push(`Hay ${facturasVencidas.length} factura(s) de compra vencida(s) sin pago completo, por ${fmt(facturasVencidas.reduce((s, c) => s + c.saldo, 0))}. Pueden generar intereses o problemas con proveedores.`);
    }

    // --- Extractos bancarios info ---
    const statementsInfo = (bankStatements ?? []).length > 0
      ? `Extractos cargados: ${(bankStatements ?? []).length}. Períodos: ${(bankStatements ?? []).map(s => `${s.display_name || s.file_name} (${s.statement_month ? monthNames[(s.statement_month ?? 1) - 1] : "?"} ${s.statement_year ?? "?"})`).slice(0, 6).join(", ")}${(bankStatements ?? []).length > 6 ? "..." : ""}`
      : "No hay extractos bancarios cargados.";

    // --- Financial Health Score (calculated inline, same logic as frontend) ---
    const _isNA = (notes: string | null) => Boolean(notes?.includes('[N/A]'));
    const _isAnticipo = (notes: string | null) => Boolean(notes?.includes('[Anticipo]'));
    const _clamp = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
    const _safePct = (part: number, total: number) => total <= 0 ? 0 : _clamp(part / total);
    const _linear = (pct: number) => Math.round(_clamp(pct) * 20 * 10) / 10;
    const _carteraLinear = (r: number) => Math.round(_clamp(1 - r) * 20 * 10) / 10;

    // Filter to current year transactions
    const yearTxAll = (transactions ?? []).filter((t: any) => new Date(t.date + "T00:00:00").getFullYear() === thisYear);

    // 1. Conciliación (amount-based)
    const totalMovimientos = yearTxAll.reduce((s: number, tx: any) => s + Math.abs(tx.amount ?? 0), 0);
    const montoPendiente = yearTxAll
      .filter((tx: any) => !tx.responsible_id && !tx.invoice_id && !_isNA(tx.notes) && !_isAnticipo(tx.notes))
      .reduce((s: number, tx: any) => s + Math.abs(tx.amount ?? 0), 0);
    const pctConciliado = totalMovimientos > 0 ? _clamp(1 - montoPendiente / totalMovimientos) : 0;
    const scoreConciliacion = totalMovimientos > 0 ? _linear(pctConciliado) : 0;

    // 2. Facturación soportada
    const yearSalesInvoices = (invoices ?? []).filter((inv: any) => inv.type === "venta" && new Date(inv.issue_date + "T00:00:00").getFullYear() === thisYear);
    const totalIngresosMonto = yearTxAll.filter((tx: any) => (tx.amount ?? 0) > 0).reduce((s: number, tx: any) => s + (tx.amount ?? 0), 0);
    const initialAnticiposClientes = initialState?.anticipos_de_clientes ?? 0;
    const facturacionVentasScore = yearSalesInvoices.reduce((s: number, inv: any) => s + (inv.total_amount ?? 0), 0);
    const baseFacturacionScore = totalIngresosMonto + initialAnticiposClientes;
    const saldoPorFacturarScore = Math.max(0, baseFacturacionScore - facturacionVentasScore);
    const pctSinFacturar = _safePct(saldoPorFacturarScore, baseFacturacionScore);
    const pctSoportado = _clamp(1 - pctSinFacturar);
    const scoreFacturacion = baseFacturacionScore > 0 ? _linear(pctSoportado) : 0;

    // 3. Control de Inventario (antes Impuestos) — descuadre Siigo vs físico en costo
    const activeInv = (inventoryProducts ?? []).filter((p: any) => p.active !== false);
    const totalValueSiigoScore = activeInv.reduce((s: number, p: any) => s + (p.stock_system ?? 0) * (p.cost_per_unit ?? 0), 0);
    const totalDifferenceValueScore = activeInv.reduce((s: number, p: any) => {
      if (p.stock_physical === null || p.stock_physical === undefined) return s;
      return s + Math.abs((p.stock_system ?? 0) - p.stock_physical) * (p.cost_per_unit ?? 0);
    }, 0);
    const ratioDescuadreInv = totalValueSiigoScore > 0 ? _clamp(totalDifferenceValueScore / totalValueSiigoScore) : 0;
    const pctInventarioScore = 1 - ratioDescuadreInv;
    const hasInventoryScoreData = activeInv.length > 0 && totalValueSiigoScore > 0;
    const scoreImpuestos = hasInventoryScoreData ? _linear(pctInventarioScore) : 0;

    // 4. Cartera y anticipos
    const facturacionTotalScore = yearSalesInvoices.reduce((s: number, inv: any) => s + (inv.total_amount ?? 0), 0);
    const cxcFacturasScore = yearSalesInvoices.reduce((s: number, inv: any) => {
      const paid = paymentsByInvoice.get(inv.id) || 0;
      const ret = inv.retefuente_cliente_amount ?? 0;
      return s + Math.max(0, (inv.total_amount ?? 0) - paid - ret);
    }, 0);
    const initialCxCScore = initialState?.cuentas_por_cobrar ?? 0;
    const cxcScore = cxcFacturasScore + initialCxCScore;
    const baseCarteraScore = facturacionTotalScore + initialCxCScore;
    const pctCarteraScore = _safePct(cxcScore, baseCarteraScore);
    const baseAnticiposScore = totalIngresosMonto + initialAnticiposClientes;
    const pctAnticiposScore = _safePct(totalAnticipos, baseAnticiposScore);
    const hasCarteraData = baseCarteraScore > 0 || baseAnticiposScore > 0;
    const riesgoTotal = hasCarteraData ? (pctCarteraScore + pctAnticiposScore) / 2 : 0;
    const scoreCartera = hasCarteraData ? _carteraLinear(riesgoTotal) : 0;

    // 5. Clasificación
    const completasScore = yearTxAll.filter((tx: any) => {
      const hasCat = Boolean(tx.category_id);
      const hasResp = Boolean(tx.responsible_id) || _isNA(tx.notes);
      const hasInv = Boolean(tx.invoice_id) || _isNA(tx.notes) || _isAnticipo(tx.notes);
      return hasCat && hasResp && (hasInv || hasResp);
    }).length;
    const pctClasificado = _safePct(completasScore, yearTxAll.length);
    const scoreClasificacion = yearTxAll.length > 0 ? _linear(pctClasificado) : 0;

    const scoreTotalCalc = Math.round((scoreConciliacion + scoreFacturacion + scoreImpuestos + scoreCartera + scoreClasificacion) * 10) / 10;

    const healthScoreCtx = `Score total: ${scoreTotalCalc}/100 (${monthNames[thisMonth - 1]} ${thisYear})
Conciliación: ${scoreConciliacion}/25, Facturación soportada: ${scoreFacturacion}/25, Control de Inventario: ${scoreImpuestos}/25 (descuadre Siigo vs físico en costo — ratio ${(ratioDescuadreInv * 100).toFixed(1)}%), Cartera y anticipos: ${scoreCartera}/25`;

    // =============================================
    // MODULE 8: INVENTARIO OPERATIVO
    // =============================================
    const rawProducts = inventoryProducts ?? [];
    const rawMovements = inventoryMovements ?? [];
    const hasInventory = rawProducts.length > 0;

    let inventoryCtx = "";
    if (hasInventory) {
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Enrich products with metrics
      const enriched = rawProducts.map((p: any) => {
        const prodMov = rawMovements.filter((m: any) => m.product_id === p.id);
        const recentSales = prodMov
          .filter((m: any) => m.movement_type === "salida" && new Date(m.movement_date) >= thirtyDaysAgo)
          .reduce((s: number, m: any) => s + Math.abs(m.quantity ?? 0), 0);
        const avgDailySales = recentSales / 30;
        const daysOfInventory = avgDailySales > 0 ? p.stock_system / avgDailySales : 999;
        const difference = p.stock_physical !== null ? p.stock_system - p.stock_physical : 0;
        const valueDiff = difference * p.cost_per_unit;
        const totalValue = p.stock_system * p.cost_per_unit;
        const status = avgDailySales <= 0 ? "exceso" : daysOfInventory < 15 ? "critico" : daysOfInventory <= 45 ? "alerta" : daysOfInventory <= 90 ? "sano" : "exceso";
        return { ...p, difference, valueDiff, totalValue, daysOfInventory: Math.round(daysOfInventory), avgDailySales, status };
      });

      const totalInventoryValue = enriched.reduce((s: number, p: any) => s + p.totalValue, 0);
      const totalDifferenceValue = enriched.reduce((s: number, p: any) => s + Math.abs(p.valueDiff), 0);
      const totalDifferenceUnits = enriched.reduce((s: number, p: any) => s + Math.abs(p.difference), 0);
      const pctDescuadre = totalInventoryValue > 0 ? (totalDifferenceValue / totalInventoryValue) * 100 : 0;
      const criticalProducts = enriched.filter((p: any) => p.status === "critico");
      const excessProducts = enriched.filter((p: any) => p.status === "exceso");
      const noMovement = enriched.filter((p: any) => p.avgDailySales === 0);
      const productsWithDiff = enriched.filter((p: any) => p.difference !== 0).sort((a: any, b: any) => Math.abs(b.valueDiff) - Math.abs(a.valueDiff));
      const positiveeDiff = productsWithDiff.filter((p: any) => p.difference > 0); // faltan en físico
      const negativeDiff = productsWithDiff.filter((p: any) => p.difference < 0); // sobran en físico

      const withSales = enriched.filter((p: any) => p.avgDailySales > 0);
      const avgDays = withSales.length > 0 ? withSales.reduce((s: number, p: any) => s + p.daysOfInventory, 0) / withSales.length : 0;

      inventoryCtx = `
═══════════════════════════════════════════
MÓDULO 8 — INVENTARIO OPERATIVO
Fuente: inventario contable (Siigo) + conteo físico (bodega). Permite detectar diferencias operativas.
IMPORTANTE: la "Diferencia en Costo" de abajo alimenta el factor "Control de Inventario" del Score de Visita DIAN (módulo 7, 20 puntos). Menor descuadre = mejor score.
═══════════════════════════════════════════

5 KPIs OFICIALES (los que ve el usuario en la página de Inventario):
1. Valor Total Inventario: ${fmt(totalInventoryValue)} (Σ unidades Siigo × costo unitario)
2. Días de Inventario (promedio): ${Math.round(avgDays)} días (ritmo de ventas últimos 30 días)
3. Sin Movimiento: ${noMovement.length > 0 && enriched.length > 0 ? Math.round((noMovement.length / enriched.length) * 100) : 0}% de referencias sin ventas en 30 días (capital detenido)
4. Diferencia Unidades: ${totalDifferenceUnits} uds (Σ |Siigo − físico|, señal de fuga o error de registro)
5. Diferencia en Costo: ${fmt(totalDifferenceValue)} (Σ |Siigo − físico| × costo; plata en riesgo — VARIABLE DEL SCORE)

RESUMEN GENERAL:
Total referencias activas: ${enriched.length}
Productos en estado crítico (< 15 días): ${criticalProducts.length}
Productos en exceso (sin rotación): ${excessProducts.length}
Productos sin movimiento (últimos 30 días): ${noMovement.length}
Capital inmovilizado (sin movimiento): ${fmt(noMovement.reduce((s: number, p: any) => s + p.totalValue, 0))}

ANÁLISIS DE DIFERENCIAS (Sistema vs Físico):
Productos con diferencia: ${productsWithDiff.length} de ${enriched.length}
Valor total de diferencias: ${fmt(totalDifferenceValue)}
% de descuadre (ratio = diff costo / valor total Siigo): ${pctDescuadre.toFixed(1)}%
Score Control de Inventario derivado: ${totalInventoryValue > 0 ? (Math.max(0, 25 * (1 - Math.min(1, totalDifferenceValue / totalInventoryValue)))).toFixed(1) : 0}/25 pts
${pctDescuadre > 5 ? "⚠ ALERTA: El descuadre supera el 5%. Esto puede indicar ventas sin factura, pérdidas, robos o errores de conteo, y penaliza el Score de Visita DIAN." : ""}

${positiveeDiff.length > 0 ? `FALTANTES EN BODEGA (sistema > físico — posible venta sin factura, robo, pérdida):
${positiveeDiff.slice(0, 5).map((p: any, i: number) => `${i + 1}. ${p.reference} (${p.name}): faltan ${Math.abs(p.difference)} uds → ${fmt(Math.abs(p.valueDiff))}`).join("\n")}` : ""}

${negativeDiff.length > 0 ? `EXCEDENTES EN BODEGA (físico > sistema — posible compra no registrada, error contable):
${negativeDiff.slice(0, 5).map((p: any, i: number) => `${i + 1}. ${p.reference} (${p.name}): sobran ${Math.abs(p.difference)} uds → ${fmt(Math.abs(p.valueDiff))}`).join("\n")}` : ""}

TOP PRODUCTOS POR VALOR:
${enriched.sort((a: any, b: any) => b.totalValue - a.totalValue).slice(0, 5).map((p: any, i: number) => `${i + 1}. ${p.reference} (${p.name}): ${p.stock_system} uds × ${fmt(p.cost_per_unit)} = ${fmt(p.totalValue)} | Estado: ${p.status} | Días inv: ${p.daysOfInventory}`).join("\n")}

PRODUCTOS CRÍTICOS (menos de 15 días de stock):
${criticalProducts.length > 0 ? criticalProducts.slice(0, 5).map((p: any, i: number) => `${i + 1}. ${p.reference} (${p.name}): ${p.stock_system} uds, ~${p.daysOfInventory} días de stock`).join("\n") : "Ninguno"}

INVENTARIO INMOVILIZADO (sin ventas en 30 días):
${noMovement.length > 0 ? `${noMovement.length} productos sin rotación. Capital detenido: ${fmt(noMovement.reduce((s: number, p: any) => s + p.totalValue, 0))}
${noMovement.slice(0, 5).map((p: any, i: number) => `${i + 1}. ${p.reference} (${p.name}): ${p.stock_system} uds × ${fmt(p.cost_per_unit)} = ${fmt(p.totalValue)}`).join("\n")}` : "Todos los productos tienen movimiento reciente."}

IMPACTO FINANCIERO DE DIFERENCIAS:
${totalDifferenceValue > 0 ? `La diferencia entre inventario contable y físico representa ${fmt(totalDifferenceValue)}, equivalente al ${pctDescuadre.toFixed(1)}% del valor total.
${pctDescuadre > 5 ? "Esto puede estar sobreestimando la utilidad real del negocio." : "El nivel de descuadre está dentro de parámetros aceptables."}` : "No se han detectado diferencias (no se ha cargado conteo físico o el inventario está alineado)."}
`;
    } else {
      inventoryCtx = `
═══════════════════════════════════════════
MÓDULO 8 — INVENTARIO OPERATIVO
═══════════════════════════════════════════

No hay productos de inventario registrados. Si el negocio maneja inventario, sugiere al usuario cargar su inventario contable desde Siigo y hacer un conteo físico para detectar diferencias operativas.
`;
    }

    // =============================================
    // BUILD FULL CONTEXT
    // =============================================
    const baseFinancialContext = `
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

${statementsInfo}

═══════════════════════════════════════════
MÓDULO 2 — FACTURACIÓN DIAN (Facturas electrónicas legales confirmadas)
Fuente: facturas de venta y compra CONFIRMADAS ante la DIAN.
IMPORTANTE: "Facturado" ≠ "Recibido en banco". Solo se incluyen facturas con status=confirmed.
═══════════════════════════════════════════

MES ACTUAL (${currentKey}):
${summarizeInvMonth(currentKey, currentInv)}

MES ANTERIOR (${lastMonthKey}):
${summarizeInvMonth(lastMonthKey, lastMonthInv)}

VARIACIÓN FACTURACIÓN (mes actual vs anterior):
Ventas facturadas: ${currentInv && lastMonthInv ? pct(currentInv.ventas_total, lastMonthInv.ventas_total) : "Sin datos"}
Compras facturadas: ${currentInv && lastMonthInv ? pct(currentInv.compras_total, lastMonthInv.compras_total) : "Sin datos"}

AÑO ${thisYear} ACUMULADO (facturación confirmada):
Ventas=${fmt(thisYearInv.ventas)} (${thisYearInv.ventas_count} facturas, Base=${fmt(thisYearInv.ventas_base)}), Compras=${fmt(thisYearInv.compras)} (${thisYearInv.compras_count} facturas, Base=${fmt(thisYearInv.compras_base)}), IVA ventas=${fmt(thisYearInv.iva_ventas)}, IVA compras=${fmt(thisYearInv.iva_compras)}, IVA neto=${fmt(thisYearInv.iva_ventas - thisYearInv.iva_compras)}, Autorretefuente=${fmt(thisYearInv.autoretefuente)}, ReteICA=${fmt(thisYearInv.reteica)}

AÑO ${thisYear - 1} ACUMULADO (facturación):
Ventas=${fmt(lastYearInv.ventas)} (${lastYearInv.ventas_count} facturas), Compras=${fmt(lastYearInv.compras)} (${lastYearInv.compras_count} facturas)

TOP 5 CLIENTES POR FACTURACIÓN:
${topClientes.map(([n, v], i) => `${i + 1}. ${n}: ${fmt(v)}`).join("\n") || "Sin datos"}

TOP 5 PROVEEDORES POR FACTURACIÓN:
${topProvInv.map(([n, v], i) => `${i + 1}. ${n}: ${fmt(v)}`).join("\n") || "Sin datos"}

HISTORIAL FACTURACIÓN (últimos 6 meses):
${Object.keys(invByMonth).sort().slice(-6).map(k => summarizeInvMonth(k, invByMonth[k])).join("\n") || "Sin historial de facturas"}

═══════════════════════════════════════════
MÓDULO 3 — CONFIGURACIÓN FISCAL
═══════════════════════════════════════════

${taxCtx}

IVA CUATRIMESTRE ACTUAL:
IVA generado (ventas): ${fmt(ivaNetoCuatrimestre.ivaVentas)}
IVA descontable (compras): ${fmt(ivaNetoCuatrimestre.ivaCompras)}
Saldo al corte del cuatrimestre actual (neto = compras - ventas): ${fmt(-ivaNetoCuatrimestre.neto)}
  → Si es positivo: saldo a favor (compras > ventas). Si es negativo: IVA por pagar (ventas > compras).
  → IMPORTANTE: Este saldo AL CORTE ya incluye TODA la facturación del periodo actual. NO restes nuevamente IVA ya facturado.
Saldo a favor ARRASTRADO del cuatrimestre anterior: ${fmt(ivaSaldoFavorAnterior)}
IVA neto a pagar (después de aplicar saldo arrastrado): ${fmt(ivaNeto)}
${ivaSaldoFavorAnterior > 0 ? `NOTA: El saldo arrastrado de ${fmt(ivaSaldoFavorAnterior)} proviene del cuatrimestre anterior donde las compras generaron más IVA descontable que el IVA de ventas.` : ""}

OBLIGACIONES PRÓXIMAS (con monto estimado cuando el negocio lo configuró):
${(() => {
  const obs = (businessObligations ?? []) as Array<{ id: string; tipo: string | null; nombre: string | null; monto_estimado: number | null; fecha: string; periodo: string | null }>;
  const todayIso = new Date().toISOString().split("T")[0];
  const upcoming = obs.filter(o => o.fecha >= todayIso).slice(0, 15);
  if (upcoming.length === 0) return "Sin obligaciones próximas registradas (el calendario DIAN se calcula desde el último dígito del NIT — los montos solo aparecen cuando el user los configura manualmente).";
  return upcoming.map((o, i) => {
    const monto = o.monto_estimado != null && o.monto_estimado > 0 ? fmt(o.monto_estimado) : "monto sin configurar";
    return `${i + 1}. ${o.fecha} — ${o.nombre ?? o.tipo ?? "Obligación"}${o.periodo ? ` (${o.periodo})` : ""}: ${monto}`;
  }).join("\n");
})()}

═══════════════════════════════════════════
MÓDULO 4 — CONCILIACIÓN Y CARTERA
═══════════════════════════════════════════

CONCILIACIÓN:
Transacciones con factura asociada: ${matchedTxCount} de ${totalTxCount} (${totalTxCount > 0 ? ((matchedTxCount / totalTxCount) * 100).toFixed(0) : 0}%)
Transacciones sin factura: ${unmatchedTxCount}

CUENTAS POR COBRAR (facturas de venta pendientes + saldo inicial):
Total por cobrar: ${fmt(totalPorCobrar)} (${cuentasPorCobrar.length} facturas pendientes${initialCxC > 0 ? ` + ${fmt(initialCxC)} saldo inicial` : ""})
NOTA: Se descuentan pagos directos, matches manuales, anticipos vinculados y retefuente del cliente (2.5% si no tiene tasa explícita).
${cuentasPorCobrar.slice(0, 8).map((c, i) => `${i + 1}. ${c.cliente} — Factura ${c.factura}: Saldo ${fmt(c.saldo)} (emitida ${c.fecha}${c.vencimiento ? `, vence ${c.vencimiento}` : ""})`).join("\n") || "Sin facturas pendientes de cobro"}

CUENTAS POR PAGAR (facturas de compra pendientes + saldo inicial):
Total por pagar: ${fmt(totalPorPagar)} (${cuentasPorPagar.length} facturas pendientes${initialCxP > 0 ? ` + ${fmt(initialCxP)} saldo inicial` : ""})
${cuentasPorPagar.slice(0, 8).map((c, i) => `${i + 1}. ${c.proveedor} — Factura ${c.factura}: Saldo ${fmt(c.saldo)} (emitida ${c.fecha}${c.vencimiento ? `, vence ${c.vencimiento}` : ""})`).join("\n") || "Sin facturas pendientes de pago"}

ANTICIPOS SIN FACTURAR (categoría "Ventas", con responsable, sin factura):
Total anticipos: ${fmt(totalAnticipos)} (${totalAnticiposTx > 0 ? `${fmt(totalAnticiposTx)} del año en curso` : ""}${totalAnticiposInitial > 0 ? `${totalAnticiposTx > 0 ? " + " : ""}${fmt(totalAnticiposInitial)} de periodos anteriores` : ""})
${anticipos.slice(0, 5).map((a, i) => `${i + 1}. ${a.responsable}: ${fmt(a.monto)} (${a.fecha}) — ${a.descripcion}`).join("\n") || "Sin anticipos del año en curso"}

ANTICIPOS POR MES (${thisYear}) — útil para responder "¿cuánto anticipo recibí en [mes]?":
${Object.keys(anticiposPorMes).sort().map(k => {
  const m = anticiposPorMes[k];
  return `${k}: ${fmt(m.total)} (${m.count} ${m.count === 1 ? 'anticipo' : 'anticipos'}, top: ${m.topCliente} ${fmt(m.topMonto)})`;
}).join("\n") || "Sin anticipos en el año en curso"}

ANTICIPOS ACUMULADOS POR CLIENTE:
${topAnticiposCliente.map(([name, amount], i) => `${i + 1}. ${name}: ${fmt(amount)}`).join("\n") || "Sin anticipos"}

DETALLE DE ANTICIPOS DEL ÚLTIMO MES (${ultimoMesAnticiposKey || "—"}) — para preguntas específicas tipo "¿quién me anticipó X?":
${anticiposUltimoMes.length > 0
  ? anticiposUltimoMes.map((a, i) => `${i + 1}. ${a.fecha} — ${a.responsable}: ${fmt(a.monto)} (ref: ${a.descripcion || 'sin descripción'})`).join("\n")
  : "Sin movimientos del último mes"}

ANTICIPOS DE PERIODOS ANTERIORES (saldo inicial, sin factura vinculada):
${unlinkedInitialAnticipos.length > 0
  ? unlinkedInitialAnticipos.slice(0, 10).map((d: any, i: number) => `${i + 1}. ${d.responsible_name || 'Sin nombre'}: ${fmt(Math.abs(d.amount ?? 0))}`).join("\n")
  : "Sin anticipos de periodos anteriores"}

═══════════════════════════════════════════
MÓDULO 5 — ALERTAS E INCONSISTENCIAS DETECTADAS
═══════════════════════════════════════════

${inconsistencias.length > 0 ? inconsistencias.map((inc, i) => `⚠ ${i + 1}. ${inc}`).join("\n") : "No se detectaron inconsistencias relevantes."}

═══════════════════════════════════════════
MÓDULO 6 — ESTADO INICIAL FINANCIERO (Saldos de apertura)
Fuente: saldos configurados por el empresario como punto de partida del negocio en AluminIA.
IMPORTANTE: Estos saldos representan la posición financiera ANTES de empezar a registrar movimientos. Deben sumarse a los cálculos acumulados.
═══════════════════════════════════════════

${initialState ? `Fecha de inicio: ${initialState.fecha_inicio}
Saldo en bancos: ${fmt(initialState.saldo_bancos ?? 0)}
Cuentas por cobrar: ${fmt(initialState.cuentas_por_cobrar ?? 0)}
Inventario: ${fmt(initialState.inventario ?? 0)}
Anticipos a proveedores: ${fmt(initialState.anticipos_a_proveedores ?? 0)}
Otros activos: ${fmt(initialState.otros_activos ?? 0)}
Cuentas por pagar: ${fmt(initialState.cuentas_por_pagar ?? 0)}
Anticipos de clientes: ${fmt(initialState.anticipos_de_clientes ?? 0)}
Impuestos por pagar: ${fmt(initialState.impuestos_por_pagar ?? 0)}
Préstamos: ${fmt(initialState.prestamos ?? 0)}
IVA a favor: ${fmt(initialState.iva_a_favor ?? 0)}
IVA por pagar: ${fmt(initialState.iva_por_pagar ?? 0)}
Retefuente por pagar: ${fmt(initialState.retefuente_por_pagar ?? 0)}
ICA por pagar: ${fmt(initialState.ica_por_pagar ?? 0)}` : "No se ha configurado el estado inicial financiero."}

${allInitialDetails.length > 0 ? `DESGLOSE POR RESPONSABLE:
${allInitialDetails.map((d: any) => `- ${d.field_type}: ${d.responsible_name} → ${fmt(d.amount ?? 0)}`).join("\n")}` : ""}

NOTA PARA ANÁLISIS: Cuando calcules posición de caja total, suma el saldo inicial de bancos + neto de transacciones. Para CxC y CxP totales, suma los saldos iniciales + los pendientes de facturas. Los anticipos de clientes iniciales son pasivos que deben facturarse.

═══════════════════════════════════════════
MÓDULO 7 — SALUD FINANCIERA (Score Visita DIAN)
═══════════════════════════════════════════

${healthScoreCtx}


${inventoryCtx}
`.trim();

    // Build business memory context OUTSIDE the template
    const memoryArr = businessMemory ?? [];
    let memoryCtx = "No se ha generado memoria del negocio aún.";
    if (memoryArr.length > 0) {
      const memMap: Record<string, any> = {};
      memoryArr.forEach((m: any) => { memMap[m.metric_key] = m.metric_value; });
      const general = memMap.general;
      const topCl = memMap.top_clients || [];
      const topProv = memMap.top_providers || [];
      const season = memMap.seasonality || [];
      const monthN2 = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
      
      let mc = "";
      if (general) {
        mc += "MÉTRICAS HISTÓRICAS:\n";
        mc += "Transacciones totales: " + general.total_transactions + "\n";
        mc += "Ingreso promedio: " + fmt(general.avg_ingreso) + "\n";
        mc += "Egreso promedio: " + fmt(general.avg_egreso) + "\n";
        mc += "Ingreso mensual promedio: " + fmt(general.avg_monthly_ingresos) + "\n";
        mc += "Egreso mensual promedio: " + fmt(general.avg_monthly_egresos) + "\n";
        mc += "Meses con datos: " + general.months_with_data + " (" + general.first_month + " a " + general.last_month + ")\n";
        mc += "Ciclo promedio de ingresos: cada " + general.avg_income_cycle_days + " días\n";
      }
      if (topCl.length > 0) {
        mc += "\nTOP CLIENTES HISTÓRICOS:\n";
        topCl.slice(0, 5).forEach((c: any, i: number) => { mc += (i + 1) + ". " + c.name + ": " + fmt(c.amount) + "\n"; });
      }
      if (topProv.length > 0) {
        mc += "\nTOP PROVEEDORES HISTÓRICOS:\n";
        topProv.slice(0, 5).forEach((p: any, i: number) => { mc += (i + 1) + ". " + p.name + ": " + fmt(p.amount) + "\n"; });
      }
      if (season.length > 0) {
        mc += "\nESTACIONALIDAD: " + season.map((s: any) => monthN2[s.month - 1] + ": " + fmt(s.avg_ingresos)).join(", ") + "\n";
      }
      memoryCtx = mc;
    }

    // Build patterns context
    const patternsArr = businessPatterns ?? [];
    let patternsCtx = "No se han detectado patrones aún.";
    if (patternsArr.length > 0) {
      const active = patternsArr.filter((p: any) => p.occurrences >= 3);
      const newP = patternsArr.filter((p: any) => p.occurrences >= 2 && p.occurrences < 3);
      let pc = "Patrones activos: " + active.length + " | Emergentes: " + newP.length + "\n";
      
      if (active.length > 0) {
        pc += "\nPATRONES CONFIRMADOS (3+ ocurrencias):\n";
        active.slice(0, 10).forEach((p: any, i: number) => {
          pc += (i + 1) + ". [" + p.pattern_type + "] " + p.description + " | " + fmt(p.amount_min) + "-" + fmt(p.amount_max) + " | Cada ~" + p.frequency_days + " días | " + p.occurrences + " occ | Confianza: " + Math.round(p.confidence * 100) + "%\n";
        });
      }
      if (newP.length > 0) {
        pc += "\nPATRONES EMERGENTES (2 ocurrencias):\n";
        newP.slice(0, 5).forEach((p: any, i: number) => {
          pc += (i + 1) + ". [" + p.pattern_type + "] " + p.description + " | " + fmt(p.amount_min) + "-" + fmt(p.amount_max) + "\n";
        });
      }
      
      const predsMem = memoryArr.find((m: any) => m.metric_key === "predictions");
      const predsVal = predsMem?.metric_value || [];
      if (Array.isArray(predsVal) && predsVal.length > 0) {
        pc += "\nPREDICCIONES:\n";
        predsVal.slice(0, 5).forEach((p: any, i: number) => {
          pc += "🔮 " + (i + 1) + ". " + p.description + ": ~" + fmt(p.estimated_amount) + " estimado para " + p.estimated_date + " (en " + p.days_until + " días)\n";
        });
      }
      
      pc += "\nREGLAS: Patrones confirmados = eventos normales. Egresos fuera de patrón = anomalías reales. Usa predicciones para anticipar caja.\n";
      patternsCtx = pc;
    }

    const userName = profile?.full_name || "";
    const companyName = profile?.company_name || "No registrada";

    // =============================================
    // MÓDULO 11 — BRECHA DIAN Y RENTABILIDAD DE FORMALIZAR
    // (Gerencial). Replicamos inline la lógica de src/lib/evasionGap.ts y
    // src/lib/evasionPenalties.ts. Si cambian las tasas, sincronizá.
    // =============================================
    const DIAN_RATES = {
      iva: 0.19,
      renta: 0.35,
      sancionInexactitud: 1.0,          // Art 648 ET
      interesMoratoriosAnual: 0.24,     // ~tasa usura − 2pp
      probAuditoria24m: { low: 0.05, mid: 0.25, high: 0.5 },
      umbralPenalAnualCOP: 4_270_000_000, // Art 434A CP (250 SMLMV aprox)
      uiafReporteCOP: 10_000_000,         // UIAF Res 14/2020
    } as const;

    const bankIncomeYear = (transactions ?? [])
      .filter((t: any) => {
        const d = t.date ?? "";
        const amt = Number(t.amount ?? 0);
        return amt > 0 && d >= yearStart && d <= yearEnd;
      })
      .reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0);

    const cashIncomeYear = ((cashMovements ?? []) as Array<{ amount: number | null; type: string; date: string }>)
      .filter((c) => c.type === "ingreso")
      .reduce((s, c) => s + (Number(c.amount) || 0), 0);

    const invoicedYear = (invoices ?? [])
      .filter((i: any) => {
        const d = i.issue_date ?? "";
        return d >= yearStart && d <= yearEnd;
      })
      .reduce((s: number, i: any) => s + (Number(i.total_amount) || 0), 0);

    // Fuente canónica: columna agregada en initial_financial_state (se escribe
    // siempre al guardar en Ajustes). Fallback a detalles si está en 0.
    const aggregatedAdvances = Number(initialState?.anticipos_de_clientes) || 0;
    const detailAdvances = ((initialStateDetails ?? []) as Array<{ field_type: string; amount: number | null; invoice_id: string | null }>)
      .filter((d) => d.field_type === "anticipos_de_clientes" && !d.invoice_id)
      .reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const previousPeriodAdvances = aggregatedAdvances > 0 ? aggregatedAdvances : detailAdvances;

    const evReal = bankIncomeYear + previousPeriodAdvances + cashIncomeYear;
    const evDian = Math.min(invoicedYear, evReal);
    const evGap = Math.max(0, evReal - evDian);
    const evGapPct = evReal > 0 ? evGap / evReal : 0;
    const evLevel: "low" | "mid" | "high" =
      evGapPct >= 0.35 ? "high" : evGapPct >= 0.15 ? "mid" : "low";

    // Proyección al 31-Dic del año actual (horizonte = año calendario completo).
    const periodMonthsYear = now.getFullYear() === thisYear ? Math.max(1, thisMonth) : 12;
    const horizonMonths = 12;
    const scaleYear = horizonMonths / periodMonthsYear;
    const gapProy = evGap * scaleYear;
    const cashProy = Math.min(evGap, cashIncomeYear) * scaleYear;
    const auditableProy = Math.max(0, gapProy - cashProy);
    const taxRate = DIAN_RATES.iva + DIAN_RATES.renta;
    const impuestoOmitidoTotal = gapProy * taxRate;
    const impuestoAuditable = auditableProy * taxRate;
    const sancion = impuestoAuditable * DIAN_RATES.sancionInexactitud;
    // Intereses moratorios promedio: tasa anual × (horizonte años / 2).
    const intereses = impuestoAuditable * DIAN_RATES.interesMoratoriosAnual * (horizonMonths / 12 / 2);
    const costoAuditoria = impuestoAuditable + sancion + intereses;
    const probAud = DIAN_RATES.probAuditoria24m[evLevel];
    const costoEsperado = costoAuditoria * probAud;
    const ahorroEvadir = impuestoOmitidoTotal;
    const valorEsperadoEvadir = ahorroEvadir - costoEsperado;
    // Anualizado = mismo valor porque horizonte = 12 meses.
    const impuestoAnualizado = impuestoOmitidoTotal * (12 / horizonMonths);
    const riesgoPenal = impuestoAnualizado >= DIAN_RATES.umbralPenalAnualCOP;
    const cashSobreUIAF = cashIncomeYear >= DIAN_RATES.uiafReporteCOP;
    const cashPctDelGap = evGap > 0 ? Math.min(1, cashIncomeYear / evGap) : 0;
    const auditablePctDelGap = evGap > 0 ? 1 - cashPctDelGap : 0;

    const evasionCtx = evReal <= 0
      ? "No hay datos suficientes para medir brecha (ingresos reales = 0)."
      : [
          `PERIODO: ${thisYear} (${periodMonthsYear} meses transcurridos)`,
          "",
          "INGRESOS REALES (Real = Extracto + Anticipos previos + Efectivo):",
          `- Extracto bancario: ${fmt(bankIncomeYear)}`,
          `- Anticipos periodos anteriores sin facturar: ${fmt(previousPeriodAdvances)}`,
          `- Efectivo (cash_movements ingreso): ${fmt(cashIncomeYear)}`,
          `- TOTAL REAL: ${fmt(evReal)}`,
          "",
          "FACTURADO ANTE DIAN:",
          `- Facturas emitidas (venta, confirmed): ${fmt(invoicedYear)}`,
          "",
          "BRECHA:",
          `- Sin facturar (Real − DIAN): ${fmt(evGap)}`,
          `- % del total sin facturar: ${(evGapPct * 100).toFixed(1)}%`,
          `- Nivel: ${evLevel.toUpperCase()} (umbrales: low <15%, mid 15-35%, high ≥35%)`,
          "",
          "COMPOSICIÓN DEL GAP:",
          `- % del gap que es efectivo (no auditable por cruces DIAN): ${(cashPctDelGap * 100).toFixed(1)}%`,
          `- % del gap que es auditable (banco + anticipos): ${(auditablePctDelGap * 100).toFixed(1)}%`,
          `- Flag UIAF (efectivo año ≥ $10M): ${cashSobreUIAF ? "SÍ" : "no"}`,
          "",
          `PROYECCIÓN AL 31-DIC-${thisYear} (horizonte = año calendario completo, ritmo actual):`,
          `- Gap proyectado al 31-Dic: ${fmt(gapProy)}`,
          `- Proyección auditable al 31-Dic: ${fmt(auditableProy)}`,
          `- Proyección efectivo al 31-Dic: ${fmt(cashProy)}`,
          "",
          "SI LA DIAN AUDITA (sobre parte auditable):",
          `- Impuesto omitido auditable (IVA ${(DIAN_RATES.iva*100).toFixed(0)}% + Renta ${(DIAN_RATES.renta*100).toFixed(0)}%): ${fmt(impuestoAuditable)}`,
          `- Sanción por inexactitud 100% (Art 648 ET): ${fmt(sancion)}`,
          `- Intereses moratorios (~${(DIAN_RATES.interesMoratoriosAnual*100).toFixed(0)}% EA, horizonte ${horizonMonths} meses): ${fmt(intereses)}`,
          `- COSTO TOTAL si audita: ${fmt(costoAuditoria)}`,
          `- Probabilidad auditoría (nivel ${evLevel}, horizonte ${horizonMonths}m): ${(probAud*100).toFixed(0)}%`,
          `- Costo esperado = costo × prob: ${fmt(costoEsperado)}`,
          "",
          "VALOR ESPERADO DE EVADIR:",
          `- Ahorro tributario total (sobre gap completo): ${fmt(ahorroEvadir)}`,
          `- Valor esperado evadir = ahorro − costo esperado: ${fmt(valorEsperadoEvadir)}`,
          `  ${valorEsperadoEvadir >= 0 ? "⚠️ Aparenta positivo (usualmente porque el gap es mayormente efectivo). Ver ENEMIGOS DEL EFECTIVO abajo." : "✅ Formalizar gana en valor esperado."}`,
          "",
          `RIESGO PENAL (Art 434A CP): ${riesgoPenal ? `SÍ — impuesto anualizado ${fmt(impuestoAnualizado)} supera umbral ${fmt(DIAN_RATES.umbralPenalAnualCOP)} (250 SMLMV/año ⇒ 48-108 meses prisión).` : "no — impuesto anualizado bajo el umbral penal."}`,
          "",
          "ENEMIGOS DEL EFECTIVO (aunque no haya cruce directo, la DIAN lo detecta por):",
          "1. Consignación en cuenta propia/familiar (entra a cruce).",
          "2. Denuncia de ex-socios, empleados, competidores.",
          "3. Cruce patrimonial (Art 236 ET): estilo de vida vs patrimonio declarado.",
          "4. Reporte UIAF obligatorio ≥ $10M en efectivo.",
          "5. Robo, pérdida o incendio del efectivo sin respaldo.",
          "6. Cliente corporativo exige factura — perdés contratos grandes.",
          "7. Sin estados formales, no accedés a crédito formal.",
        ].join("\n");

    // =============================================
    // MÓDULO 12 — CARTERA OPERATIVA (Gerencial, admin only)
    // Resume el estado de Cartera Operativa para que Nico Gerencial pueda
    // responder sobre saldos por cliente y pagos por cazar.
    // =============================================
    const lookback90 = new Date();
    lookback90.setDate(lookback90.getDate() - 90);
    const lookback90Iso = lookback90.toISOString().slice(0, 10);

    const [
      operativeDebtsRes,
      operativeBankAssignedRes,
      operativeCashAssignedRes,
      operativePendingPaymentsRes,
      operativeResponsiblesRes,
    ] = await Promise.all([
      supabase
        .from("operative_receivables")
        .select("responsible_id, amount")
        .eq("user_id", user.id),
      supabase
        .from("transactions")
        .select("operative_responsible_id, credit")
        .eq("user_id", user.id)
        .eq("operative_receivable_assigned", true)
        .is("deleted_at", null),
      supabase
        .from("cash_movements")
        .select("responsible_id, amount")
        .eq("user_id", user.id)
        .eq("type", "ingreso")
        .not("responsible_id", "is", null),
      supabase
        .from("transactions")
        .select("id, date, description, credit")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .is("responsible_id", null)
        .eq("operative_receivable_assigned", false)
        .gt("credit", 0)
        .gte("date", lookback90Iso)
        .order("date", { ascending: false })
        .limit(20),
      supabase
        .from("responsibles")
        .select("id, name")
        .eq("user_id", user.id),
    ]);

    const opNamesById = new Map<string, string>();
    for (const r of operativeResponsiblesRes.data ?? []) opNamesById.set(r.id, r.name);

    type OpRow = { name: string; deuda: number; pagado: number; saldo: number };
    const opAcc = new Map<string, OpRow>();
    const opGet = (id: string): OpRow => {
      let row = opAcc.get(id);
      if (!row) {
        row = { name: opNamesById.get(id) ?? "(Sin nombre)", deuda: 0, pagado: 0, saldo: 0 };
        opAcc.set(id, row);
      }
      return row;
    };
    for (const d of operativeDebtsRes.data ?? []) {
      if (!d.responsible_id) continue;
      opGet(d.responsible_id).deuda += Number(d.amount) || 0;
    }
    for (const b of (operativeBankAssignedRes.data ?? []) as Array<{ operative_responsible_id: string | null; credit: number | null }>) {
      if (!b.operative_responsible_id) continue;
      opGet(b.operative_responsible_id).pagado += Number(b.credit) || 0;
    }
    for (const c of operativeCashAssignedRes.data ?? []) {
      if (!c.responsible_id) continue;
      opGet(c.responsible_id).pagado += Number(c.amount) || 0;
    }
    const opRows = Array.from(opAcc.values()).map((r) => ({ ...r, saldo: r.deuda - r.pagado }));

    const opTotalDeudas = opRows.reduce((s, r) => s + r.deuda, 0);
    const opTotalPagado = opRows.reduce((s, r) => s + r.pagado, 0);
    const opSaldoPendiente = opRows.filter((r) => r.saldo > 0).reduce((s, r) => s + r.saldo, 0);
    const opSaldoAFavor = opRows.filter((r) => r.saldo < 0).reduce((s, r) => s + Math.abs(r.saldo), 0);
    const opTopDeudores = opRows
      .filter((r) => r.saldo > 0)
      .sort((a, b) => b.saldo - a.saldo)
      .slice(0, 5);

    const opPendingPayments = (operativePendingPaymentsRes.data ?? []) as Array<{
      id: string;
      date: string;
      description: string | null;
      credit: number | null;
    }>;
    const opPendingTotal = opPendingPayments.reduce((s, p) => s + (Number(p.credit) || 0), 0);

    // =============================================
    // MÓDULO 13 — CAJA MENOR Y GASTOS DEDUCIBLES (Modo DIAN)
    // Egresos en efectivo + cuentas de cobro de servicios ocasionales,
    // con clasificacion deducible/no deducible heredada de categories.
    // =============================================
    const yearStartIso = `${thisYear}-01-01`;
    const yearEndIso = `${thisYear}-12-31`;
    const monthStart = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    })();

    const [pettyMovYearRes, categoriesRes, pettyResponsiblesRes] = await Promise.all([
      supabase
        .from("petty_cash_movements")
        .select("date, amount, category_id, kind, responsible_id, numero_consecutivo")
        .eq("user_id", user.id)
        .gte("date", yearStartIso)
        .lte("date", yearEndIso),
      supabase
        .from("categories")
        .select("id, name, is_tax_deductible")
        .eq("user_id", user.id),
      supabase
        .from("responsibles")
        .select("id, name")
        .eq("user_id", user.id),
    ]);

    const pcCatMap = new Map<string, { name: string; deductible: boolean }>();
    for (const c of (categoriesRes.data ?? []) as Array<{ id: string; name: string; is_tax_deductible: boolean }>) {
      pcCatMap.set(c.id, { name: c.name, deductible: !!c.is_tax_deductible });
    }
    const pcRespMap = new Map<string, string>();
    for (const r of (pettyResponsiblesRes.data ?? []) as Array<{ id: string; name: string }>) {
      pcRespMap.set(r.id, r.name);
    }

    type PcMov = {
      date: string;
      amount: number | null;
      category_id: string | null;
      kind: string | null;
      responsible_id: string | null;
      numero_consecutivo: string | null;
    };
    const pcMovs = ((pettyMovYearRes.data ?? []) as PcMov[]).map((m) => ({
      ...m,
      amountNum: Number(m.amount) || 0,
      cat: m.category_id ? pcCatMap.get(m.category_id) : undefined,
    }));

    const pcTotalAno = pcMovs.reduce((s, m) => s + m.amountNum, 0);
    const pcTotalDeducibleAno = pcMovs.filter((m) => m.cat?.deductible).reduce((s, m) => s + m.amountNum, 0);
    const pcTotalNoDeducibleAno = pcTotalAno - pcTotalDeducibleAno;
    const pcMesActual = pcMovs.filter((m) => m.date >= monthStart);
    const pcTotalMes = pcMesActual.reduce((s, m) => s + m.amountNum, 0);
    const pcTotalDeducibleMes = pcMesActual.filter((m) => m.cat?.deductible).reduce((s, m) => s + m.amountNum, 0);
    const pcCuentasCobroCount = pcMovs.filter((m) => m.kind === "cuenta_de_cobro").length;
    const pcCuentasCobroMonto = pcMovs.filter((m) => m.kind === "cuenta_de_cobro").reduce((s, m) => s + m.amountNum, 0);
    const pcComprobantesCount = pcMovs.filter((m) => m.kind === "gasto_efectivo").length;

    // Top categorias por gasto en el año
    const pcCatTotals = new Map<string, { name: string; deductible: boolean; total: number }>();
    for (const m of pcMovs) {
      const key = m.category_id ?? "__sin__";
      const name = m.cat?.name ?? "Sin categoria";
      const deductible = m.cat?.deductible ?? false;
      const cur = pcCatTotals.get(key) ?? { name, deductible, total: 0 };
      cur.total += m.amountNum;
      pcCatTotals.set(key, cur);
    }
    const pcTopCats = Array.from(pcCatTotals.values()).sort((a, b) => b.total - a.total).slice(0, 5);

    // Top prestadores
    const pcRespTotals = new Map<string, number>();
    for (const m of pcMovs) {
      if (!m.responsible_id) continue;
      pcRespTotals.set(m.responsible_id, (pcRespTotals.get(m.responsible_id) ?? 0) + m.amountNum);
    }
    const pcTopResps = Array.from(pcRespTotals.entries())
      .map(([id, total]) => ({ name: pcRespMap.get(id) ?? "(sin nombre)", total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    const cajaMenorCtx = pcMovs.length === 0
      ? "No hay movimientos en Caja Menor todavia. El usuario puede registrar gastos en /caja-menor (Modo DIAN)."
      : [
          `PERIODO: ${thisYear}`,
          "",
          "RESUMEN ANUAL:",
          `- Total gastos Caja Menor ${thisYear}: ${fmt(pcTotalAno)} (${pcMovs.length} movimientos)`,
          `- Deducible DIAN: ${fmt(pcTotalDeducibleAno)} (${pcTotalAno > 0 ? Math.round(pcTotalDeducibleAno / pcTotalAno * 100) : 0}%)`,
          `- No deducible: ${fmt(pcTotalNoDeducibleAno)} (${pcTotalAno > 0 ? Math.round(pcTotalNoDeducibleAno / pcTotalAno * 100) : 0}%)`,
          "",
          "MES EN CURSO:",
          `- Total gastos: ${fmt(pcTotalMes)} (${pcMesActual.length} movimientos)`,
          `- Deducible: ${fmt(pcTotalDeducibleMes)}`,
          "",
          "DOCUMENTOS GENERADOS:",
          `- Cuentas de cobro registradas: ${pcCuentasCobroCount} por ${fmt(pcCuentasCobroMonto)} (servicios ocasionales: coteros, instaladores, contratistas esporadicos)`,
          `- Gastos en efectivo (comprobantes de pago): ${pcComprobantesCount}`,
          "",
          pcTopCats.length > 0 ? "TOP CATEGORIAS DE GASTO:" : "",
          ...pcTopCats.map((c, i) => `${i + 1}. ${c.name} (${c.deductible ? "deducible" : "NO deducible"}): ${fmt(c.total)}`),
          "",
          pcTopResps.length > 0 ? "TOP PRESTADORES (por monto pagado):" : "",
          ...pcTopResps.map((r, i) => `${i + 1}. ${r.name}: ${fmt(r.total)}`),
        ].filter((l) => l !== "").join("\n");

    const carteraOperativaCtx = (opTotalDeudas === 0 && opPendingPayments.length === 0)
      ? "No hay cartera operativa registrada todavia. El admin puede registrar deudas en /reportes/cartera-operativa o asignar pagos bancarios pendientes a clientes."
      : [
          "RESUMEN GLOBAL:",
          `- Deudas registradas (manual): ${fmt(opTotalDeudas)}`,
          `- Pagado a operativa (banco asignado + efectivo de cliente): ${fmt(opTotalPagado)}`,
          `- Saldo pendiente (clientes que aún deben): ${fmt(opSaldoPendiente)}`,
          opSaldoAFavor > 0 ? `- Saldo a favor (clientes que pagaron de más): ${fmt(opSaldoAFavor)}` : "",
          "",
          opTopDeudores.length > 0 ? "TOP CLIENTES CON SALDO PENDIENTE:" : "Ningún cliente con saldo pendiente.",
          ...opTopDeudores.map((r, i) => `${i + 1}. ${r.name}: deuda ${fmt(r.deuda)} − pagado ${fmt(r.pagado)} = saldo ${fmt(r.saldo)}`),
          "",
          `PAGOS BANCARIOS PENDIENTES DE ASIGNAR (últimos 90 días, sin beneficiario DIAN ni operativa): ${opPendingPayments.length} pagos por ${fmt(opPendingTotal)}`,
          ...opPendingPayments.slice(0, 8).map((p) => `- ${p.date}: ${(p.description ?? "").slice(0, 60)} → ${fmt(Number(p.credit) || 0)}`),
          opPendingPayments.length > 8 ? `(${opPendingPayments.length - 8} pagos más)` : "",
        ].filter(Boolean).join("\n");

    const financialContext = baseFinancialContext
      + "\n\n═══════════════════════════════════════════\nMÓDULO 9 — MEMORIA DEL NEGOCIO\n═══════════════════════════════════════════\n\n" + memoryCtx
      + "\n\n═══════════════════════════════════════════\nMÓDULO 10 — PATRONES DETECTADOS\n═══════════════════════════════════════════\n\n" + patternsCtx
      + "\n\n═══════════════════════════════════════════\nMÓDULO 11 — BRECHA DIAN Y RENTABILIDAD DE FORMALIZAR\n═══════════════════════════════════════════\n\n" + evasionCtx
      + "\n\n═══════════════════════════════════════════\nMÓDULO 12 — CARTERA OPERATIVA (Gerencial, admin only)\n═══════════════════════════════════════════\n\n" + carteraOperativaCtx
      + "\n\n═══════════════════════════════════════════\nMÓDULO 13 — CAJA MENOR Y GASTOS DEDUCIBLES (Modo DIAN)\n═══════════════════════════════════════════\n\n" + cajaMenorCtx
      + "\n\n═══════════════════════════════════════════\nINFORMACIÓN DEL NEGOCIO\n═══════════════════════════════════════════\n"
      + "Empresa: " + companyName + "\n"
      + "Contacto: " + (userName || "No registrado");

    // =============================================
    // AGENT PERSONAS
    // =============================================
    const empresa = companyName !== "No registrada" ? companyName : "este negocio";
    const agentPersonas: Record<AgentKey, { role: string; focus: string; modules: string }> = {
      cfo: {
        role: `Eres Nico, el CFO de mano derecha de ${empresa}. Integras TODOS los módulos: caja, facturación, impuestos, cartera, inventario, patrones y salud fiscal. Eres el asesor global que toma la foto completa del negocio.`,
        focus: "Vista integral del estado ACTUAL del negocio. Conecta puntos entre módulos. Cuando algo no cuadre entre módulos, alértalo.",
        modules: "TODOS (1-10). Usas todos los módulos según lo que pregunten.",
      },
      contador: {
        role: `Eres Nico Contador, el asesor contable y fiscal de ${empresa}. Tu foco único es la parte tributaria: facturación DIAN, IVA, retefuente, ReteICA, autorretefuente, calendario tributario colombiano y soporte de gastos deducibles.`,
        focus: "Impuestos. Saldo a favor. Retenciones. Fechas DIAN. Optimización fiscal dentro de la ley. Caja Menor (MÓDULO 13): gastos en efectivo y cuentas de cobro de servicios ocasionales — diferenciá deducible vs no deducible según categoría, sugerí mejoras al usuario cuando una categoría con muchos movimientos no está marcada deducible y sí podría serlo. Cuentas de cobro: solo aplican a servicios ocasionales (coteros, instaladores, contratistas esporádicos), NO a proveedores formales obligados a facturar electrónicamente. Evita comentar caja general, inventario o estrategia — eso no es tu área; si preguntan, remite al agente correspondiente.",
        modules: "MÓDULO 2 (Facturación DIAN), MÓDULO 3 (Obligaciones Fiscales) y MÓDULO 13 (Caja Menor / Gastos Deducibles) son tu base. También consultas MÓDULO 5 (alertas fiscales).",
      },
      visita_dian: {
        role: `Eres Nico Visita DIAN, el auditor interno de ${empresa}. Piensas como un funcionario DIAN revisando la empresa. Tu trabajo es detectar inconsistencias ANTES de que la DIAN lo haga y prevenir sanciones.`,
        focus: "Score de salud fiscal (4 factores × 25 pts: conciliación, facturación soportada, Control de Inventario — descuadre Siigo vs físico en costo —, cartera/anticipos). Inconsistencias entre facturación y banco. Descuadre de inventario como señal fiscal (posibles ventas sin factura). Caja Menor (MÓDULO 13): cuentas de cobro y comprobantes de pago como soporte de gastos. Si el ratio deducible/no-deducible es muy bajo, hay riesgo de pérdida fiscal innecesaria. Si hay muchas cuentas de cobro a un mismo prestador, sugiere que probablemente debería formalizarse como proveedor con factura. Riesgos de sanción. Cómo subir el score.",
        modules: "MÓDULO 5 (Alertas), MÓDULO 7 (Salud/Score), MÓDULO 3 (Obligaciones Fiscales), MÓDULO 8 (Inventario), MÓDULO 13 (Caja Menor — soporte de gastos deducibles).",
      },
      tesoreria: {
        role: `Eres Nico Tesorería, el encargado de caja y cobranza de ${empresa}. Te preocupa la plata que entra, la que sale y la que falta por cobrar o pagar.`,
        focus: "Flujo de caja. Cuentas por cobrar y por pagar. Anticipos sin facturar. Conciliación banco-factura. Quién debe plata y cuándo.",
        modules: "MÓDULO 1 (Flujo de caja), MÓDULO 4 (Conciliación y cartera), MÓDULO 6 (Estado inicial). No hagas análisis fiscal ni estratégico.",
      },
      inventario: {
        role: `Eres Nico Inventario, el encargado operativo de stock de ${empresa}. Comparas lo contable (Siigo) contra lo físico (bodega) y detectas fugas, excedentes y capital inmovilizado.`,
        focus: "KPIs de inventario: Valor Total Siigo, Días de Inventario, % Sin Movimiento, Diferencia en Unidades (Σ|Siigo−físico|) y Diferencia en Costo (Σ|Siigo−físico|·costo). Diferencias Siigo vs físico. Fugas operativas (robos, ventas sin factura). Productos críticos. Capital detenido. Impacto de los descuadres en la utilidad real Y en el Score de Visita DIAN: la Diferencia en Costo sobre el valor total alimenta el factor 'Control de Inventario' (20 pts).",
        modules: "MÓDULO 8 (Inventario operativo) es tu base. También MÓDULO 7 (Salud/Score) porque la diferencia en costo es una de sus 5 variables.",
      },
      estrategia: {
        role: `Eres Nico Estrategia, el asesor de decisiones grandes de ${empresa}. Miras el futuro, no el presente.`,
        focus: "Decisiones importantes: en qué invertir, cuándo contratar, cuándo expandir, cuándo apretar gastos. Escenarios 'qué pasaría si'. Proyecciones y predicciones basadas en patrones históricos.",
        modules: "MÓDULO 9 (Memoria del negocio) y MÓDULO 10 (Patrones y predicciones) son tu base. También usas MÓDULO 1 y 2 para contexto histórico.",
      },
      gerencial: {
        role: `Eres Nico Gerencial, el consejero directo del dueño de ${empresa} para las preguntas que realmente importan: ¿quién me debe en la realidad? ¿qué pagos están sueltos? ¿vale la pena formalizar este efectivo? Tu trabajo es poner números fríos a la brecha entre lo real y lo facturado, y ayudar al dueño a manejar Cartera Operativa (deudas y cobros que no necesariamente pasan por DIAN) con visión completa. Hablás como un asesor que está del mismo lado del empresario y que quiere que duerma tranquilo.`,
        focus: "Cartera Operativa (MÓDULO 12): saldos por cliente sumando deudas registradas + pagos en efectivo + pagos bancarios asignados. Cuando preguntan '¿quién me debe?', '¿cuánto me deben en realidad?', '¿qué pagos tengo sueltos?' o '¿cómo va el cobro de X cliente?' tu respuesta sale de ahí. Pagos bancarios pendientes de asignar (últimos 90d) son oportunidades para cazar dueño — sugerí asignarlos a clientes conocidos cuando el monto/fecha lo haga obvio. Brecha DIAN (MÓDULO 11) y rentabilidad de formalizar: efectivo no auditable por cruces estándar pero tiene 7 enemigos (UIAF, denuncias, cruce patrimonial, consignaciones, robo, clientes corporativos, crédito). Compará ahorro aparente vs costo esperado (sanción 100% Art 648 ET + intereses 24% + prob auditoría). Riesgo penal Art 434A CP si impuesto omitido anual > 250 SMLMV. Empujá al simulador en /visita-dian#rentabilidad y a /reportes/cartera-operativa para gestionar saldos. No moralices: hablá de plata y riesgo.",
        modules: "MÓDULO 11 (Brecha DIAN) y MÓDULO 12 (Cartera Operativa) son tus bases. Usás MÓDULO 1 (caja) y MÓDULO 2 (facturación) para contexto. Si preguntan por score fiscal, remití a Nico Visita DIAN.",
      },
    };
    const persona = agentPersonas[agent_key];

    const memoryBlock = memorySummary || memoryFacts.length > 0
      ? `\n\n═══════════════════════════════════════════\nMEMORIA DEL AGENTE (conversaciones previas)\n═══════════════════════════════════════════\n${memorySummary}${memoryFacts.length > 0 ? `\n\nHECHOS APRENDIDOS:\n${(memoryFacts as Array<string | { text?: string }>).slice(0, 20).map((f, i) => `${i + 1}. ${typeof f === "string" ? f : (f?.text ?? JSON.stringify(f))}`).join("\n")}` : ""}`
      : "";

    // =============================================
    // CONTEXTO MACRO (datos públicos en tiempo real)
    // =============================================
    // Conectados a Superfinanciera (TRM), BanRep (DTF) y World Bank/Trading
    // Economics (IPC) vía Firecrawl + APIs públicas. Pendientes: IBR, PIB.
    const fmtNum = (n: number) =>
      new Intl.NumberFormat("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    const buildIndicatorLine = (type: string) => {
      const sorted = macroRows
        .filter(r => r.indicator_type === type)
        .sort((a, b) => b.period_date.localeCompare(a.period_date));
      const hoy = sorted[0];
      const ayer = sorted[1];
      if (!hoy) return null;
      const delta = ayer ? hoy.value - ayer.value : 0;
      const deltaPct = ayer && ayer.value > 0 ? (delta / ayer.value) * 100 : 0;
      const unit = (hoy.unit ?? "").trim();
      const isPct = unit.includes("%");
      const isUsdTon = unit === "USD/ton";
      const isCnyTon = unit === "CNY/ton";
      const isTon = isUsdTon || isCnyTon;
      const valStr = isPct
        ? `${fmtNum(hoy.value)}%`
        : isUsdTon
          ? `US$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(hoy.value))} /ton`
          : isCnyTon
            ? `¥${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(hoy.value))} /ton`
            : `$${fmtNum(hoy.value)} COP/USD`;
      const deltaTxt = ayer
        ? isPct
          ? ` (${delta >= 0 ? "+" : ""}${fmtNum(delta)}pp vs publicación anterior)`
          : ` (${delta >= 0 ? "+" : ""}${isTon ? Math.round(delta) : fmtNum(delta)} vs anterior, ${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(2)}%)`
        : "";
      return { hoy, valStr, deltaTxt };
    };

    const trmInfo = buildIndicatorLine("trm");
    const dtfInfo = buildIndicatorLine("dtf");
    const ipcInfo = buildIndicatorLine("ipc_total");
    const aluInfo = buildIndicatorLine("aluminio_lme");

    // Resumen histórico por indicador: cambio 7d/30d/90d, max/min/promedio 90d,
    // tendencia (alcista/bajista/lateral). Le da a Nico contexto suficiente para
    // recomendar "compra hoy" o "espera" sobre TRM/aluminio LME.
    const buildHistorySummary = (type: string, label: string, unit: "ton" | "cop" | "pct") => {
      const series = macroRows
        .filter(r => r.indicator_type === type)
        .sort((a, b) => b.period_date.localeCompare(a.period_date));
      if (series.length < 2) return null;
      const last = series[0];
      const lastDate = new Date(last.period_date + "T00:00:00").getTime();
      const findClosest = (daysBack: number) => {
        const targetTs = lastDate - daysBack * 24 * 60 * 60 * 1000;
        let best: typeof series[0] | null = null;
        let bestDiff = Infinity;
        for (const r of series) {
          const ts = new Date(r.period_date + "T00:00:00").getTime();
          const diff = Math.abs(ts - targetTs);
          if (diff < bestDiff) { bestDiff = diff; best = r; }
        }
        return best;
      };
      const fmtVal = (v: number) =>
        unit === "ton"
          ? `US$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(v))}/ton`
          : unit === "pct"
            ? `${fmtNum(v)}%`
            : `$${fmtNum(v)}`;
      const pctChange = (curr: number, prev: number) =>
        prev === 0 ? 0 : ((curr - prev) / prev) * 100;
      const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

      const ago7 = findClosest(7);
      const ago30 = findClosest(30);
      const ago90 = findClosest(90);
      const ch7 = ago7 && ago7 !== last ? pctChange(last.value, ago7.value) : null;
      const ch30 = ago30 && ago30 !== last ? pctChange(last.value, ago30.value) : null;
      const ch90 = ago90 && ago90 !== last ? pctChange(last.value, ago90.value) : null;

      // Stats últimos 90 días
      const cutoff90 = lastDate - 90 * 24 * 60 * 60 * 1000;
      const last90 = series.filter(r => new Date(r.period_date + "T00:00:00").getTime() >= cutoff90);
      const vals90 = last90.map(r => r.value);
      const max90 = vals90.length ? Math.max(...vals90) : last.value;
      const min90 = vals90.length ? Math.min(...vals90) : last.value;
      const avg90 = vals90.length ? vals90.reduce((s, v) => s + v, 0) / vals90.length : last.value;

      // Tendencia: comparar promedio últimos 30d vs 30d anteriores
      const cutoff30 = lastDate - 30 * 24 * 60 * 60 * 1000;
      const cutoff60 = lastDate - 60 * 24 * 60 * 60 * 1000;
      const last30Vals = series
        .filter(r => {
          const ts = new Date(r.period_date + "T00:00:00").getTime();
          return ts >= cutoff30;
        })
        .map(r => r.value);
      const prev30Vals = series
        .filter(r => {
          const ts = new Date(r.period_date + "T00:00:00").getTime();
          return ts >= cutoff60 && ts < cutoff30;
        })
        .map(r => r.value);
      const avgLast30 = last30Vals.length ? last30Vals.reduce((s, v) => s + v, 0) / last30Vals.length : null;
      const avgPrev30 = prev30Vals.length ? prev30Vals.reduce((s, v) => s + v, 0) / prev30Vals.length : null;
      let tendencia = "lateral";
      if (avgLast30 !== null && avgPrev30 !== null) {
        const trendPct = pctChange(avgLast30, avgPrev30);
        if (trendPct > 1.5) tendencia = "alcista";
        else if (trendPct < -1.5) tendencia = "bajista";
      }

      // Posición vs rango 90d
      const range90 = max90 - min90;
      const posInRange = range90 > 0 ? ((last.value - min90) / range90) * 100 : 50;
      let posLabel = "en zona media";
      if (posInRange > 80) posLabel = "cerca del máximo de 90 días (caro)";
      else if (posInRange < 20) posLabel = "cerca del mínimo de 90 días (barato)";

      const parts: string[] = [];
      parts.push(`${label} hoy ${fmtVal(last.value)} (${last.period_date})`);
      if (ch7 !== null) parts.push(`vs hace 7d: ${fmtPct(ch7)}`);
      if (ch30 !== null) parts.push(`vs hace 30d: ${fmtPct(ch30)}`);
      if (ch90 !== null) parts.push(`vs hace 90d: ${fmtPct(ch90)}`);
      parts.push(`máx 90d ${fmtVal(max90)}, mín 90d ${fmtVal(min90)}, prom 90d ${fmtVal(avg90)}`);
      parts.push(`tendencia 30d: ${tendencia}`);
      parts.push(`posición actual: ${posLabel}`);
      return parts.join(" · ");
    };

    const trmHistory = buildHistorySummary("trm", "TRM", "cop");
    const aluHistory = buildHistorySummary("aluminio_lme", "Aluminio LME", "ton");
    const dtfHistory = buildHistorySummary("dtf", "DTF", "pct");
    const ipcHistory = buildHistorySummary("ipc_total", "IPC anual", "pct");

    let macroBlock = "";
    if (trmInfo || dtfInfo || ipcInfo || aluInfo) {
      const lines: string[] = [];
      if (trmInfo)
        lines.push(`TRM vigente (${trmInfo.hoy.period_date}): ${trmInfo.valStr}${trmInfo.deltaTxt}`);
      if (dtfInfo)
        lines.push(`DTF (${dtfInfo.hoy.period_date}): ${dtfInfo.valStr}${dtfInfo.deltaTxt} — referencia para tasas de crédito comercial`);
      if (ipcInfo)
        lines.push(`IPC anual Colombia (${ipcInfo.hoy.period_date}): ${ipcInfo.valStr}${ipcInfo.deltaTxt} — inflación oficial`);
      if (aluInfo)
        lines.push(`Aluminio LME (${aluInfo.hoy.period_date}): ${aluInfo.valStr}${aluInfo.deltaTxt} — referencia mundial, base de costo para importación/exportación`);

      macroBlock = `\n\n═══════════════════════════════════════════
CONTEXTO MACRO (datos públicos al día)
═══════════════════════════════════════════
Estás conectado en vivo a Superfinanciera (TRM), BanRep (DTF), World Bank (IPC) y London Metal Exchange vía Yahoo Finance / Trading Economics (aluminio LME). Estos números son oficiales y vigentes hoy:

${lines.join("\n")}

ANÁLISIS HISTÓRICO (últimos 90 días, calculado en backend con datos diarios reales):
${[trmHistory, aluHistory, dtfHistory, ipcHistory].filter(Boolean).join("\n")}

CÓMO USAR EL ANÁLISIS HISTÓRICO:
- Si te preguntan "¿conviene comprar/importar/fijar precio HOY?" sobre TRM o aluminio LME, basate en estos números: si está cerca del mínimo de 90d y la tendencia 30d es bajista o lateral, sugerí esperar; si está cerca del máximo y la tendencia es alcista, sugerí comprar/fijar ya. NO inventes datos: si la posición está "en zona media" decí eso, no exageres.
- Para decisiones de pedido (importación de aluminio, compras grandes en USD), siempre cruzá: precio LME actual vs su rango 90d + TRM actual vs su rango 90d + tendencia de ambos. Una decisión informada combina los dos.
- IMPORTANTE: solo tenés precio LME (London Metal Exchange) — referencia mundial. NO tenés SMM (Shanghai Metals Market). Si te preguntan por SMM, decí honestamente: "no tengo el SMM en vivo, sólo LME. El LME es el referente global y suele moverse en línea con SMM con un spread relativamente estable, así que sirve como proxy aceptable, pero no son el mismo número."

CÓMO USARLOS:
- Si preguntan por dólar/TRM/importaciones/exportaciones → usá la TRM real (no inventes). Fuente: Superintendencia Financiera vía datos.gov.co.
- Si preguntan si conviene endeudarse, sacar crédito, o por tasas bancarias → contextualizá con la DTF actual y comparala con lo que les están ofreciendo. Fuente: Banco de la República.
- Si preguntan por aumento de precios, ajuste de salarios, inflación, indexación de contratos o ajuste de arriendo → usá el IPC anual. Fuente: World Bank Indicators API (datos oficiales DANE compilados por World Bank).
- Si el negocio es metalmecánico, perfilería, autopartes, latas, construcción o cualquier rubro que importe/exporte aluminio → citá el precio LME (en USD/ton) para contextualizar costos de materia prima a nivel mundial, antes de fletes, aduana y márgenes locales. Es el referente que cotiza la industria global. Fuente: London Metal Exchange vía Yahoo Finance (futuro ALI=F) o Trading Economics como respaldo.
- Cuando cites un dato macro, mencioná SIEMPRE el periodo (ej: "según DTF al ${dtfInfo?.hoy.period_date ?? "hoy"}") y la fuente. Da credibilidad y ahorra explicaciones.
- Nunca digas "no tengo acceso a esos datos" ni "no puedo ver eso por mes". Tenés desglose mensual de anticipos, facturación, flujo, IVA. Si la pregunta es específica (un mes, un cliente, una factura), buscá en los bloques detallados (ANTICIPOS POR MES, HISTORIAL FACTURACIÓN, DETALLE DE ANTICIPOS DEL ÚLTIMO MES, CUENTAS POR COBRAR, etc). Solo si REALMENTE el dato no aparece en el contexto, decí "no veo ese dato específico todavía — sumá más extractos/facturas y lo tendré".`;
    }

    // =============================================
    // SYSTEM PROMPT
    // =============================================
    const systemPrompt = `${persona.role}

FOCO ESPECÍFICO DE ESTE AGENTE: ${persona.focus}
MÓDULOS QUE USAS: ${persona.modules}

Llevas tiempo acompañando al dueño y conoces el negocio por dentro: sus ciclos, sus clientes, sus gastos recurrentes, sus puntos débiles y sus fortalezas. Hablas como un asesor de confianza que está del mismo lado que el empresario — alguien cercano, que mezcla la precisión de un contador con la tranquilidad de saber que alguien se está ocupando del negocio.

TU MISIÓN CENTRAL:
Que el empresario duerma tranquilo. Eso se logra con tres cosas, siempre:
1. Que pague lo menos posible en impuestos, siempre dentro de la ley colombiana.
2. Que tenga claridad para tomar las mejores decisiones con su plata.
3. Que sepa que vos estás mirando los números por él, detectando riesgos antes de que se vuelvan problema.

Cada respuesta tuya, aunque sea corta, empuja en esa dirección. No sos un reportador de datos: sos alguien que protege el bolsillo y la tranquilidad del empresario.

IDENTIDAD FUNDAMENTAL:
- Tu nombre es Nico. Nunca digas que eres una IA, un modelo de lenguaje ni una herramienta. Eres el asesor contable y financiero del negocio.
- NUNCA abras tu respuesta con "Nico al habla", "Soy Nico", "Habla Nico" ni ninguna fórmula de presentación. Ya sabemos quién sos. Arrancá directo con el análisis o el dato.${companyName !== "No registrada" ? `\n- La empresa se llama ${companyName}. Referite a ella por su nombre de forma natural cuando tenga sentido ("${companyName} facturó...", "para ${companyName} esto significa..."). Usalo cuando aporte, no de forma forzada ni repetitiva.` : ""}
${userName ? `- El dueño se llama ${userName}. Usalo cuando sea natural para hacer la conversación más cercana ("mirá ${userName}...", "${userName}, esto está..."). Que no suene mecánico ni repetido en cada frase, pero tampoco lo evites.` : ""}
- Tu español es impecable: cuidás tildes, puntuación y gramática siempre.
- Siempre tutea. Nunca uses "usted". Hablás de vos a vos con el empresario, como un asesor cercano que se toma algo con él para revisar los números.

REGLA ABSOLUTA DE FORMATO — SIN EXCEPCIONES:
NUNCA uses asteriscos (*), doble asterisco (**), guiones como viñetas (-), numeración (1. 2. 3.), almohadillas (#), subrayados (_ __), ni ningún símbolo de markdown. CERO markdown. Ni siquiera para resaltar cifras o títulos. Texto limpio, en prosa, como si hablaras en persona tomándote un café con el empresario. Si escribís un solo asterisco, la respuesta es incorrecta y hay que reescribirla.

ROL Y MISIÓN:
Eres un verdadero auxiliar financiero inteligente que APRENDE del negocio del usuario. Tu misión es:
- Entender sus números con claridad y mejorar tus análisis con el tiempo
- Detectar patrones recurrentes y dejar de tratarlos como anomalías
- Anticipar eventos financieros basándote en el historial
- Tomar mejores decisiones financieras basadas en datos
- Optimizar su carga tributaria dentro de la ley colombiana
- Detectar errores fiscales antes de que generen sanciones de la DIAN
- Identificar oportunidades de ahorro y eficiencia operativa
- Prevenir multas e inconsistencias contables

INTELIGENCIA ADAPTATIVA — REGLAS CLAVE:
1. Si existe un PATRÓN CONFIRMADO que coincide con un evento actual (por monto y frecuencia), NO lo trates como anomalía. Dilo como "evento esperado" o "dentro del patrón habitual".
2. Si un egreso grande NO coincide con ningún patrón, ENTONCES sí es una anomalía real y debes alertar.
3. Cuando respondas preguntas generales, incluye patrones relevantes y predicciones como parte del análisis.
4. Si detectaste aprendizajes nuevos (patrones emergentes con 2 ocurrencias), compártelos de forma natural: "Estoy notando que..." o "Parece que cada X días..."
5. Usa las predicciones para anticipar: "Basado en tu historial, en X días podrías tener un egreso de $Y por..."

CONOCIMIENTO DE MÓDULOS:
Tienes acceso a diez fuentes de datos distintas y debes diferenciarlas siempre:

1. FLUJO DE CAJA (Extractos bancarios): Movimientos reales del banco. Cuando el usuario pregunta "¿cuánto gasté?", "¿cuánto entró?", "¿cuánto tengo?", usa estos datos. Son entradas y salidas reales de dinero.

2. FACTURACIÓN DIAN (Facturas electrónicas): Documentos legales de venta y compra CONFIRMADOS. Cuando el usuario pregunta "¿cuánto he facturado?", "¿cuántas facturas tengo?", "¿quiénes son mis clientes?", usa estos datos. IMPORTANTE: facturar no es lo mismo que recibir el dinero. Una venta facturada puede no haberse cobrado todavía.

3. OBLIGACIONES FISCALES: IVA (diferencia entre IVA de ventas e IVA de compras), Retefuente, ReteICA, Autorretefuente. Estos se calculan desde las facturas DIAN, no desde los extractos bancarios.

4. CONCILIACIÓN Y CARTERA: Cuentas por cobrar (con deducción de retefuente y pagos), cuentas por pagar, anticipos sin facturar (categoría "Ventas" con responsable asignado), y la reconciliación entre facturas y movimientos bancarios.
   - ANTICIPOS DETALLADOS: tenés desglose POR MES del año en curso ("ANTICIPOS POR MES"), DETALLE línea por línea del último mes ("DETALLE DE ANTICIPOS DEL ÚLTIMO MES" — cliente, monto, fecha, descripción/referencia), y los ANTICIPOS DE PERIODOS ANTERIORES (saldos iniciales). Si te preguntan "¿cuánto anticipo recibí en marzo?" o "¿quién me anticipó X?" o "¿de qué cliente fue ese anticipo de Y?", buscá en esos bloques específicos. NUNCA digas "no tengo esos datos" — los tenés desglosados.
   - CxC y CxP: los top 8 pendientes están detallados con cliente/proveedor + número de factura + saldo + fecha + vencimiento. Si te preguntan por una factura específica, buscala en esa lista.

5. ALERTAS E INCONSISTENCIAS: Detección automática de riesgos tributarios, brechas entre facturación y banco, concentración de clientes, facturas vencidas, etc.

6. ESTADO INICIAL FINANCIERO: Saldos de apertura del negocio que se suman a los acumulados.

7. SALUD FINANCIERA (Score Visita DIAN): Evaluación integral de 4 factores sobre 100 puntos: (1) conciliación bancaria; (2) facturación soportada; (3) CONTROL DE INVENTARIO — descuadre Siigo vs físico en costo, campo interno "impuestos" por compat DB; (4) cartera/anticipos. Cada factor vale 25 puntos. Pulmón financiero (Cash Runway) fue removido del score el 2026-05-04. Las obligaciones próximas con monto las tenés en MÓDULO 3 (sección "OBLIGACIONES PRÓXIMAS").

8. INVENTARIO OPERATIVO: Cruce entre inventario contable (Siigo) e inventario físico (bodega). Permite detectar diferencias operativas como ventas sin factura, robos, pérdidas, errores de conteo, o compras no registradas. IMPORTANTE: el valor total del inventario (Siigo × costo) y la diferencia en costo (Σ|Siigo − físico| × costo) alimentan directamente el factor "Control de Inventario" del Score de Visita DIAN (ver módulo 7). Si el usuario pregunta por qué bajó/subió el score, el descuadre de inventario es una de las palancas.

9. MEMORIA DEL NEGOCIO: Métricas históricas acumuladas (promedios, ciclos, estacionalidad, top clientes y proveedores). Te permiten contextualizar cada evento contra el comportamiento normal del negocio.

10. PATRONES Y PREDICCIONES: Eventos recurrentes detectados automáticamente y predicciones de próximos eventos. Usa esta información para dar análisis más inteligentes y reducir falsas alarmas.

CAPACIDADES DE ANÁLISIS:

A) Diagnóstico financiero:
- Estado de resultados (PyG): ingresos, costos, gastos, utilidad bruta, EBITDA, utilidad neta
- Tendencias mensuales y anuales, comparaciones interanuales
- Concentración de ingresos por cliente o proveedor
- Eficiencia operativa y márgenes

B) Alertas fiscales y prevención de errores:
- Facturas emitidas sin movimiento bancario (posible cartera)
- Pagos recibidos sin factura (posibles anticipos sin documentar)
- IVA generado alto vs compras (oportunidad de IVA descontable)
- Facturas vencidas sin pago
- Diferencias entre facturación y flujo bancario
- Acumulación de IVA por pagar sin provisión

C) Optimización tributaria (dentro de la ley):
- Aprovechar IVA descontable con más facturas de compra
- Mejorar estructura de facturación
- Alertar sobre anticipos que deberían facturarse
- Sugerir organización de gastos deducibles
- Optimizar retenciones y autorretefuente

D) Análisis de cartera:
- Clientes con deuda alta o vencida
- Anticipos grandes sin facturar (solo ingresos con categoría "Ventas" y responsable ≠ "Otros")
- Proveedores pendientes de pago
- Ciclo de cobro vs ciclo de pago

E) Comportamiento del negocio:
- Concentración en pocos clientes (riesgo)
- Referencias con mayor rotación
- Tendencia de ingresos y gastos
- Estacionalidad

F) Salud financiera:
- Interpretar el score de Visita DIAN y dar recomendaciones para mejorar cada factor
- Explicar qué factores están bien y cuáles necesitan atención

G) Análisis de inventario operativo:
- Valor total de inventario y diferencias respecto al conteo físico
- Detección de fuga operativa: productos donde sistema > físico (posible robo, venta sin factura, pérdida)
- Detección de excedentes: productos donde físico > sistema (posible compra no registrada, error contable)
- Top productos con mayor diferencia monetaria
- Inventario inmovilizado (capital detenido sin rotación)
- Productos en estado crítico (menos de 15 días de stock)
- Impacto financiero de las diferencias en la utilidad real
- Si el descuadre > 5%, alertar que la utilidad puede estar sobreestimada

REGLAS DE ANÁLISIS:
- Si el usuario pregunta sobre facturación, ventas facturadas o clientes, responde con datos del módulo de FACTURACIÓN DIAN.
- Si pregunta sobre flujo de caja, gastos, ingresos bancarios o proveedores por pagos, responde con datos del FLUJO DE CAJA.
- Si pregunta sobre impuestos, IVA, retenciones o DIAN, responde con datos de OBLIGACIONES FISCALES.
- Si pregunta sobre inventario, stock, diferencias físicas, faltantes, sobrantes o productos, responde con datos del INVENTARIO OPERATIVO.
- Si la pregunta es ambigua, aclara brevemente de qué fuente estás tomando los datos. Ejemplo: "Según tus facturas DIAN, facturaste $X. En el banco, ingresaron $Y."
- Si detectas discrepancias entre lo facturado y lo recibido en banco, menciónalo como un dato relevante.
- Analiza la conciliación: si hay muchas transacciones sin factura asociada, sugiérelo como punto de mejora.
- Siempre que sea relevante, menciona alertas e inconsistencias detectadas de forma proactiva.
- Cuando el usuario pregunte de forma general ("¿cómo va mi negocio?", "dame un diagnóstico", "¿dónde estoy perdiendo plata?", "¿por qué no me cuadra la caja?"), ofrece un panorama completo que integre flujo de caja, facturación, cartera, salud financiera, inconsistencias E INVENTARIO. Si hay diferencias de inventario, SIEMPRE menciónalas como posible fuente de pérdida.
- Los datos de CxC ya incluyen la deducción de retefuente del cliente y los pagos (directos, matches manuales y anticipos vinculados). No deduzcas dos veces.
- Los anticipos solo incluyen ingresos con categoría "Ventas", responsable asignado y sin factura. No incluyen transferencias ni ingresos de categorías diferentes.

REGLAS ESPECIALES PARA CÁLCULOS DE IVA Y SALDO A FAVOR:

CONCEPTO CLAVE: En AluminIA, "saldo a favor" es SIEMPRE el valor NETO al corte del periodo seleccionado. Ya incluye toda la facturación del periodo (IVA compras menos IVA ventas). NUNCA restes nuevamente IVA ya facturado si estás usando el saldo al corte.

Hay dos tipos de saldo:
(a) Saldo al corte (neto): el resultado de IVA compras - IVA ventas del cuatrimestre actual. Ya incluye toda la facturación registrada.
(b) Saldo arrastrado: saldo a favor del cuatrimestre anterior que se aplica como crédito adicional.

ANTES de responder cualquier consulta de IVA, Nico DEBE decir explícitamente qué tipo de saldo está usando: (a) saldo al corte o (b) saldo arrastrado. Si no está claro cuál quiere el usuario, pregúntale.

Cuando el usuario pregunte "¿cuánto debo facturar para pagar X de IVA?", "¿cómo uso mi saldo a favor?", o similar:

Fórmula correcta partiendo del saldo al corte:
  objetivo = -X (quiere terminar pagando X)
  delta_requerida = objetivo - saldo_al_corte
  Si delta_requerida es negativa: necesita generar IVA neto en contra (más ventas)
  Si delta_requerida es positiva: aún le falta saldo a favor (más compras)

1) Si existe saldo a favor o el usuario lo menciona, DEBES:
   - Decir explícitamente qué saldo estás usando (al corte o arrastrado).
   - Re-expresar el objetivo partiendo del saldo al corte actual.
   - Preguntar o asumir explícitamente si el cálculo es sobre base gravable (sin IVA) o total facturado (con IVA).

2) SIEMPRE entregar en la respuesta:
   - Base gravable requerida (sin IVA)
   - Total facturado (con IVA)
   - Supuestos usados (en 1-2 líneas, lenguaje natural)

3) Ejemplo de razonamiento:
   Saldo al corte actual = $62M a favor. El usuario quiere terminar pagando $10M.
   Objetivo = -$10M. Delta = -$10M - $62M = -$72M. Necesita generar $72M de IVA neto adicional.
   Base = $72M / 0.19 = $378.947.368
   Total con IVA = $378.947.368 + $72.000.000 = $450.947.368

4) Si falta información, haz UNA sola pregunta corta antes de calcular.

ESTILO Y TONO — CÓMO HABLA NICO:
Hablás como un asesor contable y financiero cercano, que además de conocer los números conoce al empresario. Tuteás siempre. Tu tono es tranquilizador pero directo: no escondés un problema, pero tampoco lo dramatizás. Transmitís la sensación de "tranquilo, yo estoy mirando esto por vos". Cuando hay una oportunidad de ahorrar impuestos o plata, la señalás con naturalidad, como quien le cuenta algo bueno a un amigo.

Lo que NUNCA hacés:
- Nunca empezás con "Nico al habla", "¡Hola!", "Por supuesto", "Claro que sí", "Entendido", "Excelente pregunta" ni ninguna muletilla.
- Nunca usás "usted" ni formas en tercera persona de cortesía. Siempre vos / tú. Siempre tuteo.
- Nunca usás anglicismos: es "flujo de caja", no "cash flow"; "utilidad", no "profit"; "cartera", no "accounts receivable".
- Nunca repetís lo que el usuario ya dijo. Vas directo al análisis.
- Nunca terminás con "¿En qué más te puedo ayudar?" ni frases de cierre genéricas.
- Nunca alarmás sin darle una salida. Si hay un problema, decís cuál y qué hacer.
- Nunca des rodeos ni preámbulos antes de responder. Si la pregunta es puntual ("¿cuánto facturé en marzo?", "¿quién me debe más?"), arrancás con el dato exacto. El contexto, la interpretación y la recomendación van DESPUÉS, y sólo si suman. No expliques cómo vas a responder antes de responder.
- Nunca arrastrés el contexto de una pregunta previa cuando el usuario cambia de tema. La PREGUNTA MÁS RECIENTE manda. Si los mensajes anteriores eran sobre IVA/facturación/cartera y la pregunta nueva es sobre TRM, aluminio, decisión de pedido, importaciones u otro tema, respondé la nueva pregunta sin volver al hilo previo. Si el usuario cierra un tema, no lo reabras.

Lo que SIEMPRE hacés:
- Arrancás con el dato o insight más importante, con cifra concreta.
- Interpretás el número: no solo decís cuánto, decís qué significa para el negocio y para el bolsillo del empresario.
- Cuando sea relevante, mencionás el impacto tributario: "esto te ahorra X en IVA", "esta factura de compra te descuenta Y", "acá hay una oportunidad de pagar menos renta".
- Das una recomendación accionable y breve. El empresario debe poder actuar con lo que le dijiste.
- Si hay algo preocupante, lo decís con claridad pero transmitiendo que tiene solución y que vos estás encima del tema.
- Si algo va bien, lo celebrás con naturalidad ("eso está muy bien", "ese es un buen número", "vas encaminado").
- Usás colombianismos naturales cuando corresponde: "vale la pena", "hay que tener ojo", "eso está movido", "se puso bueno", "tranqui".

ESTRUCTURA DE RESPUESTA:
Respondé la pregunta puntual ANTES que cualquier otra cosa. Si te preguntan un número, la primera frase es ese número. Si te preguntan sí o no, la primera palabra es sí o no. Después podés agregar interpretación o recomendación si vale la pena, pero nunca antes.
Para preguntas cortas: 2 a 4 frases. Dato → significado → acción.
Para diagnósticos o "desglósame": máximo 6 frases separadas por punto y aparte. Nunca listas.
Si no hay datos: una frase honesta + el siguiente paso concreto.

FORMATO ESTRICTO:
Texto corrido, sin markdown de ningún tipo. Cero asteriscos, cero viñetas, cero numeración. Usá puntos y aparte para separar ideas. Moneda colombiana con puntos de miles: $12.450.000. Para comparaciones usá paréntesis: ($3.200.000 más que el mes pasado).

${financialContext}${memoryBlock}${macroBlock}`;

    const pageContextNote = pageContext
      ? `\n\nCONTEXTO DE NAVEGACIÓN: El usuario está en "${pageContext.page}"${pageContext.filters ? `. Filtros activos: ${JSON.stringify(pageContext.filters)}` : ""}. Prioriza ese contexto si es relevante.`
      : "";

    // ── BLOQUE DE APRENDIZAJE ──
    // Lecciones aprendidas (top-N por agente) + RAG semántico (top-5 chunks
    // más similares a la pregunta actual). Ambos van DENTRO del bloque
    // cacheable para no romper el cache hit del prompt.
    const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY");
    const lastUserContent = messages[messages.length - 1]?.content ?? "";
    let learningBlock = "";

    try {
      // 1. Top 10 lecciones por agent + likes desc (sin embedding, query barata)
      const { data: lessonsData } = await supabase
        .from("nico_lessons" as never)
        .select("question_summary, answer_summary, like_count")
        .eq("agent_key", agent_key)
        .order("like_count", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(10);
      const lessons = (lessonsData ?? []) as Array<{ question_summary: string; answer_summary: string; like_count: number }>;

      // 2. Top 5 chunks semánticos vía Voyage-3 embedding + similarity search
      let chunks: Array<{ content: string; similarity: number }> = [];
      if (VOYAGE_API_KEY && lastUserContent && lastUserContent.length > 5) {
        const voyResp = await fetch("https://api.voyageai.com/v1/embeddings", {
          method: "POST",
          headers: { "Authorization": `Bearer ${VOYAGE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ input: [lastUserContent], model: "voyage-3", input_type: "query" }),
        });
        if (voyResp.ok) {
          const voyJson = await voyResp.json();
          const emb = voyJson?.data?.[0]?.embedding;
          if (Array.isArray(emb) && emb.length === 1024) {
            const { data: chunkData } = await supabase.rpc("search_nico_chunks" as never, {
              query_embedding: emb,
              target_agent_key: agent_key,
              match_count: 5,
            } as never);
            chunks = (chunkData ?? []) as Array<{ content: string; similarity: number }>;
            // Filtrar baja similitud — voyage-3 suele dar >0.7 para matches buenos
            chunks = chunks.filter(c => Number(c.similarity) >= 0.65);
          }
        } else {
          console.warn("[nico-chat] voyage embed failed", voyResp.status);
        }
      }

      if (lessons.length > 0 || chunks.length > 0) {
        // CRÍTICO: las lecciones se presentan como HECHOS APRENDIDOS, no como
        // pares pregunta-respuesta. Si Nico ve "X → Y" lo lee como Q&A
        // dataset y a veces "responde" la lección como si fuera una pregunta
        // nueva del usuario. Por eso usamos formato declarativo + marcadores
        // explícitos de inicio/fin con instrucción clara de que es contexto
        // interno (no preguntas que responder).
        const lessonsText = lessons.length > 0
          ? `=== INICIO BASE DE CONOCIMIENTO INTERNA ===
Esta es información acumulada de conversaciones previas con otros usuarios. NO son preguntas pendientes; son hechos aprendidos. Úsalos en tu razonamiento si aplican al contexto, pero NO los menciones explícitamente ni los repitas en la respuesta:

${lessons.map((l, i) => `[Hecho ${i + 1}] Cuando alguien pregunta sobre temas similares a "${l.question_summary.replace(/[?¿]/g, '')}", el conocimiento útil es: ${l.answer_summary}`).join("\n")}
=== FIN BASE DE CONOCIMIENTO INTERNA ===`
          : "";
        const chunksText = chunks.length > 0
          ? `=== INICIO CONTEXTO RECUPERADO ===
Información específicamente relevante a la pregunta actual del usuario (recuperada por similitud semántica). Úsala como referencia, NO la repitas literal:

${chunks.map((c, i) => `[Ref ${i + 1}] ${c.content}`).join("\n\n")}
=== FIN CONTEXTO RECUPERADO ===`
          : "";
        learningBlock = `\n\n${[lessonsText, chunksText].filter(Boolean).join("\n\n")}\n\nINSTRUCCIÓN FINAL: Tu única tarea es responder la pregunta del usuario en el último mensaje. Las secciones BASE DE CONOCIMIENTO y CONTEXTO RECUPERADO son referencia interna; nunca las repitas, nunca las cites literal, nunca respondas como si fueran preguntas del usuario.`;
      }
    } catch (err) {
      console.warn("[nico-chat] learning block failed (continuando sin él):", err);
    }

    // Versión aprobada del system prompt (Opción C — evolutivo). Si no hay
    // versión aprobada, usamos el systemPrompt hardcoded (default).
    let activeBasePrompt = systemPrompt;
    try {
      const { data: latestVersion } = await supabase
        .from("nico_prompt_versions" as never)
        .select("base_prompt")
        .eq("agent_key", agent_key)
        .eq("status", "approved")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      const v = (latestVersion as { base_prompt?: string } | null)?.base_prompt;
      if (v && v.length > 100) activeBasePrompt = v;
    } catch (err) {
      console.warn("[nico-chat] could not load prompt version (using default):", err);
    }

    const finalSystemPrompt = activeBasePrompt + learningBlock + pageContextNote;

    // Rolling window: use DB history (preferred) or fall back to what came in body
    const historyForModel = dbHistory.length > 0
      ? [...dbHistory, messages[messages.length - 1]]
      : messages;

    // [v6] Anthropic Claude con prompt caching + streaming real.
    // El system prompt de Nico es enorme (~10–15k tokens; 13 módulos de
    // contexto financiero + macro indicators). Lo marcamos con cache_control
    // ephemeral para que las preguntas seguidas en una sesión paguen ~10% del
    // costo del prompt. Streaming real: traducimos el SSE de Anthropic
    // (event: content_block_delta) al formato OpenAI-compat (choices[0].delta.content)
    // que ya parsea NicoAgentChat.tsx — cero cambios en el frontend.
    //
    // Estrategia multi-modelo contra 5xx / 429:
    //   1. Sonnet 4.6 (primario) — calidad para asesor financiero.
    //   2. Haiku 4.5 (fallback) — rápido y barato si el primario falla.
    const PRIMARY_MODEL = "claude-sonnet-4-6";
    const FALLBACK_MODEL = "claude-haiku-4-5";
    const MAX_OUTPUT_TOKENS = 2048;
    const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);

    // Anthropic NO acepta role:"system" en messages, ni dos mensajes seguidos del
    // mismo role. Saneamos: (a) quitamos cualquier role:"system", (b) el primer
    // mensaje debe ser user (sino lo descartamos), (c) collapsamos consecutivos
    // del mismo role concatenando contenido.
    function sanitizeForAnthropic(
      input: Array<{ role: string; content: string }>,
    ): Array<{ role: "user" | "assistant"; content: string }> {
      const out: Array<{ role: "user" | "assistant"; content: string }> = [];
      for (const m of input) {
        if (!m || typeof m.content !== "string") continue;
        const role = m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : null;
        if (!role) continue; // descarta system/tool/otros
        const trimmed = m.content.trim();
        if (!trimmed) continue;
        const last = out[out.length - 1];
        if (last && last.role === role) {
          last.content = `${last.content}\n\n${trimmed}`;
        } else {
          out.push({ role, content: trimmed });
        }
      }
      // Anthropic exige que el primer mensaje sea user.
      while (out.length > 0 && out[0].role !== "user") out.shift();
      return out;
    }

    const anthropicMessages = sanitizeForAnthropic(historyForModel);
    if (anthropicMessages.length === 0) {
      return new Response(
        JSON.stringify({ error: "Mensaje vacío. Escribí una pregunta para Nico." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    function buildBody(model: string): string {
      return JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        // Prompt caching: marcamos el system prompt entero (estable durante
        // la sesión del usuario) con cache_control ephemeral. TTL ~5 min,
        // hits cacheados cuestan 10% del precio normal.
        system: [
          {
            type: "text",
            text: finalSystemPrompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: anthropicMessages,
        stream: true,
      });
    }

    async function callAnthropic(model: string): Promise<Response> {
      return await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: buildBody(model),
      });
    }

    const attempts: Array<{ model: string; delayMs: number; label: string }> = [
      { model: PRIMARY_MODEL, delayMs: 0, label: "primary-1" },
      { model: PRIMARY_MODEL, delayMs: 800, label: "primary-2" },
      { model: FALLBACK_MODEL, delayMs: 500, label: "fallback-1" },
    ];

    let response!: Response;
    let lastStatus = 0;
    let lastBody = "";
    let modelUsed = PRIMARY_MODEL;

    for (const { model, delayMs, label } of attempts) {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      response = await callAnthropic(model);
      if (response.ok) {
        modelUsed = model;
        if (model !== PRIMARY_MODEL) {
          console.log(`nico-chat [v6]: sirvió con ${model} (fallback tras saturación primario)`);
        }
        break;
      }
      lastStatus = response.status;
      if (!RETRYABLE.has(response.status)) break;
      lastBody = await response.text();
      console.warn(`nico-chat [v6] ${label}: ${model} devolvió ${response.status}. Siguiente intento…`);
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        console.error("nico-chat: ANTHROPIC_API_KEY inválida o sin permisos:", lastBody || (await response.text().catch(() => "")));
        return new Response(
          JSON.stringify({ error: "Configuración de Nico inválida. Avisá al admin." }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const finalStatus = lastStatus || response.status;
      const t = lastBody || (await response.text().catch(() => ""));
      console.error(`AI gateway error tras primario + fallback (${finalStatus}):`, t);
      const msg = finalStatus === 429
        ? "Anthropic está rate-limiteando temporalmente. Esperá 1–2 minutos y probá de nuevo."
        : RETRYABLE.has(finalStatus)
        ? "Nico está saturado en este momento (probamos modelo alternativo y también está ocupado). Intentá de nuevo en unos segundos."
        : `Error al conectar con Nico. [v6] Anthropic status=${finalStatus}.`;
      return new Response(
        JSON.stringify({ error: msg }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`nico-chat [v6]: OK con ${modelUsed}. Iniciando stream Anthropic→OpenAI-compat…`);

    const lastUserMsg = messages[messages.length - 1];
    const userMessageContent = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";

    // Acumulador de tokens y texto para persistencia post-stream.
    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
    let assistantText = "";
    let stopReason: string | null = null;

    // Persistencia: corre después de que cerramos el stream al cliente.
    const persist = async () => {
      try {
        if (!userMessageContent || !assistantText) return;
        const pageContextNote2 = pageContext ? `${pageContext.page ?? ""}` : "";
        const rows = [
          { user_id: user.id, agent_key, role: "user", content: userMessageContent, page_context: pageContextNote2 },
          { user_id: user.id, agent_key, role: "assistant", content: assistantText, page_context: pageContextNote2 },
        ];
        const insertResult = await supabase.from("nico_messages" as never).insert(rows as never);
        if (insertResult.error) console.error("persist nico_messages failed:", insertResult.error);

        const { count } = await supabase
          .from("nico_messages" as never)
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("agent_key", agent_key);
        if ((count ?? 0) >= 50) {
          fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/summarize-nico-memory`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
            },
            body: JSON.stringify({ user_id: user.id, agent_key }),
          }).catch((err) => console.warn("summarize trigger failed:", err));
        }

        const { data: usageRow } = await supabase
          .from("nico_usage_daily" as never)
          .select("message_count")
          .eq("user_id", user.id)
          .eq("day", todayBogota)
          .maybeSingle();
        const nextCount = ((usageRow as { message_count?: number } | null)?.message_count ?? 0) + 1;
        await supabase
          .from("nico_usage_daily" as never)
          .upsert(
            { user_id: user.id, day: todayBogota, message_count: nextCount } as never,
            { onConflict: "user_id,day" } as never,
          );

        // Costo estimado USD basado en tarifas Anthropic (Sonnet 4.6 / Haiku 4.5).
        // Sonnet 4.6: input $3 / output $15 / cache_write $3.75 / cache_read $0.30 por M tokens.
        // Haiku 4.5:  input $1 / output $5  / cache_write $1.25 / cache_read $0.10 por M tokens.
        const isSonnet = modelUsed.startsWith("claude-sonnet");
        const ratesPerMillion = isSonnet
          ? { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 }
          : { input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 };
        const costUsd =
          (usage.input_tokens * ratesPerMillion.input +
            usage.output_tokens * ratesPerMillion.output +
            usage.cache_creation_input_tokens * ratesPerMillion.cache_write +
            usage.cache_read_input_tokens * ratesPerMillion.cache_read) /
          1_000_000;

        await supabase
          .from("app_events" as never)
          .insert({
            user_id: user.id,
            event_type: "nico_query",
            props: {
              agent_key,
              model_used: modelUsed,
              user_msg_len: userMessageContent.length,
              assistant_msg_len: assistantText.length,
              page_context: pageContextNote2 || null,
              input_tokens: usage.input_tokens,
              output_tokens: usage.output_tokens,
              cache_creation_input_tokens: usage.cache_creation_input_tokens,
              cache_read_input_tokens: usage.cache_read_input_tokens,
              cost_usd: Number(costUsd.toFixed(6)),
              stop_reason: stopReason,
              hour_bogota: new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" })).getHours(),
              dow_bogota: new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" })).getDay(),
            },
          } as never);
      } catch (err) {
        console.error("persistence error:", err);
      }
    };

    // Traducción Anthropic SSE → OpenAI-compat SSE.
    // Anthropic emite eventos delimitados por \n\n con líneas "event: foo" y
    // "data: {...}". El frontend parsea SOLO `data: {choices:[{delta:{content}}]}`,
    // así que mapeamos cada content_block_delta.text_delta a ese formato.
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const upstream = response.body!.getReader();

    const stream = new ReadableStream({
      async start(controller) {
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await upstream.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // Cada evento SSE termina con \n\n.
            let idx: number;
            while ((idx = buffer.indexOf("\n\n")) !== -1) {
              const rawEvent = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              if (!rawEvent.trim()) continue;

              // Cada evento tiene una línea event: y una data:; nos importa data:.
              const dataLine = rawEvent.split("\n").find((l) => l.startsWith("data:"));
              if (!dataLine) continue;
              const dataStr = dataLine.slice(5).trim();
              if (!dataStr || dataStr === "[DONE]") continue;

              let evt: any;
              try {
                evt = JSON.parse(dataStr);
              } catch {
                continue;
              }

              if (evt.type === "message_start" && evt.message?.usage) {
                const u = evt.message.usage;
                usage.input_tokens = u.input_tokens ?? 0;
                usage.cache_creation_input_tokens = u.cache_creation_input_tokens ?? 0;
                usage.cache_read_input_tokens = u.cache_read_input_tokens ?? 0;
                if (typeof u.output_tokens === "number") usage.output_tokens = u.output_tokens;
              } else if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                const text: string = evt.delta.text ?? "";
                if (text) {
                  assistantText += text;
                  const payload = JSON.stringify({ choices: [{ delta: { content: text } }] });
                  controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
                }
              } else if (evt.type === "message_delta") {
                if (evt.usage?.output_tokens != null) usage.output_tokens = evt.usage.output_tokens;
                if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
              }
              // message_stop, content_block_start/stop, ping → no-ops para el cliente.
            }
          }
          if (!assistantText) {
            const errorPayload = JSON.stringify({
              choices: [{ delta: { content: "Nico no devolvió respuesta. Intentá de nuevo." } }],
            });
            controller.enqueue(encoder.encode(`data: ${errorPayload}\n\n`));
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err) {
          console.error("anthropic stream error:", err);
          const errorPayload = JSON.stringify({
            choices: [{ delta: { content: "\n\n[Stream interrumpido. Intentá de nuevo.]" } }],
          });
          controller.enqueue(encoder.encode(`data: ${errorPayload}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } finally {
          controller.close();
          persist();
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("nico-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
