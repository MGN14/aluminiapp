import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarClock, AlertTriangle } from 'lucide-react';
import { useUpcomingObligations, diasRestantes } from '@/hooks/useUpcomingObligations';
import { usePaidObligations } from '@/hooks/usePaidObligations';
import { TIPO_LABEL } from '@/lib/dianCalendar2026';

const MAX_ITEMS = 5;
const UPCOMING_WINDOW_DAYS = 45;

function urgencyColor(days: number): string {
  if (days <= 3) return 'text-destructive';
  if (days <= 7) return 'text-orange-600 dark:text-orange-400';
  if (days <= 15) return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

function urgencyBg(days: number): string {
  if (days <= 3) return 'bg-destructive/5 border-destructive/30';
  if (days <= 7) return 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900/50';
  return 'bg-card border-border/50';
}

export default function UpcomingObligationsCard() {
  const { events, nitDigit } = useUpcomingObligations(UPCOMING_WINDOW_DAYS);
  const { isPaid, togglePaid } = usePaidObligations();

  const upcoming = useMemo(() => {
    return events
      .filter(ev => {
        const d = diasRestantes(ev.fecha);
        return d >= 0 && d <= UPCOMING_WINDOW_DAYS && !isPaid(ev);
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

  // Sin obligaciones próximas.
  if (upcoming.length === 0) {
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

  return (
    <Link to="/visita-dian" className="block group">
      <Card className={`overflow-hidden border hover:border-primary/30 transition-colors cursor-pointer h-full ${hasCritical ? 'border-destructive/30' : 'border-border'}`}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              {hasCritical ? (
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
                    {dias === 0 ? '¡Hoy!' : dias === 1 ? 'Mañana' : `${dias}d`}
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

          <div className="flex items-center gap-1 text-[11px] text-primary/70 group-hover:text-primary font-medium transition-colors pt-2.5">
            Ver calendario completo <ArrowRight className="h-3 w-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
