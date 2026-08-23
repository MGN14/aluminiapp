-- Aprendizaje continuo F1 (auditoría 2026-08-23): el detector de patrones
-- pasa a usar la curaduría de Conciliación y sus decisiones sobreviven.
--
-- pattern_key: llave ESTABLE de agrupación (cat+responsible o texto). El
--   regenerado de patrones hace DELETE+INSERT: sin llave estable, el status
--   (archived al crear una regla, dismissed/confirmed de F3) se perdía en
--   cada corrida — bug que también afectaba a las reglas sugeridas.
-- source: 'conciliado' = agrupado por categoría+beneficiario (curaduría de
--   Conciliación, confianza alta) · 'texto' = por descripción cruda del
--   banco (fallback) · 'factura' = por contraparte de facturas.
ALTER TABLE public.business_patterns
  ADD COLUMN IF NOT EXISTS pattern_key text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'texto';

CREATE INDEX IF NOT EXISTS idx_business_patterns_user_key
  ON public.business_patterns(user_id, pattern_key)
  WHERE pattern_key IS NOT NULL;

NOTIFY pgrst, 'reload schema';
