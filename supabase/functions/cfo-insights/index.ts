import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify user
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // Parse params
    const { periodType, month, quarter, year } = await req.json();
    console.log(`[cfo-insights] user=${userId} period=${periodType} m=${month} q=${quarter} y=${year}`);

    // Calculate date ranges
    let periodStart: string, periodEnd: string;
    let prevPeriodStart: string, prevPeriodEnd: string;

    if (periodType === "month") {
      periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      periodEnd = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
      // Previous month
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      prevPeriodStart = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
      const prevLastDay = new Date(prevYear, prevMonth, 0).getDate();
      prevPeriodEnd = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${prevLastDay}`;
    } else if (periodType === "quarter") {
      const startMonth = (quarter - 1) * 3 + 1;
      const endMonth = quarter * 3;
      periodStart = `${year}-${String(startMonth).padStart(2, "0")}-01`;
      const lastDay = new Date(year, endMonth, 0).getDate();
      periodEnd = `${year}-${String(endMonth).padStart(2, "0")}-${lastDay}`;
      // Previous quarter
      const prevQ = quarter === 1 ? 4 : quarter - 1;
      const prevY = quarter === 1 ? year - 1 : year;
      const prevStartMonth = (prevQ - 1) * 3 + 1;
      const prevEndMonth = prevQ * 3;
      prevPeriodStart = `${prevY}-${String(prevStartMonth).padStart(2, "0")}-01`;
      const prevLD = new Date(prevY, prevEndMonth, 0).getDate();
      prevPeriodEnd = `${prevY}-${String(prevEndMonth).padStart(2, "0")}-${prevLD}`;
    } else {
      // year
      periodStart = `${year}-01-01`;
      periodEnd = `${year}-12-31`;
      prevPeriodStart = `${year - 1}-01-01`;
      prevPeriodEnd = `${year - 1}-12-31`;
    }

    // IVA fiscal period (cuatrimestre: Ene-Abr, May-Ago, Sep-Dic)
    let ivaStart: string, ivaEnd: string, ivaLabel: string;
    const refMonth = periodType === "month" ? month : (quarter ? (quarter - 1) * 3 + 1 : 1);
    if (refMonth >= 1 && refMonth <= 4) {
      ivaStart = `${year}-01-01`;
      ivaEnd = `${year}-04-30`;
      ivaLabel = `Ene–Abr ${year}`;
    } else if (refMonth >= 5 && refMonth <= 8) {
      ivaStart = `${year}-05-01`;
      ivaEnd = `${year}-08-31`;
      ivaLabel = `May–Ago ${year}`;
    } else {
      ivaStart = `${year}-09-01`;
      ivaEnd = `${year}-12-31`;
      ivaLabel = `Sep–Dic ${year}`;
    }

    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    // ─── Parallel queries ───
    const [
      txCurrentRes,
      txPrevRes,
      invPeriodRes,
      invIvaRes,
      invYearRes,
      matchesRes,
      anticiposTxRes,
      taxSettingsRes,
      initialStateRes,
      initialDetailsRes,
      responsiblesRes,
      inventoryRes,
      inventoryMovRes,
      patternsRes,
      memoryRes,
    ] = await Promise.all([
      // Current period transactions
      admin
        .from("transactions")
        .select("id, date, description, amount, category_id, responsible_id, invoice_id, type, categories!transactions_category_id_fkey(name)")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .gte("date", periodStart)
        .lte("date", periodEnd),
      // Previous period transactions
      admin
        .from("transactions")
        .select("id, amount, type")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .gte("date", prevPeriodStart)
        .lte("date", prevPeriodEnd),
      // Invoices in the period (confirmed)
      admin
        .from("invoices")
        .select("id, type, issue_date, subtotal_base, iva_amount, total_amount, counterparty_name, reteica_amount, autoretefuente_amount, retefuente_cliente_amount, retefuente_cliente_rate, status, due_date")
        .eq("user_id", userId)
        .eq("status", "confirmed")
        .gte("issue_date", periodStart)
        .lte("issue_date", periodEnd),
      // IVA cuatrimestre invoices
      admin
        .from("invoices")
        .select("id, type, iva_amount, status")
        .eq("user_id", userId)
        .eq("status", "confirmed")
        .gte("issue_date", ivaStart)
        .lte("issue_date", ivaEnd),
      // Year invoices (for YTD)
      admin
        .from("invoices")
        .select("id, type, issue_date, subtotal_base, total_amount, counterparty_name, reteica_amount, autoretefuente_amount, retefuente_cliente_amount, retefuente_cliente_rate, status")
        .eq("user_id", userId)
        .eq("status", "confirmed")
        .gte("issue_date", yearStart)
        .lte("issue_date", yearEnd),
      // Invoice-transaction matches (year)
      admin
        .from("invoice_transaction_matches")
        .select("invoice_id, matched_amount")
        .eq("user_id", userId),
      // Anticipos
      admin
        .from("transactions")
        .select("id, date, amount, responsible_id, category, category_id, categories!transactions_category_id_fkey(name)")
        .eq("user_id", userId)
        .eq("type", "ingreso")
        .is("invoice_id", null)
        .is("deleted_at", null)
        .gte("date", yearStart)
        .lte("date", yearEnd),
      // Tax settings
      admin
        .from("tax_settings")
        .select("retefuente_compra_rate")
        .eq("user_id", userId)
        .maybeSingle(),
      // Initial financial state
      admin
        .from("initial_financial_state")
        .select("saldo_bancos, cuentas_por_cobrar, cuentas_por_pagar, anticipos_de_clientes, iva_a_favor, iva_por_pagar, retefuente_por_pagar, ica_por_pagar")
        .eq("user_id", userId)
        .maybeSingle(),
      // Initial state details
      admin
        .from("initial_state_details")
        .select("id, invoice_id, amount, responsible_name, field_type")
        .eq("user_id", userId)
        .eq("field_type", "anticipos_de_clientes"),
      // Responsibles
      admin
        .from("responsibles")
        .select("id, name")
        .eq("user_id", userId),
      // Inventory products
      admin
        .from("inventory_products")
        .select("id, reference, name, stock_system, stock_physical, cost_per_unit")
        .eq("user_id", userId)
        .eq("active", true),
      // Inventory movements (last 30 days for rotation)
      admin
        .from("inventory_movements")
        .select("product_id, movement_type, quantity, movement_date")
        .eq("user_id", userId)
        .gte("movement_date", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]),
      // Business patterns for smart alerting
      admin
        .from("business_patterns")
        .select("pattern_type, description, amount_min, amount_max, frequency_days, last_occurrence, entities, occurrences, confidence, status")
        .eq("user_id", userId)
        .gte("occurrences", 3)
        .order("confidence", { ascending: false })
        .limit(20),
      // Business memory for predictions
      admin
        .from("business_memory")
        .select("metric_key, metric_value")
        .eq("user_id", userId)
        .in("metric_key", ["predictions", "general"]),
    ]);

    const txCurrent = txCurrentRes.data || [];
    const txPrev = txPrevRes.data || [];
    const invPeriod = invPeriodRes.data || [];
    const invIva = invIvaRes.data || [];
    const invYear = invYearRes.data || [];
    const matches = matchesRes.data || [];
    const anticiposTx = anticiposTxRes.data || [];
    const retefuenteCompraRate = taxSettingsRes.data?.retefuente_compra_rate || 0;
    const initialState = initialStateRes.data || null;
    const initialDetails = initialDetailsRes.data || [];
    const allResponsibles = responsiblesRes.data || [];
    const patterns = patternsRes.data || [];
    const memoryData = memoryRes.data || [];
    const predictionsEntry = memoryData.find((m: any) => m.metric_key === "predictions");
    const predictions = Array.isArray(predictionsEntry?.metric_value) ? predictionsEntry.metric_value : [];

    // Build responsible name lookup
    const respNameById = new Map<string, string>();
    allResponsibles.forEach((r: any) => respNameById.set(r.id, r.name));

    console.log(`[cfo-insights] txCurrent=${txCurrent.length} txPrev=${txPrev.length} invPeriod=${invPeriod.length} invIva=${invIva.length}`);

    const insights: any[] = [];

    // ─── INSIGHT A: Flujo del periodo ───
    const ingresos = txCurrent.filter((t: any) => (t.amount ?? 0) > 0).reduce((s: number, t: any) => s + (t.amount ?? 0), 0);
    const egresos = Math.abs(txCurrent.filter((t: any) => (t.amount ?? 0) < 0).reduce((s: number, t: any) => s + (t.amount ?? 0), 0));
    const neto = ingresos - egresos;

    const prevIngresos = txPrev.filter((t: any) => (t.amount ?? 0) > 0).reduce((s: number, t: any) => s + (t.amount ?? 0), 0);
    const prevEgresos = Math.abs(txPrev.filter((t: any) => (t.amount ?? 0) < 0).reduce((s: number, t: any) => s + (t.amount ?? 0), 0));
    const prevNeto = prevIngresos - prevEgresos;

    if (txCurrent.length > 0) {
      const changePercent = prevNeto !== 0 ? ((neto - prevNeto) / Math.abs(prevNeto)) * 100 : null;
      const trend = changePercent !== null ? (changePercent >= 0 ? "up" : "down") : null;

      // Find top expense category
      const catExpenses: Record<string, number> = {};
      txCurrent.forEach((t: any) => {
        if ((t.amount ?? 0) < 0) {
          const catName = t.categories?.name || "Sin categoría";
          catExpenses[catName] = (catExpenses[catName] || 0) + Math.abs(t.amount ?? 0);
        }
      });
      const topCat = Object.entries(catExpenses).sort((a, b) => b[1] - a[1])[0];

      const saldoInicial = initialState?.saldo_bancos || 0;
      let text = `Tus ingresos suman ${fmt(ingresos)} y tus egresos ${fmt(egresos)}, dejándote un neto de ${fmt(neto)}.`;
      if (saldoInicial > 0) {
        text += ` Partiendo de un saldo inicial de ${fmt(saldoInicial)}, tu posición de caja estimada es ${fmt(saldoInicial + neto)}.`;
      }
      if (changePercent !== null) {
        const sign = changePercent >= 0 ? "+" : "";
        text += ` Eso es ${sign}${changePercent.toFixed(0)}% frente al periodo anterior.`;
      }
      if (topCat && egresos > 0) {
        text += ` Tu mayor rubro de gasto es "${topCat[0]}" con ${fmt(topCat[1])}.`;
      }

      insights.push({
        key: "flujo",
        title: neto >= 0 ? "Flujo positivo 💰" : "Ojo con el flujo ⚠️",
        text,
        recommendation: neto >= 0
          ? "Buen momento para revisar si hay anticipos pendientes de facturar."
          : topCat
            ? `Revisa los egresos en "${topCat[0]}" para estabilizar caja.`
            : "Revisa tus egresos más grandes para estabilizar caja.",
        action: { label: "Ver reporte", path: "/reports" },
        impact: Math.abs(neto),
        trend,
        changePercent: changePercent !== null ? Math.round(changePercent) : null,
      });
    }

    // ─── INSIGHT B: Impuestos ───
    const ivaVentas = invIva.filter((i: any) => i.type === "venta").reduce((s: number, i: any) => s + (i.iva_amount || 0), 0);
    const ivaCompras = invIva.filter((i: any) => i.type === "compra").reduce((s: number, i: any) => s + (i.iva_amount || 0), 0);
    const ivaNeto = ivaVentas - ivaCompras;

    const reteicaPeriod = invPeriod.filter((i: any) => i.type === "venta").reduce((s: number, i: any) => s + (i.reteica_amount || 0), 0);
    const reteicaYtd = invYear.filter((i: any) => i.type === "venta").reduce((s: number, i: any) => s + (i.reteica_amount || 0), 0);
    const retefuentePeriod = invPeriod.filter((i: any) => i.type === "venta").reduce((s: number, i: any) => s + (i.autoretefuente_amount || 0), 0)
      + invPeriod.filter((i: any) => i.type === "compra").reduce((s: number, i: any) => s + Math.round(i.subtotal_base * retefuenteCompraRate), 0);
    const retefuenteYtd = invYear.filter((i: any) => i.type === "venta").reduce((s: number, i: any) => s + (i.autoretefuente_amount || 0), 0)
      + invYear.filter((i: any) => i.type === "compra").reduce((s: number, i: any) => s + Math.round(i.subtotal_base * retefuenteCompraRate), 0);

    if (invIva.length > 0 || invPeriod.length > 0) {
      let text = "";
      if (invIva.length > 0) {
        text += ivaNeto >= 0
          ? `En el periodo fiscal ${ivaLabel} vas con ${fmt(ivaNeto)} de IVA por pagar (generado ${fmt(ivaVentas)} menos descontable ${fmt(ivaCompras)}).`
          : `Tienes ${fmt(Math.abs(ivaNeto))} de IVA a favor en ${ivaLabel}. Tus compras generaron más crédito que tus ventas.`;
      }
      if (reteicaPeriod > 0) {
        text += ` ReteICA del periodo: ${fmt(reteicaPeriod)} (acumulado año: ${fmt(reteicaYtd)}).`;
      }
      if (retefuentePeriod > 0) {
        text += ` Retefuente del periodo: ${fmt(retefuentePeriod)} (acumulado año: ${fmt(retefuenteYtd)}).`;
      }

      if (text) {
        insights.push({
          key: "impuestos",
          title: "Resumen de impuestos 🧾",
          text,
          recommendation: "Revisa el detalle de tus facturas para validar las cifras antes de declarar.",
          action: { label: "Ver facturas", path: "/invoices" },
          impact: Math.abs(ivaNeto) + reteicaPeriod + retefuentePeriod,
        });
      }
    }

    // ─── INSIGHT C: Anticipos sin facturar ───
    // Same logic as AdvancesReport: Ingreso + Category "Ventas" + Responsible != "Otros" + no invoice
    const filteredAnticipos = anticiposTx.filter((t: any) => {
      const catName = (t.categories?.name || t.category || "").toLowerCase();
      const hasResp = Boolean(t.responsible_id);
      const respName = t.responsible_id ? respNameById.get(t.responsible_id) : null;
      const isVentas = catName === "ventas";
      const isRespOtros = respName?.toLowerCase() === "otros";
      return hasResp && isVentas && !isRespOtros;
    });

    // Also include initial state details without invoice (unlinked advances from prior periods)
    const unlinkedInitialAnticipos = initialDetails.filter((d: any) => !d.invoice_id);
    const totalAnticiposTx = filteredAnticipos.reduce((s: number, t: any) => s + Math.abs(t.amount ?? 0), 0);
    const totalAnticiposInitial = unlinkedInitialAnticipos.reduce((s: number, d: any) => s + Math.abs(d.amount ?? 0), 0);
    const totalAnticipos = totalAnticiposTx + totalAnticiposInitial;
    const anticiposCount = filteredAnticipos.length + unlinkedInitialAnticipos.length;

    if (anticiposCount > 0) {
      let anticipoText = `Tienes ${anticiposCount} anticipo${anticiposCount > 1 ? "s" : ""} sin factura por ${fmt(totalAnticipos)}.`;
      if (totalAnticiposInitial > 0 && totalAnticiposTx > 0) {
        anticipoText += ` Incluye ${fmt(totalAnticiposInitial)} de periodos anteriores y ${fmt(totalAnticiposTx)} del año en curso.`;
      }
      insights.push({
        key: "anticipos",
        title: "Anticipos sin factura 📋",
        text: anticipoText,
        recommendation: "Asocia una factura existente o emite una nueva para cada anticipo. Esto te ayuda con la DIAN y a mantener limpia tu contabilidad.",
        action: { label: "Ver anticipos", path: "/reports" },
        impact: totalAnticipos,
      });
    }

    // ─── INSIGHT D: Cuentas por cobrar ───
    // Same logic as AccountsReceivableReport: subtract payments + retefuente + initial advances
    const salesInvoices = invYear.filter((i: any) => i.type === "venta");
    if (salesInvoices.length > 0) {
      const salesIds = salesInvoices.map((i: any) => i.id);
      const { data: directPayments } = await admin
        .from("transactions")
        .select("invoice_id, amount")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .in("invoice_id", salesIds);

      const payments = new Map<string, number>();
      // Direct transaction payments
      (directPayments || []).forEach((p: any) => {
        if (p.invoice_id) payments.set(p.invoice_id, (payments.get(p.invoice_id) || 0) + Math.abs(p.amount ?? 0));
      });
      // Manual matches
      matches.forEach((m: any) => {
        payments.set(m.invoice_id, (payments.get(m.invoice_id) || 0) + Math.abs(m.matched_amount));
      });
      // Initial state advance payments linked to invoices
      initialDetails.filter((d: any) => d.invoice_id).forEach((d: any) => {
        payments.set(d.invoice_id, (payments.get(d.invoice_id) || 0) + Math.abs(d.amount ?? 0));
      });

      let totalCxC = 0;
      let cxcCount = 0;
      let overdue30 = 0;
      const clientDebt = new Map<string, number>();
      const today = new Date();

      salesInvoices.forEach((inv: any) => {
        const paid = payments.get(inv.id) || 0;
        // Subtract retefuente cliente (same logic as CxC report)
        const savedRetefuente = inv.retefuente_cliente_amount ?? 0;
        const rawRate = inv.retefuente_cliente_rate;
        const hasExplicitRate = rawRate !== null && rawRate !== undefined;
        const effectiveRate = hasExplicitRate ? rawRate : 0.025;
        const retefuenteCliente = savedRetefuente > 0
          ? savedRetefuente
          : Math.round((inv.subtotal_base ?? 0) * effectiveRate);

        const totalDeducted = paid + retefuenteCliente;
        const pending = Math.max(0, inv.total_amount - totalDeducted);
        if (pending > 0) {
          totalCxC += pending;
          cxcCount++;
          const name = inv.counterparty_name || "Sin nombre";
          clientDebt.set(name, (clientDebt.get(name) || 0) + pending);
          const issueDate = new Date(inv.issue_date);
          const daysSince = Math.floor((today.getTime() - issueDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysSince > 30) overdue30 += pending;
        }
      });

      // Add initial CxC if configured
      const initialCxC = initialState?.cuentas_por_cobrar || 0;
      totalCxC += initialCxC;

      if (totalCxC > 0) {
        const topDebtor = Array.from(clientDebt.entries()).sort((a, b) => b[1] - a[1])[0];
        let text = `Tienes ${fmt(totalCxC)} pendientes de cobro`;
        if (initialCxC > 0) {
          text += ` (incluye ${fmt(initialCxC)} del saldo inicial)`;
        }
        text += ` en ${cxcCount} factura${cxcCount > 1 ? "s" : ""}.`;
        if (overdue30 > 0) {
          text += ` De eso, ${fmt(overdue30)} tiene más de 30 días.`;
        }
        if (topDebtor) {
          text += ` Tu mayor deudor es ${topDebtor[0]} con ${fmt(topDebtor[1])}.`;
        }

        insights.push({
          key: "cxc",
          title: "Cuentas por cobrar 🔔",
          text,
          recommendation: overdue30 > 0
            ? "Prioriza el cobro de las facturas con más de 30 días. Un recordatorio amable puede hacer la diferencia."
            : "Mantén seguimiento de estos saldos para evitar que se vuelvan morosos.",
          action: { label: "Ver CxC", path: "/reports" },
          impact: totalCxC,
        });
      }
    }

    // ─── INSIGHT D2: Cuentas por pagar (from initial state + purchase invoices) ───
    const purchaseInvoices = invYear.filter((i: any) => i.type === "compra");
    const totalCxPInvoices = purchaseInvoices.reduce((s: number, i: any) => s + (i.total_amount || 0), 0);
    const initialCxP = initialState?.cuentas_por_pagar || 0;
    const totalCxP = totalCxPInvoices + initialCxP;

    if (totalCxP > 0) {
      let text = `Tienes ${fmt(totalCxP)} en cuentas por pagar`;
      if (initialCxP > 0) {
        text += ` (incluye ${fmt(initialCxP)} del saldo inicial)`;
      }
      text += `.`;

      insights.push({
        key: "cxp",
        title: "Cuentas por pagar 💳",
        text,
        recommendation: "Revisa los plazos de pago de tus proveedores y prioriza las obligaciones más urgentes.",
        action: { label: "Ver CxP", path: "/reports" },
        impact: totalCxP,
      });
    }

    // ─── INSIGHT E: Concentración de clientes ───
    const salesPeriod = invPeriod.filter((i: any) => i.type === "venta");
    if (salesPeriod.length >= 2) {
      const totalFacturado = salesPeriod.reduce((s: number, i: any) => s + (i.total_amount || 0), 0);
      const byClient = new Map<string, number>();
      salesPeriod.forEach((i: any) => {
        const name = i.counterparty_name || "Sin nombre";
        byClient.set(name, (byClient.get(name) || 0) + (i.total_amount || 0));
      });
      const sorted = Array.from(byClient.entries()).sort((a, b) => b[1] - a[1]);
      const topClient = sorted[0];
      if (topClient && totalFacturado > 0) {
        const pct = (topClient[1] / totalFacturado) * 100;
        if (pct > 25) {
          const isRisk = pct > 40;
          insights.push({
            key: "concentracion",
            title: isRisk ? "Riesgo de concentración ⚠️" : "Cliente principal 📊",
            text: `${topClient[0]} representa el ${pct.toFixed(0)}% de tu facturación del periodo (${fmt(topClient[1])} de ${fmt(totalFacturado)}).`,
            recommendation: isRisk
              ? "Depender tanto de un solo cliente es riesgoso. Busca diversificar tu cartera para proteger tu flujo."
              : "Tu principal cliente está en un rango saludable. Sigue diversificando para mantener estabilidad.",
            action: { label: "Ver clientes", path: "/invoices" },
            impact: topClient[1],
          });
        }
      }
    }

    // ─── INSIGHT F: Mayor egreso / outlier ───
    const egresosTx = txCurrent.filter((t: any) => (t.amount ?? 0) < 0);
    if (egresosTx.length >= 3) {
      const sorted = [...egresosTx].sort((a: any, b: any) => (a.amount ?? 0) - (b.amount ?? 0)); // most negative first
      const biggest = sorted[0];
      const avgEgreso = egresos / egresosTx.length;
      const biggestAbs = Math.abs(biggest.amount ?? 0);

      if (biggestAbs > avgEgreso * 2.5) {
        insights.push({
          key: "outlier",
          title: "Egreso fuera de lo normal 🔍",
          text: `"${(biggest.description || "").substring(0, 60)}" por ${fmt(biggestAbs)} es ${(biggestAbs / avgEgreso).toFixed(1)}x el promedio de tus egresos en el periodo.`,
          recommendation: "Revisa si este egreso es recurrente o fue un gasto excepcional. Entenderlo te ayuda a planear mejor.",
          action: { label: "Ver transacciones", path: "/transactions" },
          impact: biggestAbs,
        });
      }
    }

    // ─── INSIGHT G: Conciliación bancaria ───
    const totalTx = txCurrent.length;
    if (totalTx > 0) {
      const pendientes = txCurrent.filter((t: any) => !t.responsible_id);
      const conciliadas = totalTx - pendientes.length;
      const pctConciliado = (conciliadas / totalTx) * 100;
      const montoPendiente = pendientes.reduce((s: number, t: any) => s + Math.abs(t.amount ?? 0), 0);

      if (pctConciliado >= 100) {
        insights.push({
          key: "conciliacion",
          title: "Conciliación al día ✅",
          text: `Todas tus ${totalTx} transacciones del periodo tienen responsable asignado. Tu conciliación bancaria está completa.`,
          recommendation: "Excelente trabajo. Mantén este hábito para tener siempre claridad sobre tu flujo de caja.",
          action: { label: "Ver transacciones", path: "/transactions" },
          impact: 1,
          trend: "up" as const,
        });
      } else {
        insights.push({
          key: "conciliacion",
          title: pendientes.length > 10 ? "Conciliación atrasada ⚠️" : "Pendientes por conciliar 📌",
          text: `Tienes ${pendientes.length} de ${totalTx} transacciones sin responsable asignado (${fmt(montoPendiente)}). Eso es el ${(100 - pctConciliado).toFixed(0)}% de tus movimientos del periodo.`,
          recommendation: pendientes.length > 10
            ? "Tienes bastantes movimientos sin clasificar. Dedica unos minutos a asignar responsables para tener claridad real de tu flujo."
            : "Asigna responsable a estas transacciones para completar tu conciliación y tener reportes más precisos.",
          action: { label: "Conciliar", path: "/transactions" },
          impact: montoPendiente > 0 ? montoPendiente : pendientes.length * 1000,
          trend: "down" as const,
        });
      }
    }

    // ─── INSIGHT H: Inventario operativo ───
    const invProducts = inventoryRes.data || [];
    const invMovements = inventoryMovRes.data || [];
    if (invProducts.length > 0) {
      const totalValue = invProducts.reduce((s: number, p: any) => s + (p.stock_system ?? 0) * (p.cost_per_unit ?? 0), 0);
      const productsWithDiff = invProducts.filter((p: any) => p.stock_physical !== null && p.stock_system !== p.stock_physical);
      const totalDiffValue = productsWithDiff.reduce((s: number, p: any) => s + Math.abs((p.stock_system - p.stock_physical) * p.cost_per_unit), 0);
      const pctDescuadre = totalValue > 0 ? (totalDiffValue / totalValue) * 100 : 0;

      // No-movement products
      const movProductIds = new Set(invMovements.map((m: any) => m.product_id));
      const noMovement = invProducts.filter((p: any) => !movProductIds.has(p.id));
      const noMovValue = noMovement.reduce((s: number, p: any) => s + (p.stock_system ?? 0) * (p.cost_per_unit ?? 0), 0);

      // Critical products (low stock with sales)
      const salesByProduct = new Map<string, number>();
      invMovements.filter((m: any) => m.movement_type === "salida").forEach((m: any) => {
        salesByProduct.set(m.product_id, (salesByProduct.get(m.product_id) || 0) + Math.abs(m.quantity ?? 0));
      });
      const criticalProducts = invProducts.filter((p: any) => {
        const sales30 = salesByProduct.get(p.id) || 0;
        const avgDaily = sales30 / 30;
        return avgDaily > 0 && (p.stock_system / avgDaily) < 15;
      });

      if (totalDiffValue > 0 && pctDescuadre > 2) {
        const topDiff = productsWithDiff
          .sort((a: any, b: any) => Math.abs((b.stock_system - b.stock_physical) * b.cost_per_unit) - Math.abs((a.stock_system - a.stock_physical) * a.cost_per_unit))
          .slice(0, 2)
          .map((p: any) => p.name || p.reference)
          .join(", ");

        insights.push({
          key: "inventario_diferencias",
          title: pctDescuadre > 5 ? "Fuga de inventario ⚠️" : "Diferencias de inventario 📦",
          text: `Tienes ${fmt(totalDiffValue)} en diferencias entre tu inventario contable y el conteo físico (${pctDescuadre.toFixed(1)}% del total). Los productos con mayor diferencia son: ${topDiff}.${pctDescuadre > 5 ? " Esto puede indicar ventas sin factura, pérdidas operativas o errores de conteo." : ""}`,
          recommendation: pctDescuadre > 5
            ? "Revisa urgentemente los productos con mayor diferencia. Un descuadre de este nivel puede estar sobreestimando tu utilidad real."
            : "Revisa los productos con diferencia y actualiza tu conteo físico para mantener el inventario alineado.",
          action: { label: "Ver inventario", path: "/inventory" },
          impact: totalDiffValue,
        });
      }

      if (noMovement.length > 0 && noMovValue > 500000) {
        insights.push({
          key: "inventario_inmovilizado",
          title: "Capital detenido en inventario 📦",
          text: `Tienes ${noMovement.length} producto${noMovement.length > 1 ? "s" : ""} sin movimiento en los últimos 30 días, con un valor de ${fmt(noMovValue)} en capital inmovilizado.`,
          recommendation: "Evalúa si puedes liquidar ese inventario con descuentos o promociones para liberar capital de trabajo.",
          action: { label: "Ver inventario", path: "/inventory" },
          impact: noMovValue,
        });
      }

      if (criticalProducts.length > 0) {
        const names = criticalProducts.slice(0, 2).map((p: any) => p.name || p.reference).join(", ");
        insights.push({
          key: "inventario_critico",
          title: "Stock crítico 🔴",
          text: `${criticalProducts.length} producto${criticalProducts.length > 1 ? "s" : ""} con menos de 15 días de stock: ${names}. Si no reabasteces, podrías perder ventas.`,
          recommendation: "Contacta a tus proveedores y genera órdenes de compra para los productos en riesgo de desabastecimiento.",
          action: { label: "Ver inventario", path: "/inventory" },
          impact: criticalProducts.reduce((s: number, p: any) => s + (p.stock_system ?? 0) * (p.cost_per_unit ?? 0), 0),
        });
      }
    }

    // Sort by impact
    insights.sort((a, b) => (b.impact || 0) - (a.impact || 0));

    // Limit to 7
    const result = insights.slice(0, 7);

    console.log(`[cfo-insights] generated ${result.length} insights`);

    return new Response(JSON.stringify({ insights: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[cfo-insights] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function fmt(value: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
