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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;
    const admin = createClient(supabaseUrl, serviceKey);

    // Fetch all transaction data
    const [txRes, invRes, respRes] = await Promise.all([
      admin.from("transactions")
        .select("id, date, description, amount, credit, debit, type, category_id, responsible_id, invoice_id, operational_type, categories!transactions_category_id_fkey(name)")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("date", { ascending: true })
        .limit(5000),
      admin.from("invoices")
        .select("id, type, issue_date, total_amount, counterparty_name, status")
        .eq("user_id", userId)
        .eq("status", "confirmed")
        .order("issue_date", { ascending: true })
        .limit(2000),
      admin.from("responsibles")
        .select("id, name")
        .eq("user_id", userId),
    ]);

    const transactions = txRes.data || [];
    const invoices = invRes.data || [];
    const responsibles = respRes.data || [];

    const respMap: Record<string, string> = {};
    responsibles.forEach((r: any) => { respMap[r.id] = r.name; });

    const fmt = (n: number) => Math.round(n);
    const now = new Date();

    // ==========================================
    // 1. COMPUTE BUSINESS METRICS
    // ==========================================

    const ingresos = transactions.filter((t: any) => (t.amount ?? 0) > 0);
    const egresos = transactions.filter((t: any) => (t.amount ?? 0) < 0);

    const totalIngresos = ingresos.reduce((s: number, t: any) => s + (t.amount ?? 0), 0);
    const totalEgresos = Math.abs(egresos.reduce((s: number, t: any) => s + (t.amount ?? 0), 0));

    const avgIngresos = ingresos.length > 0 ? totalIngresos / ingresos.length : 0;
    const avgEgresos = egresos.length > 0 ? totalEgresos / egresos.length : 0;

    // Monthly aggregates
    const monthlyData: Record<string, { ingresos: number; egresos: number; count_in: number; count_eg: number }> = {};
    transactions.forEach((t: any) => {
      const d = new Date(t.date + "T00:00:00");
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!monthlyData[key]) monthlyData[key] = { ingresos: 0, egresos: 0, count_in: 0, count_eg: 0 };
      if ((t.amount ?? 0) > 0) {
        monthlyData[key].ingresos += t.amount;
        monthlyData[key].count_in++;
      } else {
        monthlyData[key].egresos += Math.abs(t.amount ?? 0);
        monthlyData[key].count_eg++;
      }
    });

    const months = Object.keys(monthlyData).sort();
    const monthlyIngresos = months.map(k => monthlyData[k].ingresos);
    const monthlyEgresos = months.map(k => monthlyData[k].egresos);

    const avgMonthlyIngresos = monthlyIngresos.length > 0 ? monthlyIngresos.reduce((a, b) => a + b, 0) / monthlyIngresos.length : 0;
    const avgMonthlyEgresos = monthlyEgresos.length > 0 ? monthlyEgresos.reduce((a, b) => a + b, 0) / monthlyEgresos.length : 0;

    // Top clients by invoiced amount
    const clientTotals: Record<string, number> = {};
    invoices.filter((i: any) => i.type === "venta").forEach((i: any) => {
      const name = i.counterparty_name || "Sin nombre";
      clientTotals[name] = (clientTotals[name] || 0) + (i.total_amount ?? 0);
    });
    const topClients = Object.entries(clientTotals).sort((a, b) => b[1] - a[1]).slice(0, 10);

    // Top providers
    const providerTotals: Record<string, number> = {};
    invoices.filter((i: any) => i.type === "compra").forEach((i: any) => {
      const name = i.counterparty_name || "Sin nombre";
      providerTotals[name] = (providerTotals[name] || 0) + (i.total_amount ?? 0);
    });
    const topProviders = Object.entries(providerTotals).sort((a, b) => b[1] - a[1]).slice(0, 10);

    // Cash cycle estimate (average days between income events)
    const incomeDates = ingresos.map((t: any) => new Date(t.date + "T00:00:00").getTime()).sort();
    let avgIncomeCycleDays = 0;
    if (incomeDates.length > 1) {
      const diffs: number[] = [];
      for (let i = 1; i < incomeDates.length; i++) {
        diffs.push((incomeDates[i] - incomeDates[i - 1]) / (1000 * 60 * 60 * 24));
      }
      avgIncomeCycleDays = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    }

    // Seasonality: which months have highest/lowest income
    const monthAvgs: Record<number, { sum: number; count: number }> = {};
    months.forEach(k => {
      const m = parseInt(k.split("-")[1]);
      if (!monthAvgs[m]) monthAvgs[m] = { sum: 0, count: 0 };
      monthAvgs[m].sum += monthlyData[k].ingresos;
      monthAvgs[m].count++;
    });
    const seasonality = Object.entries(monthAvgs)
      .map(([m, v]) => ({ month: parseInt(m), avg: v.sum / v.count }))
      .sort((a, b) => b.avg - a.avg);

    // Save metrics
    const metrics: Record<string, any> = {
      general: {
        total_transactions: transactions.length,
        total_ingresos: fmt(totalIngresos),
        total_egresos: fmt(totalEgresos),
        avg_ingreso: fmt(avgIngresos),
        avg_egreso: fmt(avgEgresos),
        avg_monthly_ingresos: fmt(avgMonthlyIngresos),
        avg_monthly_egresos: fmt(avgMonthlyEgresos),
        months_with_data: months.length,
        first_month: months[0] || null,
        last_month: months[months.length - 1] || null,
        avg_income_cycle_days: Math.round(avgIncomeCycleDays),
      },
      top_clients: topClients.map(([name, amount]) => ({ name, amount: fmt(amount) })),
      top_providers: topProviders.map(([name, amount]) => ({ name, amount: fmt(amount) })),
      seasonality: seasonality.slice(0, 4).map(s => ({
        month: s.month,
        avg_ingresos: fmt(s.avg),
      })),
      invoicing: {
        total_sales_invoices: invoices.filter((i: any) => i.type === "venta").length,
        total_purchase_invoices: invoices.filter((i: any) => i.type === "compra").length,
        total_facturado_ventas: fmt(invoices.filter((i: any) => i.type === "venta").reduce((s: number, i: any) => s + (i.total_amount ?? 0), 0)),
        total_facturado_compras: fmt(invoices.filter((i: any) => i.type === "compra").reduce((s: number, i: any) => s + (i.total_amount ?? 0), 0)),
      },
      last_updated: now.toISOString(),
    };

    // Upsert each metric
    for (const [key, value] of Object.entries(metrics)) {
      await admin.from("business_memory").upsert(
        { user_id: userId, metric_key: key, metric_value: value, updated_at: now.toISOString() },
        { onConflict: "user_id,metric_key" }
      );
    }

    // ==========================================
    // 2. DETECT PATTERNS
    // ==========================================

    // Group similar transactions by description similarity + amount range
    const txGroups: Record<string, {
      descriptions: string[];
      amounts: number[];
      dates: string[];
      entities: Set<string>;
      type: string;
    }> = {};

    transactions.forEach((t: any) => {
      // Normalize description for grouping
      const desc = (t.description || "").toLowerCase().trim();
      const words = desc.split(/\s+/).slice(0, 4).join(" "); // first 4 words as key
      const amount = Math.abs(t.amount ?? 0);
      if (amount < 10000) return; // skip tiny amounts

      const groupKey = `${t.type || "unknown"}_${words}`;
      if (!txGroups[groupKey]) {
        txGroups[groupKey] = { descriptions: [], amounts: [], dates: [], entities: new Set(), type: t.type || "unknown" };
      }
      txGroups[groupKey].descriptions.push(t.description || "");
      txGroups[groupKey].amounts.push(amount);
      txGroups[groupKey].dates.push(t.date);
      if (t.responsible_id && respMap[t.responsible_id]) {
        txGroups[groupKey].entities.add(respMap[t.responsible_id]);
      }
    });

    // Also detect patterns from invoice counterparties
    const invoiceGroups: Record<string, { amounts: number[]; dates: string[]; type: string }> = {};
    invoices.forEach((inv: any) => {
      const name = (inv.counterparty_name || "").toLowerCase().trim();
      if (!name) return;
      const key = `inv_${inv.type}_${name}`;
      if (!invoiceGroups[key]) invoiceGroups[key] = { amounts: [], dates: [], type: inv.type };
      invoiceGroups[key].amounts.push(inv.total_amount ?? 0);
      invoiceGroups[key].dates.push(inv.issue_date);
    });

    // Build patterns from groups that appear 2+ times
    const detectedPatterns: {
      pattern_type: string;
      description: string;
      amount_min: number;
      amount_max: number;
      frequency_days: number;
      last_occurrence: string;
      entities: string[];
      occurrences: number;
      confidence: number;
    }[] = [];

    // From transaction groups
    for (const [key, group] of Object.entries(txGroups)) {
      if (group.amounts.length < 2) continue;

      const sortedDates = group.dates.sort();
      const dateDiffs: number[] = [];
      for (let i = 1; i < sortedDates.length; i++) {
        const d1 = new Date(sortedDates[i - 1] + "T00:00:00").getTime();
        const d2 = new Date(sortedDates[i] + "T00:00:00").getTime();
        dateDiffs.push(Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
      }

      const avgFreq = dateDiffs.length > 0 ? Math.round(dateDiffs.reduce((a, b) => a + b, 0) / dateDiffs.length) : 0;
      const minAmount = Math.min(...group.amounts);
      const maxAmount = Math.max(...group.amounts);
      const avgAmount = group.amounts.reduce((a, b) => a + b, 0) / group.amounts.length;

      // Confidence: higher if amounts are consistent and frequency is regular
      const amountVariance = maxAmount > 0 ? (maxAmount - minAmount) / avgAmount : 1;
      const freqVariance = dateDiffs.length > 0
        ? dateDiffs.reduce((s, d) => s + Math.abs(d - avgFreq), 0) / dateDiffs.length / Math.max(avgFreq, 1)
        : 1;
      const confidence = Math.max(0, Math.min(1, 1 - (amountVariance * 0.4 + freqVariance * 0.6)));

      const patternType = group.type === "ingreso" ? "ingreso_recurrente" :
                          group.type === "egreso" ? "egreso_recurrente" : "movimiento_recurrente";

      const mostCommonDesc = group.descriptions.sort((a, b) =>
        group.descriptions.filter(d => d === a).length - group.descriptions.filter(d => d === b).length
      ).pop() || "";

      detectedPatterns.push({
        pattern_type: patternType,
        description: mostCommonDesc.substring(0, 200),
        amount_min: Math.round(minAmount),
        amount_max: Math.round(maxAmount),
        frequency_days: avgFreq,
        last_occurrence: sortedDates[sortedDates.length - 1],
        entities: Array.from(group.entities).slice(0, 5),
        occurrences: group.amounts.length,
        confidence: Math.round(confidence * 100) / 100,
      });
    }

    // From invoice groups
    for (const [key, group] of Object.entries(invoiceGroups)) {
      if (group.amounts.length < 2) continue;

      const sortedDates = group.dates.sort();
      const dateDiffs: number[] = [];
      for (let i = 1; i < sortedDates.length; i++) {
        const d1 = new Date(sortedDates[i - 1] + "T00:00:00").getTime();
        const d2 = new Date(sortedDates[i] + "T00:00:00").getTime();
        dateDiffs.push(Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
      }

      const avgFreq = dateDiffs.length > 0 ? Math.round(dateDiffs.reduce((a, b) => a + b, 0) / dateDiffs.length) : 0;
      const minAmount = Math.min(...group.amounts);
      const maxAmount = Math.max(...group.amounts);
      const avgAmount = group.amounts.reduce((a, b) => a + b, 0) / group.amounts.length;
      const amountVariance = maxAmount > 0 ? (maxAmount - minAmount) / avgAmount : 1;
      const freqVariance = dateDiffs.length > 0
        ? dateDiffs.reduce((s, d) => s + Math.abs(d - avgFreq), 0) / dateDiffs.length / Math.max(avgFreq, 1)
        : 1;
      const confidence = Math.max(0, Math.min(1, 1 - (amountVariance * 0.4 + freqVariance * 0.6)));

      const entityName = key.replace(/^inv_(venta|compra)_/, "");
      const patternType = group.type === "venta" ? "facturacion_recurrente_cliente" : "compra_recurrente_proveedor";

      detectedPatterns.push({
        pattern_type: patternType,
        description: `Facturación recurrente: ${entityName}`,
        amount_min: Math.round(minAmount),
        amount_max: Math.round(maxAmount),
        frequency_days: avgFreq,
        last_occurrence: sortedDates[sortedDates.length - 1],
        entities: [entityName],
        occurrences: group.amounts.length,
        confidence: Math.round(confidence * 100) / 100,
      });
    }

    // Sort by confidence and occurrences
    detectedPatterns.sort((a, b) => (b.confidence * b.occurrences) - (a.confidence * a.occurrences));

    // Keep top 30 patterns
    const topPatterns = detectedPatterns.slice(0, 30);

    // Delete old patterns and insert new ones
    await admin.from("business_patterns").delete().eq("user_id", userId);
    if (topPatterns.length > 0) {
      await admin.from("business_patterns").insert(
        topPatterns.map(p => ({
          user_id: userId,
          pattern_type: p.pattern_type,
          description: p.description,
          amount_min: p.amount_min,
          amount_max: p.amount_max,
          frequency_days: p.frequency_days,
          last_occurrence: p.last_occurrence,
          entities: p.entities,
          occurrences: p.occurrences,
          confidence: p.confidence,
          status: p.occurrences >= 3 ? "active" : "new",
        }))
      );
    }

    // ==========================================
    // 3. GENERATE PREDICTIONS
    // ==========================================
    const predictions: any[] = [];

    // For active patterns, predict next occurrence
    for (const p of topPatterns.filter(p => p.occurrences >= 3 && p.frequency_days > 0 && p.confidence >= 0.3)) {
      const lastDate = new Date(p.last_occurrence + "T00:00:00");
      const nextDate = new Date(lastDate.getTime() + p.frequency_days * 24 * 60 * 60 * 1000);
      const daysUntil = Math.round((nextDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysUntil > -7 && daysUntil < 45) {
        const avgAmount = (p.amount_min + p.amount_max) / 2;
        predictions.push({
          type: p.pattern_type,
          description: p.description,
          estimated_amount: Math.round(avgAmount),
          estimated_date: nextDate.toISOString().split("T")[0],
          days_until: daysUntil,
          confidence: p.confidence,
          entities: p.entities,
        });
      }
    }

    predictions.sort((a, b) => a.days_until - b.days_until);

    // Save predictions as a metric
    await admin.from("business_memory").upsert(
      {
        user_id: userId,
        metric_key: "predictions",
        metric_value: predictions.slice(0, 10),
        updated_at: now.toISOString(),
      },
      { onConflict: "user_id,metric_key" }
    );

    // Count new learnings
    const newPatterns = topPatterns.filter(p => p.occurrences >= 2 && p.occurrences <= 3);
    const activePatterns = topPatterns.filter(p => p.occurrences >= 3);

    console.log(`[update-business-memory] user=${userId} metrics=${Object.keys(metrics).length} patterns=${topPatterns.length} predictions=${predictions.length}`);

    return new Response(JSON.stringify({
      metrics_updated: Object.keys(metrics).length,
      patterns_detected: topPatterns.length,
      active_patterns: activePatterns.length,
      new_learnings: newPatterns.length,
      predictions: predictions.length,
      summary: {
        new_patterns: newPatterns.slice(0, 3).map(p => p.description),
        upcoming_predictions: predictions.slice(0, 3).map(p => ({
          description: p.description,
          amount: p.estimated_amount,
          days_until: p.days_until,
        })),
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[update-business-memory] Error:", error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
