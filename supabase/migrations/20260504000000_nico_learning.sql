-- Migration: Nico IA aprende.
--
-- Tres mecanismos de aprendizaje:
--   1. nico_lessons        — top-N por agente, sin embeddings (Opción A "lecciones")
--   2. nico_knowledge_chunks — embeddings vectoriales para retrieval semántico (Opción B "RAG")
--   3. nico_prompt_versions — propuestas de cambio al system prompt evaluadas
--                              semanalmente por Opus 4.7 (Opción C "evolutivo")
--
-- Las lecciones son colectivas: cualquier 👍 alimenta el conocimiento que ven
-- todos los usuarios del mismo agent_key. Decisión consciente para que Nico
-- aprenda más rápido con menos volumen.

-- 1. pgvector si no estaba habilitado
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Lecciones aprendidas (Opción A — sin embeddings, top-N)
CREATE TABLE IF NOT EXISTS public.nico_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_key text NOT NULL,
  question_summary text NOT NULL,
  answer_summary text NOT NULL,
  source_message_id uuid REFERENCES public.nico_messages(id) ON DELETE SET NULL,
  like_count int DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nico_lessons_agent
  ON public.nico_lessons(agent_key, like_count DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nico_lessons_source_msg
  ON public.nico_lessons(source_message_id)
  WHERE source_message_id IS NOT NULL;

COMMENT ON TABLE public.nico_lessons IS
  'Lecciones aprendidas de respuestas con feedback positivo (👍). Se inyectan top-10 por agent_key en el system prompt de Nico. Colectivas: alimentan a todos los usuarios.';

-- 3. Knowledge chunks con embeddings (Opción B — RAG semántico).
--    Voyage-3 produce vectores de 1024 dimensiones.
CREATE TABLE IF NOT EXISTS public.nico_knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key text NOT NULL,
  content text NOT NULL,
  embedding vector(1024) NOT NULL,
  source_lesson_id uuid REFERENCES public.nico_lessons(id) ON DELETE CASCADE,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nico_chunks_agent
  ON public.nico_knowledge_chunks(agent_key);

-- ivfflat con 100 lists es buen default para <100k chunks (que es nuestro horizonte)
CREATE INDEX IF NOT EXISTS idx_nico_chunks_embedding
  ON public.nico_knowledge_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

COMMENT ON TABLE public.nico_knowledge_chunks IS
  'Chunks vectorizados para retrieval semántico (RAG). Voyage-3 genera embeddings de 1024 dims. Se buscan top-5 por similarity coseno y se inyectan en el system prompt de Nico.';

-- 4. Versionado de system prompts propuestos por Opus (Opción C — evolutivo)
CREATE TABLE IF NOT EXISTS public.nico_prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key text NOT NULL,
  version int NOT NULL,
  base_prompt text NOT NULL,
  changelog text,
  evidence jsonb DEFAULT '[]'::jsonb,         -- IDs de feedback que motivaron la propuesta
  proposed_by text DEFAULT 'opus-weekly',
  status text DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(agent_key, version)
);

CREATE INDEX IF NOT EXISTS idx_nico_prompt_versions_active
  ON public.nico_prompt_versions(agent_key, status, version DESC);

COMMENT ON TABLE public.nico_prompt_versions IS
  'Versiones del system prompt propuestas semanalmente por Opus 4.7 analizando feedback. Estado pending hasta que el admin las apruebe desde /nico/evolution.';

-- 5. RPC para similarity search (cosine distance via <=>)
CREATE OR REPLACE FUNCTION public.search_nico_chunks(
  query_embedding vector(1024),
  target_agent_key text,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  content text,
  similarity float,
  chunk_id uuid
)
LANGUAGE sql STABLE
AS $$
  SELECT content, 1 - (embedding <=> query_embedding) AS similarity, id
  FROM public.nico_knowledge_chunks
  WHERE agent_key = target_agent_key
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.search_nico_chunks(vector(1024), text, int) TO authenticated, service_role;

COMMENT ON FUNCTION public.search_nico_chunks IS
  'Retrieval semántico: devuelve los match_count chunks más similares al embedding dado dentro del agent_key. Distancia coseno (1 - <=>).';

-- 6. RLS — lecciones y chunks son LECTURA PÚBLICA para usuarios autenticados
--    (son aprendizaje colectivo). Inserts solo via service role (edge functions).
ALTER TABLE public.nico_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nico_knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nico_prompt_versions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nico_lessons' AND policyname='Authenticated read lessons') THEN
    CREATE POLICY "Authenticated read lessons"
      ON public.nico_lessons FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nico_knowledge_chunks' AND policyname='Authenticated read chunks') THEN
    CREATE POLICY "Authenticated read chunks"
      ON public.nico_knowledge_chunks FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='nico_prompt_versions' AND policyname='Admins manage prompt versions') THEN
    -- Solo admins pueden leer/modificar versiones (panel de aprobación admin-only)
    CREATE POLICY "Admins manage prompt versions"
      ON public.nico_prompt_versions FOR ALL
      USING (public.is_admin(auth.uid()))
      WITH CHECK (public.is_admin(auth.uid()));
  END IF;
END $$;
