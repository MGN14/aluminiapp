-- ============================================================================
-- REGLAS INVERSAS DE TARJETA: categoría + beneficiario → descripción
-- ============================================================================
-- El CSV de tarjeta de crédito Bancolombia no trae comercio: todas las compras
-- entran como "Compra TC *2047". Las reglas normales van descripción→categoría,
-- acá es AL REVÉS: cuando el usuario asigna cierta categoría/beneficiario a un
-- movimiento de tarjeta (ej: Impuestos + DIAN), la descripción se reemplaza
-- automáticamente (ej: "IMPTO GOBIERNO 4X1000").
--
-- Tabla SEPARADA de reconciliation_rules a propósito: una regla inversa tiene
-- category_id/responsible_id como CONDICIÓN (no como acción). Si viviera en
-- reconciliation_rules, los appliers existentes (frontend + trigger + RPC
-- apply_pending_rules_for_user) la tratarían como regla normal sin keyword y
-- categorizarían TODO movimiento del tipo. Separar elimina esa clase de bug.

CREATE TABLE IF NOT EXISTS public.card_description_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  responsible_id uuid REFERENCES public.responsibles(id) ON DELETE CASCADE,
  description text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  match_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Al menos una condición (las dos juntas es el caso típico)
  CONSTRAINT card_desc_rule_has_condition CHECK (category_id IS NOT NULL OR responsible_id IS NOT NULL)
);

-- Una regla por combinación exacta (NULLs cuentan como valor distinto en
-- UNIQUE de Postgres, por eso índice sobre expresiones con coalesce).
CREATE UNIQUE INDEX IF NOT EXISTS card_desc_rules_combo_uniq
  ON public.card_description_rules (
    user_id,
    COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(responsible_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

ALTER TABLE public.card_description_rules ENABLE ROW LEVEL SECURITY;

-- Mismo patrón owner/colaborador que el resto de tablas de datos de empresa
-- (migración 20260507120000_collaborators_share_owner_data).
CREATE POLICY card_description_rules_owner_or_collab_select
  ON public.card_description_rules FOR SELECT TO authenticated
  USING (user_id = public.current_data_owner());
CREATE POLICY card_description_rules_owner_or_collab_insert
  ON public.card_description_rules FOR INSERT TO authenticated
  WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY card_description_rules_owner_or_collab_update
  ON public.card_description_rules FOR UPDATE TO authenticated
  USING (user_id = public.current_data_owner())
  WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY card_description_rules_owner_or_collab_delete
  ON public.card_description_rules FOR DELETE TO authenticated
  USING (user_id = public.current_data_owner());

DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.card_description_rules;
CREATE TRIGGER set_user_id_to_data_owner_trg
  BEFORE INSERT ON public.card_description_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

COMMENT ON TABLE public.card_description_rules IS
  'Reglas inversas para tarjeta de credito: al asignar categoria/beneficiario a un movimiento con descripcion sintetica (Compra TC ...), se reemplaza la descripcion automaticamente.';
