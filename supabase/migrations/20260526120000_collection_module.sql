-- Módulo de Cobranza — fase backend.
--
-- Dos tablas nuevas:
--   1) collection_touchpoints: registro de cada contacto con un cliente
--      (llamada, email, whatsapp, visita) con outcome y notas. Es la base
--      de toda la automatización futura.
--   2) client_collection_scores: cache del score IA por cliente. Se recalcula
--      diariamente con Claude. El UI consulta este cache (no llama a Claude
--      en cada render).

-- =============================================================================
-- 1. collection_touchpoints
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.collection_touchpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Quién: cliente identificado por responsible_id (si existe) o por nombre
  responsible_id uuid NULL REFERENCES public.responsibles(id) ON DELETE SET NULL,
  client_name text NOT NULL, -- denormalizado por si no hay responsible_id

  -- Opcional: a qué factura específica refiere
  invoice_id uuid NULL,

  -- Tipo de contacto
  channel text NOT NULL CHECK (channel IN (
    'llamada', 'email', 'whatsapp', 'sms', 'visita', 'reunion', 'otro'
  )),

  -- Resultado del contacto
  outcome text NOT NULL CHECK (outcome IN (
    'contactado',          -- hablaste con él/ella
    'no_contesto',         -- no atendió
    'prometio_pago',       -- prometió pagar (crear expected_payment aparte)
    'disputa',             -- discute la deuda
    'compromiso_parcial',  -- acuerdo de cuotas
    'sin_respuesta',       -- mandaste mensaje, no respondió
    'otro'
  )),

  notes text NULL,

  -- Cuándo: por default ahora, pero permite registrar contactos pasados
  contacted_at timestamptz NOT NULL DEFAULT now(),

  -- Auditoría
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS collection_touchpoints_user_idx
  ON public.collection_touchpoints(user_id, contacted_at DESC);
CREATE INDEX IF NOT EXISTS collection_touchpoints_responsible_idx
  ON public.collection_touchpoints(user_id, responsible_id, contacted_at DESC)
  WHERE responsible_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS collection_touchpoints_invoice_idx
  ON public.collection_touchpoints(user_id, invoice_id)
  WHERE invoice_id IS NOT NULL;

COMMENT ON TABLE public.collection_touchpoints IS
  'Registro de contactos con clientes deudores: llamadas, emails, WhatsApps, visitas. Base para automatización de cobranza.';

ALTER TABLE public.collection_touchpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "touchpoints_owner_all" ON public.collection_touchpoints;
CREATE POLICY "touchpoints_owner_all"
  ON public.collection_touchpoints
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_touchpoints_updated_at ON public.collection_touchpoints;
CREATE TRIGGER set_touchpoints_updated_at
  BEFORE UPDATE ON public.collection_touchpoints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================================
-- 2. client_collection_scores
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.client_collection_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Cliente (igual que touchpoints: responsible_id si existe, sino por nombre)
  responsible_id uuid NULL REFERENCES public.responsibles(id) ON DELETE SET NULL,
  client_name text NOT NULL,

  -- Score 0-100 (mayor = más probable que pague)
  score smallint NOT NULL CHECK (score >= 0 AND score <= 100),

  -- Categoría humana: 'excelente' | 'bueno' | 'medio' | 'riesgo' | 'critico'
  category text NOT NULL CHECK (category IN ('excelente','bueno','medio','riesgo','critico')),

  -- Razonamiento del modelo (1-2 oraciones)
  reasoning text NULL,

  -- Acción recomendada (e.g. "Llamar hoy", "Email firme", "Escalar a legal")
  recommended_action text NULL,

  -- Snapshot de la situación al momento del scoring (auditoría)
  total_owed numeric(18, 2) NULL,
  oldest_overdue_days integer NULL,
  invoices_count integer NULL,

  -- Cuándo se calculó
  scored_at timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Único score "vivo" por cliente por usuario (upsert pattern)
CREATE UNIQUE INDEX IF NOT EXISTS client_collection_scores_unique
  ON public.client_collection_scores(user_id, COALESCE(responsible_id::text, '__name:' || lower(client_name)));

CREATE INDEX IF NOT EXISTS client_collection_scores_user_score_idx
  ON public.client_collection_scores(user_id, score ASC);

COMMENT ON TABLE public.client_collection_scores IS
  'Cache de scoring IA por cliente. Se recalcula diariamente vía cron score-collection-clients. UI lee de aquí.';

ALTER TABLE public.client_collection_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scores_owner_select" ON public.client_collection_scores;
CREATE POLICY "scores_owner_select"
  ON public.client_collection_scores
  FOR SELECT USING (auth.uid() = user_id);

-- INSERT/UPDATE/DELETE solo vía service_role (edge function score-collection-clients).
-- No creamos policies de mutación = bloqueado para el cliente.

DROP TRIGGER IF EXISTS set_scores_updated_at ON public.client_collection_scores;
CREATE TRIGGER set_scores_updated_at
  BEFORE UPDATE ON public.client_collection_scores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
