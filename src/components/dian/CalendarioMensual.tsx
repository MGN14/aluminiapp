import { useMemo, useState } from 'react';
import {
  CalendarEvent,
  TIPO_COLOR,
  TIPO_LABEL,
} from '@/lib/dianCalendar2026';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';

interface Props {
  events: CalendarEvent[];
  initialDate?: Date;
}

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// lunes como primer día de semana
function firstDayOffset(year: number, month: number): number {
  const d = new Date(year, month, 1).getDay(); // 0=Dom..6=Sáb
  return (d + 6) % 7; // 0=Lun..6=Dom
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function fmtMoney(n: number | null | undefined): string {
  if (!n) return '';
  return '$' + n.toLocaleString('es-CO');
}

export default function CalendarioMensual({ events, initialDate }: Props) {
  const [cursor, setCursor] = useState<Date>(() => initialDate ?? new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      if (ev.fecha.getFullYear() === year && ev.fecha.getMonth() === month) {
        const key = String(ev.fecha.getDate());
        const arr = map.get(key) || [];
        arr.push(ev);
        map.set(key, arr);
      }
    }
    return map;
  }, [events, year, month]);

  const offset = firstDayOffset(year, month);
  const total = daysInMonth(year, month);
  const cells: (number | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= total; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const today = new Date();
  const selectedEvents = selectedDay
    ? (eventsByDay.get(String(selectedDay.getDate())) || [])
    : [];

  const goPrev = () => setCursor(new Date(year, month - 1, 1));
  const goNext = () => setCursor(new Date(year, month + 1, 1));
  const goToday = () => { setCursor(new Date()); setSelectedDay(new Date()); };

  return (
    <div className="space-y-4">
      {/* Header navegación */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold capitalize">
            {MESES[month]} {year}
          </h3>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={goPrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>
            Hoy
          </Button>
          <Button variant="outline" size="sm" onClick={goNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Días de semana */}
      <div className="grid grid-cols-7 gap-1 text-xs font-medium text-muted-foreground">
        {DIAS_SEMANA.map(d => (
          <div key={d} className="px-2 py-1 text-center">{d}</div>
        ))}
      </div>

      {/* Grilla del mes */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) {
            return <div key={i} className="aspect-square min-h-[90px] bg-muted/20 rounded border border-dashed border-transparent" />;
          }
          const dayDate = new Date(year, month, d);
          const dayEvents = eventsByDay.get(String(d)) || [];
          const isToday = sameDay(dayDate, today);
          const isSelected = selectedDay && sameDay(dayDate, selectedDay);

          return (
            <button
              key={i}
              onClick={() => setSelectedDay(dayDate)}
              className={`aspect-square min-h-[90px] p-1.5 rounded border text-left transition-colors relative flex flex-col gap-1 ${
                isSelected
                  ? 'border-foreground ring-1 ring-foreground bg-background'
                  : isToday
                  ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/20'
                  : 'border-border hover:bg-muted/40 bg-background'
              }`}
            >
              <span className={`text-xs font-medium ${isToday ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                {d}
              </span>
              <div className="flex-1 flex flex-col gap-0.5 overflow-hidden">
                {dayEvents.slice(0, 3).map(ev => (
                  <span
                    key={ev.id}
                    className={`text-[9px] leading-tight px-1 py-0.5 rounded border truncate ${TIPO_COLOR[ev.tipo]}`}
                    title={ev.descripcion}
                  >
                    {TIPO_LABEL[ev.tipo]}
                  </span>
                ))}
                {dayEvents.length > 3 && (
                  <span className="text-[9px] text-muted-foreground">+{dayEvents.length - 3} más</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Detalle día seleccionado */}
      {selectedDay && (
        <div className="border rounded-lg p-4 bg-muted/20">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold capitalize">
              {selectedDay.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            <button
              onClick={() => setSelectedDay(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cerrar
            </button>
          </div>
          {selectedEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin obligaciones este día.</p>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map(ev => (
                <div key={ev.id} className={`p-3 rounded border ${TIPO_COLOR[ev.tipo]}`}>
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className="text-[10px] shrink-0 bg-background">
                      {TIPO_LABEL[ev.tipo]}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{ev.descripcion}</p>
                      <p className="text-xs opacity-80 mt-0.5">
                        {ev.periodo}
                        {ev.monto ? ` · ${fmtMoney(ev.monto)}` : ''}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Leyenda */}
      <div className="flex flex-wrap gap-2 pt-2 border-t">
        <span className="text-xs text-muted-foreground mr-2">Leyenda:</span>
        {(['iva','retefuente','renta','ica','arriendo','nomina','pila','servicios'] as const).map(t => (
          <span key={t} className={`text-[10px] px-2 py-0.5 rounded border ${TIPO_COLOR[t]}`}>
            {TIPO_LABEL[t]}
          </span>
        ))}
      </div>
    </div>
  );
}
