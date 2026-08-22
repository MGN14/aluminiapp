-- Cierre de Año — FASE 2: roll-forward de apertura versionada.
--
-- Tras cerrar el año N (Fase 1: reconciliación app vs contador), este RPC
-- convierte los saldos REALES del contador en el estado inicial del año N+1:
--
--   · fecha_inicio            → 31-dic-N (los flujos cuentan con date > fecha_inicio,
--                               o sea desde el 1-ene-N+1)
--   · caja y bancos           → real del contador, una fila consolidada de
--                               saldo_cuentas (transactions no atribuyen cuenta,
--                               repartir por cuenta sería inventar)
--   · cuentas_por_cobrar      → real POR CLIENTE (cxc_inicial de la cartera:
--                               mata H2/H3 de la auditoría de cobranza — la
--                               cartera del año nuevo arranca anclada al contador)
--   · anticipos_de_clientes   → real por cliente (reemplaza los anticipos de
--                               migración; la duda Eje/La Bodega/Todoalum muere
--                               con lo que firme el contador)
--   · anticipos_a_proveedores → real por proveedor
--   · cuentas_por_pagar       → real por proveedor
--   · iva_a_favor             → real del contador
--
-- NO se tocan: inventario (módulo Inventario), activos fijos (módulo), créditos
-- (módulo Créditos arrastra la deuda viva), prestaciones (Nómina), details de
-- tipo 'deudas' (deudas pre-app, siguen siendo las mismas).
--
-- VERSIONADO: antes de escribir se guarda un snapshot completo del estado
-- inicial (state + details + matches, con sus ids) en
-- year_closings.prev_state_snapshot. revert_year_closing_opening lo restaura
-- tal cual (mismos ids ⇒ los FKs de initial_balance_matches reviven) y vuelve
-- rolled_forward a false. La cadena de cierres ES el historial de versiones.

-- El CHECK original de field_type (2026-03-06) solo permitía 4 tipos; la app
-- escribe además 'saldo_cuentas' y 'deudas' desde Settings. En prod el
-- constraint ya no está; acá lo bajamos defensivamente para entornos que
-- vengan del schema viejo.
ALTER TABLE public.initial_state_details
  DROP CONSTRAINT IF EXISTS initial_state_details_field_type_check;

-- ─────────────────── RPC: aplicar la apertura del año N+1 ───────────────────
DROP FUNCTION IF EXISTS public.apply_year_closing_opening(uuid);

CREATE OR REPLACE FUNCTION public.apply_year_closing_opening(
  p_closing_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_closing public.year_closings%ROWTYPE;
  v_snapshot jsonb;
  v_cutoff date;
  v_caja numeric := 0;
  v_iva numeric := 0;
  v_cxc numeric := 0;
  v_ant_cli numeric := 0;
  v_ant_prov numeric := 0;
  v_cxp numeric := 0;
  v_detail_count integer := 0;
BEGIN
  v_owner := public.current_data_owner();

  -- Solo el administrador (dueño de la cuenta), igual que close_fiscal_year.
  IF v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Solo el administrador puede aplicar la apertura';
  END IF;

  -- Lock del cierre: dos clicks concurrentes no aplican dos veces.
  SELECT * INTO v_closing FROM public.year_closings
  WHERE id = p_closing_id AND user_id = v_owner
  FOR UPDATE;

  IF v_closing.id IS NULL THEN
    RAISE EXCEPTION 'Cierre no encontrado: %', p_closing_id;
  END IF;

  IF v_closing.rolled_forward THEN
    RAISE EXCEPTION 'La apertura de este cierre ya fue aplicada';
  END IF;

  -- Solo el cierre más reciente puede generar la apertura vigente.
  IF EXISTS (
    SELECT 1 FROM public.year_closings
    WHERE user_id = v_owner AND fiscal_year > v_closing.fiscal_year
  ) THEN
    RAISE EXCEPTION 'Existe un cierre más reciente (%). Solo el último cierre puede aplicar la apertura.',
      (SELECT max(fiscal_year) FROM public.year_closings WHERE user_id = v_owner);
  END IF;

  v_cutoff := make_date(v_closing.fiscal_year, 12, 31);

  -- No aplicar hacia atrás: si la apertura vigente ya es posterior al corte,
  -- algo está mal (p.ej. se aplicó un cierre y se re-creó otro del mismo año).
  IF EXISTS (
    SELECT 1 FROM public.initial_financial_state
    WHERE user_id = v_owner AND fecha_inicio >= v_cutoff
  ) THEN
    RAISE EXCEPTION 'El estado inicial vigente ya arranca en o después del %', v_cutoff;
  END IF;

  -- ── 1. Snapshot completo del estado inicial actual (permite revertir) ──
  v_snapshot := jsonb_build_object(
    'state', (
      SELECT to_jsonb(s) FROM public.initial_financial_state s WHERE s.user_id = v_owner
    ),
    'details', COALESCE((
      SELECT jsonb_agg(to_jsonb(d)) FROM public.initial_state_details d WHERE d.user_id = v_owner
    ), '[]'::jsonb),
    'matches', COALESCE((
      SELECT jsonb_agg(to_jsonb(m)) FROM public.initial_balance_matches m WHERE m.user_id = v_owner
    ), '[]'::jsonb),
    'taken_at', now()
  );

  -- ── 2. Reales del cierre por rubro (línea nivel-rubro: responsible_name IS NULL).
  --       Si el rubro no tiene línea de nivel, cae a la suma de sus terceros. ──
  SELECT COALESCE(
    (SELECT l.real_amount FROM public.year_closing_lines l
      WHERE l.closing_id = p_closing_id AND l.rubro = 'caja_bancos' AND l.responsible_name IS NULL LIMIT 1),
    0) INTO v_caja;
  SELECT COALESCE(
    (SELECT l.real_amount FROM public.year_closing_lines l
      WHERE l.closing_id = p_closing_id AND l.rubro = 'iva_a_favor' AND l.responsible_name IS NULL LIMIT 1),
    0) INTO v_iva;

  -- ── 3. Reemplazar los details de los tipos que la apertura ancla al contador.
  --       Los initial_balance_matches colgados de estos details caen por CASCADE
  --       (quedaron en el snapshot; el real del contador ya los netea). ──
  DELETE FROM public.initial_state_details
  WHERE user_id = v_owner
    AND field_type IN ('saldo_cuentas', 'cuentas_por_cobrar', 'anticipos_de_clientes',
                       'anticipos_a_proveedores', 'cuentas_por_pagar');

  -- Caja consolidada (una fila; el usuario puede repartirla por cuenta en Settings).
  INSERT INTO public.initial_state_details (user_id, field_type, responsible_id, responsible_name, amount)
  VALUES (v_owner, 'saldo_cuentas', NULL,
          format('Apertura %s — consolidado (contador)', v_closing.fiscal_year + 1), v_caja);

  -- Por tercero: CxC, anticipos de clientes, anticipos a proveedores, CxP.
  -- Línea de tercero = responsible_name IS NOT NULL. Solo montos > 0,50.
  INSERT INTO public.initial_state_details (user_id, field_type, responsible_id, responsible_name, amount)
  SELECT v_owner, l.rubro, l.responsible_id, l.responsible_name, l.real_amount
  FROM public.year_closing_lines l
  WHERE l.closing_id = p_closing_id
    AND l.rubro IN ('cuentas_por_cobrar', 'anticipos_de_clientes',
                    'anticipos_a_proveedores', 'cuentas_por_pagar')
    AND l.responsible_name IS NOT NULL
    AND l.real_amount > 0.5;

  -- Remanente sin desglosar: si el real de nivel-rubro supera la suma de sus
  -- terceros en más de $1, la diferencia entra como fila "(sin desglosar)"
  -- para que el total cuadre con el contador y el hueco quede VISIBLE.
  INSERT INTO public.initial_state_details (user_id, field_type, responsible_id, responsible_name, amount)
  SELECT v_owner, r.rubro, NULL,
         format('Ajuste contador %s (sin desglosar)', v_closing.fiscal_year + 1),
         r.nivel - r.terceros
  FROM (
    SELECT x.rubro,
      COALESCE((SELECT l.real_amount FROM public.year_closing_lines l
        WHERE l.closing_id = p_closing_id AND l.rubro = x.rubro AND l.responsible_name IS NULL LIMIT 1), 0) AS nivel,
      COALESCE((SELECT sum(l.real_amount) FROM public.year_closing_lines l
        WHERE l.closing_id = p_closing_id AND l.rubro = x.rubro
          AND l.responsible_name IS NOT NULL AND l.real_amount > 0.5), 0) AS terceros
    FROM (VALUES ('cuentas_por_cobrar'), ('anticipos_de_clientes'),
                 ('anticipos_a_proveedores'), ('cuentas_por_pagar')) AS x(rubro)
  ) r
  WHERE r.nivel - r.terceros > 1;

  -- Totales por tipo, leídos de lo efectivamente insertado.
  SELECT COALESCE(sum(amount) FILTER (WHERE field_type = 'cuentas_por_cobrar'), 0),
         COALESCE(sum(amount) FILTER (WHERE field_type = 'anticipos_de_clientes'), 0),
         COALESCE(sum(amount) FILTER (WHERE field_type = 'anticipos_a_proveedores'), 0),
         COALESCE(sum(amount) FILTER (WHERE field_type = 'cuentas_por_pagar'), 0),
         count(*)
  INTO v_cxc, v_ant_cli, v_ant_prov, v_cxp, v_detail_count
  FROM public.initial_state_details
  WHERE user_id = v_owner
    AND field_type IN ('cuentas_por_cobrar', 'anticipos_de_clientes',
                       'anticipos_a_proveedores', 'cuentas_por_pagar');

  -- ── 4. Estado maestro: la apertura nueva. prestamos y legacy quedan como están. ──
  UPDATE public.initial_financial_state SET
    fecha_inicio = v_cutoff,
    saldo_bancos = v_caja,
    iva_a_favor = v_iva,
    cuentas_por_cobrar = v_cxc,
    anticipos_de_clientes = v_ant_cli,
    anticipos_a_proveedores = v_ant_prov,
    cuentas_por_pagar = v_cxp,
    updated_at = now()
  WHERE user_id = v_owner;

  IF NOT FOUND THEN
    INSERT INTO public.initial_financial_state (
      user_id, fecha_inicio, saldo_bancos, iva_a_favor,
      cuentas_por_cobrar, anticipos_de_clientes, anticipos_a_proveedores, cuentas_por_pagar
    ) VALUES (
      v_owner, v_cutoff, v_caja, v_iva, v_cxc, v_ant_cli, v_ant_prov, v_cxp
    );
  END IF;

  -- ── 5. Marcar el cierre como aplicado, con el snapshot para revertir. ──
  UPDATE public.year_closings SET
    prev_state_snapshot = v_snapshot,
    rolled_forward = true
  WHERE id = p_closing_id;

  RETURN jsonb_build_object(
    'success', true,
    'closing_id', p_closing_id,
    'fiscal_year', v_closing.fiscal_year,
    'opening_year', v_closing.fiscal_year + 1,
    'fecha_inicio', v_cutoff,
    'caja_bancos', v_caja,
    'iva_a_favor', v_iva,
    'cuentas_por_cobrar', v_cxc,
    'anticipos_de_clientes', v_ant_cli,
    'anticipos_a_proveedores', v_ant_prov,
    'cuentas_por_pagar', v_cxp,
    'detalle_terceros', v_detail_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_year_closing_opening(uuid) TO authenticated;

-- ─────────────────── RPC: revertir la apertura (restaura el snapshot) ───────
DROP FUNCTION IF EXISTS public.revert_year_closing_opening(uuid);

CREATE OR REPLACE FUNCTION public.revert_year_closing_opening(
  p_closing_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_closing public.year_closings%ROWTYPE;
  v_restored_details integer := 0;
  v_restored_matches integer := 0;
BEGIN
  v_owner := public.current_data_owner();

  IF v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Solo el administrador puede revertir la apertura';
  END IF;

  SELECT * INTO v_closing FROM public.year_closings
  WHERE id = p_closing_id AND user_id = v_owner
  FOR UPDATE;

  IF v_closing.id IS NULL THEN
    RAISE EXCEPTION 'Cierre no encontrado: %', p_closing_id;
  END IF;

  IF NOT v_closing.rolled_forward THEN
    RAISE EXCEPTION 'Este cierre no tiene una apertura aplicada';
  END IF;

  IF v_closing.prev_state_snapshot IS NULL
     OR v_closing.prev_state_snapshot->'state' IS NULL THEN
    RAISE EXCEPTION 'El cierre no tiene snapshot del estado anterior; no se puede revertir automáticamente';
  END IF;

  -- Borrar el estado vigente (la apertura aplicada + cualquier edición
  -- posterior sobre ella). Los matches actuales caen por CASCADE.
  DELETE FROM public.initial_state_details WHERE user_id = v_owner;
  DELETE FROM public.initial_financial_state WHERE user_id = v_owner;

  -- Restaurar tal cual, con los ids originales (los FKs de matches reviven).
  INSERT INTO public.initial_financial_state
  SELECT * FROM jsonb_populate_record(NULL::public.initial_financial_state,
                                      v_closing.prev_state_snapshot->'state');

  INSERT INTO public.initial_state_details
  SELECT * FROM jsonb_populate_recordset(NULL::public.initial_state_details,
                                         v_closing.prev_state_snapshot->'details');
  GET DIAGNOSTICS v_restored_details = ROW_COUNT;

  -- Matches: solo los que aún apuntan a una transaction viva (pudieron
  -- borrarse transacciones entre el apply y el revert).
  INSERT INTO public.initial_balance_matches
  SELECT m.* FROM jsonb_populate_recordset(NULL::public.initial_balance_matches,
                                           v_closing.prev_state_snapshot->'matches') m
  WHERE EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = m.transaction_id);
  GET DIAGNOSTICS v_restored_matches = ROW_COUNT;

  UPDATE public.year_closings SET
    prev_state_snapshot = NULL,
    rolled_forward = false
  WHERE id = p_closing_id;

  RETURN jsonb_build_object(
    'success', true,
    'closing_id', p_closing_id,
    'fiscal_year', v_closing.fiscal_year,
    'restored_details', v_restored_details,
    'restored_matches', v_restored_matches
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.revert_year_closing_opening(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
