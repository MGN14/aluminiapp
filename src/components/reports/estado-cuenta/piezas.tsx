/**
 * Piezas visuales compartidas por la tabla y el panel de Estado de cuenta.
 * Estados y mora son colores de ESTADO (reservados): siempre van con ícono o
 * texto, nunca solo color. Texto mínimo de 12px; montos con tabular-nums.
 */
import { CheckCircle2, HandCoins, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { iniciales, type EstadoCliente } from './modelo';

export const ESTADO_UI: Record<EstadoCliente, {
  label: string; corto: string; icon: typeof HandCoins; pill: string; texto: string; barra: string;
}> = {
  cxc: {
    label: 'Te debe', corto: 'te debe', icon: HandCoins,
    pill: 'bg-red-500/10 text-red-700 ring-red-500/25 dark:text-red-300',
    texto: 'text-red-600 dark:text-red-400',
    barra: 'bg-red-500',
  },
  anticipos: {
    label: 'Anticipo', corto: 'a favor del cliente', icon: Wallet,
    pill: 'bg-sky-500/10 text-sky-800 ring-sky-500/25 dark:text-sky-300',
    texto: 'text-sky-700 dark:text-sky-300',
    barra: 'bg-sky-500',
  },
  aldia: {
    label: 'Al día', corto: 'al día', icon: CheckCircle2,
    pill: 'bg-emerald-500/10 text-emerald-800 ring-emerald-500/25 dark:text-emerald-300',
    texto: 'text-emerald-700 dark:text-emerald-400',
    barra: 'bg-emerald-500',
  },
};

export function EstadoPill({ estado, className }: { estado: EstadoCliente; className?: string }) {
  const e = ESTADO_UI[estado];
  const Icon = e.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', e.pill, className)}>
      <Icon className="h-3 w-3" strokeWidth={2.25} /> {e.label}
    </span>
  );
}

/** Días de mora con el tono de su tramo (mismos cortes que el aging). */
export function MoraPill({ dias, className }: { dias: number; className?: string }) {
  if (dias <= 0) {
    return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground whitespace-nowrap', className)}>Sin vencer</span>;
  }
  const tono = dias > 90 ? 'bg-red-600 text-white dark:bg-red-500 dark:text-red-950'
    : dias > 60 ? 'bg-red-500/15 text-red-700 dark:text-red-300'
    : dias > 30 ? 'bg-orange-500/15 text-orange-800 dark:text-orange-300'
    : 'bg-amber-500/15 text-amber-800 dark:text-amber-300';
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums whitespace-nowrap', tono, className)}>
      {dias} d vencida
    </span>
  );
}

export function Avatar({ nombre, estado }: { nombre: string; estado: EstadoCliente }) {
  return (
    <span className={cn(
      'h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold',
      estado === 'cxc' ? 'bg-red-500/10 text-red-700 dark:text-red-300'
        : estado === 'anticipos' ? 'bg-sky-500/10 text-sky-800 dark:text-sky-300'
        : 'bg-muted text-muted-foreground',
    )} aria-hidden>
      {iniciales(nombre)}
    </span>
  );
}

/** Barra fina de avance (cobrado ÷ facturado). Pista = paso más claro de la misma tonalidad. */
export function Avance({ valor, className }: { valor: number; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, valor)) * 100);
  return (
    <span className={cn('block h-1 w-full rounded-full bg-emerald-500/15', className)} aria-hidden>
      <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
    </span>
  );
}
