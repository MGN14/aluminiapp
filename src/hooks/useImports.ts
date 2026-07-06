import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

export type ImportEstado =
  | 'cotizacion'
  | 'anticipo'
  | 'produccion'
  | 'transito'
  | 'aduana'
  | 'entregado'
  | 'cancelado';

// 'anticipo' salió del flujo (decisión de Nico: "no es un estado como tal" —
// el anticipo es un pago, no una etapa del contenedor). Sigue en el type y en
// los labels solo para renderizar filas legacy que quedaron con ese valor.
export const IMPORT_ESTADOS_ORDER: ImportEstado[] = [
  'cotizacion', 'produccion', 'transito', 'aduana', 'entregado',
];

export const IMPORT_ESTADO_LABEL: Record<ImportEstado, string> = {
  cotizacion: 'Cotización',
  anticipo: 'Anticipo pagado',
  produccion: 'En producción',
  transito: 'En tránsito',
  aduana: 'En aduana',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

export interface ImportEstadoHistoryRow {
  estado: ImportEstado;
  fecha: string; // YYYY-MM-DD — día en que la importación ENTRÓ a ese estado
}

export interface ImportCostRow {
  tipo: 'flete' | 'seguro' | 'arancel' | 'iva_importacion' | 'nacionalizacion' | 'gastos_bancarios' | 'otro';
  monto: number;
  moneda: 'USD' | 'COP';
}

// La suma por tipo vive en la lib de costeo (misma fuente que el desglose
// del Resumen y los KPIs) — re-export para no romper imports existentes.
export { sumImportCosts } from '@/lib/importCosting';

export interface ImportRow {
  id: string;
  user_id: string;
  responsible_id: string | null;
  proveedor_nombre: string;
  estado: ImportEstado;
  cantidad_ton: number | null;
  precio_smm_cerrado_usd_ton: number | null;
  trm_causacion: number | null;
  monto_total_usd: number | null;
  anticipo_pagado_usd: number;
  saldo_pendiente_usd: number; // computed by DB
  fecha_cotizacion: string | null;
  fecha_anticipo: string | null;
  fecha_embarque: string | null;
  fecha_estimada_llegada: string | null;
  fecha_arribo_real: string | null;
  ref_pedido: string | null;
  notas: string | null;
  /** % de arancel estimado para el costeo (default 5) */
  arancel_pct: number | null;
  /** % de IVA de importación para el costeo (default 19) */
  iva_pct: number | null;
  /** Cerrada = checklist documental completo; solo el admin puede modificarla */
  cerrada: boolean;
  cerrada_at: string | null;
  created_at: string;
  updated_at: string;
  /** Historial de cambios de estado (embebido) — base de las duraciones de etapa */
  import_estado_history?: ImportEstadoHistoryRow[];
  /** Costos adicionales (embebido) — flete, arancel, IVA importación, agencia */
  import_costs?: ImportCostRow[];
}

export interface ImportsSummary {
  all: ImportRow[];
  abiertos: ImportRow[]; // estado != entregado, cancelado
  total_saldo_pendiente_usd: number;
  total_abiertos: number;
  proximos_30d: ImportRow[]; // ETA en próx 30 días
}

export function useImports() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery<ImportsSummary>({
    queryKey: ['imports', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const empty: ImportsSummary = {
        all: [], abiertos: [], total_saldo_pendiente_usd: 0,
        total_abiertos: 0, proximos_30d: [],
      };
      if (!user) return empty;

      const { data, error } = await supabase
        .from('imports' as never)
        .select('*, import_estado_history(estado, fecha), import_costs(tipo, monto, moneda)')
        .order('fecha_estimada_llegada', { ascending: true, nullsFirst: false });
      if (error) throw error;

      const rows = ((data as unknown) as ImportRow[]) ?? [];

      const abiertos = rows.filter(r => r.estado !== 'entregado' && r.estado !== 'cancelado');
      const todayIso = new Date().toISOString().split('T')[0];
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 30);
      const horizonIso = horizon.toISOString().split('T')[0];
      const proximos_30d = abiertos.filter(r =>
        r.fecha_estimada_llegada
        && r.fecha_estimada_llegada >= todayIso
        && r.fecha_estimada_llegada <= horizonIso,
      );

      return {
        all: rows,
        abiertos,
        total_saldo_pendiente_usd: abiertos.reduce((s, r) => s + Number(r.saldo_pendiente_usd ?? 0), 0),
        total_abiertos: abiertos.length,
        proximos_30d,
      };
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['imports', user?.id] });

  type Patch = Partial<Omit<ImportRow, 'id' | 'saldo_pendiente_usd' | 'created_at' | 'updated_at' | 'import_estado_history' | 'import_costs'>>;

  /** Registra (upsert) la fecha en que la importación entró a un estado. */
  const recordEstadoHistory = async (importId: string, estado: ImportEstado, fecha: string) => {
    if (!user) return;
    const { error } = await (supabase as any)
      .from('import_estado_history')
      .upsert(
        { user_id: user.id, import_id: importId, estado, fecha },
        { onConflict: 'import_id,estado' },
      );
    if (error) console.warn('No se pudo registrar historial de estado:', error.message);
  };

  /** Borra la fecha de UN estado (el usuario la vació en el grid de Datos). */
  const deleteEstadoHistory = async (importId: string, estado: ImportEstado) => {
    const { error } = await (supabase as any)
      .from('import_estado_history')
      .delete()
      .eq('import_id', importId)
      .eq('estado', estado);
    if (error) console.warn('No se pudo borrar historial de estado:', error.message);
  };

  /** Regla de flujo: al fijar un estado, las etapas POSTERIORES no pueden
   *  tener fecha (un 'entregado' huérfano con el pedido en tránsito rompía
   *  los tiempos). Se borran del historial. */
  const deleteEstadoHistoryBeyond = async (importId: string, estado: ImportEstado) => {
    const idx = IMPORT_ESTADOS_ORDER.indexOf(estado);
    if (idx === -1) return; // cancelado/legacy: fuera del flujo, no se toca
    const beyond = IMPORT_ESTADOS_ORDER.slice(idx + 1);
    if (!beyond.length) return;
    const { error } = await (supabase as any)
      .from('import_estado_history')
      .delete()
      .eq('import_id', importId)
      .in('estado', beyond);
    if (error) console.warn('No se pudo limpiar historial posterior:', error.message);
  };

  const create = useMutation({
    mutationFn: async (input: Patch & { proveedor_nombre: string; estado: ImportEstado; estado_fecha?: string; estado_fechas?: Partial<Record<ImportEstado, string>> }) => {
      if (!user) throw new Error('No auth');
      const { estado_fecha, estado_fechas, ...payload } = input;
      const { data, error } = await supabase
        .from('imports' as never)
        .insert({ user_id: user.id, ...payload } as never)
        .select('id')
        .single();
      if (error) throw error;
      const newId = (data as unknown as { id: string })?.id;
      if (newId) {
        // TODAS las fechas de flujo que el usuario puso al crear — no solo la
        // del estado actual. Si el pedido nace ya "en tránsito" con fecha de
        // cotización de hace 2 meses, el total de días arranca en cotización.
        const fechas: Partial<Record<ImportEstado, string>> = { ...(estado_fechas ?? {}) };
        if (!fechas[input.estado]) {
          fechas[input.estado] = estado_fecha || input.fecha_cotizacion || new Date().toISOString().split('T')[0];
        }
        for (const [estado, fecha] of Object.entries(fechas)) {
          if (fecha) await recordEstadoHistory(newId, estado as ImportEstado, fecha);
        }
      }
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Importación creada' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error al crear', description: err.message, variant: 'destructive' });
    },
  });

  const update = useMutation({
    // estado_fecha: fecha del cambio de estado (si el estado cambió).
    // estado_fechas: fechas de flujo por estado (grid "Fechas del flujo" del
    // modal) — valor = upsert, string vacío = borrar la fila del historial.
    // Al final se limpian las etapas posteriores al estado (regla de flujo).
    mutationFn: async (input: { id: string; estado_fecha?: string; estado_fechas?: Partial<Record<ImportEstado, string>> } & Patch) => {
      const { id, estado_fecha, estado_fechas, ...patch } = input;
      const { error } = await supabase
        .from('imports' as never)
        .update(patch as never)
        .eq('id', id);
      if (error) throw error;
      if (patch.estado && estado_fecha) {
        await recordEstadoHistory(id, patch.estado as ImportEstado, estado_fecha);
      }
      if (estado_fechas) {
        for (const [estado, fecha] of Object.entries(estado_fechas)) {
          if (fecha) await recordEstadoHistory(id, estado as ImportEstado, fecha);
          else await deleteEstadoHistory(id, estado as ImportEstado);
        }
      }
      if (patch.estado) {
        await deleteEstadoHistoryBeyond(id, patch.estado as ImportEstado);
      }
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Importación actualizada' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error al actualizar', description: err.message, variant: 'destructive' });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('imports' as never).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Importación eliminada' });
    },
  });

  // Cambiar el estado a CUALQUIER estado del flujo (select inline en la lista).
  // `fecha` = día real del cambio; lo pide el dialog de confirmación.
  const changeEstado = useMutation({
    mutationFn: async ({ row, estado, fecha }: { row: ImportRow; estado: ImportEstado; fecha?: string }) => {
      const cambioFecha = fecha || new Date().toISOString().split('T')[0];
      // Stamp la fecha del nuevo estado (columnas legacy del flujo).
      const datePatch: Record<string, string | null> = {};
      if (estado === 'cotizacion') datePatch.fecha_cotizacion = cambioFecha;
      if (estado === 'transito') datePatch.fecha_embarque = cambioFecha;
      if (estado === 'entregado') datePatch.fecha_arribo_real = cambioFecha;
      // Regla de flujo: si el pedido NO está entregado, no puede quedar con
      // fecha de arribo real (generaba un 'entregado' fantasma en el timeline).
      if (estado !== 'entregado' && estado !== 'cancelado') datePatch.fecha_arribo_real = null;
      const { error } = await supabase
        .from('imports' as never)
        .update({ estado, ...datePatch } as never)
        .eq('id', row.id);
      if (error) throw error;
      if (estado !== 'cancelado') {
        await recordEstadoHistory(row.id, estado, cambioFecha);
        await deleteEstadoHistoryBeyond(row.id, estado);
      }
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Estado actualizado' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error al cambiar estado', description: err.message, variant: 'destructive' });
    },
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    create,
    update,
    remove,
    changeEstado,
  };
}
