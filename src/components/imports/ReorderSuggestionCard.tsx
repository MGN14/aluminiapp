/**
 * Card "¿Cuándo montar el próximo pedido?" — presentación del motor de
 * src/lib/reorderSuggestion.ts (los datos y el cálculo viven en
 * useReorderSuggestion, compartido con el radar de abastecimiento).
 *
 * Decisión de Nico (jul 2026): el banner dice SOLO lo esencial — cuándo
 * montar, días para decidir y cuándo llegaría si monto hoy. El detalle de
 * alertas (faltantes / alertas / huecos) vive en la pestaña Cobertura
 * (CoverageAlertsReport); acá solo el conteo con botón para ir a leerlo.
 */

import { useReorderSuggestion } from '@/hooks/useReorderSuggestion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, CalendarClock, Loader2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

function fmtFecha(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
}

export default function ReorderSuggestionCard({ onVerReporte }: { onVerReporte?: () => void }) {
  const { isPending, suggestion: sug, pedidosSinItems, pipeline } = useReorderSuggestion();

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
  const totalAlertas = sug.faltantes.length + sug.alertas.length + sug.huecos.length;

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
            Contando: stock físico + {pipeline.total} contenedor{pipeline.total === 1 ? '' : 'es'}
            {pipeline.total > 0 && (
              <> ({[
                pipeline.produccion > 0 ? `${pipeline.produccion} en producción` : null,
                pipeline.aduana > 0 ? `${pipeline.aduana} en aduanas` : null,
                pipeline.transito > 0 ? `${pipeline.transito} en tránsito` : null,
              ].filter(Boolean).join(', ')})</>
            )}
            {' '}· lead time {sug.leadTime.totalDias}d + {sug.safetyDias}d colchón
          </p>
        </div>

        {sug.fechaLimite ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-2">
            <div>
              <p className="text-[11px] text-muted-foreground">Fecha límite para montar</p>
              <p className={cn(
                'text-lg font-bold',
                urgencia === 'rojo' ? 'text-destructive' : urgencia === 'ambar' ? 'text-warning' : 'text-foreground',
              )}>
                {fmtFecha(sug.fechaLimite)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Días para decidir</p>
              <p className="text-lg font-bold text-foreground">
                {dias != null && dias <= 0 ? 'montálo HOY' : `${dias} día${dias === 1 ? '' : 's'}`}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Si lo montás hoy, llega</p>
              <p className="text-lg font-bold text-foreground">{fmtFecha(sug.llegadaSiPidoHoy)}</p>
            </div>
          </div>
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

        {/* Alertas: solo el conteo — el reporte completo vive en Cobertura */}
        {totalAlertas > 0 && (
          <div className="flex items-center justify-between gap-3 flex-wrap pt-1 border-t border-border/60">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <TriangleAlert className="h-3.5 w-3.5 text-warning" />
              {[
                sug.faltantes.length > 0 ? `${sug.faltantes.length} faltante${sug.faltantes.length > 1 ? 's' : ''} real${sug.faltantes.length > 1 ? 'es' : ''}` : null,
                sug.alertas.length > 0 ? `${sug.alertas.length} alerta${sug.alertas.length > 1 ? 's' : ''}` : null,
                sug.huecos.length > 0 ? `${sug.huecos.length} hueco${sug.huecos.length > 1 ? 's' : ''} corto${sug.huecos.length > 1 ? 's' : ''}` : null,
              ].filter(Boolean).join(' · ')}
            </p>
            {onVerReporte && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onVerReporte}>
                Leer reporte completo <ArrowRight className="h-3 w-3" />
              </Button>
            )}
          </div>
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
