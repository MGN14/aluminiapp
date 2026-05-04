-- ============================================================================
-- COLABORADORES VEN DATOS DEL OWNER
-- ============================================================================
-- Antes: cada tabla tenía RLS USING (auth.uid() = user_id). Eso significaba
-- que un colaborador invitado entraba a la app y veía 0 filas (su propio
-- user_id no había insertado nada). El sistema de colaboradores se quedó a
-- la mitad: la UI permitía invitar y configurar permisos, pero las tablas
-- de datos nunca compartieron.
--
-- Ahora: una función `current_data_owner()` resuelve el "dueño efectivo"
-- de los datos para el usuario actual. Para owners es auth.uid(). Para
-- colaboradores activos es el owner_user_id correspondiente. Las policies
-- y un trigger BEFORE INSERT garantizan que tanto lecturas como inserts
-- usan el owner correcto.
--
-- IMPORTANTE: esta migración solo cambia el modelo de visibilidad por owner.
-- El gating por module_key + access_level (view/edit/none) sigue siendo
-- responsabilidad del frontend (RequireModule + AppSidebar). Una iteración
-- futura puede mover el gating granular a RLS si el riesgo lo amerita.
-- ============================================================================

-- 1. Función que devuelve el "dueño efectivo" de los datos para el caller.
--    SECURITY DEFINER porque consulta `collaborators` cuyas policies podrían
--    no permitir al colaborador ver su propio registro de relación.
--    STABLE porque no muta y el resultado es estable dentro de una query.
CREATE OR REPLACE FUNCTION public.current_data_owner()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid;
  v_owner uuid;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RETURN NULL;
  END IF;

  -- Si es colaborador activo, devolver el owner que lo invitó.
  -- LIMIT 1: en teoría un user solo puede ser colaborador de un owner a la
  -- vez (UNIQUE constraint en collaborators), pero LIMIT por seguridad.
  SELECT owner_user_id INTO v_owner
  FROM public.collaborators
  WHERE collaborator_user_id = v_caller
    AND status = 'active'
  LIMIT 1;

  RETURN COALESCE(v_owner, v_caller);
END;
$$;

GRANT EXECUTE ON FUNCTION public.current_data_owner() TO authenticated;

-- 2. Trigger genérico BEFORE INSERT que reescribe NEW.user_id al owner
--    efectivo. Garantiza que un colaborador insertando en cash_movements,
--    invoices, etc., asocia la fila al owner — no a su propio user_id.
CREATE OR REPLACE FUNCTION public.set_user_id_to_data_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.user_id := public.current_data_owner();
  RETURN NEW;
END;
$$;

-- 3. Aplicar a cada tabla "categoría A" (datos de empresa que el colaborador
--    debe ver/editar). Drop policies viejas, recrear con el patrón nuevo,
--    y attach el trigger BEFORE INSERT.
--
--    Tablas categoría B (datos personales: profiles, user_roles, nico_messages,
--    app_events, user_*_credentials, etc.) NO se tocan — siguen filtrando
--    por auth.uid() = user_id.
DO $$
DECLARE
  tbl text;
  pol RECORD;
  has_user_id boolean;
  tables text[] := ARRAY[
    'invoices', 'invoice_items', 'invoice_transaction_matches',
    'transactions', 'categories', 'responsibles', 'responsible_aliases',
    'inventory_products', 'inventory_movements', 'inventory_counts',
    'inventory_import_logs', 'cash_movements',
    'remisiones', 'remision_items', 'remision_invoices', 'remission_payments',
    'bank_statements', 'petty_cash_movements', 'petty_cash_closings',
    'initial_state_details', 'initial_financial_state', 'initial_balance_matches',
    'financial_health_scores', 'tax_settings',
    'operative_receivables', 'credits', 'credit_payments',
    'fiscal_config', 'business_patterns', 'business_obligations',
    'user_payment_methods', 'reconciliation_rules', 'product_master'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- Skip silenciosamente si la tabla no existe en este schema (algunas
    -- como remission_payments, product_master, business_obligations
    -- pueden haber sido creadas via Studio sin migración local).
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = tbl AND n.nspname = 'public'
    ) THEN
      RAISE NOTICE 'Skip table %: not found in public schema', tbl;
      CONTINUE;
    END IF;

    -- Skip si la tabla no tiene columna user_id (ej: relations de N:M
    -- como remision_invoices que viven la lógica via FK al padre).
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'user_id'
    ) INTO has_user_id;
    IF NOT has_user_id THEN
      RAISE NOTICE 'Skip table %: no user_id column', tbl;
      CONTINUE;
    END IF;

    -- Drop ALL existing policies on the table (nombres heterogéneos en
    -- migraciones viejas; el unico patrón seguro es enumerar y drop).
    FOR pol IN
      SELECT polname FROM pg_policy
      WHERE polrelid = format('public.%I', tbl)::regclass
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.polname, tbl);
    END LOOP;

    -- Recrear las 4 policies con el patrón estandarizado.
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = public.current_data_owner())',
      tbl || '_owner_or_collab_select', tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = public.current_data_owner())',
      tbl || '_owner_or_collab_insert', tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (user_id = public.current_data_owner()) WITH CHECK (user_id = public.current_data_owner())',
      tbl || '_owner_or_collab_update', tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (user_id = public.current_data_owner())',
      tbl || '_owner_or_collab_delete', tbl
    );

    -- Trigger BEFORE INSERT — safety net por si frontend olvida resolver el
    -- owner. Si el trigger ya existe (por re-corrida idempotente), drop+recrear.
    EXECUTE format('DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.%I', tbl);
    EXECUTE format(
      'CREATE TRIGGER set_user_id_to_data_owner_trg BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner()',
      tbl
    );

    -- Asegurar RLS habilitado.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;

-- 4. Agregar policy SELECT en `profiles` para que el colaborador pueda LEER
--    el profile del owner (reteica, company_name, etc.). Mantiene UPDATE
--    restringido al dueño. Esto se hace de forma aditiva — la policy
--    existente "auth.uid() = user_id" se conserva.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'profiles' AND relnamespace = 'public'::regnamespace) THEN
    -- Drop si la policy ya existe (idempotencia).
    EXECUTE 'DROP POLICY IF EXISTS profiles_collab_read_owner ON public.profiles';
    EXECUTE $POL$
      CREATE POLICY profiles_collab_read_owner ON public.profiles
      FOR SELECT TO authenticated
      USING (
        auth.uid() = user_id
        OR user_id IN (
          SELECT owner_user_id FROM public.collaborators
          WHERE collaborator_user_id = auth.uid() AND status = 'active'
        )
      )
    $POL$;
  END IF;
END $$;

-- 5. Agregar policy de SELECT en collaborators para que el colaborador
--    pueda VER su propio registro de invitación (necesario para el hook
--    useDataOwner del frontend que busca el owner). El insert/update/delete
--    sigue siendo solo del owner — esto solo agrega visibilidad de lectura.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.collaborators'::regclass
      AND polname = 'collaborators_self_select'
  ) THEN
    -- Si la policy de "Collaborators can view their own collaborator record"
    -- ya existe (creada en migración inicial), igual creo la mía con un
    -- nombre nuevo para idempotencia. No hace daño tener dos SELECT policies
    -- — Postgres hace OR entre ellas.
    CREATE POLICY collaborators_self_select
      ON public.collaborators
      FOR SELECT
      TO authenticated
      USING (auth.uid() = collaborator_user_id);
  END IF;
END $$;
