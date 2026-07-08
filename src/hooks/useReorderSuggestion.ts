/**
 * Hook del motor de "¿cuándo montar el próximo pedido?" — ÚNICA fuente de
 * verdad para la card de sugerencia Y la celda del radar de abastecimiento
 * (antes cada uno calculaba distinto y se contradecían en pantalla).
 *
 * Junta: fechas de todos los pedidos (lead time por etapa), stock FÍSICO
 * (inventory_products.stock_physical — el del conteo QR propio, NO el de
 * Siigo que vive en stock_system), consumo real (salidas de inventario =
 * remisiones/despachos, últimos 90 días) y llegadas en tránsito (packing
 * list / proforma de los pedidos abiertos).
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useImports, type ImportRow } from '@/hooks/useImports';
import {
  computeReorderSuggestion,
  estimateLeadTime,
  estimateDisponibilidad,
  CONSUMO_VENTANA_DIAS,
  type ImportFechas,
  type TransitoItem,
  type ReorderSuggestion,
} from '@/lib/reorderSuggestion';
import { refFamilyKey } from '@/lib/refFamily';

interface ItemRow { import_id: string; reference: string; cantidad: number }

export interface PedidoSinItems {
  id: string;
  label: string;
}

export interface UseReorderSuggestionResult {
  isPending: boolean;
  suggestion: ReorderSuggestion | null;
  /** Pedidos abiertos SIN packing list/proforma: no cuentan como cobertura. */
  pedidosSinItems: PedidoSinItems[];
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Fecha en que el pedido entró a 'entregado' según su historial embebido. */
function fechaEntregado(r: ImportRow): string | null {
  const h = (r.import_estado_history ?? []).find((x) => x.estado === 'entregado');
  return h?.fecha ?? null;
}

export function useReorderSuggestion(): UseReorderSuggestionResult {
  const { data: importsData } = useImports();

  const inventoryQuery = useQuery({
    queryKey: ['imports', 'reorder-inventario'],
    queryFn: async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - CONSUMO_VENTANA_DIAS);
      const cutoffIso = cutoff.toISOString().slice(0, 10);

      const [prodRes, movRes] = await Promise.all([
        // stock_physical = inventario físico propio (conteo QR). stock_system
        // (Siigo) NO se usa acá a propósito.
        supabase
          .from('inventory_products')
          .select('id, reference, stock_physical')
          .eq('active', true),
        // Salidas = despachos reales (las remisiones insertan estos movimientos).
        supabase
          .from('inventory_movements')
          .select('product_id, quantity')
          .eq('movement_type', 'salida')
          .gte('movement_date', cutoffIso),
      ]);
      if (prodRes.error) throw prodRes.error;
      if (movRes.error) throw movRes.error;
      return {
        products: (prodRes.data ?? []) as { id: string; reference: string; stock_physical: number | null }[],
        salidas: (movRes.data ?? []) as { product_id: string; quantity: number }[],
      };
    },
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
  });

  const abiertos = importsData?.abiertos ?? [];
  const abiertosIds = abiertos.map((r) => r.id);
  const itemsQuery = useQuery({
    queryKey: ['imports', 'reorder-items-transito', abiertosIds.join('|')],
    enabled: abiertosIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as never as { from: (t: string) => any })
        .from('import_items')
        .select('import_id, reference, cantidad')
        .in('import_id', abiertosIds);
      if (error) throw error;
      return (data ?? []) as ItemRow[];
    },
    staleTime: 10 * 60_000,
  });

  // OJO: esperar TAMBIÉN los items — computar sin ellos mostraba "0 llegadas
  // en tránsito" y una fecha alarmista mientras la query seguía en vuelo.
  const itemsPending = abiertosIds.length > 0 && itemsQuery.isPending;
  if (!importsData || inventoryQuery.isPending || itemsPending) {
    return { isPending: true, suggestion: null, pedidosSinItems: [] };
  }

  const today = isoToday();
  const fechas: ImportFechas[] = (importsData.all ?? []).map((r) => ({
    estado: r.estado,
    fecha_anticipo: r.fecha_anticipo,
    fecha_embarque: r.fecha_embarque,
    fecha_estimada_llegada: r.fecha_estimada_llegada,
    fecha_arribo_real: r.fecha_arribo_real,
    fecha_entregado: fechaEntregado(r),
  }));
  const leadTime = estimateLeadTime(fechas);

  // Packing list / proforma de pedidos abiertos → llegadas proyectadas a bodega.
  const items = itemsQuery.data ?? [];
  const dispPorImport = new Map<string, string>(
    abiertos.map((r) => [r.id, estimateDisponibilidad(
      { ...r, fecha_entregado: null },
      leadTime,
      today,
    )]),
  );
  const transito: TransitoItem[] = items
    .filter((it) => dispPorImport.has(it.import_id))
    .map((it) => ({
      reference: it.reference,
      cantidad: Number(it.cantidad ?? 0),
      fechaDisponible: dispPorImport.get(it.import_id)!,
      // Familia: la base del packing list (LIV-40 + colores) cruza con la
      // -5 del inventario de Siigo. Ver refFamilyKey.
      matchKey: refFamilyKey(it.reference),
    }));

  const idsConItems = new Set(items.map((it) => it.import_id));
  const pedidosSinItems: PedidoSinItems[] = abiertos
    .filter((r) => !idsConItems.has(r.id))
    .map((r) => ({ id: r.id, label: r.ref_pedido || r.proveedor_nombre }));

  const inv = inventoryQuery.data!;

  // El cálculo es "sobre el -5": si existieran variantes de color como filas
  // propias (LIV-40-2, LIV-40-3...), se agrupan con la -5 en una sola familia
  // — stock sumado, consumo sumado. La etiqueta visible es la ref de Siigo
  // (la -5) cuando existe.
  interface Familia { key: string; label: string; stock: number; productIds: string[] }
  const familias = new Map<string, Familia>();
  for (const p of inv.products) {
    const key = refFamilyKey(p.reference);
    if (!key) continue;
    const f = familias.get(key) ?? { key, label: p.reference, stock: 0, productIds: [] };
    f.stock += Number(p.stock_physical ?? 0);
    f.productIds.push(p.id);
    // Preferir la -5 como etiqueta (es la nomenclatura que usa Nico).
    if (/-5$/i.test(p.reference.trim())) f.label = p.reference;
    familias.set(key, f);
  }
  const familiaPorProductId = new Map<string, string>();
  for (const f of familias.values()) {
    for (const id of f.productIds) familiaPorProductId.set(id, f.key);
  }

  const suggestion = computeReorderSuggestion({
    todayIso: today,
    imports: fechas,
    stock: [...familias.values()].map((f) => ({
      productId: f.key,
      reference: f.label,
      stockPhysical: f.stock,
      matchKey: f.key,
    })),
    salidas: inv.salidas
      .map((s) => ({ productId: familiaPorProductId.get(s.product_id) ?? '', quantity: Number(s.quantity ?? 0) }))
      .filter((s) => s.productId !== ''),
    transito,
  });

  return { isPending: false, suggestion, pedidosSinItems };
}
