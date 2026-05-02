// Edge function: nico-weekly-report
// Genera y envía por email un reporte semanal de uso de Nico IA.
//
// Lo que mide:
//   - Volumen y distribución temporal (hora del día, día de semana)
//   - Tokens consumidos (input/output/cache_write/cache_read) y costo USD
//   - Aprovechamiento del prompt cache (% de input que vino de cache)
//   - Top usuarios y top agentes
//   - Top 10 categorías de preguntas (clustering vía Haiku 4.5)
//   - Outliers: respuestas más caras / largas
//
// Request:
//   POST /functions/v1/nico-weekly-report
//   Headers: x-cron-secret: <NICO_REPORT_CRON_SECRET>   (cron)
//   o        Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
//   Body (opcional): { period_days?: number, dry_run?: boolean, to?: string }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_TO = "ngrm14@gmail.com";
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "onboarding@resend.dev";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}
function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}
function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

interface NicoEventProps {
  agent_key?: string;
  model_used?: string;
  user_msg_len?: number;
  assistant_msg_len?: number;
  page_context?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cost_usd?: number;
  stop_reason?: string | null;
  hour_bogota?: number;
  dow_bogota?: number;
}

interface NicoEvent {
  user_id: string;
  occurred_at: string;
  props: NicoEventProps;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const CRON_SECRET = Deno.env.get("NICO_REPORT_CRON_SECRET");
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

  // AuthN: cron-secret O service-role bearer.
  const cronHeader = req.headers.get("x-cron-secret");
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const isCron = !!CRON_SECRET && cronHeader === CRON_SECRET;
  const isServiceRole = !!SERVICE_ROLE_KEY && bearer === SERVICE_ROLE_KEY;
  if (!isCron && !isServiceRole) {
    console.log(`[auth-denied] cron=${!!cronHeader} sr=${!!bearer}`);
    return json({ error: "No autorizado" }, 401);
  }

  const body = await req.json().catch(() => ({})) as {
    period_days?: number;
    dry_run?: boolean;
    to?: string;
  };
  const periodDays = body.period_days ?? 7;
  const dryRun = body.dry_run === true;
  const to = body.to ?? DEFAULT_TO;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1. Pull events
  const sinceIso = new Date(Date.now() - periodDays * 24 * 3600 * 1000).toISOString();
  const { data: rawEvents, error: evErr } = await admin
    .from("app_events" as never)
    .select("user_id, occurred_at, props")
    .eq("event_type", "nico_query")
    .gte("occurred_at", sinceIso)
    .order("occurred_at", { ascending: false })
    .limit(5000);

  if (evErr) {
    console.error("[nico-weekly-report] error fetching events:", evErr);
    return json({ error: "Error consultando eventos" }, 500);
  }

  const events = (rawEvents ?? []) as NicoEvent[];
  if (events.length === 0) {
    const html = `<p>No hubo actividad de Nico IA en los últimos ${periodDays} días.</p>`;
    if (dryRun) return json({ html, eventCount: 0 });
    if (RESEND_API_KEY) await sendEmail(RESEND_API_KEY, to, `Nico IA — sin actividad (${periodDays}d)`, html);
    return json({ ok: true, eventCount: 0 });
  }

  // 2. Aggregations
  let totalIn = 0, totalOut = 0, totalCacheWrite = 0, totalCacheRead = 0, totalCost = 0;
  const byAgent: Record<string, { count: number; cost: number }> = {};
  const byHour: number[] = new Array(24).fill(0);
  const byDow: number[] = new Array(7).fill(0); // 0=Sun .. 6=Sat
  const byUser: Record<string, { count: number; cost: number }> = {};
  const byModel: Record<string, { count: number; cost: number }> = {};

  for (const e of events) {
    const p = e.props ?? {};
    totalIn += p.input_tokens ?? 0;
    totalOut += p.output_tokens ?? 0;
    totalCacheWrite += p.cache_creation_input_tokens ?? 0;
    totalCacheRead += p.cache_read_input_tokens ?? 0;
    totalCost += Number(p.cost_usd ?? 0);

    const agent = p.agent_key ?? "unknown";
    byAgent[agent] = byAgent[agent] || { count: 0, cost: 0 };
    byAgent[agent].count += 1;
    byAgent[agent].cost += Number(p.cost_usd ?? 0);

    const model = p.model_used ?? "unknown";
    byModel[model] = byModel[model] || { count: 0, cost: 0 };
    byModel[model].count += 1;
    byModel[model].cost += Number(p.cost_usd ?? 0);

    if (typeof p.hour_bogota === "number" && p.hour_bogota >= 0 && p.hour_bogota < 24) {
      byHour[p.hour_bogota] += 1;
    }
    if (typeof p.dow_bogota === "number" && p.dow_bogota >= 0 && p.dow_bogota < 7) {
      byDow[p.dow_bogota] += 1;
    }
    byUser[e.user_id] = byUser[e.user_id] || { count: 0, cost: 0 };
    byUser[e.user_id].count += 1;
    byUser[e.user_id].cost += Number(p.cost_usd ?? 0);
  }

  const totalCacheableInput = totalIn + totalCacheWrite + totalCacheRead;
  const cacheHitRate = totalCacheableInput > 0 ? totalCacheRead / totalCacheableInput : 0;

  // 3. Top user questions for clustering
  const { data: rawMessages } = await admin
    .from("nico_messages" as never)
    .select("content, agent_key, created_at")
    .eq("role", "user")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(500);

  const userMessages = ((rawMessages ?? []) as Array<{ content: string; agent_key: string; created_at: string }>)
    .map((m) => (m.content ?? "").trim())
    .filter((c) => c.length > 0 && c.length < 500); // descartar muy cortas o muy largas

  // 4. Cluster con Haiku (si hay key + suficientes preguntas)
  let categories: Array<{ name: string; count: number; example: string }> = [];
  if (ANTHROPIC_API_KEY && userMessages.length >= 5) {
    try {
      categories = await clusterQuestions(ANTHROPIC_API_KEY, userMessages);
    } catch (err) {
      console.error("[nico-weekly-report] clustering failed:", err);
    }
  }

  // 5. Build HTML
  const periodEnd = new Date();
  const periodStart = new Date(Date.now() - periodDays * 24 * 3600 * 1000);
  const subject = `Nico IA — Reporte semanal ${periodEnd.toISOString().slice(0, 10)}`;

  const topAgents = Object.entries(byAgent).sort((a, b) => b[1].count - a[1].count);
  const topModels = Object.entries(byModel).sort((a, b) => b[1].count - a[1].count);
  const topUsers = Object.entries(byUser).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
  const peakHour = byHour.indexOf(Math.max(...byHour));
  const peakDow = byDow.indexOf(Math.max(...byDow));
  const dowNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1d1d1f;max-width:680px;margin:0 auto;padding:24px;background:#fff">
<h1 style="font-size:20px;margin:0 0 4px">Nico IA — Reporte semanal</h1>
<p style="color:#86868b;font-size:13px;margin:0 0 24px">${periodStart.toISOString().slice(0,10)} → ${periodEnd.toISOString().slice(0,10)} · ${periodDays} días</p>

<table style="width:100%;border-collapse:collapse;margin-bottom:20px">
  <tr>
    <td style="padding:12px;background:#f5f5f7;border-radius:8px;width:25%">
      <div style="font-size:11px;color:#86868b;text-transform:uppercase;letter-spacing:0.5px">Mensajes</div>
      <div style="font-size:22px;font-weight:600;margin-top:4px">${fmtInt(events.length)}</div>
    </td>
    <td style="padding:12px;background:#f5f5f7;border-radius:8px;width:25%">
      <div style="font-size:11px;color:#86868b;text-transform:uppercase;letter-spacing:0.5px">Costo total</div>
      <div style="font-size:22px;font-weight:600;margin-top:4px">${fmtUsd(totalCost)}</div>
    </td>
    <td style="padding:12px;background:#f5f5f7;border-radius:8px;width:25%">
      <div style="font-size:11px;color:#86868b;text-transform:uppercase;letter-spacing:0.5px">Cache hit</div>
      <div style="font-size:22px;font-weight:600;margin-top:4px">${pct(cacheHitRate)}</div>
    </td>
    <td style="padding:12px;background:#f5f5f7;border-radius:8px;width:25%">
      <div style="font-size:11px;color:#86868b;text-transform:uppercase;letter-spacing:0.5px">Usuarios únicos</div>
      <div style="font-size:22px;font-weight:600;margin-top:4px">${fmtInt(Object.keys(byUser).length)}</div>
    </td>
  </tr>
</table>

<h2 style="font-size:15px;margin:20px 0 8px">💰 Tokens y costo</h2>
<table style="width:100%;border-collapse:collapse;font-size:13px">
  <tr style="background:#f5f5f7"><td style="padding:6px 10px">Input (no cacheado)</td><td style="padding:6px 10px;text-align:right">${fmtInt(totalIn)}</td></tr>
  <tr><td style="padding:6px 10px">Cache write (1ra vez)</td><td style="padding:6px 10px;text-align:right">${fmtInt(totalCacheWrite)}</td></tr>
  <tr style="background:#f5f5f7"><td style="padding:6px 10px;color:#0a7c4a"><b>Cache read (descuento)</b></td><td style="padding:6px 10px;text-align:right;color:#0a7c4a"><b>${fmtInt(totalCacheRead)}</b></td></tr>
  <tr><td style="padding:6px 10px">Output</td><td style="padding:6px 10px;text-align:right">${fmtInt(totalOut)}</td></tr>
  <tr style="background:#f5f5f7"><td style="padding:6px 10px"><b>Costo USD</b></td><td style="padding:6px 10px;text-align:right"><b>${fmtUsd(totalCost)}</b></td></tr>
</table>
<p style="font-size:11px;color:#86868b;margin:6px 0 0">Cache hit rate ${pct(cacheHitRate)} — cuanto más alto, más barato (sesiones largas con mismo agente).</p>

${categories.length > 0 ? `
<h2 style="font-size:15px;margin:24px 0 8px">🏷️ Top categorías de preguntas</h2>
<table style="width:100%;border-collapse:collapse;font-size:13px">
${categories.map((c, i) => `
  <tr style="${i % 2 === 0 ? "background:#f5f5f7" : ""}">
    <td style="padding:8px 10px;width:40%"><b>${escapeHtml(c.name)}</b></td>
    <td style="padding:8px 10px;width:10%;text-align:right">${c.count}</td>
    <td style="padding:8px 10px;color:#86868b;font-style:italic">"${escapeHtml(c.example.slice(0, 100))}${c.example.length > 100 ? "…" : ""}"</td>
  </tr>`).join("")}
</table>
` : `<p style="font-size:12px;color:#86868b;margin:24px 0 0">No hay suficientes preguntas para clustering esta semana (mínimo 5).</p>`}

<h2 style="font-size:15px;margin:24px 0 8px">🤖 Por agente</h2>
<table style="width:100%;border-collapse:collapse;font-size:13px">
${topAgents.map(([k, v], i) => `
  <tr style="${i % 2 === 0 ? "background:#f5f5f7" : ""}">
    <td style="padding:6px 10px">${escapeHtml(k)}</td>
    <td style="padding:6px 10px;text-align:right">${v.count} (${pct(v.count / events.length)})</td>
    <td style="padding:6px 10px;text-align:right">${fmtUsd(v.cost)}</td>
  </tr>`).join("")}
</table>

<h2 style="font-size:15px;margin:24px 0 8px">🧠 Por modelo</h2>
<table style="width:100%;border-collapse:collapse;font-size:13px">
${topModels.map(([k, v], i) => `
  <tr style="${i % 2 === 0 ? "background:#f5f5f7" : ""}">
    <td style="padding:6px 10px">${escapeHtml(k)}</td>
    <td style="padding:6px 10px;text-align:right">${v.count}</td>
    <td style="padding:6px 10px;text-align:right">${fmtUsd(v.cost)}</td>
  </tr>`).join("")}
</table>

<h2 style="font-size:15px;margin:24px 0 8px">⏰ ¿Cuándo preguntan?</h2>
<p style="font-size:13px;margin:0 0 8px">Hora pico: <b>${peakHour}:00 Bogotá</b> (${byHour[peakHour]} mensajes). Día pico: <b>${dowNames[peakDow]}</b> (${byDow[peakDow]} mensajes).</p>
<table style="width:100%;border-collapse:collapse;font-size:11px">
<tr>${byHour.map((_, h) => `<td style="padding:2px 4px;text-align:center;color:#86868b">${h}</td>`).join("")}</tr>
<tr>${byHour.map((c) => `<td style="padding:2px 4px;text-align:center;background:rgba(10,124,74,${Math.min(c / Math.max(...byHour, 1), 1)});color:${c > 0 ? "#fff" : "#86868b"}">${c}</td>`).join("")}</tr>
</table>
<p style="font-size:11px;color:#86868b;margin:6px 0 0">Distribución por hora del día (0–23, Bogotá).</p>

<h2 style="font-size:15px;margin:24px 0 8px">👥 Top 10 usuarios</h2>
<table style="width:100%;border-collapse:collapse;font-size:13px">
${topUsers.map(([uid, v], i) => `
  <tr style="${i % 2 === 0 ? "background:#f5f5f7" : ""}">
    <td style="padding:6px 10px;font-family:monospace;font-size:11px">${uid.slice(0, 8)}…</td>
    <td style="padding:6px 10px;text-align:right">${v.count}</td>
    <td style="padding:6px 10px;text-align:right">${fmtUsd(v.cost)}</td>
  </tr>`).join("")}
</table>

<p style="font-size:11px;color:#86868b;margin:32px 0 0">Generado automáticamente por nico-weekly-report. Si querés ajustar qué incluye, decímelo.</p>
</body></html>`;

  // 6. Enviar email (o devolver dry_run)
  if (dryRun) {
    return json({
      html,
      stats: {
        eventCount: events.length,
        totalCost,
        cacheHitRate,
        categories: categories.length,
        users: Object.keys(byUser).length,
      },
    });
  }

  if (!RESEND_API_KEY) {
    return json({ error: "RESEND_API_KEY no configurada" }, 500);
  }

  const sendResult = await sendEmail(RESEND_API_KEY, to, subject, html);
  if (!sendResult.ok) {
    return json({ error: sendResult.error }, 500);
  }
  return json({ ok: true, eventCount: events.length, sentTo: to, totalCost: Number(totalCost.toFixed(4)) });
});

async function clusterQuestions(
  apiKey: string,
  questions: string[],
): Promise<Array<{ name: string; count: number; example: string }>> {
  const sample = questions.slice(0, 200);
  const numbered = sample.map((q, i) => `${i + 1}. ${q}`).join("\n");
  const systemPrompt = `Eres un sistema que clasifica preguntas de empresarios colombianos a un asesor financiero llamado Nico.

Recibís una lista numerada de preguntas reales y devolvés JSON con hasta 10 categorías que cubran los temas principales. Cada categoría tiene:
  - "name": nombre corto en español (2-4 palabras)
  - "count": cuántas preguntas caen en esa categoría
  - "example": el texto de UNA pregunta representativa de la categoría (copiar literal)

Reglas:
- Si dos preguntas son del mismo tema, van juntas (ej: "IVA descontable", "IVA generado", "retención IVA" → "IVA y retenciones")
- Categorías ordenadas por count desc
- Cubrir el >80% de las preguntas; preguntas raras agruparlas en "Otros"
- count es entero; suma puede no llegar al total exacto si hay ambiguas
- Responder SOLO el JSON, sin texto extra`;

  const userPrompt = `Preguntas (${sample.length}):\n${numbered}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        { role: "user", content: userPrompt },
        { role: "assistant", content: '{"categories":[' },
      ],
    }),
  });

  if (!resp.ok) {
    console.error("[clustering] anthropic error:", resp.status, await resp.text());
    return [];
  }
  const aiJson = await resp.json();
  const text = Array.isArray(aiJson?.content)
    ? aiJson.content.find((c: { type: string }) => c?.type === "text")?.text ?? ""
    : "";
  const raw = '{"categories":[' + text;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.categories)) return [];
    return parsed.categories
      .filter((c: { name?: unknown; count?: unknown; example?: unknown }) =>
        typeof c?.name === "string" && typeof c?.count === "number" && typeof c?.example === "string"
      )
      .map((c: { name: string; count: number; example: string }) => ({
        name: c.name,
        count: c.count,
        example: c.example,
      }))
      .slice(0, 10);
  } catch (err) {
    console.error("[clustering] parse error:", err);
    return [];
  }
}

async function sendEmail(apiKey: string, to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `AluminIA Telemetría <${RESEND_FROM}>`,
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("[nico-weekly-report] Resend error:", res.status, txt.slice(0, 300));
    return { ok: false, error: `Resend ${res.status}` };
  }
  return { ok: true };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
