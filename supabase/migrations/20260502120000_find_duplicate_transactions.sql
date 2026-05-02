-- Detector de transacciones duplicadas al subir extracto.
--
-- Caso de uso: el usuario sube un extracto Bancolombia (PDF o CSV). Si el
-- mismo extracto (o uno con superposición de fechas) ya fue cargado antes,
-- vamos a duplicar transacciones. El frontend llama a esta función ANTES
-- de hacer el insert real para mostrar al usuario qué movimientos ya
-- existen y dejar que decida.
--
-- Match heurístico: misma date + amount + description normalizada
-- (lowercase + trim) dentro del MISMO user (cross-statement).
-- No hace match contra deleted_at != NULL.

DROP FUNCTION IF EXISTS public.find_duplicate_transactions(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.find_duplicate_transactions(
  p_user_id uuid,
  p_candidates jsonb
)
RETURNS TABLE (
  candidate_index int,
  matched_tx_id uuid,
  matched_date date,
  matched_amount numeric,
  matched_description text,
  matched_statement_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cands AS (
    SELECT
      (ord - 1)::int AS idx,
      (item->>'date')::date AS date,
      (item->>'amount')::numeric AS amount,
      lower(trim(item->>'description')) AS description
    FROM jsonb_array_elements(p_candidates) WITH ORDINALITY AS t(item, ord)
  )
  SELECT
    c.idx AS candidate_index,
    t.id AS matched_tx_id,
    t.date AS matched_date,
    t.amount AS matched_amount,
    t.description AS matched_description,
    t.statement_id AS matched_statement_id
  FROM cands c
  JOIN public.transactions t ON
    t.user_id = p_user_id
    AND t.deleted_at IS NULL
    AND t.date = c.date
    AND t.amount = c.amount
    AND lower(trim(t.description)) = c.description
  ORDER BY c.idx;
$$;

-- Permitir invocar desde rol authenticated (filtrado interno por p_user_id).
GRANT EXECUTE ON FUNCTION public.find_duplicate_transactions(uuid, jsonb)
  TO authenticated;

COMMENT ON FUNCTION public.find_duplicate_transactions(uuid, jsonb) IS
  'Devuelve las posiciones (candidate_index) del array de candidatos que ya existen como transactions del mismo user (match por date + amount + description normalizada). Llamada desde frontend antes de upload para mostrar duplicados al usuario.';

NOTIFY pgrst, 'reload schema';
