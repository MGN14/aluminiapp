import { CalendarClock } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';
import { useReorderSuggestion } from '@/hooks/useReorderSuggestion';
import { MetricCard, DashLoading, Pill, PILL, urgencyOf, type Tone } from './cardKit';

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
  const valueColor =
    tone === 'alarm' ? 'text-destructive'
    : tone === 'warn' ? 'text-amber-600 dark:text-amber-400'
    : 'text-foreground';

  return (
    <MetricCard
      icon={CalendarClock}
      tone={tone}
      title="Montar próximo pedido"
      badge={fecha && dias != null ? <Pill className={PILL[urgencyOf(dias)]}>{dias <= 0 ? 'Hoy' : `${dias} días`}</Pill> : undefined}
      value={fecha ? format(parseLocalDate(fecha), "d 'de' MMMM", { locale: es }) : 'Sin fecha todavía'}
      valueClassName={fecha ? valueColor : 'text-foreground text-lg'}
      subtitle={
        fecha
          ? (dias != null
              ? dias <= 0 ? 'Es HOY: cada día que pasa corre la llegada' : `Quedan ${dias} día${dias !== 1 ? 's' : ''} para decidir`
              : 'Fecha límite para no quebrar stock')
          : 'Falta consumo o stock por variante para proyectar el quiebre.'
      }
      note={fecha ? 'Quiebre proyectado por variante, menos tránsito y aduana.' : undefined}
      link={{ to: '/importaciones', label: 'Ver detalle en Importaciones' }}
    />
  );
}
