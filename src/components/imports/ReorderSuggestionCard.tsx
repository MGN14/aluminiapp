/**
 * Card "¿Cuándo montar el próximo pedido?" — sugerencia basada en datos vivos:
 *
 *   fecha límite = primer quiebre de stock crítico − lead time − colchón
 *
 * Todo se recalcula en cada visita con lo último que haya en la BD:
 *   · Consumo real: salidas de inventario de los últimos 90 días.
 *   · Stock físico actual por referencia.
 *   · Lo que ya viene en el agua (packing list de pedidos abiertos, a su ETA).
 *   · Lead time medido por ETAPA de las fechas reales de todos los pedidos —
 *     no exige ciclo completo: hoy producción/tránsito pueden estar medidos y
 *     nacionalización en default; al entregarse el primer contenedor esa etapa
 *     pasa a medida sola. Ver src/lib/reorderSuggestion.ts.
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
} from '@/lib/reorderSuggestion';
import { Card, CardContent } from '@/components/ui/card';
import { CalendarClock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ItemRow { import_id: string; reference: string; cantidad: number }

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtFecha(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Fecha en que el pedido entró a 'entregado' según su historial embebido. */
function fechaEntregado(r: ImportRow): string | null {
  const h = (r.import_estado_history ?? []).find((x) => x.estado === 'entregado');
  return h?.fecha ?? null;
}

export default function ReorderSuggestionCard() {
  const { data: importsData } = useImports();

  const inventoryQuery = useQuery({
    queryKey: ['imports', 'reorder-inventario'],
    queryFn: async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - CONSUMO_VENTANA_DIAS);
      const cutoffIso = cutoff.toISOString().slice(0, 10);

      const [prodRes, movRes] = await Promise.all([
        supabase
          .from('inventory_products')
          .select('id, reference, stock_physical')
          .eq('active', true),
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

  if (!importsData || inventoryQuery.isPending) {
    return (
      <Card>
        <CardContent className="py-4 px-5 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Calculando sugerencia de próximo pedido…
        </CardContent>
      </Card>
    );
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

  // Packing list de pedidos abiertos → llegadas proyectadas a bodega.
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
    }));

  const inv = inventoryQuery.data!;
  const sug = computeReorderSuggestion({
    todayIso: today,
    imports: fechas,
    stock: inv.products.map((p) => ({ productId: p.id, reference: p.reference, stockPhysical: Number(p.stock_physical ?? 0) })),
    salidas: inv.salidas.map((s) => ({ productId: s.product_id, quantity: Number(s.quantity ?? 0) })),
    transito,
  });

  const dias = sug.diasParaDecidir;
  const urgencia: 'rojo' | 'ambar' | 'verde' = dias == null ? 'verde' : dias <= 7 ? 'rojo' : dias <= 30 ? 'ambar' : 'verde';
  const etapaTxt = (nombre: string, e: { dias: number; fuente: string; n: number }) =>
    `${nombre} ${e.dias}d ${e.fuente === 'medido' ? `(medido, ${e.n} pedido${e.n > 1 ? 's' : ''})` : '(estimado)'}`;

  return (
    <Card className={cn(
      urgencia === 'rojo' && 'border-destructive/40 bg-destructive/[0.03]',
      urgencia === 'ambar' && 'border-warning/40 bg-warning/[0.04]',
      urgencia === 'verde' && 'border-primary/25 bg-primary/[0.03]',
    )}>
      <CardContent className="py-4 px-5 space-y-2">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarClock className={cn(
              'h-4 w-4',
              urgencia === 'rojo' ? 'text-destructive' : urgencia === 'ambar' ? 'text-warning' : 'text-primary',
            )} />
            <p className="text-sm font-semibold">¿Cuándo montar el próximo pedido?</p>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Se recalcula solo: consumo {sug.datos.ventanaDias}d · {sug.datos.referenciasConConsumo} refs con movimiento · {sug.datos.llegadasEnTransito} llegadas en tránsito
          </p>
        </div>

        {sug.fechaLimite ? (
          <>
            <p className="text-sm leading-relaxed">
              Fecha límite para montar pedido:{' '}
              <strong className={cn(
                'text-base',
                urgencia === 'rojo' ? 'text-destructive' : urgencia === 'ambar' ? 'text-warning' : 'text-foreground',
              )}>
                {fmtFecha(sug.fechaLimite)}
              </strong>
              {dias != null && (
                <span className="text-muted-foreground">
                  {' '}— {dias <= 0 ? '¡ya estás en la fecha!' : `tenés ${dias} día${dias === 1 ? '' : 's'} para decidir`}
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              La referencia que manda es <strong className="text-foreground">{sug.quiebre!.reference}</strong>:
              con el consumo actual ({sug.quiebre!.consumoDiario.toFixed(1)}/día) y contando lo que viene en
              el agua, se quiebra el <strong className="text-foreground">{fmtFecha(sug.quiebre!.fechaQuiebre!)}</strong>.
              A eso le restamos el lead time ({sug.leadTime.totalDias} días: {etapaTxt('producción', sug.leadTime.produccion)},{' '}
              {etapaTxt('tránsito', sug.leadTime.transito)}, {etapaTxt('nacionalización', sug.leadTime.nacionalizacion)})
              y {sug.safetyDias} días de colchón.
            </p>
          </>
        ) : sug.motivoSinFecha === 'sin_consumo' ? (
          <p className="text-xs text-muted-foreground">
            Sin salidas de inventario en los últimos {sug.datos.ventanaDias} días — no hay consumo para proyectar.
            Apenas se registren despachos, la fecha aparece sola.
          </p>
        ) : sug.motivoSinFecha === 'sin_stock_data' ? (
          <p className="text-xs text-muted-foreground">
            No hay productos de inventario para proyectar. Cargá el inventario físico y la fecha aparece sola.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Ninguna referencia crítica se quiebra en el horizonte proyectado — con el stock actual y lo que
            viene en tránsito, no hay urgencia de pedido. La fecha aparecerá cuando el consumo acerque un quiebre.
          </p>
        )}

        {sug.leadTime.tieneDefaults && (
          <p className="text-[10px] text-muted-foreground/70 italic">
            Algunas etapas del lead time siguen estimadas por defecto — se reemplazan solas con las fechas
            reales de tus pedidos (hoy llega uno a puerto: al marcarlo, tránsito queda medido).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
