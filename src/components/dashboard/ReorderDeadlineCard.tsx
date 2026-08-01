import { Card, CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import { CalendarClock, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';
import { useReorderSuggestion } from '@/hooks/useReorderSuggestion';

/**
 * Card del Dashboard: SOLO la fecha límite para montar el próximo pedido
 * (pedido de Nico 2026-08-01: "fecha limite me gusta, solo fecha"). El
 * detalle completo (refs que quiebran, lead time, pipeline) sigue viviendo
 * en Importaciones — misma fuente: useReorderSuggestion, única verdad.
 */
export default function ReorderDeadlineCard() {
  const { isPending, suggestion } = useReorderSuggestion();

  if (isPending) {
    return (
      <Card className="h-full">
        <CardContent className="p-4 flex items-center justify-center h-full">
          <p className="text-xs text-muted-foreground">Cargando...</p>
        </CardContent>
      </Card>
    );
  }

  const fecha = suggestion?.fechaLimite ?? null;
  const dias = suggestion?.diasParaDecidir ?? null;
  const urgencia =
    dias == null ? 'text-foreground'
    : dias <= 7 ? 'text-destructive'
    : dias <= 15 ? 'text-amber-600 dark:text-amber-400'
    : 'text-foreground';

  return (
    <Link to="/importaciones" className="block group">
      <Card className="overflow-hidden h-full hover:border-primary/30 transition-colors">
        <CardContent className="p-4 h-full flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <CalendarClock className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">Montar próximo pedido</p>
              {fecha ? (
                <>
                  <p className={`text-xl font-bold mt-0.5 tabular-nums ${urgencia}`}>
                    {format(parseLocalDate(fecha), "d 'de' MMMM", { locale: es })}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {dias != null
                      ? dias <= 0 ? 'Es HOY — cada día corre la llegada' : `Quedan ${dias} día${dias !== 1 ? 's' : ''} para decidir`
                      : 'Fecha límite para no quebrar stock'}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-foreground mt-0.5">Sin fecha todavía</p>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-1">
                    Falta consumo o stock por variante para proyectar el quiebre.
                  </p>
                </>
              )}
            </div>
          </div>
          <span className="flex items-center justify-end gap-1 text-[11px] text-primary group-hover:underline mt-auto">
            Ver detalle en Importaciones <ArrowRight className="h-3 w-3" />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}
