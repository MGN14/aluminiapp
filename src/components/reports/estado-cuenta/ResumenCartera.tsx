/**
 * Encabezado de Estado de cuenta: cuánto te deben (con sus edades), cuánto
 * tenés en anticipos y cuántos están al día. Cada bloque filtra la tabla.
 *
 * Edades de la cartera = barra segmentada (método dataviz): un todo partido
 * en partes, una sola tonalidad de claro (sin vencer) a oscuro (+90 días) —
 * la rampa ordinal validada de chartColors (ORDINAL_RAMP), 2px de separación
 * entre bloques, esquinas de 4px. Cada bloque tiene tooltip y es un botón;
 * la lista de abajo es la leyenda en el mismo orden y, con sus montos, la
 * vista en tabla de la barra.
 */
import { Link } from 'react-router-dom';
import { CheckCircle2, ExternalLink, HandCoins, Wallet } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { ORDINAL_RAMP } from '@/lib/chartColors';
import type { AgingBuckets } from '@/lib/agingBuckets';
import { cn } from '@/lib/utils';
import {
  TRAMOS, formatCompacto, formatCurrency,
  type EstadoFilter, type MoraFilter, type TramoMora,
} from './modelo';

/** Texto dentro de cada bloque: oscuro sobre los tonos claros, blanco sobre
 *  los oscuros. La rampa se invierte en modo oscuro, así que el texto también. */
const TEXTO_BLOQUE = [
  'text-slate-950 dark:text-white',
  'text-slate-950 dark:text-white',
  'text-white dark:text-slate-950',
  'text-white dark:text-slate-950',
  'text-white dark:text-slate-950',
];

interface Props {
  cargando: boolean;
  year: number;
  teDeben: number;
  nTeDeben: number;
  aFavor: number;
  nAFavor: number;
  nAlDia: number;
  facturado: number;
  cobrado: number;
  tramos: AgingBuckets | null;
  clientesPorTramo: Record<TramoMora, number>;
  estado: EstadoFilter;
  mora: MoraFilter;
  onEstado: (e: EstadoFilter) => void;
  onMora: (m: MoraFilter) => void;
}

export default function ResumenCartera(p: Props) {
  const total = p.tramos?.total ?? 0;
  const vencido = total - (p.tramos?.corriente ?? 0);
  const pctCobrado = p.facturado > 0 ? Math.round((p.cobrado / p.facturado) * 100) : 0;
  const activoTeDeben = p.estado === 'cxc';

  return (
    <section className="grid gap-3 lg:grid-cols-3">
      {/* ── Te deben + edades ─────────────────────────────────────────── */}
      <div
        className={cn(
          'lg:col-span-2 rounded-2xl border bg-card p-5 transition-colors',
          activoTeDeben ? 'border-red-500/50 ring-1 ring-red-500/25' : 'border-border',
        )}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => p.onEstado(activoTeDeben ? 'todos' : 'cxc')}
            className="group flex items-center gap-3 text-left rounded-lg -m-1 p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={activoTeDeben ? 'Quitar el filtro' : 'Ver solo los clientes que te deben'}
          >
            <span className="w-10 h-10 rounded-xl flex items-center justify-center bg-red-500/10 text-red-600 dark:text-red-400 shrink-0">
              <HandCoins className="h-5 w-5" strokeWidth={2.25} />
            </span>
            <span>
              <span className="block text-sm font-semibold text-foreground">Te deben</span>
              <span className="block text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                {p.cargando ? 'Calculando…' : `${p.nTeDeben} cliente${p.nTeDeben === 1 ? '' : 's'} · clic para ver solo ellos`}
              </span>
            </span>
          </button>
          <Link
            to="/reportes/cuentas-por-cobrar"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Cobranza con scores IA <ExternalLink className="h-3 w-3" />
          </Link>
        </div>

        {p.cargando ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-12 w-64" />
            <Skeleton className="h-7 w-full" />
          </div>
        ) : (
          <>
            <div className="mt-4 flex items-end gap-x-6 gap-y-1 flex-wrap">
              <p className="text-4xl sm:text-5xl font-semibold tracking-tight tabular-nums leading-none text-foreground">
                {formatCurrency(p.teDeben)}
              </p>
              <p className="text-xs text-muted-foreground pb-1">
                {vencido > 1
                  ? <><span className="font-semibold text-foreground tabular-nums">{formatCompacto(vencido)}</span> vencido · </>
                  : 'Nada vencido · '}
                cobrado el <span className="font-semibold text-foreground tabular-nums">{pctCobrado} %</span> de lo facturado en {p.year}
              </p>
            </div>

            {total > 1 ? (
              <div className="mt-5">
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Edad de la deuda · clic en un tramo para filtrar</p>
                <div className="flex h-7 w-full gap-[2px]" role="group" aria-label="Edades de la cartera">
                  {TRAMOS.map((t, i) => {
                    const v = p.tramos?.[t.key] ?? 0;
                    if (v <= 1) return null;
                    const share = v / total;
                    const activo = p.mora === t.key;
                    return (
                      <Tooltip key={t.key}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => p.onMora(activo ? 'todas' : t.key)}
                            aria-label={`${t.label}: ${formatCurrency(v)}, ${Math.round(share * 100)} %`}
                            className={cn(
                              'h-full rounded-[4px] flex items-center px-2 overflow-hidden transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                              p.mora !== 'todas' && !activo && 'opacity-35',
                              TEXTO_BLOQUE[i],
                            )}
                            style={{ width: `${share * 100}%`, minWidth: 6, background: ORDINAL_RAMP[i] }}
                          >
                            {share >= 0.11 && (
                              <span className={cn('text-xs font-semibold tabular-nums whitespace-nowrap', share < 0.2 && 'hidden sm:inline')}>{Math.round(share * 100)} %</span>
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          <p className="font-semibold">{t.label}</p>
                          <p className="tabular-nums">{formatCurrency(v)} · {Math.round(share * 100)} %</p>
                          <p className="text-muted-foreground">{p.clientesPorTramo[t.key]} cliente{p.clientesPorTramo[t.key] === 1 ? '' : 's'}</p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                  {TRAMOS.map((t, i) => {
                    const v = p.tramos?.[t.key] ?? 0;
                    const activo = p.mora === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        disabled={v <= 1}
                        onClick={() => p.onMora(activo ? 'todas' : t.key)}
                        className={cn(
                          'text-left rounded-lg border px-2.5 py-1.5 transition-colors disabled:opacity-50 disabled:cursor-default',
                          activo ? 'border-foreground/40 bg-muted' : 'border-border hover:bg-muted/60',
                        )}
                      >
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: ORDINAL_RAMP[i] }} />
                          {t.corto}
                        </span>
                        <span className="block text-sm font-semibold tabular-nums text-foreground mt-0.5">{v > 1 ? formatCompacto(v) : '—'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="mt-5 text-sm text-muted-foreground">Nadie te debe en {p.year}.</p>
            )}
          </>
        )}
      </div>

      {/* ── Anticipos + al día ───────────────────────────────────────── */}
      <div className="grid gap-3">
        <button
          type="button"
          onClick={() => p.onEstado(p.estado === 'anticipos' ? 'todos' : 'anticipos')}
          className={cn(
            'text-left rounded-2xl border bg-card p-5 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            p.estado === 'anticipos' ? 'border-sky-500/50 ring-1 ring-sky-500/25' : 'border-border',
          )}
        >
          <span className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center bg-sky-500/10 text-sky-700 dark:text-sky-300 shrink-0">
              <Wallet className="h-[18px] w-[18px]" strokeWidth={2.25} />
            </span>
            <span className="text-sm font-semibold text-foreground">Anticipos vivos</span>
          </span>
          {p.cargando ? <Skeleton className="h-8 w-40 mt-3" /> : (
            <span className="block text-2xl font-semibold tracking-tight tabular-nums mt-3 text-foreground">{formatCurrency(p.aFavor)}</span>
          )}
          <span className="block text-xs text-muted-foreground mt-1">
            {p.nAFavor} cliente{p.nAFavor === 1 ? '' : 's'} con saldo a favor: les debés factura
          </span>
          <Link
            to="/reportes/anticipos"
            onClick={(e) => e.stopPropagation()}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Conciliar anticipos iniciales <ExternalLink className="h-3 w-3" />
          </Link>
        </button>

        <button
          type="button"
          onClick={() => p.onEstado(p.estado === 'aldia' ? 'todos' : 'aldia')}
          className={cn(
            'text-left rounded-2xl border bg-card p-5 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            p.estado === 'aldia' ? 'border-emerald-500/50 ring-1 ring-emerald-500/25' : 'border-border',
          )}
        >
          <span className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 shrink-0">
              <CheckCircle2 className="h-[18px] w-[18px]" strokeWidth={2.25} />
            </span>
            <span className="text-sm font-semibold text-foreground">Al día</span>
          </span>
          {p.cargando ? <Skeleton className="h-8 w-24 mt-3" /> : (
            <span className="block text-2xl font-semibold tracking-tight tabular-nums mt-3 text-foreground">
              {p.nAlDia} cliente{p.nAlDia === 1 ? '' : 's'}
            </span>
          )}
          <span className="block text-xs text-muted-foreground mt-1">Facturado y pagado cuadran al peso</span>
        </button>
      </div>
    </section>
  );
}
