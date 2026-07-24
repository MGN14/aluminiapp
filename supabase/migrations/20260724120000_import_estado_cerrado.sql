-- Estado 'cerrado' como etapa FINAL del ciclo de importación.
--
-- Decisión de Nico (2026-07-24): la importación NO termina en 'entregado' —
-- termina en 'cerrado', que se alcanza únicamente vía cerrar_importacion()
-- cuando el checklist documental está completo (swifts, DIM, certificado
-- BanRep, excel de costeo). 'entregado' pasa a ser una etapa más: el
-- contenedor llegó pero sigue "abierto" hasta legalizar frente al BanRep.
--
-- reabrir_importacion() devuelve el estado a 'entregado'.

-- ── CHECK constraints: sumar 'cerrado' ──────────────────────────────────────
ALTER TABLE public.imports DROP CONSTRAINT IF EXISTS imports_estado_check;
ALTER TABLE public.imports ADD CONSTRAINT imports_estado_check
  CHECK (estado IN ('cotizacion', 'anticipo', 'produccion', 'transito', 'aduana', 'entregado', 'cerrado', 'cancelado'));

ALTER TABLE public.import_estado_history DROP CONSTRAINT IF EXISTS import_estado_history_estado_check;
ALTER TABLE public.import_estado_history ADD CONSTRAINT import_estado_history_estado_check
  CHECK (estado IN ('cotizacion', 'anticipo', 'produccion', 'transito', 'aduana', 'entregado', 'cerrado', 'cancelado'));

-- ── cerrar_importacion: además de cerrada=true, estado='cerrado' + historial ─
CREATE OR REPLACE FUNCTION public.cerrar_importacion(p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_imp record;
  v_pagos int;
  v_swift int;
  v_dim int;
  v_banrep int;
  v_costeo int;
  v_faltantes text[] := '{}';
BEGIN
  SELECT * INTO v_imp FROM public.imports WHERE id = p_import_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importación no encontrada'; END IF;
  IF auth.uid() IS DISTINCT FROM v_imp.user_id THEN
    RAISE EXCEPTION 'Solo el administrador puede cerrar la importación';
  END IF;
  IF v_imp.cerrada THEN
    RETURN jsonb_build_object('ok', true, 'ya_cerrada', true);
  END IF;
  IF v_imp.estado <> 'entregado' THEN
    RAISE EXCEPTION 'Solo se cierra una importación entregada';
  END IF;

  SELECT count(*) INTO v_pagos FROM public.import_payments WHERE import_id = p_import_id;
  SELECT
    count(*) FILTER (WHERE tipo = 'swift'),
    count(*) FILTER (WHERE tipo = 'dim'),
    count(*) FILTER (WHERE tipo = 'certificado_banrep'),
    count(*) FILTER (WHERE tipo = 'costeo_excel')
  INTO v_swift, v_dim, v_banrep, v_costeo
  FROM public.import_documents WHERE import_id = p_import_id;

  -- Un swift por abono (mínimo 1 aunque no haya abonos registrados).
  IF v_swift < GREATEST(v_pagos, 1) THEN
    v_faltantes := array_append(v_faltantes,
      format('swifts: %s de %s abonos', v_swift, GREATEST(v_pagos, 1)));
  END IF;
  IF v_dim = 0 THEN v_faltantes := array_append(v_faltantes, 'DIM (declaración de importación)'); END IF;
  IF v_banrep = 0 THEN v_faltantes := array_append(v_faltantes, 'certificado BanRep (excel de legalización)'); END IF;
  IF v_costeo = 0 THEN v_faltantes := array_append(v_faltantes, 'excel de costeo'); END IF;

  IF array_length(v_faltantes, 1) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'faltantes', to_jsonb(v_faltantes));
  END IF;

  UPDATE public.imports
  SET cerrada = true, cerrada_at = now(), cerrada_by = auth.uid(),
      estado = 'cerrado', updated_at = now()
  WHERE id = p_import_id;

  -- Historial: fecha en que entró a 'cerrado' (hoy).
  INSERT INTO public.import_estado_history (user_id, import_id, estado, fecha)
  VALUES (v_imp.user_id, p_import_id, 'cerrado', current_date)
  ON CONFLICT (import_id, estado) DO UPDATE SET fecha = EXCLUDED.fecha;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── reabrir_importacion: vuelve a 'entregado' y limpia el historial ──────────
CREATE OR REPLACE FUNCTION public.reabrir_importacion(p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_imp record;
BEGIN
  SELECT * INTO v_imp FROM public.imports WHERE id = p_import_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importación no encontrada'; END IF;
  IF auth.uid() IS DISTINCT FROM v_imp.user_id THEN
    RAISE EXCEPTION 'Solo el administrador puede reabrir la importación';
  END IF;
  UPDATE public.imports
  SET cerrada = false, cerrada_at = NULL, cerrada_by = NULL,
      estado = CASE WHEN estado = 'cerrado' THEN 'entregado' ELSE estado END,
      updated_at = now()
  WHERE id = p_import_id;
  DELETE FROM public.import_estado_history
  WHERE import_id = p_import_id AND estado = 'cerrado';
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── Backfill: importaciones ya cerradas (flag) pasan al estado 'cerrado' ─────
UPDATE public.imports
SET estado = 'cerrado'
WHERE cerrada = true AND estado = 'entregado';

INSERT INTO public.import_estado_history (user_id, import_id, estado, fecha)
SELECT user_id, id, 'cerrado', COALESCE(cerrada_at::date, current_date)
FROM public.imports
WHERE cerrada = true AND estado = 'cerrado'
ON CONFLICT (import_id, estado) DO NOTHING;
