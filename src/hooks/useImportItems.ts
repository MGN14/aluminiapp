import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  computeLandedCost,
  type AllocationBasis,
  type ImportCostTipo,
  type LandedCostResult,
} from '@/lib/landedCost';

export interface ImportItemRow {
  id: string;
  user_id: string;
  import_id: string;
  reference: string;
  descripcion: string | null;
  cantidad: number;
  unidad: string;
  peso_kg: number | null;
  fob_total_usd: number;
  orden: number;
  notas: string | null;
  /** Color del renglón (los pedidos repiten referencia por color). */
  color?: string | null;
  /** Bultos/bales — el total del contenedor es el control de descarga. */
  bultos?: number | null;
  /** Costo unitario COP del Excel del usuario, solo para comparar vs landed. */
  costo_unitario_excel?: number | null;
  /** 'proforma' = pedido a producción · 'packing' = packing list definitivo.
   *  El costeo y la cobertura usan packing si existe; si no, proforma. */
  source?: 'proforma' | 'packing';
}

export type ImportItemSource = 'proforma' | 'packing';

export interface ImportCostRow {
  id: string;
  user_id: string;
  import_id: string;
  tipo: ImportCostTipo;
  concepto: string | null;
  monto: number;
  moneda: 'USD' | 'COP';
  trm: number | null;
  base_asignacion: AllocationBasis;
  orden: number;
}

export type NewImportItem = Omit<ImportItemRow, 'id' | 'user_id' | 'import_id'>;
export type NewImportCost = Omit<ImportCostRow, 'id' | 'user_id' | 'import_id'>;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Datos de costeo de UNA importación: packing list (import_items), costos
 * adicionales (import_costs) y la TRM ponderada de los abonos. Calcula el
 * landed cost por referencia con computeLandedCost.
 *
 * @param trmOverride si se pasa (> 0), se usa en vez de la TRM ponderada del
 *   pedido. Útil para simular el landed cuando aún no hay abonos.
 */
export function useImportItems(importId: string | null | undefined, trmOverride?: number | null) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const enabled = !!user && !!importId;

  const itemsQuery = useQuery<ImportItemRow[]>({
    queryKey: ['import_items', importId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('import_items' as never)
        .select('*')
        .eq('import_id', importId!)
        .order('orden', { ascending: true });
      if (error) throw error;
      return (((data as unknown) as ImportItemRow[]) ?? []).map((r) => ({
        ...r,
        cantidad: num(r.cantidad),
        peso_kg: r.peso_kg === null ? null : num(r.peso_kg),
        fob_total_usd: num(r.fob_total_usd),
      }));
    },
  });

  const costsQuery = useQuery<ImportCostRow[]>({
    queryKey: ['import_costs', importId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('import_costs' as never)
        .select('*')
        .eq('import_id', importId!)
        .order('orden', { ascending: true });
      if (error) throw error;
      return (((data as unknown) as ImportCostRow[]) ?? []).map((r) => ({
        ...r,
        monto: num(r.monto),
        trm: r.trm === null ? null : num(r.trm),
      }));
    },
  });

  // TRM ponderada de los abonos del pedido (imports_liquidation).
  const trmQuery = useQuery<number | null>({
    queryKey: ['import_trm_ponderada', importId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('imports_liquidation' as never)
        .select('trm_promedio_ponderada')
        .eq('import_id', importId!)
        .maybeSingle();
      if (error) return null;
      const v = (data as { trm_promedio_ponderada: number | null } | null)?.trm_promedio_ponderada;
      return v === null || v === undefined ? null : num(v);
    },
  });

  const items = itemsQuery.data ?? [];
  const costs = costsQuery.data ?? [];
  const trmPonderada = trmQuery.data ?? null;
  const trmEfectiva = num(trmOverride) > 0 ? Number(trmOverride) : trmPonderada;

  // El packing list definitivo MANDA cuando existe; si no, el proforma.
  // (Filas pre-migración sin source cuentan como packing.)
  const sourceOf = (r: ImportItemRow): 'proforma' | 'packing' => r.source ?? 'packing';
  const hayPacking = items.some((r) => sourceOf(r) === 'packing');
  const effectiveSource: 'proforma' | 'packing' = hayPacking ? 'packing' : 'proforma';
  const effectiveItems = useMemo(
    () => items.filter((r) => sourceOf(r) === effectiveSource),
    [items, effectiveSource],
  );
  const proformaItems = useMemo(
    () => items.filter((r) => sourceOf(r) === 'proforma'),
    [items],
  );

  const landed: LandedCostResult = useMemo(
    () => computeLandedCost(effectiveItems, costs, trmEfectiva),
    [effectiveItems, costs, trmEfectiva],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['import_items', importId] });
    qc.invalidateQueries({ queryKey: ['import_costs', importId] });
    qc.invalidateQueries({ queryKey: ['import_reference_history'] });
    // Cobertura / sugerencia de pedido leen los items de TODOS los pedidos
    // abiertos bajo ['imports', ...] (reorder-items-transito, reorder-inventario,
    // lista de pedidos). Sin esto, subir la proforma no apagaba el aviso de
    // "pedido abierto SIN proforma" hasta hacer hard refresh.
    qc.invalidateQueries({ queryKey: ['imports'] });
  };

  // ── Items ──────────────────────────────────────────────────────────────
  /** Importa un set completo (proforma o packing). Con replace=true borra las
   *  filas existentes DEL MISMO tipo primero — re-subir corrige, no duplica. */
  const importItemSet = useMutation({
    mutationFn: async ({ rows, source, replace }: { rows: NewImportItem[]; source: ImportItemSource; replace: boolean }) => {
      if (!user || !importId || rows.length === 0) return;
      if (replace) {
        const { error: delErr } = await supabase
          .from('import_items' as never)
          .delete()
          .eq('import_id', importId)
          .eq('source', source);
        if (delErr) throw delErr;
      }
      const payload = rows.map((r, i) => ({
        user_id: user.id,
        import_id: importId,
        reference: r.reference,
        descripcion: r.descripcion ?? null,
        cantidad: num(r.cantidad),
        unidad: r.unidad || 'kg',
        peso_kg: r.peso_kg === null || r.peso_kg === undefined ? null : num(r.peso_kg),
        fob_total_usd: num(r.fob_total_usd),
        orden: i,
        notas: r.notas ?? null,
        color: r.color ?? null,
        bultos: r.bultos === null || r.bultos === undefined ? null : num(r.bultos),
        costo_unitario_excel: r.costo_unitario_excel === null || r.costo_unitario_excel === undefined ? null : num(r.costo_unitario_excel),
        source,
      }));
      const { error } = await supabase.from('import_items' as never).insert(payload as never);
      if (error) throw error;
    },
    onSuccess: (_d, { rows, source }) => {
      invalidate();
      toast({
        title: `${rows.length} referencia${rows.length === 1 ? '' : 's'} de ${source === 'proforma' ? 'proforma' : 'packing list'} cargada${rows.length === 1 ? '' : 's'}`,
      });
    },
    onError: (e: Error) => toast({ title: 'Error al importar', description: e.message, variant: 'destructive' }),
  });

  const addItems = useMutation({
    mutationFn: async (rows: NewImportItem[]) => {
      if (!user || !importId || rows.length === 0) return;
      const payload = rows.map((r, i) => ({
        user_id: user.id,
        import_id: importId,
        reference: r.reference,
        descripcion: r.descripcion ?? null,
        cantidad: num(r.cantidad),
        unidad: r.unidad || 'kg',
        peso_kg: r.peso_kg === null || r.peso_kg === undefined ? null : num(r.peso_kg),
        fob_total_usd: num(r.fob_total_usd),
        // Orden siempre contiguo a partir del final actual (no depende del
        // `orden` entrante, que podía colisionar / saltar de posición).
        orden: items.length + i,
        notas: r.notas ?? null,
        color: r.color ?? null,
        bultos: r.bultos === null || r.bultos === undefined ? null : num(r.bultos),
        costo_unitario_excel: r.costo_unitario_excel === null || r.costo_unitario_excel === undefined ? null : num(r.costo_unitario_excel),
        // Fila manual: hereda el set activo para no "activar" un packing
        // fantasma cuando solo hay proforma.
        source: r.source ?? effectiveSource,
      }));
      const { error } = await supabase.from('import_items' as never).insert(payload as never);
      if (error) throw error;
    },
    onSuccess: (_d, rows) => {
      invalidate();
      toast({ title: `${rows.length} referencia${rows.length === 1 ? '' : 's'} agregada${rows.length === 1 ? '' : 's'}` });
    },
    onError: (e: Error) => toast({ title: 'Error al agregar referencias', description: e.message, variant: 'destructive' }),
  });

  const updateItem = useMutation({
    mutationFn: async (input: { id: string } & Partial<NewImportItem>) => {
      const { id, ...patch } = input;
      const { error } = await supabase.from('import_items' as never).update(patch as never).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    // Refetch en error para que el input (no controlado, defaultValue+onBlur)
    // vuelva al valor real de la DB en vez de quedar con lo tecleado.
    onError: (e: Error) => { invalidate(); toast({ title: 'Error al actualizar', description: e.message, variant: 'destructive' }); },
  });

  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('import_items' as never).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // ── Costs ──────────────────────────────────────────────────────────────
  const addCost = useMutation({
    mutationFn: async (row: NewImportCost) => {
      if (!user || !importId) return;
      const { error } = await supabase.from('import_costs' as never).insert({
        user_id: user.id,
        import_id: importId,
        tipo: row.tipo,
        concepto: row.concepto ?? null,
        monto: num(row.monto),
        moneda: row.moneda,
        trm: row.trm === null || row.trm === undefined ? null : num(row.trm),
        base_asignacion: row.base_asignacion,
        orden: row.orden ?? costs.length,
      } as never);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast({ title: 'Error al agregar costo', description: e.message, variant: 'destructive' }),
  });

  const updateCost = useMutation({
    mutationFn: async (input: { id: string } & Partial<NewImportCost>) => {
      const { id, ...patch } = input;
      const { error } = await supabase.from('import_costs' as never).update(patch as never).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => { invalidate(); toast({ title: 'Error al actualizar costo', description: e.message, variant: 'destructive' }); },
  });

  const removeCost = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('import_costs' as never).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    items,
    effectiveItems,
    effectiveSource,
    proformaItems,
    hayProforma: proformaItems.length > 0,
    hayPacking,
    costs,
    landed,
    trmPonderada,
    trmEfectiva,
    isLoading: itemsQuery.isLoading || costsQuery.isLoading,
    importItemSet,
    addItems,
    updateItem,
    removeItem,
    addCost,
    updateCost,
    removeCost,
  };
}
