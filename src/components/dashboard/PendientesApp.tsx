/**
 * "Pendientes en la app": lo que el usuario dejó de hacer EN la app (Siigo
 * caído, extractos atrasados, inventario sin contar, caja sin cerrar…).
 * Vive dentro de la tarjeta de Salud del Dashboard, en el hueco que quedaba
 * al lado de "Próximas obligaciones" (Nico 2026-11-12).
 *
 * Cada fila lleva a la pantalla donde se resuelve. "Posponer" la esconde 7
 * días en este navegador; no toca ningún dato.
 */
import { useNavigate } from 'react-router-dom';
import {
  Unplug, Receipt, Inbox, FileWarning, Boxes, Wallet, ListChecks, CheckCircle2, ArrowRight, BellOff,
  type LucideIcon,
} from 'lucide-react';
import { useRecordatoriosApp } from '@/hooks/useRecordatoriosApp';
import type { Recordatorio } from '@/lib/recordatoriosApp';
import { DashItem } from './cardKit';
import { cn } from '@/lib/utils';

const ICONO: Record<Recordatorio['id'], LucideIcon> = {
  siigo: Unplug,
  'facturas-venta': Receipt,
  'facturas-compra': Inbox,
  extractos: FileWarning,
  inventario: Boxes,
  'caja-menor': Wallet,
};

const TILE: Record<Recordatorio['nivel'], string> = {
  alarm: 'bg-destructive/15 text-destructive',
  warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
};

export default function PendientesApp() {
  const { recordatorios, loading, posponer } = useRecordatoriosApp();
  const navigate = useNavigate();

  if (loading) return null;

  return (
    <section className="mt-4 pt-4 border-t border-border/60" aria-label="Pendientes en la app">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5" strokeWidth={2.5} /> Pendientes en la app
        </span>
        {recordatorios.length > 0 && (
          <span className="text-xs font-bold tabular-nums px-2 py-0.5 rounded-full bg-muted text-foreground shrink-0">
            {recordatorios.length}
          </span>
        )}
      </div>

      {recordatorios.length === 0 ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-success/30 bg-success/[0.06] px-3 py-2.5">
          <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
          <p className="text-xs text-muted-foreground leading-snug">
            <span className="font-semibold text-foreground">Estás al día.</span> Extractos, facturas, inventario y caja sin tareas atrasadas.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {recordatorios.map((r) => {
            const Icon = ICONO[r.id];
            return (
              <DashItem
                key={r.id}
                urgency={r.nivel === 'alarm' ? 'critical' : 'week'}
                onClick={() => navigate(r.ruta)}
                leading={
                  <span className={cn('h-8 w-8 rounded-lg flex items-center justify-center shrink-0', TILE[r.nivel])}>
                    <Icon className="h-4 w-4" strokeWidth={2.25} />
                  </span>
                }
                title={r.titulo}
                // El verbo va en la línea del título: así el detalle usa todo
                // el ancho y no se parte en tres renglones a 4 columnas.
                value={
                  <span className="flex items-center gap-0.5 text-xs font-semibold text-primary">
                    {r.accion} <ArrowRight className="h-3 w-3" />
                  </span>
                }
                subtitle={r.detalle}
                actions={
                  <button
                    type="button"
                    title="Posponer 7 días (solo en este navegador)"
                    aria-label={`Posponer 7 días: ${r.titulo}`}
                    className="h-6 w-6 -my-1 rounded-md flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted"
                    onClick={(e) => { e.stopPropagation(); posponer(r.id); }}
                  >
                    <BellOff className="h-3.5 w-3.5" />
                  </button>
                }
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
