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

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

function daysFromToday(iso: string): number {
  const hoy = new Date();
  const a = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const b = new Date(iso + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86_400_000);
}

const fmtUSD0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export default function ReorderSuggestionCard({ onVerReporte }: { onVerReporte?: () => void }) {
  const { isPending, suggestion: sug, pedidosSinItems, pipeline, diasCotizacion, retenidos } = useReorderSuggestion();

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

        {/* ── DECISIÓN 1 · MANDÁ A TRAER (antes que montar nada) ──────────────
            Dos decisiones distintas, dos cálculos (Nico 2026-08-02): lo YA
            fabricado/comprado se manda a traer — eso corre el corte de
            inventario; montar pedido NUEVO es la decisión de después. Por eso
            este bloque va PRIMERO y en rojo cuando toca ya. */}
        {retenidos.length > 0 && (
          <div className={cn(
            'rounded-lg border px-3 py-2.5 space-y-1.5',
            dias != null && dias <= 30
              ? 'border-destructive/50 bg-destructive/[0.06]'
              : 'border-sky-400/40 bg-sky-50/60 dark:bg-sky-950/20',
          )}>
            <p className={cn(
              'text-[10px] font-semibold uppercase tracking-wide',
              dias != null && dias <= 30 ? 'text-destructive' : 'text-sky-700 dark:text-sky-300',
            )}>
              1ª decisión · Mandá a traer lo que ya está comprado
            </p>
            {retenidos.map((ret) => {
              const trans = sug.leadTime.transito.dias;
              const nac = sug.leadTime.nacionalizacion.dias;
              const hoy = new Date().toISOString().slice(0, 10);
              const llegaSiTraigo = addDaysIso(hoy, trans + nac);
              const traerAntesDe = sug.fechaQuiebreGrupal
                ? addDaysIso(sug.fechaQuiebreGrupal, -(trans + nac + sug.safetyDias))
                : null;
              const diasTraer = traerAntesDe ? daysFromToday(traerAntesDe) : null;
              const urgente = diasTraer != null && diasTraer <= 0;
              const pronto = diasTraer != null && diasTraer > 0 && diasTraer <= 7;
              return (
                <p key={ret.id} className="text-[11px] leading-relaxed">
                  {ret.motivo === 'listo' ? (
                    <>
                      🏭 <strong>{ret.label} listo en fábrica</strong>
                      {ret.listoDesde && <span className="text-muted-foreground"> desde {fmtFecha(ret.listoDesde)}</span>}
                    </>
                  ) : (
                    <>
                      ⏳ <strong>{ret.label} ya cumplió el promedio de producción</strong>
                      <span className="text-muted-foreground"> ({ret.diasProduccion}d fabricando, promedio {sug.leadTime.produccion.dias}d)</span>
                      {' '}— confirmá con la fábrica: cada día que no embarque corre la llegada un día
                    </>
                  )}
                  {' '}— <strong className={urgente ? 'text-destructive' : pronto ? 'text-warning' : ''}>
                    {urgente ? 'mandalo a traer YA' : traerAntesDe ? `mandalo a traer antes del ${fmtFecha(traerAntesDe)}` : 'mandalo a traer'}
                  </strong>; queda en bodega ≈ <strong>{fmtFecha(llegaSiTraigo)}</strong>.
                  {' '}El tránsito (~{trans}d) es tu ventana para girar el saldo
                  {ret.saldoUsd > 0 && <> de <strong className="font-mono">{fmtUSD0(ret.saldoUsd)} USD</strong></>} antes de aduana.
                </p>
              );
            })}
          </div>
        )}

        {/* Los avisos de documentos faltantes (proforma/packing/BanRep) viven
            POR FILA en la tabla de pedidos, no acá (decisión de Nico 2026-08-02). */}
        {sug.fechaLimite ? (
          <div className="space-y-1">
            {retenidos.length > 0 && (
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                2ª decisión · Montar pedido NUEVO
              </p>
            )}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-x-6 gap-y-2">
            {/* Cotizar arranca ANTES de montar: fecha límite − días promedio
                de cotización (medidos de tus pedidos; 14d sin historia). */}
            {(() => {
              const fechaCotizar = addDaysIso(sug.fechaLimite, -diasCotizacion);
              const diasCotizar = daysFromToday(fechaCotizar);
              const tono = diasCotizar <= 0 ? 'text-destructive' : diasCotizar <= 7 ? 'text-warning' : 'text-foreground';
              return (
                <div title={`Cotizar te toma ~${diasCotizacion} días (promedio de tus pedidos) — arrancá con esa anticipación para poder montar a tiempo`}>
                  <p className="text-[11px] text-muted-foreground">Empezar a cotizar</p>
                  <p className={cn('text-lg font-bold', tono)}>
                    {diasCotizar <= 0 ? 'cotizá YA' : fmtFecha(fechaCotizar)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">~{diasCotizacion}d de cotización</p>
                </div>
              );
            })()}
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
                {dias != null && dias <= 0
                  ? retenidos.length > 0
                    // Con mercancía comprada retenida en fábrica, "montá HOY"
                    // es prematuro: embarcarla corre el corte y esta fecha se
                    // recalcula sola.
                    ? <span className="text-warning" title="Embarcar lo retenido corre el corte — la fecha se recalcula sola. Resolvé la 1ª decisión primero.">tras mandar a traer</span>
                    : pedidosSinItems.length > 0
                      ? <span className="text-warning" title="Hay un pedido abierto sin proforma: esa mercancía no cuenta como cobertura y la fecha sale más alarmista de lo real.">subí proforma 1º</span>
                      : 'montálo HOY'
                  : `${dias} día${dias === 1 ? '' : 's'}`}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Si lo montás hoy, llega</p>
              <p className="text-lg font-bold text-foreground">{fmtFecha(sug.llegadaSiPidoHoy)}</p>
            </div>
          </div>
          </div>
        ) : sug.motivoSinFecha === 'sin_urgencia' ? (
          <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2.5">
            <p className="text-sm font-semibold text-success">✓ Cobertura sobrada — no hay pedido que montar</p>
            <p className="text-xs text-muted-foreground mt-1">
              Con el stock actual + lo que viene, el quiebre grupal queda a más de {400} días
              {sug.fechaQuiebreGrupal ? ` (≈ ${fmtFecha(sug.fechaQuiebreGrupal)})` : ''}. Normal recién
              entrado un contenedor. La fecha límite aparecerá sola cuando el consumo acerque el quiebre —
              las referencias puntuales que igual se agotan van en faltantes/alertas abajo.
            </p>
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
