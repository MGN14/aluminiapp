import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Dos vías (patrón score-collection-clients):
    //   1. x-cron-secret → corre para TODOS los usuarios (cron diario 6am)
    //   2. Bearer JWT    → solo el usuario autenticado (disparo del Dashboard)
    const cronSecret = Deno.env.get("BUSINESS_MEMORY_CRON_SECRET") || Deno.env.get("NICO_REPORT_CRON_SECRET");
    const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;

    let targetUsers: string[] = [];
    if (isCron) {
      const { data: profs } = await admin.from("profiles").select("user_id");
      targetUsers = Array.from(new Set((profs ?? []).map((r: any) => r.user_id).filter(Boolean)));
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "No autorizado" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authErr } = await userClient.auth.getUser();
      if (authErr || !user) {
        return new Response(JSON.stringify({ error: "No autorizado" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      targetUsers = [user.id];
    }

    const results: Record<string, unknown> = {};
    for (const uid of targetUsers) {
      try {
        results[uid] = await processUser(admin, uid);
      } catch (e) {
        console.error(`[update-business-memory] user=${uid} failed:`, e);
        results[uid] = { error: e instanceof Error ? e.message : String(e) };
      }
    }

    const payload = isCron
      ? { mode: "cron", users: targetUsers.length, results }
      : results[targetUsers[0]];
    return new Response(JSON.stringify(payload), {
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

// Toda la lógica por usuario (métricas + patrones + predicciones). Devuelve el
// payload que antes salía directo en la Response del modo single-user.
function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

async function processUser(admin: any, userId: string) {

    // Fetch all transaction data
    const [txRes, invRes, respRes] = await Promise.all([
      admin.from("transactions")
        .select("id, date, description, amount, credit, debit, type, category_id, responsible_id, invoice_id, operational_type, movement_nature, categories!transactions_category_id_fkey(name)")
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
      source: "conciliado" | "texto";
      label: string | null;
    }> = {};

    transactions.forEach((t: any) => {
      // Traspasos, préstamos y aportes NO son patrones del negocio (mismo
      // criterio que isOperativo en types/transaction.ts).
      const nature = t.movement_nature ?? "operativo";
      if (nature !== "operativo") return;

      const desc = (t.description || "").toLowerCase().trim();
      const words = desc.split(/\s+/).slice(0, 4).join(" "); // first 4 words as key
      const amount = Math.abs(t.amount ?? 0);
      if (amount < 10000) return; // skip tiny amounts

      // La curaduría de Conciliación manda: si el movimiento tiene beneficiario
      // asignado, se agrupa por beneficiario+categoría — dos pagos del mismo
      // arriendo con referencia bancaria distinta caen en el MISMO grupo.
      // Sin beneficiario, fallback al texto crudo (las primeras 4 palabras).
      const conciliado = !!t.responsible_id;
      const groupKey = conciliado
        ? `${t.type || "unknown"}|resp:${t.responsible_id}|cat:${t.category_id ?? ""}`
        : `${t.type || "unknown"}|txt:${words}`;
      if (!txGroups[groupKey]) {
        const catName = (t.categories as any)?.name ?? null;
        const respName = t.responsible_id ? respMap[t.responsible_id] ?? null : null;
        txGroups[groupKey] = {
          descriptions: [], amounts: [], dates: [], entities: new Set(), type: t.type || "unknown",
          source: conciliado ? "conciliado" : "texto",
          // Etiqueta curada para patrones conciliados: "Arriendo — Inmobiliaria X"
          label: conciliado ? [catName, respName].filter(Boolean).join(" — ") || null : null,
        };
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
      pattern_key: string;
      source: string;
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

      // Un patrón anclado a la curaduría de Conciliación (beneficiario+categoría)
      // es más sólido que uno por texto crudo: +0.15 de confianza, capped.
      const finalConfidence = group.source === "conciliado"
        ? Math.min(1, confidence + 0.15)
        : confidence;

      detectedPatterns.push({
        pattern_type: patternType,
        description: (group.label ?? mostCommonDesc).substring(0, 200),
        amount_min: Math.round(minAmount),
        amount_max: Math.round(maxAmount),
        frequency_days: avgFreq,
        last_occurrence: sortedDates[sortedDates.length - 1],
        entities: Array.from(group.entities).slice(0, 5),
        occurrences: group.amounts.length,
        confidence: Math.round(finalConfidence * 100) / 100,
        pattern_key: key,
        source: group.source,
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
        pattern_key: key,
        source: "factura",
      });
    }

    // Sort by confidence and occurrences
    detectedPatterns.sort((a, b) => (b.confidence * b.occurrences) - (a.confidence * a.occurrences));

    // Keep top 30 patterns
    const topPatterns = detectedPatterns.slice(0, 30);

    // El regenerado es DELETE+INSERT: preservar el status por pattern_key para
    // que archived (regla creada) / dismissed / confirmed (F3) sobrevivan cada
    // corrida. Antes se perdían — el archivado de reglas se des-archivaba solo.
    const { data: prevRows } = await admin
      .from("business_patterns")
      .select("pattern_key, status")
      .eq("user_id", userId)
      .not("pattern_key", "is", null);
    const prevStatus = new Map<string, string>(
      ((prevRows ?? []) as any[]).map((r) => [r.pattern_key as string, r.status as string]),
    );

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
          pattern_key: p.pattern_key,
          source: p.source,
          status: prevStatus.get(p.pattern_key) ?? "new",
        }))
      );
    }

    // ==========================================
    // 3. GENERATE PREDICTIONS
    // ==========================================
    const predictions: any[] = [];

    // For active patterns, predict next occurrence
    for (const p of topPatterns.filter(p => p.occurrences >= 3 && p.frequency_days > 0 && p.confidence >= 0.3)) {
      // dismissed = el usuario dijo "ignoralo"; confirmed = ya es una
      // business_obligation real (F3) — no predecir encima.
      const st = prevStatus.get(p.pattern_key) ?? "new";
      if (st === "dismissed" || st === "confirmed") continue;
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
          pattern_key: p.pattern_key,
          source: p.source,
          occurrences: p.occurrences,
          frequency_days: p.frequency_days,
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

    // ══════════════════ LIBRO DE ACIERTOS ══════════════════
    // Registrar predicciones abiertas + resolver las vencidas contra la
    // realidad. Corre en el mismo cron diario — un solo lugar escribe el log.
    try {
      const todayIso = now.toISOString().slice(0, 10);

      // A. Abrir logs de gastos recurrentes predichos (uno abierto por patrón).
      const gastoPreds = predictions.filter((p: any) =>
        (p.type === "egreso_recurrente" || p.type === "compra_recurrente_proveedor") && p.days_until >= 0);
      if (gastoPreds.length > 0) {
        const { data: openRows } = await admin.from("prediction_log")
          .select("subject_key").eq("user_id", userId).eq("kind", "gasto_recurrente").is("resolved_at", null);
        const openKeys = new Set(((openRows ?? []) as any[]).map((r) => r.subject_key));
        const toInsert = gastoPreds.filter((p: any) => p.pattern_key && !openKeys.has(p.pattern_key));
        if (toInsert.length > 0) {
          await admin.from("prediction_log").insert(toInsert.map((p: any) => ({
            user_id: userId,
            kind: "gasto_recurrente",
            subject_key: p.pattern_key,
            subject_label: (p.description ?? "").slice(0, 200),
            predicted: { estimated_amount: p.estimated_amount, estimated_date: p.estimated_date, confidence: p.confidence, source: p.source },
            resolve_after: addDaysIso(p.estimated_date, 4),
          })));
        }
      }

      // B. Abrir logs de score de cobranza (desde el cache de scores vigente).
      const { data: scoreRows } = await admin.from("client_collection_scores")
        .select("client_id, client_name, score").eq("user_id", userId);
      if ((scoreRows ?? []).length > 0) {
        const { data: openScoreRows } = await admin.from("prediction_log")
          .select("subject_key").eq("user_id", userId).eq("kind", "score_cobranza").is("resolved_at", null);
        const openScoreKeys = new Set(((openScoreRows ?? []) as any[]).map((r) => r.subject_key));
        const newScores = ((scoreRows ?? []) as any[]).filter((r) => !openScoreKeys.has(r.client_id));
        if (newScores.length > 0) {
          await admin.from("prediction_log").insert(newScores.map((r) => ({
            user_id: userId,
            kind: "score_cobranza",
            subject_key: r.client_id,
            subject_label: (r.client_name ?? "").slice(0, 200),
            predicted: { score: r.score },
            resolve_after: addDaysIso(todayIso, 30),
          })));
        }
      }

      // C. Resolver los vencidos.
      const { data: dueRows } = await admin.from("prediction_log")
        .select("id, kind, subject_key, predicted")
        .eq("user_id", userId).is("resolved_at", null).lte("resolve_after", todayIso)
        .limit(100);
      for (const row of (dueRows ?? []) as any[]) {
        let hit: boolean | null = null;
        let actual: Record<string, unknown> = {};
        if (row.kind === "gasto_recurrente") {
          // ¿Cayó un egreso del mismo grupo (resp/cat del pattern_key) en la
          // ventana ±4 días y ±40% del monto? Para patrones de texto, solo
          // monto+fecha (señal más débil, documentada en actual.match).
          const est = Number(row.predicted?.estimated_amount ?? 0);
          const estDate = String(row.predicted?.estimated_date ?? todayIso);
          const respMatch = /\|resp:([0-9a-f-]{36})/.exec(row.subject_key ?? "");
          let q = admin.from("transactions")
            .select("amount, date").eq("user_id", userId).is("deleted_at", null)
            .gte("date", addDaysIso(estDate, -4)).lte("date", addDaysIso(estDate, 4));
          if (respMatch) q = q.eq("responsible_id", respMatch[1]);
          const { data: txs } = await q;
          const found = ((txs ?? []) as any[]).find((t) => {
            const amt = Math.abs(Number(t.amount) || 0);
            return est > 0 && amt >= est * 0.6 && amt <= est * 1.4;
          });
          hit = !!found;
          actual = found
            ? { found_amount: Math.abs(Number(found.amount)), found_date: found.date, match: respMatch ? "beneficiario" : "monto" }
            : { match: respMatch ? "beneficiario" : "monto" };
        } else if (row.kind === "score_cobranza") {
          // ¿El cliente pagó algo en los 30 días? Score alto (≥60) acierta si
          // pagó; score bajo (<40) acierta si NO pagó; 40-59 = zona gris, no
          // puntúa (hit null) — el modelo no se comprometió.
          const score = Number(row.predicted?.score ?? 50);
          const { count } = await admin.from("transactions")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId).is("deleted_at", null).eq("type", "ingreso")
            .eq("responsible_id", row.subject_key)
            .gte("date", addDaysIso(todayIso, -30));
          const pago = (count ?? 0) > 0;
          actual = { pagos_ventana: count ?? 0 };
          hit = score >= 60 ? pago : score < 40 ? !pago : null;
        }
        await admin.from("prediction_log")
          .update({ actual, hit, resolved_at: now.toISOString() })
          .eq("id", row.id);
      }
    } catch (e) {
      console.warn("[update-business-memory] libro de aciertos falló (no bloquea):", e);
    }

    return {
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
    };
}
