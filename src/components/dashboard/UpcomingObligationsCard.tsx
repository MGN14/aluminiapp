import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Link } from 'react-router-dom';
import {
  ArrowRight, CalendarClock, AlertTriangle, Sparkles, Check, X,
  Receipt, Percent, Landmark, Building2, Home, Users, ShieldCheck, Zap,
  Briefcase, PiggyBank, CreditCard, HandCoins, Ship, CircleDot, type LucideIcon,
} from 'lucide-react';
import { useUpcomingObligations, diasRestantes } from '@/hooks/useUpcomingObligations';
import { usePaidObligations } from '@/hooks/usePaidObligations';
import { usePredictedObligations } from '@/hooks/usePredictedObligations';
import { TIPO_LABEL, type ObligacionTipo } from '@/lib/dianCalendar2026';
import { cn } from '@/lib/utils';

const MAX_ITEMS = 5;
const UPCOMING_WINDOW_DAYS = 45;

/** Ícono y color por tipo: se lee de un vistazo qué es cada fila. */
const TIPO_ICON: Record<ObligacionTipo, LucideIcon> = {
  iva: Receipt,
  retefuente: Percent,
  renta: Landmark,
  ica: Building2,
  arriendo: Home,
  nomina: Users,
  pila: ShieldCheck,
  servicios: Zap,
  parafiscales: Briefcase,
  cesantias: PiggyBank,
  credito: CreditCard,
  cobro_esperado: HandCoins,
  importacion: Ship,
  otro: CircleDot,
};

const TIPO_TILE: Record<ObligacionTipo, string> = {
  iva: 'bg-red-500/15 text-red-600 dark:text-red-400',
  retefuente: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  renta: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  ica: 'bg-pink-500/15 text-pink-600 dark:text-pink-400',
  arriendo: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  nomina: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  pila: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  servicios: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  parafiscales: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
  cesantias: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  credito: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
  cobro_esperado: 'bg-green-500/15 text-green-600 dark:text-green-400',
  importacion: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  otro: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
};

type Urgency = 'overdue' | 'critical' | 'soon' | 'week' | 'later';

function urgencyOf(days: number): Urgency {
  if (days < 0) return 'overdue';
  if (days <= 1) return 'critical';
  if (days <= 3) return 'soon';
  if (days <= 7) return 'week';
  return 'later';
}

/** Fondo de la fila: la urgencia se ve antes de leer. */
const ROW_BG: Record<Urgency, string> = {
  overdue: 'bg-destructive/10 border-destructive/40 hover:bg-destructive/15',
  critical: 'bg-destructive/[0.06] border-destructive/30 hover:bg-destructive/10',
  soon: 'bg-orange-500/[0.07] border-orange-300/70 dark:border-orange-800/60 hover:bg-orange-500/10',
  week: 'bg-amber-500/[0.06] border-amber-300/60 dark:border-amber-800/50 hover:bg-amber-500/10',
  later: 'bg-card border-border/60 hover:bg-muted/40',
};

/** Píldora de días: contraste alto, se lee desde lejos. */
const PILL: Record<Urgency, string> = {
  overdue: 'bg-destructive text-destructive-foreground',
  critical: 'bg-destructive text-destructive-foreground',
  soon: 'bg-orange-500 text-white',
  week: 'bg-amber-400 text-amber-950',
  later: 'bg-muted text-muted-foreground',
};

function pillLabel(days: number): string {
  if (days < 0) return `Vencida ${Math.abs(days)}d`;
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  return `${days} días`;
}

const fmtCop = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

const fmtFecha = (d: Date) =>
  d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');

/** Cuadro de ícono por tipo. */
function TipoTile({ tipo, className }: { tipo: ObligacionTipo; className?: string }) {
  const Icon = TIPO_ICON[tipo] ?? CircleDot;
  return (
    <span className={cn('h-9 w-9 rounded-xl flex items-center justify-center shrink-0', TIPO_TILE[tipo] ?? TIPO_TILE.otro, className)}>
      <Icon className="h-4 w-4" strokeWidth={2.25} />
    </span>
  );
}

export default function UpcomingObligationsCard() {
  const { events, nitDigit } = useUpcomingObligations(UPCOMING_WINDOW_DAYS);
  const { isPaid, togglePaid } = usePaidObligations();
  // Gastos recurrentes detectados en la conciliación (estimados, nunca DIAN).
  const { predicted, confirm, dismiss } = usePredictedObligations();

  // Mantiene vencidas no pagadas (d < 0) — solo el checkbox las saca de la lista.
  // Ordena: vencidas primero (más vencida arriba), luego por fecha ascendente.
  const upcoming = useMemo(() => {
    return events
      .filter(ev => {
        const d = diasRestantes(ev.fecha);
        return d <= UPCOMING_WINDOW_DAYS && !isPaid(ev);
      })
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
      .slice(0, MAX_ITEMS);
  }, [events, isPaid]);

  const totalVentana = useMemo(
    () => upcoming.reduce((s, ev) => s + (ev.monto && ev.monto > 0 ? ev.monto : 0), 0),
    [upcoming],
  );

  // Estado sin configurar: CTA suave.
  if (nitDigit === null) {
    return (
      <Link to="/visita-dian" className="block group">
        <Card className="overflow-hidden border border-border hover:border-primary/30 transition-colors cursor-pointer h-full rounded-2xl">
          <CardContent className="p-5 h-full flex flex-col justify-center">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-muted/60 flex items-center justify-center shrink-0">
                <CalendarClock className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Próximas obligaciones</p>
                <p className="text-base font-bold text-foreground mt-0.5">Configura tu NIT</p>
                <p className="text-xs text-muted-foreground leading-snug mt-1">
                  Activa el calendario DIAN con el último dígito de tu NIT.
                </p>
                <div className="flex items-center gap-1 text-xs text-primary/80 group-hover:text-primary font-semibold transition-colors pt-2">
                  Configurar ahora <ArrowRight className="h-3.5 w-3.5" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }

  // Sin obligaciones próximas (ni predichos que mostrar).
  if (upcoming.length === 0 && predicted.length === 0) {
    return (
      <Link to="/visita-dian" className="block group">
        <Card className="overflow-hidden border border-success/30 bg-gradient-to-br from-success/10 via-card to-card hover:border-success/50 transition-colors cursor-pointer h-full rounded-2xl">
          <CardContent className="p-5 h-full flex flex-col justify-center">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-success/15 flex items-center justify-center shrink-0">
                <CalendarClock className="h-5 w-5 text-success" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Próximas obligaciones</p>
                <p className="text-base font-bold text-success mt-0.5">Todo tranquilo</p>
                <p className="text-xs text-muted-foreground leading-snug mt-1">
                  No tenés vencimientos en los próximos {UPCOMING_WINDOW_DAYS} días.
                </p>
                <div className="flex items-center gap-1 text-xs text-primary/80 group-hover:text-primary font-semibold transition-colors pt-2">
                  Ver calendario completo <ArrowRight className="h-3.5 w-3.5" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }

  const worst = upcoming.reduce<Urgency>((acc, ev) => {
    const u = urgencyOf(diasRestantes(ev.fecha));
    const rank: Record<Urgency, number> = { overdue: 0, critical: 1, soon: 2, week: 3, later: 4 };
    return rank[u] < rank[acc] ? u : acc;
  }, 'later');
  const alarm = worst === 'overdue' || worst === 'critical' || worst === 'soon';

  return (
    <Link to="/visita-dian" className="block group">
      <Card
        className={cn(
          'overflow-hidden border transition-colors cursor-pointer h-full rounded-2xl',
          alarm
            ? 'border-destructive/30 bg-gradient-to-br from-destructive/[0.07] via-card to-card hover:border-destructive/50'
            : 'border-border bg-gradient-to-br from-primary/[0.04] via-card to-card hover:border-primary/40',
        )}
      >
        <CardContent className="p-4 sm:p-5">
          {/* Encabezado: qué es, cuántas y cuánta plata en la ventana */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn('w-11 h-11 rounded-2xl flex items-center justify-center shrink-0', alarm ? 'bg-destructive/15' : 'bg-primary/10')}>
                {alarm
                  ? <AlertTriangle className="h-5 w-5 text-destructive" strokeWidth={2.25} />
                  : <CalendarClock className="h-5 w-5 text-primary" strokeWidth={2.25} />}
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-bold tracking-tight text-foreground leading-tight">Próximas obligaciones</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {upcoming.length} en {UPCOMING_WINDOW_DAYS} días
                  {totalVentana > 0 && (
                    <>
                      {' · '}
                      <span className="font-semibold text-foreground tabular-nums">≈ {fmtCop(totalVentana)}</span>
                    </>
                  )}
                </p>
              </div>
            </div>
            {worst === 'overdue' && (
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-destructive text-destructive-foreground">
                Vencidas
              </span>
            )}
          </div>

          <div className="space-y-2">
            {upcoming.map(ev => {
              const dias = diasRestantes(ev.fecha);
              const u = urgencyOf(dias);
              const hasMonto = ev.monto != null && ev.monto > 0;
              return (
                <div
                  key={ev.id}
                  className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 border transition-colors', ROW_BG[u])}
                  title={ev.detalle ?? undefined}
                >
                  <span
                    onClick={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      togglePaid(ev);
                    }}
                    className="shrink-0 flex items-center"
                    title="Marcar como pagada"
                  >
                    <Checkbox className="h-4 w-4 rounded-md" />
                  </span>
                  <TipoTile tipo={ev.tipo} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-foreground leading-tight truncate">{ev.descripcion}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      <span className="font-medium text-foreground/70">{TIPO_LABEL[ev.tipo]}</span>
                      {' · '}
                      {fmtFecha(ev.fecha)}
                      {ev.detalle ? ` · ${ev.detalle}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className={cn('text-[14px] font-bold tabular-nums leading-none', hasMonto ? 'text-foreground' : 'text-muted-foreground/60')}>
                      {hasMonto ? `${ev.montoEstimado ? '≈ ' : ''}${fmtCop(ev.monto!)}` : '—'}
                    </span>
                    <span className={cn('text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full leading-none', PILL[u])}>
                      {pillLabel(dias)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Predichos desde la conciliación — SIEMPRE marcados "estimado":
              una fecha DIAN es ley, esta es estadística de tus propios pagos. */}
          {predicted.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/60 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Detectado en tus pagos
              </p>
              {predicted.map((p) => {
                const u = urgencyOf(p.days_until);
                return (
                  <div
                    key={p.pattern_key}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 border border-dashed border-border bg-muted/20 hover:bg-muted/40 transition-colors"
                    title={`Se repitió ${p.occurrences} veces, cada ~${p.frequency_days} días (confianza ${Math.round(p.confidence * 100)}%).`}
                  >
                    <span className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Sparkles className="h-4 w-4" strokeWidth={2.25} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-foreground leading-tight truncate">{p.description}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        Estimado · {p.occurrences} pagos cada ~{p.frequency_days} días
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <span className="text-[14px] font-bold tabular-nums leading-none text-foreground">≈ {fmtCop(p.estimated_amount)}</span>
                      <span className={cn('text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full leading-none', PILL[u])}>
                        {pillLabel(p.days_until)}
                      </span>
                    </div>
                    <span className="flex flex-col gap-1 shrink-0">
                      <button
                        type="button"
                        title="Sí, es un pago fijo — crear la obligación"
                        className="h-6 w-6 rounded-md flex items-center justify-center text-success hover:bg-success/15"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); confirm.mutate(p); }}
                      >
                        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </button>
                      <button
                        type="button"
                        title="No es fijo — no volver a sugerirlo"
                        className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismiss.mutate(p); }}
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between pt-3">
            <span className="text-[10px] text-muted-foreground">≈ estimado con tus facturas; el contador cierra la cifra</span>
            <span className="flex items-center gap-1 text-xs text-primary/80 group-hover:text-primary font-semibold transition-colors">
              Ver calendario completo <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
