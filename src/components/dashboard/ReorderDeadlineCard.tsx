import { CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import { CalendarClock } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';
import { useReorderSuggestion } from '@/hooks/useReorderSuggestion';
import { DashCard, DashHeader, DashBig, DashFooter, DashLoading, Pill, PILL, urgencyOf, type Tone } from './cardKit';

/**
 * Card del Dashboard: SOLO la fecha límite para montar el próximo pedido
 * (pedido de Nico 2026-08-01: "fecha limite me gusta, solo fecha"). El
 * detalle completo (refs que quiebran, lead time, pipeline) sigue viviendo
 * en Importaciones — misma fuente: useReorderSuggestion, única verdad.
 */
export default function ReorderDeadlineCard() {
  const { isPending, suggestion } = useReorderSuggestion();

  if (isPending) return <DashLoading lines={1} />;

  const fecha = suggestion?.fechaLimite ?? null;
  const dias = suggestion?.diasParaDecidir ?? null;
  const tone: Tone =
    dias == null ? 'default'
    : dias <= 7 ? 'alarm'
    : dias <= 15 ? 'warn'
    : 'default';
  const bigColor =
    tone === 'alarm' ? 'text-destructive'
    : tone === 'warn' ? 'text-amber-600 dark:text-amber-400'
    : 'text-foreground';

  return (
    <Link to="/importaciones" className="block group h-full">
      <DashCard tone={tone}>
        <CardContent className="p-4 sm:p-5 h-full flex flex-col">
          <DashHeader
            icon={CalendarClock}
            tone={tone}
            title="Montar próximo pedido"
            subtitle={
              fecha
                ? (dias != null
                    ? dias <= 0 ? 'Es HOY — cada día corre la llegada' : `Quedan ${dias} día${dias !== 1 ? 's' : ''} para decidir`
                    : 'Fecha límite para no quebrar stock')
                : 'Falta consumo o stock por variante para proyectar el quiebre.'
            }
            right={
              fecha && dias != null
                ? <Pill className={PILL[urgencyOf(dias)]}>{dias <= 0 ? 'Hoy' : `${dias} días`}</Pill>
                : undefined
            }
          >
            {fecha ? (
              <DashBig className={bigColor}>
                {format(parseLocalDate(fecha), "d 'de' MMMM", { locale: es })}
              </DashBig>
            ) : (
              <p className="text-base font-bold text-foreground mt-0.5">Sin fecha todavía</p>
            )}
          </DashHeader>

          {fecha && (
            <p className="text-xs text-muted-foreground leading-snug rounded-xl border border-border/60 bg-card/60 px-3 py-2">
              Fecha límite para montar el pedido sin quebrar stock: quiebre proyectado por variante menos el tiempo de tránsito y aduana.
            </p>
          )}

          <DashFooter>Ver detalle en Importaciones</DashFooter>
        </CardContent>
      </DashCard>
    </Link>
  );
}
