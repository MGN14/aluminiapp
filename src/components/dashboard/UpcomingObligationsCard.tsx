import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarClock, AlertTriangle, Sparkles, Check, X } from 'lucide-react';
import { useUpcomingObligations, diasRestantes } from '@/hooks/useUpcomingObligations';
import { usePaidObligations } from '@/hooks/usePaidObligations';
import { usePredictedObligations } from '@/hooks/usePredictedObligations';
import { TIPO_LABEL } from '@/lib/dianCalendar2026';

const MAX_ITEMS = 5;
const UPCOMING_WINDOW_DAYS = 45;

function urgencyColor(days: number): string {
  if (days < 0) return 'text-destructive';
  if (days <= 3) return 'text-destructive';
  if (days <= 7) return 'text-orange-600 dark:text-orange-400';
  if (days <= 15) return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

function urgencyBg(days: number): string {
  if (days < 0) return 'bg-destructive/10 border-destructive/40';
  if (days <= 3) return 'bg-destructive/5 border-destructive/30';
  if (days <= 7) return 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900/50';
  return 'bg-card border-border/50';
}

function urgencyLabel(days: number): string {
  if (days < 0) return `Vencida hace ${Math.abs(days)}d`;
  if (days === 0) return '¡Hoy!';
  if (days === 1) return 'Mañana';
  return `${days}d`;
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

  // Estado sin configurar: CTA suave.
  if (nitDigit === null) {
    return (
      <Link to="/visita-dian" className="block group">
        <Card className="overflow-hidden border border-border hover:border-primary/20 transition-colors cursor-pointer h-full">
          <CardContent className="p-4 h-full flex flex-col justify-center">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center shrink-0">
                <CalendarClock className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground">Próximas obligaciones</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">Configura tu NIT</p>
                <p className="text-[11px] text-muted-foreground leading-snug mt-1">
                  Activa el calendario DIAN con el último dígito de tu NIT.
                </p>
                <div className="flex items-center gap-1 text-[11px] text-primary/70 group-hover:text-primary font-medium transition-colors pt-2">
                  Configurar ahora <ArrowRight className="h-3 w-3" />
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
        <Card className="overflow-hidden border border-success/30 bg-success/5 hover:border-success/50 transition-colors cursor-pointer h-full">
          <CardContent className="p-4 h-full flex flex-col justify-center">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-success/15 flex items-center justify-center shrink-0">
                <CalendarClock className="h-5 w-5 text-success" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground">Próximas obligaciones</p>
                <p className="text-sm font-semibold text-success mt-0.5">Todo tranquilo</p>
                <p className="text-[11px] text-muted-foreground leading-snug mt-1">
                  No tenés vencimientos en los próximos {UPCOMING_WINDOW_DAYS} días.
                </p>
                <div className="flex items-center gap-1 text-[11px] text-primary/70 group-hover:text-primary font-medium transition-colors pt-2">
                  Ver calendario completo <ArrowRight className="h-3 w-3" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }

  const hasCritical = upcoming.some(ev => diasRestantes(ev.fecha) <= 3);
  const hasOverdue = upcoming.some(ev => diasRestantes(ev.fecha) < 0);

  return (
    <Link to="/visita-dian" className="block group">
      <Card className={`overflow-hidden border hover:border-primary/30 transition-colors cursor-pointer h-full ${hasOverdue || hasCritical ? 'border-destructive/30' : 'border-border'}`}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              {hasOverdue || hasCritical ? (
                <AlertTriangle className="h-4 w-4 text-destructive" />
              ) : (
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
              )}
              <p className="text-xs font-medium text-muted-foreground">Próximas obligaciones</p>
            </div>
            <span className="text-[10px] text-muted-foreground">{UPCOMING_WINDOW_DAYS}d</span>
          </div>

          <div className="space-y-1.5">
            {upcoming.map(ev => {
              const dias = diasRestantes(ev.fecha);
              return (
                <div
                  key={ev.id}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 border ${urgencyBg(dias)}`}
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
                    <Checkbox className="h-3.5 w-3.5" />
                  </span>
                  <Badge variant="outline" className="text-[9px] py-0 px-1.5 h-4 shrink-0 bg-background">
                    {TIPO_LABEL[ev.tipo]}
                  </Badge>
                  <span className="text-[11px] text-foreground truncate flex-1 min-w-0">
                    {ev.descripcion}
                  </span>
                  <span className={`text-[10px] font-semibold shrink-0 ${urgencyColor(dias)}`}>
                    {urgencyLabel(dias)}
                  </span>
                  <span className="text-[10px] font-medium tabular-nums shrink-0 text-muted-foreground min-w-[58px] text-right">
                    {ev.monto != null && ev.monto > 0
                      ? new Intl.NumberFormat('es-CO', {
                          style: 'currency',
                          currency: 'COP',
                          maximumFractionDigits: 0,
                          notation: 'compact',
                        }).format(ev.monto)
                      : '—'}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Predichos desde la conciliación — SIEMPRE marcados "estimado":
              una fecha DIAN es ley, esta es estadística de tus propios pagos. */}
          {predicted.length > 0 && (
            <div className="mt-2.5 pt-2 border-t border-border/60 space-y-1.5">
              <p className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> Detectado en tus pagos
              </p>
              {predicted.map((p) => (
                <div
                  key={p.pattern_key}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 border border-dashed border-border bg-muted/20"
                  title={`Se repitió ${p.occurrences} veces, cada ~${p.frequency_days} días (confianza ${Math.round(p.confidence * 100)}%).`}
                >
                  <Badge variant="outline" className="text-[9px] py-0 px-1.5 h-4 shrink-0 bg-background text-muted-foreground">
                    estimado
                  </Badge>
                  <span className="text-[11px] text-foreground truncate flex-1 min-w-0">{p.description}</span>
                  <span className={`text-[10px] font-semibold shrink-0 ${urgencyColor(p.days_until)}`}>
                    {urgencyLabel(p.days_until)}
                  </span>
                  <span className="text-[10px] font-medium tabular-nums shrink-0 text-muted-foreground">
                    ≈{new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0, notation: 'compact' }).format(p.estimated_amount)}
                  </span>
                  <span className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      title="Sí, es un pago fijo — crear la obligación"
                      className="h-5 w-5 rounded flex items-center justify-center text-success hover:bg-success/10"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); confirm.mutate(p); }}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="No es fijo — no volver a sugerirlo"
                      className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:bg-muted"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismiss.mutate(p); }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1 text-[11px] text-primary/70 group-hover:text-primary font-medium transition-colors pt-2.5">
            Ver calendario completo <ArrowRight className="h-3 w-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
