-- Registro de etiquetas impresas (LPN) = trazabilidad por bulto.
--
-- Cada etiqueta que se imprime queda registrada acá (serial único, referencia,
-- cantidad, ubicación, cuándo, quién). Es la "entrada" del bulto a bodega.
-- La SALIDA se deriva de dispatch_scans (que ya guarda el serial al despachar):
-- juntando ambos se reconstruye la historia de un serial → para resolver quejas
-- ("este bulto exacto salió en tal remisión, a tal cliente, tal día").
--
-- RLS compartida (owner + colaboradores) como el resto del inventario.

CREATE TABLE IF NOT EXISTS public.inventory_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.inventory_products(id) ON DELETE SET NULL,
  reference text NOT NULL,
  serial text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  location text,
  status text NOT NULL DEFAULT 'en_bodega',   -- en_bodega | despachada (se deriva) | anulada
  printed_at timestamptz NOT NULL DEFAULT now(),
  printed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_labels_serial_uq UNIQUE (user_id, serial)
);

CREATE INDEX IF NOT EXISTS idx_inventory_labels_serial ON public.inventory_labels (user_id, lower(serial));
CREATE INDEX IF NOT EXISTS idx_inventory_labels_reference ON public.inventory_labels (user_id, lower(reference));

ALTER TABLE public.inventory_labels ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE pol RECORD; BEGIN
  FOR pol IN SELECT polname FROM pg_policy WHERE polrelid = 'public.inventory_labels'::regclass
  LOOP EXECUTE format('DROP POLICY %I ON public.inventory_labels', pol.polname); END LOOP;
END $$;
CREATE POLICY inventory_labels_select ON public.inventory_labels FOR SELECT TO authenticated USING (user_id = public.current_data_owner());
CREATE POLICY inventory_labels_insert ON public.inventory_labels FOR INSERT TO authenticated WITH CHECK (user_id = public.current_data_owner());
CREATE POLICY inventory_labels_update ON public.inventory_labels FOR UPDATE TO authenticated USING (user_id = public.current_data_owner()) WITH CHECK (user_id = public.current_data_owner());

DROP TRIGGER IF EXISTS set_user_id_to_data_owner_trg ON public.inventory_labels;
CREATE TRIGGER set_user_id_to_data_owner_trg
  BEFORE INSERT ON public.inventory_labels
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

NOTIFY pgrst, 'reload schema';
