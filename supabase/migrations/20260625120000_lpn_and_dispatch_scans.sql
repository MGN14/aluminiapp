-- ============================================================================
-- LPN (etiqueta única por bulto) + concurrencia multi-operario en despacho.
-- ============================================================================
-- LPN: cada etiqueta lleva un SERIAL único además de la referencia compartida,
-- así el QR de cada paquete es distinto ("ALU|ref|qty|loc|serial") pero el
-- código de producto (referencia) es el mismo → control + trazabilidad por
-- producto, y a la vez anti-doble-escaneo + trazabilidad por bulto.
--
-- Concurrencia: el progreso de un despacho deja de vivir en la tablet y pasa a
-- ser EVENTOS en el servidor (dispatch_scans). Varios operarios suman al mismo
-- pedido y ven el avance en vivo (la app poolea). Un serial solo puede
-- escanearse una vez por remisión (índice único) = anti-doble-escaneo global.
-- ============================================================================

-- ─── Contador de serials por (owner, producto) para las etiquetas LPN ───
CREATE TABLE IF NOT EXISTS public.label_counters (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.inventory_products(id) ON DELETE CASCADE,
  last_seq integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, product_id)
);
ALTER TABLE public.label_counters ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE pol RECORD; BEGIN
  FOR pol IN SELECT polname FROM pg_policy WHERE polrelid = 'public.label_counters'::regclass
  LOOP EXECUTE format('DROP POLICY %I ON public.label_counters', pol.polname); END LOOP;
END $$;
CREATE POLICY label_counters_select ON public.label_counters FOR SELECT TO authenticated USING (user_id = public.current_data_owner());

-- Reserva atómica de N serials para un producto. SECURITY DEFINER: incrementa
-- el contador del owner sin importar el RLS, y devuelve el ÚLTIMO seq asignado.
-- El rango reservado es [retorno - p_count + 1, retorno].
DROP FUNCTION IF EXISTS public.allocate_label_seq(uuid, integer);
CREATE OR REPLACE FUNCTION public.allocate_label_seq(p_product_id uuid, p_count integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; v_last integer;
BEGIN
  v_owner := public.current_data_owner();
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Sin owner para asignar serials'; END IF;
  IF p_count IS NULL OR p_count < 1 THEN RAISE EXCEPTION 'count inválido'; END IF;
  INSERT INTO public.label_counters (user_id, product_id, last_seq)
    VALUES (v_owner, p_product_id, p_count)
    ON CONFLICT (user_id, product_id)
    DO UPDATE SET last_seq = public.label_counters.last_seq + EXCLUDED.last_seq
    RETURNING last_seq INTO v_last;
  RETURN v_last;
END $$;
GRANT EXECUTE ON FUNCTION public.allocate_label_seq(uuid, integer) TO authenticated;

-- ─── Eventos de escaneo de despacho (estado compartido + anti-doble-escaneo) ───
CREATE TABLE IF NOT EXISTS public.dispatch_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  remision_id uuid NOT NULL REFERENCES public.remisiones(id) ON DELETE CASCADE,
  reference text NOT NULL,
  location text,
  serial text,                 -- LPN; null para etiquetas viejas / ajuste manual
  quantity numeric NOT NULL DEFAULT 0,
  operator_id uuid,            -- quién escaneó (auth.uid del operario)
  scanned_at timestamptz NOT NULL DEFAULT now()
);

-- Un serial se escanea UNA sola vez por remisión → anti-doble-escaneo.
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_scans_serial_uq
  ON public.dispatch_scans (remision_id, serial) WHERE serial IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dispatch_scans_remision ON public.dispatch_scans (remision_id);

ALTER TABLE public.dispatch_scans ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE pol RECORD; BEGIN
  FOR pol IN SELECT polname FROM pg_policy WHERE polrelid = 'public.dispatch_scans'::regclass
  LOOP EXECUTE format('DROP POLICY %I ON public.dispatch_scans', pol.polname); END LOOP;
END $$;
CREATE POLICY dispatch_scans_select ON public.dispatch_scans FOR SELECT TO authenticated USING (user_id = public.current_data_owner());
CREATE POLICY dispatch_scans_insert ON public.dispatch_scans FOR INSERT TO authenticated WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY dispatch_scans_delete ON public.dispatch_scans FOR DELETE TO authenticated USING (user_id = public.current_data_owner());

DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.dispatch_scans;
CREATE TRIGGER set_user_id_to_data_owner_trg
  BEFORE INSERT ON public.dispatch_scans
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

NOTIFY pgrst, 'reload schema';
