import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const KEEP_RECENT = 15;
const SUMMARIZE_WHEN_TOTAL_GTE = 20;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    if (!GEMINI_API_KEY || !SERVICE_ROLE || !SUPABASE_URL) {
      return new Response(JSON.stringify({ error: "Config faltante" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { user_id, agent_key } = await req.json();
    if (!user_id || !agent_key) {
      return new Response(JSON.stringify({ error: "user_id y agent_key requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { count } = await supabase
      .from("nico_messages" as never)
      .select("id", { count: "exact", head: true })
      .eq("user_id", user_id)
      .eq("agent_key", agent_key);
    const total = count ?? 0;
    if (total < SUMMARIZE_WHEN_TOTAL_GTE) {
      return new Response(JSON.stringify({ skipped: "not enough messages", total }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all messages ordered chronologically, then split: older ones go to summary.
    const { data: allMessages } = await supabase
      .from("nico_messages" as never)
      .select("id, role, content, created_at")
      .eq("user_id", user_id)
      .eq("agent_key", agent_key)
      .order("created_at", { ascending: true });
    const list = (allMessages ?? []) as Array<{ id: string; role: string; content: string; created_at: string }>;
    if (list.length <= KEEP_RECENT) {
      return new Response(JSON.stringify({ skipped: "within window", total: list.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const toSummarize = list.slice(0, list.length - KEEP_RECENT);
    const keepIds = list.slice(list.length - KEEP_RECENT).map((m) => m.id);

    // Existing memory
    const { data: memRow } = await supabase
      .from("nico_agent_memory" as never)
      .select("summary, facts")
      .eq("user_id", user_id)
      .eq("agent_key", agent_key)
      .maybeSingle();
    const prevSummary = (memRow as { summary?: string } | null)?.summary ?? "";
    const prevFacts = ((memRow as { facts?: unknown[] } | null)?.facts ?? []) as unknown[];

    const conversationText = toSummarize
      .map((m) => `${m.role === "user" ? "EMPRESARIO" : "NICO"}: ${m.content}`)
      .join("\n\n");

    const systemPrompt = `Eres un sistema que condensa la memoria de conversaciones entre un empresario colombiano y su asesor financiero llamado Nico.
Recibirás:
1. Un resumen de memoria previa (puede estar vacío).
2. Una lista de hechos aprendidos previos (pueden estar vacíos).
3. Una conversación reciente a resumir.

Tu tarea: devolver un JSON (sin markdown, sin backticks) con esta forma:
{
  "summary": "texto corrido máximo 400 palabras, en español, en prosa — sin asteriscos, sin viñetas, sin numeración. Mantiene el contexto esencial del negocio del empresario y lo que se habló con Nico. Usa el tono de un asesor que recuerda lo importante.",
  "facts": ["hecho 1", "hecho 2", ...]
}

Reglas:
- El summary NO debe repetir transcripciones; debe CONDENSAR.
- Integra el summary previo con la conversación nueva de forma coherente.
- Los facts son aprendizajes estables sobre el negocio (ej: "factura a 60 días", "cliente principal representa 40% de ventas"). Máximo 30 facts totales. Si hay más, prioriza los más relevantes y recientes.
- Descarta detalles operativos de una sola vez (preguntas puntuales de un día).
- Nunca inventes información que no estaba en la conversación.
- Responde SOLO con el JSON, sin texto adicional.`;

    const userPrompt = `MEMORIA PREVIA:
${prevSummary || "(vacía)"}

HECHOS PREVIOS:
${prevFacts.length > 0 ? prevFacts.map((f, i) => `${i + 1}. ${typeof f === "string" ? f : JSON.stringify(f)}`).join("\n") : "(vacíos)"}

CONVERSACIÓN A INTEGRAR:
${conversationText}`;

    const aiResp = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GEMINI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("summarize AI error:", aiResp.status, errText);
      return new Response(JSON.stringify({ error: "AI error", status: aiResp.status }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiResp.json();
    const raw = aiJson?.choices?.[0]?.message?.content ?? "";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error("summarize: no JSON in response", raw);
      return new Response(JSON.stringify({ error: "invalid AI response" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsed: { summary?: string; facts?: unknown[] };
    try {
      parsed = JSON.parse(match[0]);
    } catch (e) {
      console.error("summarize JSON parse failed:", e, match[0]);
      return new Response(JSON.stringify({ error: "invalid JSON" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const nextSummary = typeof parsed.summary === "string" ? parsed.summary : prevSummary;
    const nextFacts = Array.isArray(parsed.facts) ? parsed.facts.slice(0, 30) : prevFacts;

    // Upsert memory and delete the old messages that went into the summary
    await supabase
      .from("nico_agent_memory" as never)
      .upsert(
        {
          user_id,
          agent_key,
          summary: nextSummary,
          facts: nextFacts,
          last_summarized_at: new Date().toISOString(),
          message_count_at_summary: list.length,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "user_id,agent_key" } as never,
      );

    // Remove the old messages that were summarized to keep storage bounded
    const idsToDelete = toSummarize.map((m) => m.id);
    if (idsToDelete.length > 0) {
      await supabase.from("nico_messages" as never).delete().in("id", idsToDelete);
    }

    return new Response(JSON.stringify({
      ok: true,
      summarized: toSummarize.length,
      kept: keepIds.length,
      facts_count: nextFacts.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("summarize-nico-memory error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
