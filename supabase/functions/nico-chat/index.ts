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

    const { messages } = await req.json();

    // --- Gather financial context ---
    const now = new Date();
    const thisYear = now.getFullYear();
    const thisMonth = now.getMonth() + 1;
    const lastMonth = thisMonth === 1 ? 12 : thisMonth - 1;
    const lastMonthYear = thisMonth === 1 ? thisYear - 1 : thisYear;

    // Transactions for last 13 months (current + 12)
    const since = new Date(thisYear - 1, now.getMonth(), 1).toISOString().split("T")[0];

    const { data: transactions } = await supabase
      .from("transactions")
      .select("date, description, credit, debit, amount, category, operational_type, category_id")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .gte("date", since)
      .order("date", { ascending: false })
      .limit(2000);

    const { data: categories } = await supabase
      .from("categories")
      .select("id, name, report_group")
      .eq("user_id", user.id);

    // Build category map
    const catMap: Record<string, { name: string; report_group: string }> = {};
    for (const c of (categories ?? [])) {
      catMap[c.id] = { name: c.name, report_group: c.report_group };
    }

    // Aggregate monthly data
    type MonthData = {
      ingresos: number;
      costos: number;
      gastos: number;
      impuestos: number;
      total_egresos: number;
      utilidad_bruta: number;
      ebitda: number;
      proveedores: Record<string, number>;
      categorias: Record<string, number>;
    };

    const byMonth: Record<string, MonthData> = {};

    for (const t of (transactions ?? [])) {
      const d = new Date(t.date + "T00:00:00");
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!byMonth[key]) {
        byMonth[key] = {
          ingresos: 0, costos: 0, gastos: 0, impuestos: 0,
          total_egresos: 0, utilidad_bruta: 0, ebitda: 0,
          proveedores: {}, categorias: {}
        };
      }
      const m = byMonth[key];
      const credit = t.credit ?? 0;
      const debit = t.debit ?? 0;
      const opType = t.operational_type ?? "";
      const catInfo = t.category_id ? catMap[t.category_id] : null;
      const catName = catInfo?.name ?? t.category ?? "Sin categoría";
      const reportGroup = catInfo?.report_group ?? opType;

      if (credit > 0) {
        m.ingresos += credit;
      }
      if (debit > 0) {
        m.total_egresos += debit;
        if (opType === "costo" || reportGroup === "costos_operacionales") {
          m.costos += debit;
        } else if (opType === "impuesto" || reportGroup === "impuestos") {
          m.impuestos += debit;
        } else {
          m.gastos += debit;
        }
        // Track top provider by description
        if (debit > 0) {
          const desc = t.description?.substring(0, 50) ?? "Desconocido";
          m.proveedores[desc] = (m.proveedores[desc] ?? 0) + debit;
        }
      }
      // Track categories
      if (catName !== "Sin categoría") {
        const amount = credit > 0 ? credit : debit;
        m.categorias[catName] = (m.categorias[catName] ?? 0) + amount;
      }
    }

    // Compute derived metrics
    for (const key of Object.keys(byMonth)) {
      const m = byMonth[key];
      m.utilidad_bruta = m.ingresos - m.costos;
      m.ebitda = m.utilidad_bruta - m.gastos;
    }

    // Sort months
    const sortedMonths = Object.keys(byMonth).sort();
    const currentKey = `${thisYear}-${String(thisMonth).padStart(2, "0")}`;
    const lastMonthKey = `${lastMonthYear}-${String(lastMonth).padStart(2, "0")}`;
    const currentData = byMonth[currentKey] ?? null;
    const lastMonthData = byMonth[lastMonthKey] ?? null;

    // Year comparisons
    const thisYearKey = `${thisYear}`;
    const lastYearKey = `${thisYear - 1}`;
    let thisYearTotal = { ingresos: 0, costos: 0, gastos: 0, ebitda: 0 };
    let lastYearTotal = { ingresos: 0, costos: 0, gastos: 0, ebitda: 0 };
    for (const [key, m] of Object.entries(byMonth)) {
      const yr = key.split("-")[0];
      if (yr === thisYearKey) {
        thisYearTotal.ingresos += m.ingresos;
        thisYearTotal.costos += m.costos;
        thisYearTotal.gastos += m.gastos;
        thisYearTotal.ebitda += m.ebitda;
      } else if (yr === lastYearKey) {
        lastYearTotal.ingresos += m.ingresos;
        lastYearTotal.costos += m.costos;
        lastYearTotal.gastos += m.gastos;
        lastYearTotal.ebitda += m.ebitda;
      }
    }

    // Top providers (last 3 months)
    const last3Keys = sortedMonths.slice(-3);
    const aggProveedores: Record<string, number> = {};
    for (const k of last3Keys) {
      for (const [p, v] of Object.entries(byMonth[k]?.proveedores ?? {})) {
        aggProveedores[p] = (aggProveedores[p] ?? 0) + v;
      }
    }
    const topProveedores = Object.entries(aggProveedores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, amount]) => ({ name, amount }));

    const fmt = (n: number) =>
      new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

    const pct = (a: number, b: number) =>
      b === 0 ? "N/A" : `${((a - b) / b * 100).toFixed(1)}%`;

    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const summarizeMonth = (key: string | null, data: MonthData | null) => {
      if (!key || !data) return "Sin datos";
      const [yr, mo] = key.split("-");
      const name = monthNames[parseInt(mo) - 1];
      const utilNeta = data.ebitda - data.impuestos;
      return `${name} ${yr}: Ingresos=${fmt(data.ingresos)}, Costos=${fmt(data.costos)}, Gastos=${fmt(data.gastos)}, Utilidad Bruta=${fmt(data.utilidad_bruta)}, EBITDA=${fmt(data.ebitda)}, Impuestos=${fmt(data.impuestos)}, Utilidad Neta=${fmt(utilNeta)}`;
    };

    const financialContext = `
CONTEXTO FINANCIERO REAL DEL USUARIO (datos de AluminIA):

MES ACTUAL (${currentKey}):
${summarizeMonth(currentKey, currentData)}

MES ANTERIOR (${lastMonthKey}):
${summarizeMonth(lastMonthKey, lastMonthData)}

VARIACIONES MES ACTUAL vs MES ANTERIOR:
- Ingresos: ${currentData && lastMonthData ? pct(currentData.ingresos, lastMonthData.ingresos) : "Sin datos"}
- Gastos totales: ${currentData && lastMonthData ? pct(currentData.total_egresos, lastMonthData.total_egresos) : "Sin datos"}
- EBITDA: ${currentData && lastMonthData ? pct(currentData.ebitda, lastMonthData.ebitda) : "Sin datos"}

AÑO ACTUAL (${thisYearKey} acumulado):
Ingresos=${fmt(thisYearTotal.ingresos)}, Costos=${fmt(thisYearTotal.costos)}, Gastos=${fmt(thisYearTotal.gastos)}, EBITDA=${fmt(thisYearTotal.ebitda)}

AÑO ANTERIOR (${lastYearKey} acumulado):
Ingresos=${fmt(lastYearTotal.ingresos)}, Costos=${fmt(lastYearTotal.costos)}, Gastos=${fmt(lastYearTotal.gastos)}, EBITDA=${fmt(lastYearTotal.ebitda)}

VARIACIÓN AÑO vs AÑO:
- Ingresos: ${pct(thisYearTotal.ingresos, lastYearTotal.ingresos)}
- EBITDA: ${pct(thisYearTotal.ebitda, lastYearTotal.ebitda)}

TOP 5 PROVEEDORES (últimos 3 meses):
${topProveedores.map((p, i) => `${i + 1}. ${p.name}: ${fmt(p.amount)}`).join("\n") || "Sin datos"}

HISTORIAL MENSUAL (${sortedMonths.length} meses):
${sortedMonths.slice(-6).map((k) => summarizeMonth(k, byMonth[k])).join("\n")}
`.trim();

    const systemPrompt = `Eres Nico, el asistente financiero inteligente de AluminIA para empresarios colombianos.

REGLAS ESTRICTAS:
- Usa SIEMPRE los datos financieros reales del contexto proporcionado
- Si no hay datos suficientes, indícalo claramente
- Formato de respuesta SIEMPRE en 4 partes:
  1️⃣ Resultado principal (número concreto)
  2️⃣ Comparación con período anterior (con % de variación)
  3️⃣ Insight clave (anomalía, tendencia o patrón relevante)
  4️⃣ Recomendación ejecutiva concreta
- Máximo 5 líneas en total
- Usa moneda colombiana (COP) formateada con puntos de miles
- Lenguaje ejecutivo, directo, sin jerga contable compleja
- NO saludar extensamente, ir al grano
- Si detectas un pico o anomalía, menciónalo explícitamente
- Para impuestos, estimar ~35% de la utilidad neta como provisión recomendada

${financialContext}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Límite de uso alcanzado. Intenta de nuevo en unos minutos." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Se requieren créditos adicionales para continuar." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "Error al conectar con Nico." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("nico-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
