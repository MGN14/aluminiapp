// Edge function: nico-prompt-evolution
//
// Cron semanal (lunes 9am Bogotá). Para cada agent_key:
//   1. Lee feedback de la última semana (👍/👎 + comentarios)
//   2. Si <5 ítems significativos, skip
//   3. Opus 4.7 analiza patrones y propone reglas a agregar al system prompt
//   4. Inserta nico_prompt_versions con status=pending
//   5. Manda email a ngrm14@gmail.com con resumen + link al panel admin
//
// La aprobación final es manual desde /nico/evolution. Hasta que un admin
// aprueba, el system prompt sigue siendo el hardcoded.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ADMIN_EMAIL = "ngrm14@gmail.com";
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "onboarding@resend.dev";
const APP_URL = "https://aluminia.app";

const AGENT_KEYS = ["cfo", "contador", "visita_dian", "tesoreria", "inventario", "estrategia", "gerencial"] as const;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface FeedbackItem {
  agent: string;
  question: string;
  answer: string;
  feedback: number;
  comment: string | null;
  created_at: string;
}

interface OpusProposal {
  rule_to_add: string;
  rationale: string;
  evidence_count: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const CRON_SECRET = Deno.env.get("NICO_EVOLUTION_CRON_SECRET");
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

  // Auth: cron-secret O service-role bearer
  const cronHeader = req.headers.get("x-cron-secret");
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const isCron = !!CRON_SECRET && cronHeader === CRON_SECRET;
  const isServiceRole = !!SERVICE_ROLE && bearer === SERVICE_ROLE;
  if (!isCron && !isServiceRole) {
    return json({ error: "No autorizado" }, 401);
  }

  if (!ANTHROPIC_API_KEY) {
    return json({ error: "ANTHROPIC_API_KEY no configurada" }, 500);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const sinceIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const allProposals: Array<{ agent: string; proposal: OpusProposal; version: number }> = [];

  for (const agent of AGENT_KEYS) {
    try {
      // 1. Cargar feedback del agente
      const { data: assistantMsgs } = await admin
        .from("nico_messages" as never)
        .select("id, content, feedback, feedback_text, created_at, user_id")
        .eq("agent_key", agent)
        .eq("role", "assistant")
        .not("feedback", "is", null)
        .gte("feedback_at", sinceIso)
        .order("feedback_at", { ascending: false })
        .limit(50);

      const am = (assistantMsgs ?? []) as Array<{
        id: string;
        content: string;
        feedback: number;
        feedback_text: string | null;
        created_at: string;
        user_id: string;
      }>;

      if (am.length < 5) {
        console.log(`[evolution] agent ${agent}: ${am.length} ítems — skip`);
        continue;
      }

      // 2. Para cada respuesta, buscar la pregunta previa
      const items: FeedbackItem[] = [];
      for (const m of am) {
        const { data: prev } = await admin
          .from("nico_messages" as never)
          .select("content")
          .eq("user_id", m.user_id)
          .eq("agent_key", agent)
          .eq("role", "user")
          .lt("created_at", m.created_at)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        items.push({
          agent,
          question: ((prev as { content?: string } | null)?.content ?? "(no encontrada)").slice(0, 400),
          answer: m.content.slice(0, 400),
          feedback: m.feedback,
          comment: m.feedback_text,
          created_at: m.created_at,
        });
      }

      // 3. Opus analiza y propone
      const proposals = await opusAnalyze(ANTHROPIC_API_KEY, agent, items);
      if (proposals.length === 0) {
        console.log(`[evolution] agent ${agent}: no proposals from Opus`);
        continue;
      }

      // 4. Cargar última versión para construir base_prompt nueva
      const { data: latestVer } = await admin
        .from("nico_prompt_versions" as never)
        .select("version, base_prompt")
        .eq("agent_key", agent)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      const lv = (latestVer as { version?: number; base_prompt?: string } | null);
      const nextVersion = (lv?.version ?? 0) + 1;

      // El base_prompt nuevo es el actual + las reglas propuestas. El actual
      // se obtiene de la versión aprobada anterior, o vacío (= usa el
      // hardcoded del edge function como fallback).
      const previousBase = lv?.base_prompt ?? "";
      const newRulesBlock = proposals
        .map((p, i) => `\n[REGLA AGREGADA v${nextVersion} #${i + 1}] ${p.rule_to_add}\n  Razón: ${p.rationale} (${p.evidence_count} casos en la última semana)`)
        .join("\n");
      const newBasePrompt = (previousBase || "[REGLAS APRENDIDAS]") + newRulesBlock;
      const changelog = proposals.map((p, i) => `${i + 1}. ${p.rule_to_add}`).join("\n");

      // 5. Insert pending
      const { error: insErr } = await admin
        .from("nico_prompt_versions" as never)
        .insert({
          agent_key: agent,
          version: nextVersion,
          base_prompt: newBasePrompt,
          changelog,
          evidence: items.map(it => ({
            feedback: it.feedback,
            question: it.question.slice(0, 200),
            comment: it.comment?.slice(0, 200) ?? null,
          })),
          proposed_by: "opus-weekly",
          status: "pending",
        } as never);

      if (insErr) {
        console.error(`[evolution] insert version failed for ${agent}:`, insErr);
        continue;
      }

      for (const p of proposals) allProposals.push({ agent, proposal: p, version: nextVersion });
    } catch (err) {
      console.error(`[evolution] agent ${agent} error:`, err);
    }
  }

  // 6. Email resumen
  if (allProposals.length > 0 && RESEND_API_KEY) {
    const html = renderEmail(allProposals);
    await sendEmail(RESEND_API_KEY, ADMIN_EMAIL, `Nico IA — ${allProposals.length} propuestas para revisar`, html);
  }

  return json({ ok: true, proposals_count: allProposals.length });
});

async function opusAnalyze(
  apiKey: string,
  agent: string,
  items: FeedbackItem[],
): Promise<OpusProposal[]> {
  const positives = items.filter(i => i.feedback === 1);
  const negatives = items.filter(i => i.feedback === -1);

  const systemPrompt = `Eres un experto en mejorar prompts de IA financiera. Recibes feedback semanal del asesor "Nico" — algunas respuestas con 👍 (buenas) y otras con 👎 (malas, a veces con comentario del usuario).

Tu tarea: identificar PATRONES en las respuestas malas y proponer 1-3 reglas concretas que se agregarían al system prompt para evitar que se repitan.

Reglas para tus propuestas:
- Cada propuesta debe estar fundamentada en al menos 2 casos del feedback
- Una regla = una instrucción accionable y específica (no abstracta)
- Si NO hay patrones claros, devuelve array vacío — no inventes
- No propongas más de 3 reglas por agente
- Las reglas se inyectan DESPUÉS del prompt base, así que pueden contradecir/refinar comportamiento existente

Responder SOLO el JSON con esta forma exacta:
{
  "proposals": [
    {
      "rule_to_add": "instrucción específica para agregar al prompt",
      "rationale": "por qué (qué patrón observaste)",
      "evidence_count": <int, # casos que sustentan>
    }
  ]
}`;

  const userPrompt = `AGENTE: ${agent}

FEEDBACK POSITIVO (${positives.length}):
${positives.slice(0, 15).map(i => `Q: ${i.question}\nA: ${i.answer}\n---`).join("\n")}

FEEDBACK NEGATIVO (${negatives.length}):
${negatives.slice(0, 15).map(i => `Q: ${i.question}\nA: ${i.answer}\nComentario user: ${i.comment ?? "(sin comentario)"}\n---`).join("\n")}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-4-7",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [
        { role: "user", content: userPrompt },
        { role: "assistant", content: '{"proposals":[' },
      ],
    }),
  });
  if (!resp.ok) {
    console.error("[opusAnalyze] error", resp.status, await resp.text());
    return [];
  }
  const aiJson = await resp.json();
  const text = Array.isArray(aiJson?.content)
    ? aiJson.content.find((c: { type: string }) => c?.type === "text")?.text ?? ""
    : "";
  const raw = '{"proposals":[' + text;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed.proposals)) return [];
    return parsed.proposals
      .filter((p: { rule_to_add?: unknown; rationale?: unknown; evidence_count?: unknown }) =>
        typeof p?.rule_to_add === "string" && typeof p?.rationale === "string" && typeof p?.evidence_count === "number"
      )
      .slice(0, 3) as OpusProposal[];
  } catch (e) {
    console.error("[opusAnalyze] parse failed", e);
    return [];
  }
}

function renderEmail(props: Array<{ agent: string; proposal: OpusProposal; version: number }>): string {
  const byAgent = new Map<string, typeof props>();
  for (const p of props) {
    if (!byAgent.has(p.agent)) byAgent.set(p.agent, []);
    byAgent.get(p.agent)!.push(p);
  }
  const sections = Array.from(byAgent.entries()).map(([agent, ps]) => `
    <h3 style="margin:18px 0 6px;font-size:14px">Agente: ${escapeHtml(agent)}</h3>
    ${ps.map(p => `
      <div style="padding:10px 12px;margin:6px 0;background:#f5f5f7;border-left:3px solid oklch(0.43 0.14 155);border-radius:4px;font-size:12.5px">
        <div style="font-weight:600;margin-bottom:4px">${escapeHtml(p.proposal.rule_to_add)}</div>
        <div style="color:#666;font-size:11px">${escapeHtml(p.proposal.rationale)} · ${p.proposal.evidence_count} casos</div>
      </div>
    `).join("")}
  `).join("");

  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1d1d1f;max-width:680px;margin:0 auto;padding:24px;background:#fff">
<h1 style="font-size:20px;margin:0 0 4px">Nico IA — Propuestas semanales</h1>
<p style="color:#86868b;font-size:13px;margin:0 0 20px">Opus 4.7 analizó el feedback de la última semana y propone ${props.length} cambios al system prompt. Aprobalos o rechazalos desde el panel admin.</p>

${sections}

<p style="margin:24px 0 8px"><a href="${APP_URL}/nico/evolution" style="display:inline-block;background:oklch(0.43 0.14 155);color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">Revisar y aprobar →</a></p>

<p style="font-size:11px;color:#86868b;margin-top:32px">Generado automáticamente cada lunes por nico-prompt-evolution.</p>
</body></html>`;
}

async function sendEmail(apiKey: string, to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `AluminIA Telemetría <${RESEND_FROM}>`,
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    console.error("[evolution] resend failed", res.status, await res.text());
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
