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

export const IMPORT_ESTADOS_ORDER: ImportEstado[] = [
  'cotizacion', 'anticipo', 'produccion', 'transito', 'aduana', 'entregado',
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

export interface ImportRow {
  id: string;
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
  created_at: string;
  updated_at: string;
  /** Historial de cambios de estado (embebido) — base de las duraciones de etapa */
  import_estado_history?: ImportEstadoHistoryRow[];
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
        .select('*, import_estado_history(estado, fecha)')
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

  type Patch = Partial<Omit<ImportRow, 'id' | 'saldo_pendiente_usd' | 'created_at' | 'updated_at' | 'import_estado_history'>>;

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

  const create = useMutation({
    mutationFn: async (input: Patch & { proveedor_nombre: string; estado: ImportEstado; estado_fecha?: string }) => {
      if (!user) throw new Error('No auth');
      const { estado_fecha, ...payload } = input;
      const { data, error } = await supabase
        .from('imports' as never)
        .insert({ user_id: user.id, ...payload } as never)
        .select('id')
        .single();
      if (error) throw error;
      const newId = (data as unknown as { id: string })?.id;
      if (newId) {
        await recordEstadoHistory(
          newId,
          input.estado,
          estado_fecha || input.fecha_cotizacion || new Date().toISOString().split('T')[0],
        );
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
    // estado_fecha: fecha en que ocurrió el cambio de estado (si el estado cambió).
    mutationFn: async (input: { id: string; estado_fecha?: string } & Patch) => {
      const { id, estado_fecha, ...patch } = input;
      const { error } = await supabase
        .from('imports' as never)
        .update(patch as never)
        .eq('id', id);
      if (error) throw error;
      if (patch.estado && estado_fecha) {
        await recordEstadoHistory(id, patch.estado as ImportEstado, estado_fecha);
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

  // Atajo: avanzar al siguiente estado del flujo. `fecha` = día real del cambio
  // (lo pide el dialog en la lista); default hoy.
  const advanceEstado = useMutation({
    mutationFn: async ({ row, fecha }: { row: ImportRow; fecha?: string }) => {
      const idx = IMPORT_ESTADOS_ORDER.indexOf(row.estado);
      if (idx < 0 || idx >= IMPORT_ESTADOS_ORDER.length - 1) return; // cancelado o ya entregado
      const nextEstado = IMPORT_ESTADOS_ORDER[idx + 1];
      const cambioFecha = fecha || new Date().toISOString().split('T')[0];
      // Stamp la fecha del nuevo estado (columnas legacy del flujo).
      const datePatch: Record<string, string> = {};
      if (nextEstado === 'anticipo') datePatch.fecha_anticipo = cambioFecha;
      if (nextEstado === 'transito') datePatch.fecha_embarque = cambioFecha;
      if (nextEstado === 'entregado') datePatch.fecha_arribo_real = cambioFecha;
      const { error } = await supabase
        .from('imports' as never)
        .update({ estado: nextEstado, ...datePatch } as never)
        .eq('id', row.id);
      if (error) throw error;
      await recordEstadoHistory(row.id, nextEstado, cambioFecha);
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Estado avanzado' });
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
    advanceEstado,
  };
}
