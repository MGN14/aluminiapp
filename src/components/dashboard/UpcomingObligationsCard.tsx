import { useMemo } from 'react';
import { CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Link } from 'react-router-dom';
import {
  CalendarClock, AlertTriangle, Sparkles, Check, X,
  Receipt, Percent, Landmark, Building2, Home, Users, ShieldCheck, Zap,
  Briefcase, PiggyBank, CreditCard, HandCoins, Ship, CircleDot, type LucideIcon,
} from 'lucide-react';
import { useUpcomingObligations } from '@/hooks/useUpcomingObligations';
import { usePaidObligations } from '@/hooks/usePaidObligations';
import { usePredictedObligations } from '@/hooks/usePredictedObligations';
import { TIPO_LABEL, type CalendarEvent, type ObligacionTipo } from '@/lib/dianCalendar2026';
import { diasRestantes, sumaMontos, ventanasObligaciones, DIAS_SEMANA } from '@/lib/obligationWindows';
import { cn } from '@/lib/utils';
import { DashCard, DashHeader, DashItem, DashFooter, DashEmpty, UrgencyPill, urgencyOf, fmtCop, fmtFecha, type Urgency } from './cardKit';

const MAX_ITEMS = 5;

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

/** Fondo de las cajas del encabezado: como ROW_BG pero sin hover (la
 *  tarjeta entera es un link, no queremos que "respiren" solas). */
const VENTANA_BG: Record<Urgency, string> = {
  overdue: 'bg-destructive/10 border-destructive/40',
  critical: 'bg-destructive/[0.06] border-destructive/30',
  soon: 'bg-orange-500/[0.07] border-orange-300/70 dark:border-orange-800/60',
  week: 'bg-amber-500/[0.06] border-amber-300/60 dark:border-amber-800/50',
  later: 'bg-background/50 border-border/60',
};

/**
 * Caja de ventana del encabezado: cuántas obligaciones y cuánta plata.
 * Nico (2026-10-22): "ese dato de 'en 45 días' no me sirve de nada; hazlo
 * por este mes y por los próximos 7 días". Pensada para 4 columnas (~130 px
 * por caja): el monto no se trunca, el rótulo sí.
 */
function Ventana({ label, items, urgency = 'later' }: { label: string; items: CalendarEvent[]; urgency?: Urgency }) {
  const n = items.length;
  const total = sumaMontos(items);
  return (
    <div className={cn('rounded-xl border px-3 py-2 min-w-0', VENTANA_BG[urgency])}>
      <p className="text-xs font-semibold text-muted-foreground truncate">{label}</p>
      <p className={cn('text-[15px] font-extrabold tabular-nums tracking-tight leading-tight mt-0.5 whitespace-nowrap', total > 0 ? 'text-foreground' : 'text-muted-foreground/60')}>
        {total > 0 ? `≈ ${fmtCop(total)}` : '—'}
      </p>
      <p className="text-xs text-muted-foreground mt-0.5 truncate">
        {n === 0 ? 'Sin vencimientos' : `${n} ${n === 1 ? 'obligación' : 'obligaciones'}`}
      </p>
    </div>
  );
}

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
  const { events, nitDigit } = useUpcomingObligations();
  const { isPaid, togglePaid } = usePaidObligations();
  // Gastos recurrentes detectados en la conciliación (estimados, nunca DIAN).
  const { predicted, confirm, dismiss } = usePredictedObligations();

  // Solo pendientes (el checkbox de "pagada" las saca), repartidas en las
  // ventanas que sí sirven: vencidas, próximos 7 días y lo que va del mes.
  // La lista trae vencidas primero (más vencida arriba) y luego por fecha.
  const { vencidas, semana, mes, lista } = useMemo(
    () => ventanasObligaciones(events.filter(ev => !isPaid(ev))),
    [events, isPaid],
  );
  const upcoming = lista.slice(0, MAX_ITEMS);
  const ocultas = lista.length - upcoming.length;
  const mesCorto = new Date().toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');
  // La caja de la semana toma el color de lo más cercano a vencer.
  const urgenciaSemana: Urgency = semana.length
    ? urgencyOf(Math.min(...semana.map(ev => diasRestantes(ev.fecha))))
    : 'later';

  // Estado sin configurar: CTA suave.
  if (nitDigit === null) {
    return (
      <Link to="/visita-dian" className="block group h-full">
        <DashEmpty
          icon={CalendarClock}
          tone="muted"
          title="Próximas obligaciones"
          headline="Configura tu NIT"
          hint="Activa el calendario DIAN con el último dígito de tu NIT."
          cta="Configurar ahora"
        />
      </Link>
    );
  }

  // Sin obligaciones próximas (ni predichos que mostrar).
  if (lista.length === 0 && predicted.length === 0) {
    return (
      <Link to="/visita-dian" className="block group h-full">
        <DashEmpty
          icon={CalendarClock}
          tone="success"
          title="Próximas obligaciones"
          headline="Todo tranquilo"
          hint={`No tenés vencimientos en los próximos ${DIAS_SEMANA} días ni en lo que queda del mes.`}
          cta="Ver calendario completo"
        />
      </Link>
    );
  }

  const worst = lista.reduce<Urgency>((acc, ev) => {
    const u = urgencyOf(diasRestantes(ev.fecha));
    const rank: Record<Urgency, number> = { overdue: 0, critical: 1, soon: 2, week: 3, later: 4 };
    return rank[u] < rank[acc] ? u : acc;
  }, 'later');
  const alarm = worst === 'overdue' || worst === 'critical' || worst === 'soon';

  return (
    <Link to="/visita-dian" className="block group h-full">
      <DashCard tone={alarm ? 'alarm' : 'default'}>
        <CardContent className="p-4 sm:p-5 h-full flex flex-col">
          {/* Encabezado: qué es + vencidas sin pagar */}
          <DashHeader
            icon={alarm ? AlertTriangle : CalendarClock}
            tone={alarm ? 'alarm' : 'default'}
            title="Próximas obligaciones"
            subtitle={
              vencidas.length
                ? <span className="text-destructive font-semibold">{vencidas.length} {vencidas.length === 1 ? 'vencida' : 'vencidas'} sin pagar</span>
                : `Próximos ${DIAS_SEMANA} días y mes en curso`
            }
          />

          {/* Las dos ventanas que pidió Nico: cuánto sale esta semana y cuánto
              en el mes. Suman TODO lo pendiente de la ventana, no solo las 5
              filas que caben abajo. */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <Ventana label={`Próximos ${DIAS_SEMANA} días`} items={semana} urgency={urgenciaSemana} />
            <Ventana label={`Este mes · ${mesCorto}`} items={mes} />
          </div>

          <div className="space-y-2">
            {upcoming.map(ev => {
              const dias = diasRestantes(ev.fecha);
              const u = urgencyOf(dias);
              const hasMonto = ev.monto != null && ev.monto > 0;
              // Estimado en $0 (saldo a favor cubre el período) ≠ sin dato.
              const esCeroEstimado = !hasMonto && ev.montoEstimado && ev.monto === 0;
              return (
                <DashItem
                  key={ev.id}
                  urgency={u}
                  titleAttr={ev.detalle ?? ev.descripcion}
                  leading={
                    <>
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
                    </>
                  }
                  title={ev.descripcion}
                  value={
                    <span className={hasMonto ? undefined : esCeroEstimado ? 'text-success' : 'text-muted-foreground/60'}>
                      {hasMonto ? `${ev.montoEstimado ? '≈ ' : ''}${fmtCop(ev.monto!)}` : esCeroEstimado ? '≈ $0' : '—'}
                    </span>
                  }
                  subtitle={
                    <>
                      <span className="font-medium text-foreground/70">{TIPO_LABEL[ev.tipo]}</span>
                      {' · '}
                      {fmtFecha(ev.fecha)}
                      {ev.detalle ? ` · ${ev.detalle}` : ''}
                    </>
                  }
                  pill={<UrgencyPill days={dias} />}
                />
              );
            })}
          </div>
          {ocultas > 0 && (
            <p className="text-xs text-muted-foreground mt-2 px-1">
              +{ocultas} más en el calendario
            </p>
          )}

          {/* Predichos desde la conciliación — SIEMPRE marcados "estimado":
              una fecha DIAN es ley, esta es estadística de tus propios pagos. */}
          {predicted.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/60 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" /> Detectado en tus pagos
              </p>
              {predicted.map((p) => (
                <DashItem
                  key={p.pattern_key}
                  className="border-dashed bg-muted/20 hover:bg-muted/40"
                  titleAttr={`Se repitió ${p.occurrences} veces, cada ~${p.frequency_days} días (confianza ${Math.round(p.confidence * 100)}%).`}
                  leading={
                    <span className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Sparkles className="h-4 w-4" strokeWidth={2.25} />
                    </span>
                  }
                  title={p.description}
                  value={`≈ ${fmtCop(p.estimated_amount)}`}
                  subtitle={`Estimado · ${p.occurrences} pagos cada ~${p.frequency_days} días`}
                  pill={<UrgencyPill days={p.days_until} />}
                  actions={
                    <span className="flex items-center gap-1 shrink-0">
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
                  }
                />
              ))}
            </div>
          )}

          <DashFooter note="≈ estimado con tus facturas; el contador cierra la cifra">Ver calendario completo</DashFooter>
        </CardContent>
      </DashCard>
    </Link>
  );
}
