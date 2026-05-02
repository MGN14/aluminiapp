// Edge function: nico-ingest-lesson
//
// Disparada cada vez que un usuario marca 👍 en una respuesta de Nico IA.
// Convierte la pregunta+respuesta en una "lección" colectiva:
//   1. Lee el assistant_message + el user_message previo del mismo agente
//   2. Haiku 4.5 los condensa en question_summary + answer_summary
//   3. Voyage-3 genera embedding del par para retrieval semántico
//   4. Insert en nico_lessons + nico_knowledge_chunks (atómico vía RPC implícita)
//
// Idempotente: si ya hay una lección para el mismo source_message_id,
// incrementa like_count en lugar de duplicar.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const VOYAGE_API_KEY = Deno.env.get("VOYAGE_API_KEY");

    if (!ANTHROPIC_API_KEY || !VOYAGE_API_KEY) {
      console.error("[nico-ingest-lesson] missing keys", { anth: !!ANTHROPIC_API_KEY, voy: !!VOYAGE_API_KEY });
      return json({ error: "Configuración incompleta (ANTHROPIC_API_KEY o VOYAGE_API_KEY faltante)" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    // Cliente con JWT del user para validar identidad
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({})) as { assistant_message_id?: string };
    const messageId = body.assistant_message_id;
    if (!messageId) return json({ error: "assistant_message_id requerido" }, 400);

    // Cliente service role para bypassear RLS al insertar (las lecciones son colectivas)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1. Idempotencia: si ya existe lección de este mensaje, solo incrementar like_count
    const { data: existing } = await admin
      .from("nico_lessons" as never)
      .select("id, like_count")
      .eq("source_message_id", messageId)
      .maybeSingle();
    if (existing) {
      const row = existing as { id: string; like_count: number };
      await admin
        .from("nico_lessons" as never)
        .update({ like_count: (row.like_count ?? 1) + 1 } as never)
        .eq("id", row.id);
      return json({ ok: true, lesson_id: row.id, deduped: true });
    }

    // 2. Cargar el mensaje del asistente + buscar el user_message previo del mismo agente
    const { data: assistantMsg, error: amErr } = await admin
      .from("nico_messages" as never)
      .select("id, agent_key, content, role, user_id, created_at")
      .eq("id", messageId)
      .maybeSingle();
    if (amErr || !assistantMsg) {
      console.error("[nico-ingest-lesson] assistant message not found", amErr);
      return json({ error: "Mensaje no encontrado" }, 404);
    }
    const am = assistantMsg as { id: string; agent_key: string; content: string; role: string; user_id: string; created_at: string };
    if (am.user_id !== user.id) {
      return json({ error: "Forbidden" }, 403);
    }
    if (am.role !== "assistant") {
      return json({ error: "El mensaje debe ser del asistente" }, 400);
    }

    const { data: prevUser } = await admin
      .from("nico_messages" as never)
      .select("content")
      .eq("user_id", user.id)
      .eq("agent_key", am.agent_key)
      .eq("role", "user")
      .lt("created_at", am.created_at)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const userQuestion = (prevUser as { content?: string } | null)?.content ?? "(pregunta no encontrada)";

    // 3. Haiku 4.5 condensa pregunta + respuesta
    const summaryPrompt = `Resumí este intercambio entre un empresario colombiano y su asesor financiero Nico en un JSON con EXACTAMENTE estas claves:
{
  "question_summary": "1 oración con la PREGUNTA esencial (qué quería saber)",
  "answer_summary": "2-3 oraciones con la RESPUESTA condensada (qué dato/regla/lección queda como aprendizaje útil)"
}

Reglas:
- Sin markdown, sin asteriscos, sin viñetas
- Sin nombres propios sensibles si pueden generalizarse
- El answer_summary debe ser útil para recordar como regla — no transcribas la respuesta literal
- Responder SOLO el JSON, sin texto adicional`;

    const haikuResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 600,
        system: summaryPrompt,
        messages: [
          { role: "user", content: `PREGUNTA DEL EMPRESARIO:\n${userQuestion}\n\nRESPUESTA DE NICO:\n${am.content}` },
          { role: "assistant", content: "{" },
        ],
      }),
    });
    if (!haikuResp.ok) {
      const t = await haikuResp.text();
      console.error("[nico-ingest-lesson] haiku error", haikuResp.status, t);
      return json({ error: "Error condensando lección" }, 502);
    }
    const haikuJson = await haikuResp.json();
    const text = Array.isArray(haikuJson?.content)
      ? haikuJson.content.find((c: { type: string }) => c?.type === "text")?.text ?? ""
      : "";
    const raw = "{" + text;
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) {
      console.error("[nico-ingest-lesson] no JSON in haiku response", raw.slice(0, 200));
      return json({ error: "Respuesta de Haiku inválida" }, 502);
    }
    let parsed: { question_summary?: string; answer_summary?: string };
    try {
      parsed = JSON.parse(m[0]);
    } catch (e) {
      console.error("[nico-ingest-lesson] JSON parse failed", e, m[0]);
      return json({ error: "JSON inválido de Haiku" }, 502);
    }
    const qs = (parsed.question_summary ?? "").trim();
    const as = (parsed.answer_summary ?? "").trim();
    if (!qs || !as) {
      return json({ error: "Resumen vacío" }, 502);
    }

    // 4. Voyage-3 embedding del par concat
    const chunkText = `${qs}\n${as}`;
    const voyResp = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${VOYAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: [chunkText],
        model: "voyage-3",
        input_type: "document",
      }),
    });
    if (!voyResp.ok) {
      const t = await voyResp.text();
      console.error("[nico-ingest-lesson] voyage error", voyResp.status, t);
      return json({ error: "Error generando embedding" }, 502);
    }
    const voyJson = await voyResp.json();
    const embedding = voyJson?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== 1024) {
      console.error("[nico-ingest-lesson] embedding inválido", embedding?.length);
      return json({ error: "Embedding inválido" }, 502);
    }

    // 5. Insert lección + chunk
    const { data: lessonInsert, error: lErr } = await admin
      .from("nico_lessons" as never)
      .insert({
        user_id: user.id,
        agent_key: am.agent_key,
        question_summary: qs,
        answer_summary: as,
        source_message_id: am.id,
        like_count: 1,
      } as never)
      .select("id")
      .single();
    if (lErr || !lessonInsert) {
      console.error("[nico-ingest-lesson] insert lesson failed", lErr);
      return json({ error: "No se pudo guardar la lección" }, 500);
    }
    const lessonId = (lessonInsert as { id: string }).id;

    const { error: cErr } = await admin
      .from("nico_knowledge_chunks" as never)
      .insert({
        agent_key: am.agent_key,
        content: chunkText,
        embedding: embedding as number[],
        source_lesson_id: lessonId,
      } as never);
    if (cErr) {
      console.error("[nico-ingest-lesson] insert chunk failed", cErr);
      // No abortamos — la lesson queda sin embedding (Opción A sigue funcionando)
    }

    return json({ ok: true, lesson_id: lessonId });
  } catch (e) {
    console.error("[nico-ingest-lesson] unhandled", e);
    return json({ error: e instanceof Error ? e.message : "Error desconocido" }, 500);
  }
});
