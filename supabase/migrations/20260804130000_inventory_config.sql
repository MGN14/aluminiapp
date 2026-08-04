-- Configuración del inventario por variante: LA fecha de corte global (F0).
--
-- Decisión de Nico (2026-08-04): el stock por variante sale de UNA sola
-- cuenta — inicial + contenedor − remisiones — con UNA fecha de corte global
-- visible y editable. Las remisiones (y contenedores) cuentan desde F0 en
-- adelante, cortando por la FECHA del hecho, nunca por cuándo se digitó.
--
-- Una fila por dueño de datos. Al confirmar un cierre de inventario, la app
-- mueve F0 a la fecha de ese conteo.

CREATE TABLE IF NOT EXISTS public.inventory_config (
  user_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  fecha_corte_stock date NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.inventory_config IS
  'Config del inventario por variante. fecha_corte_stock = F0: el stock es inicial + contenedor - remisiones con fecha posterior a F0.';

ALTER TABLE public.inventory_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_config_select ON public.inventory_config;
DROP POLICY IF EXISTS inventory_config_insert ON public.inventory_config;
DROP POLICY IF EXISTS inventory_config_update ON public.inventory_config;
DROP POLICY IF EXISTS inventory_config_delete ON public.inventory_config;

CREATE POLICY inventory_config_select ON public.inventory_config
  FOR SELECT TO authenticated USING (user_id = public.current_data_owner());
CREATE POLICY inventory_config_insert ON public.inventory_config
  FOR INSERT TO authenticated WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY inventory_config_update ON public.inventory_config
  FOR UPDATE TO authenticated USING (user_id = public.current_data_owner())
                              WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY inventory_config_delete ON public.inventory_config
  FOR DELETE TO authenticated USING (user_id = public.current_data_owner());

DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.inventory_config;
CREATE TRIGGER set_user_id_to_data_owner_trg
  BEFORE INSERT ON public.inventory_config
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();
