-- Cierre de Año (cierre fiscal) — espeja el patrón de cierre de caja menor.
--
-- Caso de uso: al final del año, el dueño "cierra el año": la app SUGIERE los
-- saldos de cierre por rubro (y por tercero en cartera/CxP/anticipos), el
-- usuario carga al lado los saldos REALES que le pasa el contador, y la app
-- muestra la diferencia y el %. Queda un registro inmutable + PDF firmable.
-- La Fase 2 (apply_year_closing_opening) usa esos saldos reales como apertura
-- del próximo año SIN tocar el estado inicial existente (versión nueva aparte).
--
-- Este archivo solo crea el registro de cierre + reconciliación. NO escribe en
-- initial_financial_state / initial_state_details (los saldos iniciales del
-- usuario quedan intactos).

-- ───────────────────────── Tabla maestra del cierre ─────────────────────────
CREATE TABLE IF NOT EXISTS public.year_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fiscal_year integer NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  -- Patrimonio (activos − pasivos) sugerido por la app vs real del contador.
  total_sugerido numeric(16, 2) NOT NULL DEFAULT 0,
  total_real numeric(16, 2) NOT NULL DEFAULT 0,
  total_diferencia numeric(16, 2) NOT NULL DEFAULT 0,
  -- Snapshot del estado inicial ANTES del roll-forward (Fase 2). NULL mientras
  -- no se aplique la apertura; permite revertir sin perder nada.
  prev_state_snapshot jsonb,
  -- true cuando la Fase 2 ya creó la apertura del próximo año a partir de este cierre.
  rolled_forward boolean NOT NULL DEFAULT false,
  notes text,
  closed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT year_closings_period_valid CHECK (period_end >= period_start),
  CONSTRAINT year_closings_unique_year UNIQUE (user_id, fiscal_year)
);

CREATE INDEX IF NOT EXISTS idx_year_closings_user_year
  ON public.year_closings (user_id, fiscal_year DESC);

ALTER TABLE public.year_closings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own year closings" ON public.year_closings;
CREATE POLICY "Users view own year closings"
  ON public.year_closings FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own year closings" ON public.year_closings;
CREATE POLICY "Users insert own year closings"
  ON public.year_closings FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own year closings" ON public.year_closings;
CREATE POLICY "Users update own year closings"
  ON public.year_closings FOR UPDATE USING (auth.uid() = user_id);

-- ─────────────────── Detalle de reconciliación (por rubro/tercero) ───────────
CREATE TABLE IF NOT EXISTS public.year_closing_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_id uuid NOT NULL REFERENCES public.year_closings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Rubro del balance: caja_bancos, cuentas_por_cobrar, anticipos_de_clientes,
  -- inventario, activos_fijos, anticipos_a_proveedores, cuentas_por_pagar,
  -- deuda_financiera, prestaciones_por_pagar, iva_a_favor, patrimonio.
  rubro text NOT NULL,
  -- Cuando es una línea por tercero (cliente/proveedor). NULL = total del rubro.
  responsible_id uuid,
  responsible_name text,
  suggested_amount numeric(16, 2) NOT NULL DEFAULT 0,
  real_amount numeric(16, 2) NOT NULL DEFAULT 0,
  difference numeric(16, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_year_closing_lines_closing
  ON public.year_closing_lines (closing_id);

ALTER TABLE public.year_closing_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own year closing lines" ON public.year_closing_lines;
CREATE POLICY "Users view own year closing lines"
  ON public.year_closing_lines FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own year closing lines" ON public.year_closing_lines;
CREATE POLICY "Users insert own year closing lines"
  ON public.year_closing_lines FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ───────────────────────── RPC: cerrar el año ───────────────────────────────
-- Recibe las líneas ya calculadas en el frontend (sugerido reusa clientReceivables
-- + balance; real lo carga el contador). El RPC valida que sea el ADMINISTRADOR,
-- persiste el cierre + líneas atómicamente, y devuelve el id. NO toca el estado
-- inicial (eso es Fase 2, en otro RPC explícito).
DROP FUNCTION IF EXISTS public.close_fiscal_year(integer, jsonb, numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.close_fiscal_year(
  p_fiscal_year integer,
  p_lines jsonb,
  p_total_sugerido numeric,
  p_total_real numeric,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_closing_id uuid;
  v_line jsonb;
BEGIN
  v_owner := public.current_data_owner();

  -- Solo el administrador (dueño de la cuenta) puede cerrar el año.
  IF v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Solo el administrador puede cerrar el año';
  END IF;

  IF p_fiscal_year IS NULL OR p_fiscal_year < 2000 OR p_fiscal_year > 2100 THEN
    RAISE EXCEPTION 'Año fiscal inválido: %', p_fiscal_year;
  END IF;

  INSERT INTO public.year_closings (
    user_id, fiscal_year, period_start, period_end,
    total_sugerido, total_real, total_diferencia, notes
  )
  VALUES (
    v_owner, p_fiscal_year,
    make_date(p_fiscal_year, 1, 1), make_date(p_fiscal_year, 12, 31),
    COALESCE(p_total_sugerido, 0), COALESCE(p_total_real, 0),
    COALESCE(p_total_real, 0) - COALESCE(p_total_sugerido, 0),
    p_notes
  )
  RETURNING id INTO v_closing_id;

  -- Insertar las líneas de reconciliación.
  IF p_lines IS NOT NULL THEN
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
      INSERT INTO public.year_closing_lines (
        closing_id, user_id, rubro, responsible_id, responsible_name,
        suggested_amount, real_amount, difference
      )
      VALUES (
        v_closing_id, v_owner,
        v_line->>'rubro',
        -- Cast defensivo: solo un uuid válido entra; cualquier id sintético
        -- (p.ej. '__unknown', '__name:foo' de clientReceivables) → NULL, para
        -- no abortar todo el cierre con "invalid input syntax for type uuid".
        CASE WHEN v_line->>'responsible_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN (v_line->>'responsible_id')::uuid ELSE NULL END,
        v_line->>'responsible_name',
        COALESCE((v_line->>'suggested_amount')::numeric, 0),
        COALESCE((v_line->>'real_amount')::numeric, 0),
        COALESCE((v_line->>'real_amount')::numeric, 0) - COALESCE((v_line->>'suggested_amount')::numeric, 0)
      );
    END LOOP;
  END IF;

  RETURN v_closing_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_fiscal_year(integer, jsonb, numeric, numeric, text) TO authenticated;

-- ───────────────────────── RPC: reabrir el año (admin) ──────────────────────
-- Borra el cierre (cascade borra las líneas). Si la Fase 2 ya había aplicado la
-- apertura (rolled_forward), la reversión de esa apertura la hace el RPC de
-- Fase 2 (apply/revert); acá solo se borra el registro de reconciliación.
DROP FUNCTION IF EXISTS public.reopen_fiscal_year(uuid);

CREATE OR REPLACE FUNCTION public.reopen_fiscal_year(
  p_closing_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_owner uuid;
  v_rolled boolean;
  v_is_admin boolean := false;
BEGIN
  BEGIN
    v_is_admin := public.is_admin(v_caller);
  EXCEPTION WHEN OTHERS THEN
    v_is_admin := false;
  END;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Forbidden: solo los administradores pueden reabrir cierres';
  END IF;

  SELECT user_id, rolled_forward INTO v_owner, v_rolled
  FROM public.year_closings WHERE id = p_closing_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Cierre no encontrado: %', p_closing_id;
  END IF;

  -- Si la apertura del próximo año ya fue aplicada, hay que revertirla primero
  -- desde la Fase 2 (apply_year_closing_opening con revert). No borramos un
  -- cierre con apertura activa para no dejar la apertura huérfana.
  IF v_rolled THEN
    RAISE EXCEPTION 'Este cierre ya generó la apertura del próximo año. Revertí la apertura antes de reabrir el cierre.';
  END IF;

  DELETE FROM public.year_closings WHERE id = p_closing_id;

  RETURN jsonb_build_object(
    'success', true,
    'closing_id', p_closing_id,
    'owner_user_id', v_owner,
    'reopened_by', v_caller
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_fiscal_year(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
