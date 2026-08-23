/**
 * Card "¿Cuándo montar el próximo pedido?" — presentación del motor de
 * src/lib/reorderSuggestion.ts (los datos y el cálculo viven en
 * useReorderSuggestion, compartido con el radar de abastecimiento).
 *
 * Decisión de Nico (jul 2026): el banner dice SOLO lo esencial — cuándo
 * montar, días para decidir y cuándo llegaría si monto hoy. El detalle de
 * alertas (faltantes / alertas / huecos) vive en la pestaña Cobertura
 * (CoverageAlertsReport); acá solo el conteo con botón para ir a leerlo.
 *
 * Rediseño 2026-08-23 — la versión anterior pintaba la urgencia con
 * `bg-destructive/[0.03]`, pero el token --destructive de este tema es un tan
 * lavado (27 24.5% 57.7%), no un rojo: al 3-6% de opacidad el semáforo no
 * llegaba al ojo. Ahora la urgencia se comunica con una BARRA DE ACENTO
 * lateral en color pleno + tipografía, no con fondos tintados. Escala
 * tipográfica de 3 niveles (hero / label / body), iconos lucide en vez de
 * emojis, y los datos tabulares salen en chips en vez de párrafos corridos.
 */

import { useState } from 'react';
import { useReorderSuggestion } from '@/hooks/useReorderSuggestion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ArrowRight, CalendarClock, Loader2, TriangleAlert, Factory, Hourglass,
  Info, ChevronDown, CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function fmtFecha(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** Fecha corta para chips y datos secundarios: "15 oct". */
function fmtFechaCorta(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
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
const fmtUnd = (n: number) => Math.round(n).toLocaleString('es-CO');

/** Escala de urgencia propia de la card.
 *  No usa `destructive` a propósito: ese token es el tan de los botones de
 *  borrar, no comunica urgencia temporal. Colores plenos = contraste AA. */
const TONO = {
  critico: {
    bar: 'bg-red-500',
    text: 'text-red-600 dark:text-red-400',
    chip: 'bg-red-500/10 text-red-700 dark:text-red-300 ring-1 ring-inset ring-red-500/25',
  },
  pronto: {
    bar: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-500/25',
  },
  ok: {
    bar: 'bg-emerald-500',
    text: 'text-foreground',
    chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-inset ring-emerald-500/25',
  },
} as const;

type Tono = keyof typeof TONO;

/** Etiqueta de sección: el único uppercase de la card. */
function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground', className)}>
      {children}
    </p>
  );
}

/** Dato con label arriba y valor hero abajo. */
function Metric({ label, value, hint, tone = 'text-foreground', title }: {
  label: string; value: React.ReactNode; hint?: string; tone?: string; title?: string;
}) {
  return (
    <div title={title} className="min-w-0">
      <p className="text-[11px] text-muted-foreground truncate">{label}</p>
      <p className={cn('text-[19px] leading-tight font-semibold tracking-tight tabular-nums mt-0.5', tone)}>
        {value}
      </p>
      {hint && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{hint}</p>}
    </div>
  );
}

export default function ReorderSuggestionCard({ onVerReporte }: { onVerReporte?: () => void }) {
  const { isPending, suggestion: sug, pedidosSinItems, pipeline, diasCotizacion, retenidos, transitoSinImputar } = useReorderSuggestion();
  const [showRefs, setShowRefs] = useState(false);

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
  const urgencia: Tono = dias == null ? 'ok' : dias <= 7 ? 'critico' : dias <= 30 ? 'pronto' : 'ok';
  const totalAlertas = sug.faltantes.length + sug.alertas.length + sug.huecos.length;

  // Tooltip con el detalle del cálculo — antes ocupaba una línea entera de
  // texto de 10px al lado del título.
  const comoSeCalcula = [
    `Contando stock físico + ${pipeline.total} contenedor${pipeline.total === 1 ? '' : 'es'}`,
    pipeline.total > 0
      ? `(${[
          pipeline.produccion > 0 ? `${pipeline.produccion} en producción` : null,
          pipeline.aduana > 0 ? `${pipeline.aduana} en aduanas` : null,
          pipeline.transito > 0 ? `${pipeline.transito} en tránsito` : null,
        ].filter(Boolean).join(', ')})`
      : null,
    `· lead time ${sug.leadTime.totalDias}d + ${sug.safetyDias}d de colchón`,
    sug.leadTime.tieneDefaults
      ? '\n\nParte del lead time sigue estimado por defecto — se reemplaza solo con las fechas reales de tus pedidos.'
      : null,
  ].filter(Boolean).join(' ');

  return (
    <Card className="overflow-hidden">
      {/* Barra de acento superior: el semáforo, en color pleno */}
      <div className={cn('h-1', TONO[urgencia].bar)} />

      <CardContent className="p-5 space-y-5">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <CalendarClock className={cn('h-[18px] w-[18px]', TONO[urgencia].text)} />
            <h3 className="text-[15px] font-semibold tracking-tight">Próximo pedido</h3>
          </div>
          <span
            title={comoSeCalcula}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-help shrink-0"
          >
            <Info className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Cómo se calcula</span>
          </span>
        </div>

        {/* ── DECISIÓN 1 · MANDÁ A TRAER ──────────────────────────────────
            Dos decisiones distintas, dos cálculos (Nico 2026-08-02): lo YA
            fabricado/comprado se manda a traer — eso corre el corte de
            inventario; montar pedido NUEVO es la decisión de después. */}
        {retenidos.length > 0 && (
          <div className="space-y-3">
            <SectionLabel>Primero · mandá a traer lo que ya está comprado</SectionLabel>
            {retenidos.map((ret) => {
              const trans = sug.leadTime.transito.dias;
              const nac = sug.leadTime.nacionalizacion.dias;
              const hoy = new Date().toISOString().slice(0, 10);
              const llegaSiTraigo = addDaysIso(hoy, trans + nac);
              const traerAntesDe = sug.fechaQuiebreGrupal
                ? addDaysIso(sug.fechaQuiebreGrupal, -(trans + nac + sug.safetyDias))
                : null;
              const diasTraer = traerAntesDe ? daysFromToday(traerAntesDe) : null;
              const tonoRet: Tono = diasTraer == null ? 'ok' : diasTraer <= 0 ? 'critico' : diasTraer <= 7 ? 'pronto' : 'ok';
              const Icono = ret.motivo === 'listo' ? Factory : Hourglass;

              return (
                <div key={ret.id} className="flex gap-3">
                  {/* Acento lateral: contraste sin lavar el fondo */}
                  <div className={cn('w-[3px] rounded-full shrink-0', TONO[tonoRet].bar)} />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <Icono className="h-4 w-4 text-muted-foreground self-center shrink-0" />
                      <span className="text-[15px] font-semibold tracking-tight">
                        {diasTraer != null && diasTraer <= 0
                          ? `Mandá a traer ${ret.label} ya`
                          : traerAntesDe
                            ? <>Mandá a traer {ret.label} antes del <span className={TONO[tonoRet].text}>{fmtFecha(traerAntesDe)}</span></>
                            : `Mandá a traer ${ret.label}`}
                      </span>
                      {diasTraer != null && (
                        <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0', TONO[tonoRet].chip)}>
                          {diasTraer <= 0 ? 'vencido' : `${diasTraer}d`}
                        </span>
                      )}
                    </div>

                    {/* Los tres datos que sostienen la decisión, en fila */}
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
                      <span className="text-muted-foreground">
                        {ret.motivo === 'listo' ? 'Listo en fábrica' : `${ret.diasProduccion}d fabricando`}
                        {ret.motivo === 'listo' && ret.listoDesde
                          ? <> desde <span className="text-foreground font-medium">{fmtFechaCorta(ret.listoDesde)}</span></>
                          : <> · promedio <span className="text-foreground font-medium">{sug.leadTime.produccion.dias}d</span></>}
                      </span>
                      <span className="text-muted-foreground">
                        En bodega ≈ <span className="text-foreground font-medium tabular-nums">{fmtFechaCorta(llegaSiTraigo)}</span>
                      </span>
                      {ret.saldoUsd > 0 && (
                        <span className="text-muted-foreground">
                          Girar <span className="text-foreground font-medium tabular-nums">{fmtUSD0(ret.saldoUsd)}</span> en el tránsito (~{trans}d)
                        </span>
                      )}
                    </div>

                    {ret.motivo !== 'listo' && (
                      <p className="text-xs text-muted-foreground">
                        Confirmá con la fábrica: cada día que no embarque corre la llegada un día.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── DECISIÓN 2 · MONTAR PEDIDO NUEVO ────────────────────────────── */}
        {sug.fechaLimite ? (
          <div className="space-y-3">
            {retenidos.length > 0 && (
              <>
                <div className="border-t border-border" />
                <SectionLabel>Después · montar pedido nuevo</SectionLabel>
              </>
            )}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-4">
              {/* Cotizar arranca ANTES de montar: fecha límite − días promedio
                  de cotización (medidos de tus pedidos; 14d sin historia). */}
              {(() => {
                const fechaCotizar = addDaysIso(sug.fechaLimite!, -diasCotizacion);
                const diasCotizar = daysFromToday(fechaCotizar);
                const t: Tono = diasCotizar <= 0 ? 'critico' : diasCotizar <= 7 ? 'pronto' : 'ok';
                return (
                  <Metric
                    label="Empezar a cotizar"
                    value={diasCotizar <= 0 ? 'Cotizá ya' : fmtFecha(fechaCotizar)}
                    hint={`~${diasCotizacion}d de cotización`}
                    tone={TONO[t].text}
                    title={`Cotizar te toma ~${diasCotizacion} días (promedio de tus pedidos) — arrancá con esa anticipación para poder montar a tiempo`}
                  />
                );
              })()}

              <Metric
                label="Fecha límite para montar"
                value={fmtFecha(sug.fechaLimite)}
                tone={TONO[urgencia].text}
              />

              <Metric
                label="Días para decidir"
                value={
                  dias != null && dias <= 0
                    ? retenidos.length > 0
                      // Con mercancía comprada retenida en fábrica, "montá HOY"
                      // es prematuro: embarcarla corre el corte y esta fecha se
                      // recalcula sola.
                      ? <span className={TONO.pronto.text}>Tras mandar a traer</span>
                      : pedidosSinItems.length > 0
                        ? <span className={TONO.pronto.text}>Subí proforma</span>
                        : <span className={TONO.critico.text}>Montálo hoy</span>
                    : `${dias} día${dias === 1 ? '' : 's'}`
                }
                title={
                  dias != null && dias <= 0 && retenidos.length > 0
                    ? 'Embarcar lo retenido corre el corte — la fecha se recalcula sola. Resolvé la 1ª decisión primero.'
                    : undefined
                }
              />

              <Metric label="Si lo montás hoy, llega" value={fmtFecha(sug.llegadaSiPidoHoy)} />
            </div>

            {/* POR QUÉ esa fecha: las referencias que fijaron el corte. Antes
                era un párrafo corrido con paréntesis; ahora chips colapsables
                — el dato se puede auditar a ojo sin cargar la card. */}
            {sug.refsGrupal.length > 0 && sug.fechaQuiebreGrupal && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowRefs((v) => !v)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showRefs && 'rotate-180')} />
                  Corte del <span className="text-foreground font-medium">{fmtFecha(sug.fechaQuiebreGrupal)}</span>
                  <span className="text-muted-foreground">
                    · lo fijan {sug.refsGrupal.length} referencia{sug.refsGrupal.length === 1 ? '' : 's'}
                  </span>
                </button>
                {showRefs && (
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {sug.refsGrupal.slice(-8).map((q) => (
                      <span
                        key={q.reference}
                        className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[11px]"
                        title={`${fmtUnd(q.consumoDiario)}/día · stock ${fmtUnd(q.stock)}${q.enTransito > 0 ? ` · ${fmtUnd(q.enTransito)} en camino` : ' · nada en camino'}`}
                      >
                        <span className="font-mono font-medium">{q.reference}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {fmtUnd(q.consumoDiario)}/d · {fmtUnd(q.stock)}
                          {q.enTransito > 0 && <span className="text-emerald-600 dark:text-emerald-400"> +{fmtUnd(q.enTransito)}</span>}
                        </span>
                      </span>
                    ))}
                    {sug.refsGrupal.length > 8 && (
                      <span className="inline-flex items-center px-2 py-1 text-[11px] text-muted-foreground">
                        +{sug.refsGrupal.length - 8} más
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : sug.motivoSinFecha === 'sin_urgencia' ? (
          <div className="flex gap-3">
            <div className="w-[3px] rounded-full bg-emerald-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-[15px] font-semibold tracking-tight flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Cobertura sobrada — no hay pedido que montar
              </p>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                Con el stock actual + lo que viene, el quiebre grupal queda a más de 400 días
                {sug.fechaQuiebreGrupal ? ` (≈ ${fmtFecha(sug.fechaQuiebreGrupal)})` : ''}. Normal recién
                entrado un contenedor. La fecha límite aparece sola cuando el consumo acerque el quiebre.
              </p>
            </div>
          </div>
        ) : sug.motivoSinFecha === 'sin_consumo' ? (
          <p className="text-xs text-muted-foreground leading-relaxed">
            Sin salidas de inventario en los últimos {sug.datos.ventanaDias} días — no hay consumo para proyectar.
            Apenas se registren despachos, la fecha aparece sola.
          </p>
        ) : sug.motivoSinFecha === 'sin_stock_data' ? (
          <p className="text-xs text-muted-foreground leading-relaxed">
            No hay productos de inventario para proyectar. Cargá el inventario físico y la fecha aparece sola.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground leading-relaxed">
            Sin referencias críticas con consumo para proyectar fecha todavía. Un pedido montado hoy quedaría en
            bodega el <span className="text-foreground font-medium">{fmtFecha(sug.llegadaSiPidoHoy)}</span>.
          </p>
        )}

        {/* ── Pie: diagnósticos + alertas, en una sola fila ───────────────── */}
        {(transitoSinImputar.length > 0 || totalAlertas > 0) && (
          <div className="border-t border-border pt-3 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap min-w-0">
              {/* DIAGNÓSTICO: unidades en camino que el modelo no usa para
                  cubrir ningún quiebre. Si aparece, la fecha de arriba es más
                  alarmista que la realidad (auditoría externa 2026-08-02). */}
              {transitoSinImputar.length > 0 && (() => {
                const total = transitoSinImputar.reduce((s, t) => s + t.unidades, 0);
                const detalle = transitoSinImputar.map((t) => `${t.label} (${fmtUnd(t.unidades)})`).join(', ');
                return (
                  <span
                    className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 cursor-help"
                    title={`${detalle}\n\nLa fecha de arriba NO las cuenta como cobertura. Revisá cómo quedó escrita esa referencia en el packing/proforma del pedido.`}
                  >
                    <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                    <span className="tabular-nums font-medium">{fmtUnd(total)}</span> unidades en camino sin cruzar
                  </span>
                );
              })()}

              {totalAlertas > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {[
                    sug.faltantes.length > 0 ? `${sug.faltantes.length} faltante${sug.faltantes.length > 1 ? 's' : ''}` : null,
                    sug.alertas.length > 0 ? `${sug.alertas.length} alerta${sug.alertas.length > 1 ? 's' : ''}` : null,
                    sug.huecos.length > 0 ? `${sug.huecos.length} hueco${sug.huecos.length > 1 ? 's' : ''} corto${sug.huecos.length > 1 ? 's' : ''}` : null,
                  ].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>

            {onVerReporte && totalAlertas > 0 && (
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 -mr-2 shrink-0" onClick={onVerReporte}>
                Reporte completo <ArrowRight className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
