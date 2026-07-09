/**
 * Card "¿Cuándo montar el próximo pedido?" — presentación del motor de
 * src/lib/reorderSuggestion.ts (los datos y el cálculo viven en
 * useReorderSuggestion, compartido con el radar de abastecimiento).
 *
 * Criterio (decisión de Nico): UNA referencia quebrando = alerta puntual;
 * el pedido se dispara cuando quiebran UMBRAL_REFS_QUIEBRE referencias del
 * grueso del consumo. Los pedidos abiertos sin packing list/proforma no
 * cuentan como cobertura — la card lo avisa para que se suban.
 */

import { useReorderSuggestion } from '@/hooks/useReorderSuggestion';
import { Card, CardContent } from '@/components/ui/card';
import { CalendarClock, Loader2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

function fmtFecha(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
}

export default function ReorderSuggestionCard() {
  const { isPending, suggestion: sug, pedidosSinItems } = useReorderSuggestion();

  if (isPending || !sug) {
    return (
      <Card>
        <CardContent className="py-4 px-5 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Calculando sugerencia de próximo pedido…
        </CardContent>
      </Card>
    );
  }

  const dias = sug.diasParaDecidir;
  const urgencia: 'rojo' | 'ambar' | 'verde' = dias == null ? 'verde' : dias <= 7 ? 'rojo' : dias <= 30 ? 'ambar' : 'verde';

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
            Se recalcula solo: consumo {sug.datos.ventanaDias}d · {sug.datos.referenciasConConsumo} refs con movimiento · {sug.datos.llegadasEnTransito} llegadas en tránsito · lead time {sug.leadTime.totalDias}d + {sug.safetyDias}d colchón
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
              {sug.refsGrupal.length} referencia{sug.refsGrupal.length > 1 ? 's' : ''} del grueso del consumo se quiebra{sug.refsGrupal.length > 1 ? 'n' : ''} hacia el{' '}
              <strong className="text-foreground">{fmtFecha(sug.fechaQuiebreGrupal!)}</strong>{' '}
              ({sug.refsGrupal.map((q) => q.reference).join(', ')}), contando stock físico y lo que viene en el agua.
              Un pedido montado hoy quedaría en bodega el{' '}
              <strong className="text-foreground">{fmtFecha(sug.llegadaSiPidoHoy)}</strong>.
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
          <p className="text-xs text-muted-foreground leading-relaxed">
            Sin referencias críticas con consumo para proyectar fecha todavía. Un pedido montado hoy quedaría en
            bodega el <strong className="text-foreground">{fmtFecha(sug.llegadaSiPidoHoy)}</strong>.
          </p>
        )}

        {/* Huecos operativos: el contenedor en camino repone, pero hay unos
            días en 0 mientras nacionaliza. No mueven la fecha del pedido. */}
        {sug.alertas.length > 0 && (
          <p className="text-xs leading-relaxed flex items-start gap-1.5">
            <TriangleAlert className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
            <span>
              <strong>Hueco corto (lo repone lo que viene en camino):</strong>{' '}
              {sug.alertas.slice(0, 3).map((q, i) => (
                <span key={q.reference}>
                  {i > 0 && ' · '}
                  <strong>{q.reference}</strong> queda en 0 hacia el {fmtFecha((q.fechaHueco ?? q.fechaQuiebre)!)}
                </span>
              ))}
              {sug.alertas.length > 3 && ` · +${sug.alertas.length - 3} más`}
              . Reposición local o apurá la nacionalización si no querés el faltante.
            </span>
          </p>
        )}

        {/* Pedidos abiertos sin packing list/proforma → cobertura invisible */}
        {pedidosSinItems.length > 0 && (
          <p className="text-[11px] text-muted-foreground leading-relaxed rounded-md border border-border bg-muted/30 px-2 py-1.5">
            📦 <strong>{pedidosSinItems.length} pedido{pedidosSinItems.length > 1 ? 's' : ''} abierto{pedidosSinItems.length > 1 ? 's' : ''} sin packing list/proforma</strong>{' '}
            ({pedidosSinItems.map((p) => p.label).join(', ')}): no cuenta{pedidosSinItems.length > 1 ? 'n' : ''} como
            cobertura. Subile el proforma en la pestaña <strong>Costeo</strong> del pedido (sirve desde producción;
            cuando llegue el packing list definitivo lo reemplazás) y la fecha se corrige sola.
          </p>
        )}

        {sug.leadTime.tieneDefaults && (
          <p className="text-[10px] text-muted-foreground/70 italic">
            Parte del lead time sigue estimado por defecto — se reemplaza solo con las fechas reales de tus
            pedidos (anticipo, embarque, arribo, entrega).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
