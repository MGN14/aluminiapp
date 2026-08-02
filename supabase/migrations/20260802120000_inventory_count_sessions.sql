-- CIERRE DE INVENTARIO ("cerrar caja" del inventario por variante).
--
-- Pedido de Nico (2026-08-02): cuando bodega sube un conteo nuevo, la app no
-- debe pisar el stock de una: primero muestra las DIFERENCIAS contra el
-- teórico (borrador), el admin las revisa, y al CONFIRMAR queda el reporte
-- guardado y el conteo pasa a ser la nueva fuente de verdad.
--
-- Clave del diseño: NO se borra nada del ledger. El conteo confirmado escribe
-- un movimiento 'ajuste' por variante (que ya funciona como ancla en
-- computeVariantDesglose: stock = ancla + contenedores − remisiones
-- POSTERIORES). La historia previa queda intacta para que el análisis de
-- rotación / demanda por referencia siga teniendo con qué medir.

CREATE TABLE IF NOT EXISTS public.inventory_count_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'borrador' = subido, sin aplicar · 'confirmado' = ancló el inventario
  -- 'descartado' = el admin lo desechó sin aplicar
  estado text NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador', 'confirmado', 'descartado')),
  -- Fecha real del conteo en bodega (la carga puede ser posterior).
  fecha_conteo date NOT NULL DEFAULT CURRENT_DATE,
  nombre text,
  notas text,
  -- Qué hacer con las referencias que NO vinieron en el archivo:
  -- false = se dejan como están (conteo parcial) · true = se anclan en 0.
  cuenta_faltantes_como_cero boolean NOT NULL DEFAULT false,
  -- Totales congelados al confirmar (para el reporte histórico).
  total_referencias integer NOT NULL DEFAULT 0,
  total_con_diferencia integer NOT NULL DEFAULT 0,
  total_unidades_diferencia numeric NOT NULL DEFAULT 0,
  total_valor_diferencia numeric NOT NULL DEFAULT 0,
  subido_por uuid REFERENCES auth.users(id),
  confirmado_por uuid REFERENCES auth.users(id),
  confirmado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.inventory_count_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.inventory_variants(id) ON DELETE SET NULL,
  -- Referencia tal como vino en el archivo (puede no existir aún en la maestra).
  variant_reference text NOT NULL,
  descripcion text,
  -- Teórico al momento de subir el conteo (inicial + contenedor − remisiones).
  stock_teorico numeric NOT NULL DEFAULT 0,
  -- Lo que contó bodega (editable por el admin antes de confirmar).
  stock_contado numeric NOT NULL DEFAULT 0,
  -- contado − teórico (positivo = sobra físico; negativo = falta).
  diferencia numeric GENERATED ALWAYS AS (stock_contado - stock_teorico) STORED,
  costo_unitario numeric NOT NULL DEFAULT 0,
  -- true = la referencia no existía en la maestra y se crea al confirmar.
  es_nueva boolean NOT NULL DEFAULT false,
  nota text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_count_lines_session_idx
  ON public.inventory_count_lines(session_id);
CREATE INDEX IF NOT EXISTS inventory_count_sessions_user_idx
  ON public.inventory_count_sessions(user_id, created_at DESC);
-- Un solo borrador vivo por cuenta: evita dos conteos a medio aplicar.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_count_sessions_un_borrador
  ON public.inventory_count_sessions(user_id)
  WHERE estado = 'borrador';

ALTER TABLE public.inventory_count_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_lines ENABLE ROW LEVEL SECURITY;

-- RLS patrón current_data_owner (colaboradores de bodega pueden subir el
-- conteo; la CONFIRMACIÓN la gatea el frontend + la política de update).
DROP POLICY IF EXISTS "count_sessions_select" ON public.inventory_count_sessions;
CREATE POLICY "count_sessions_select" ON public.inventory_count_sessions
  FOR SELECT USING (user_id = public.current_data_owner());

DROP POLICY IF EXISTS "count_sessions_insert" ON public.inventory_count_sessions;
CREATE POLICY "count_sessions_insert" ON public.inventory_count_sessions
  FOR INSERT WITH CHECK (user_id = public.current_data_owner());

DROP POLICY IF EXISTS "count_sessions_update" ON public.inventory_count_sessions;
CREATE POLICY "count_sessions_update" ON public.inventory_count_sessions
  FOR UPDATE USING (user_id = public.current_data_owner());

DROP POLICY IF EXISTS "count_sessions_delete" ON public.inventory_count_sessions;
CREATE POLICY "count_sessions_delete" ON public.inventory_count_sessions
  FOR DELETE USING (user_id = public.current_data_owner());

DROP POLICY IF EXISTS "count_lines_all" ON public.inventory_count_lines;
CREATE POLICY "count_lines_all" ON public.inventory_count_lines
  FOR ALL USING (user_id = public.current_data_owner())
  WITH CHECK (user_id = public.current_data_owner());

-- user_id = dueño de los datos, aunque escriba un colaborador.
DROP TRIGGER IF EXISTS set_user_id_count_sessions ON public.inventory_count_sessions;
CREATE TRIGGER set_user_id_count_sessions
  BEFORE INSERT ON public.inventory_count_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

DROP TRIGGER IF EXISTS set_user_id_count_lines ON public.inventory_count_lines;
CREATE TRIGGER set_user_id_count_lines
  BEFORE INSERT ON public.inventory_count_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_user_id_to_data_owner();

COMMENT ON TABLE public.inventory_count_sessions IS
  'Cierres de inventario por variante: borrador con diferencias → confirmación del admin → nueva ancla. El ledger NO se borra: el conteo escribe un ajuste y las remisiones posteriores vuelven a descontar.';
COMMENT ON COLUMN public.inventory_count_lines.diferencia IS
  'contado − teórico. Positivo = sobra físico (el sistema descontó de más); negativo = falta (merma, robo o salida no registrada).';
