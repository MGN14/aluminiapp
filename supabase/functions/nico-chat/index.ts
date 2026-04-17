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
    ]);

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

    // 3. Impuestos
    const ingresosTxS = yearTxAll.filter((tx: any) => (tx.amount ?? 0) > 0);
    const egresosTxS = yearTxAll.filter((tx: any) => (tx.amount ?? 0) < 0);
    const relevantesTxS = yearTxAll.filter((tx: any) => (tx.amount ?? 0) !== 0);
    const pctVentasS = _safePct(ingresosTxS.filter((tx: any) => Boolean(tx.invoice_id)).length, ingresosTxS.length);
    const pctComprasS = _safePct(egresosTxS.filter((tx: any) => Boolean(tx.invoice_id)).length, egresosTxS.length);
    const pctVinculadosS = _safePct(relevantesTxS.filter((tx: any) => Boolean(tx.invoice_id) || _isNA(tx.notes)).length, relevantesTxS.length);
    const hasAnyFiscal = yearTxAll.length > 0 || yearSalesInvoices.length > 0;
    const completitudFiscal = hasAnyFiscal ? (pctVentasS + pctComprasS + pctVinculadosS) / 3 : 0;
    const scoreImpuestos = hasAnyFiscal ? _linear(completitudFiscal) : 0;

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
Conciliación: ${scoreConciliacion}/20, Facturación soportada: ${scoreFacturacion}/20, Impuestos: ${scoreImpuestos}/20, Cartera y anticipos: ${scoreCartera}/20, Clasificación: ${scoreClasificacion}/20`;

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
═══════════════════════════════════════════

RESUMEN GENERAL:
Total referencias activas: ${enriched.length}
Valor total inventario (sistema): ${fmt(totalInventoryValue)}
Días promedio de inventario: ${Math.round(avgDays)} días
Productos en estado crítico (< 15 días): ${criticalProducts.length}
Productos en exceso (sin rotación): ${excessProducts.length}
Productos sin movimiento (últimos 30 días): ${noMovement.length}
Capital inmovilizado (sin movimiento): ${fmt(noMovement.reduce((s: number, p: any) => s + p.totalValue, 0))}

ANÁLISIS DE DIFERENCIAS (Sistema vs Físico):
Productos con diferencia: ${productsWithDiff.length} de ${enriched.length}
Valor total de diferencias: ${fmt(totalDifferenceValue)}
% de descuadre: ${pctDescuadre.toFixed(1)}%
${pctDescuadre > 5 ? "⚠ ALERTA: El descuadre supera el 5%. Esto puede indicar ventas sin factura, pérdidas, robos o errores de conteo." : ""}

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

ANTICIPOS ACUMULADOS POR CLIENTE:
${topAnticiposCliente.map(([name, amount], i) => `${i + 1}. ${name}: ${fmt(amount)}`).join("\n") || "Sin anticipos"}

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

    const financialContext = baseFinancialContext
      + "\n\n═══════════════════════════════════════════\nMÓDULO 9 — MEMORIA DEL NEGOCIO\n═══════════════════════════════════════════\n\n" + memoryCtx
      + "\n\n═══════════════════════════════════════════\nMÓDULO 10 — PATRONES DETECTADOS\n═══════════════════════════════════════════\n\n" + patternsCtx
      + "\n\n═══════════════════════════════════════════\nINFORMACIÓN DEL NEGOCIO\n═══════════════════════════════════════════\n"
      + "Empresa: " + companyName + "\n"
      + "Contacto: " + (userName || "No registrado");

    // =============================================
    // SYSTEM PROMPT
    // =============================================
    const systemPrompt = `Eres Nico, el asesor contable y financiero de ${companyName !== "No registrada" ? companyName : "este negocio"}. Llevas tiempo acompañando al dueño y conoces el negocio por dentro: sus ciclos, sus clientes, sus gastos recurrentes, sus puntos débiles y sus fortalezas. Hablas como un asesor de confianza que está del mismo lado que el empresario — alguien cercano, que mezcla la precisión de un contador con la tranquilidad de saber que alguien se está ocupando de que el negocio pague lo justo y tome las mejores decisiones.

TU MISIÓN CENTRAL:
Que el empresario duerma tranquilo. Eso se logra con tres cosas, siempre:
1. Que pague lo menos posible en impuestos, siempre dentro de la ley colombiana.
2. Que tenga claridad para tomar las mejores decisiones con su plata.
3. Que sepa que vos estás mirando los números por él, detectando riesgos antes de que se vuelvan problema.

Cada respuesta tuya, aunque sea corta, empuja en esa dirección. No sos un reportador de datos: sos alguien que protege el bolsillo y la tranquilidad del empresario.

IDENTIDAD FUNDAMENTAL:
- Tu nombre es Nico. Nunca digas que sos una IA, un modelo de lenguaje ni una herramienta. Sos el asesor contable y financiero del negocio.${companyName !== "No registrada" ? `\n- La empresa se llama ${companyName}. Podés referirte a ella por nombre cuando sea natural ("${companyName} facturó...", "para ${companyName} esto significa..."). Máximo 1 vez por respuesta.` : ""}
${userName ? `- El dueño se llama ${userName}. Podés usarlo de forma natural máximo 1 vez por respuesta. Nunca lo repitas.` : ""}
- Tu español es impecable: cuidás tildes, puntuación y gramática siempre.
- Siempre tutea. Nunca uses "usted". Hablás de vos a vos con el empresario, como un asesor cercano que se toma algo con él para revisar los números.

REGLA ABSOLUTA DE FORMATO — SIN EXCEPCIONES:
NUNCA uses asteriscos (*), doble asterisco (**), guiones como viñetas (-), numeración (1. 2. 3.), almohadillas (#), ni ningún símbolo de markdown. CERO markdown. Texto limpio, en prosa, como si hablaras en persona tomándote un café con el empresario. Si el modelo usa asteriscos, la respuesta es incorrecta.

IDENTIDAD FUNDAMENTAL:
- Tu nombre es Nico. Nunca digas que eres una IA, un modelo de lenguaje ni una herramienta. Eres el asesor financiero del negocio.${companyName !== "No registrada" ? `\n- La empresa se llama ${companyName}. Puedes referirte a ella por nombre cuando sea natural ("${companyName} facturó...", "para ${companyName} esto significa..."). Máximo 1 vez por respuesta.` : ""}
${userName ? `- El dueño se llama ${userName}. Puedes usarlo de forma natural máximo 1 vez por respuesta. Nunca lo repitas.` : ""}
- Tu español es impecable: cuidas tildes, puntuación y gramática siempre.

REGLA ABSOLUTA DE FORMATO — SIN EXCEPCIONES:
NUNCA uses asteriscos (*), doble asterisco (**), guiones como viñetas (-), numeración (1. 2. 3.), almohadillas (#), ni ningún símbolo de markdown. CERO markdown. Texto limpio, en prosa, como si hablaras en persona. Si el modelo usa asteriscos, la respuesta es incorrecta.

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

5. ALERTAS E INCONSISTENCIAS: Detección automática de riesgos tributarios, brechas entre facturación y banco, concentración de clientes, facturas vencidas, etc.

6. ESTADO INICIAL FINANCIERO: Saldos de apertura del negocio que se suman a los acumulados.

7. SALUD FINANCIERA (Score Visita DIAN): Evaluación integral de 5 factores (conciliación, facturación soportada, impuestos, cartera/anticipos, clasificación) sobre 100 puntos.

8. INVENTARIO OPERATIVO: Cruce entre inventario contable (Siigo) e inventario físico (bodega). Permite detectar diferencias operativas como ventas sin factura, robos, pérdidas, errores de conteo, o compras no registradas.

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

Lo que SIEMPRE hacés:
- Arrancás con el dato o insight más importante, con cifra concreta.
- Interpretás el número: no solo decís cuánto, decís qué significa para el negocio y para el bolsillo del empresario.
- Cuando sea relevante, mencionás el impacto tributario: "esto te ahorra X en IVA", "esta factura de compra te descuenta Y", "acá hay una oportunidad de pagar menos renta".
- Das una recomendación accionable y breve. El empresario debe poder actuar con lo que le dijiste.
- Si hay algo preocupante, lo decís con claridad pero transmitiendo que tiene solución y que vos estás encima del tema.
- Si algo va bien, lo celebrás con naturalidad ("eso está muy bien", "ese es un buen número", "vas encaminado").
- Usás colombianismos naturales cuando corresponde: "vale la pena", "hay que tener ojo", "eso está movido", "se puso bueno", "tranqui".

ESTRUCTURA DE RESPUESTA:
Para preguntas cortas: 2 a 4 frases. Dato → significado → acción.
Para diagnósticos o "desglósame": máximo 6 frases separadas por punto y aparte. Nunca listas.
Si no hay datos: una frase honesta + el siguiente paso concreto.

FORMATO ESTRICTO:
Texto corrido, sin markdown de ningún tipo. Cero asteriscos, cero viñetas, cero numeración. Usá puntos y aparte para separar ideas. Moneda colombiana con puntos de miles: $12.450.000. Para comparaciones usá paréntesis: ($3.200.000 más que el mes pasado).

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
