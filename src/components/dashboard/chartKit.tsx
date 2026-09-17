/**
 * Cromado común de las gráficas del Dashboard (método dataviz):
 * grilla en línea fina sólida y recesiva, ejes sin trazo, ticks en tinta
 * atenuada de 12px, marcas finas (barras ≤ 24px con 4px de radio arriba),
 * separación de 2px en color de superficie entre segmentos apilados, tooltip
 * donde el VALOR manda y la serie acompaña con una raya de su color, y una
 * vista de TABLA gemela para cada gráfica (todo valor es alcanzable sin hover).
 */
import type { ReactNode } from 'react';
import { CardHeader } from '@/components/ui/card';
import type { LucideIcon } from 'lucide-react';
import { DashTile, type Tone } from './cardKit';
import { CHART_COLORS } from '@/lib/chartColors';
import { cn } from '@/lib/utils';

export const CHART_HEIGHT = 300;

/** Props de ejes y grilla listas para esparcir en Recharts. */
export const gridProps = { stroke: CHART_COLORS.grid, strokeWidth: 1, vertical: false } as const;
export const tickStyle = { fontSize: 12, fill: CHART_COLORS.inkMuted } as const;
export const xAxisProps = { tick: tickStyle, axisLine: { stroke: CHART_COLORS.axis, strokeWidth: 1 }, tickLine: false } as const;
export const yAxisProps = { tick: tickStyle, axisLine: false, tickLine: false, width: 64 } as const;
/** Barras finas con remate redondeado arriba, cuadradas en la base. */
export const BAR_MAX = 24;
export const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
/** Separación de 2px en color de superficie entre segmentos apilados / barras vecinas. */
export const surfaceGap = { stroke: 'hsl(var(--card))', strokeWidth: 2 } as const;
export const hoverCursor = { fill: 'hsl(var(--muted))', fillOpacity: 0.35 } as const;

export const fmtCopFull = (value: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
/** Compacto en millones con punto de miles: $1.160M, $360M, $18,5M, $400K. */
export const fmtCopShort = (value: number) => {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: abs >= 100_000_000 ? 0 : 1 })}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toLocaleString('es-CO', { maximumFractionDigits: 0 })}K`;
  return `${sign}$${abs.toFixed(0)}`;
};

/**
 * Etiqueta al final de una barra HORIZONTAL (layout vertical de Recharts),
 * dibujada a mano para que no se parta en dos líneas cuando la barra es
 * corta (el <Text> de Recharts envuelve por el ancho de la barra).
 */
export function endLabel(text: (index: number) => string | null) {
  return (props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; index?: number }) => {
    const t = props.index != null ? text(props.index) : null;
    if (!t) return null;
    const x = Number(props.x) + Number(props.width) + 6;
    const y = Number(props.y) + Number(props.height) / 2;
    return <text x={x} y={y} dominantBaseline="central" textAnchor="start" fontSize={11} fontWeight={600} fill="hsl(var(--muted-foreground))">{t}</text>;
  };
}

/** Encabezado de gráfica: cuadro de ícono + título 17px + subtítulo + filtros. */
export function ChartHeader({ icon, tone = 'default', tileClassName, title, subtitle, right }: {
  icon: LucideIcon; tone?: Tone; tileClassName?: string; title: string; subtitle?: ReactNode; right?: ReactNode;
}) {
  return (
    <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <DashTile icon={icon} tone={tone} className={tileClassName} />
        <div className="min-w-0">
          <p className="text-[17px] font-bold tracking-tight text-foreground leading-tight">{title}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </CardHeader>
  );
}

/** Contenedor del tooltip. */
export function TipBox({ title, titleRight, children, minWidth = 200 }: { title: ReactNode; titleRight?: ReactNode; children: ReactNode; minWidth?: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-xs shadow-lg" style={{ minWidth }}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="font-semibold text-foreground">{title}</p>
        {titleRight && <span className="text-muted-foreground tabular-nums">{titleRight}</span>}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

/** Fila del tooltip: raya del color de la serie, nombre en secundario, VALOR en negrita. */
export function TipRow({ color, label, value, sub, muted, className }: { color?: string; label: ReactNode; value: ReactNode; sub?: ReactNode; muted?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <span className={cn('flex items-center gap-2 min-w-0', muted ? 'text-muted-foreground' : 'text-muted-foreground')}>
        {color && <span className="inline-block w-3 h-0.5 rounded-full shrink-0" style={{ background: color }} />}
        <span className="truncate">{label}</span>
      </span>
      <span className="text-right shrink-0">
        <span className={cn('tabular-nums', muted ? 'text-muted-foreground' : 'font-bold text-foreground')}>{value}</span>
        {sub && <span className="ml-1.5 text-muted-foreground tabular-nums">{sub}</span>}
      </span>
    </div>
  );
}

/** Leyenda: rectángulo para barras/áreas, raya para líneas; texto en tinta, nunca en el color. */
export function ChartLegend({ items, className }: { items: Array<{ color: string; label: string; shape?: 'rect' | 'line' | 'dash'; value?: string }>; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 mt-2', className)}>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {it.shape === 'line'
            ? <span className="inline-block w-4 h-0.5 rounded-full" style={{ background: it.color }} />
            : it.shape === 'dash'
              ? <span className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: it.color }} />
              : <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: it.color }} />}
          <span>{it.label}</span>
          {it.value && <span className="tabular-nums font-medium text-foreground/80">{it.value}</span>}
        </span>
      ))}
    </div>
  );
}

export interface TableColumn<Row> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (row: Row) => ReactNode;
}

/** Vista de tabla gemela de una gráfica: mismos datos, sin hover. */
export function ChartDataTable<Row>({ columns, rows, rowKey, footer, maxHeight = CHART_HEIGHT + 24 }: {
  columns: TableColumn<Row>[]; rows: Row[]; rowKey: (row: Row, i: number) => string; footer?: Row; maxHeight?: number;
}) {
  return (
    <div className="rounded-xl border border-border overflow-auto" style={{ maxHeight }}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted/60 backdrop-blur text-muted-foreground">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cn('px-3 py-2 font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap', c.align === 'right' ? 'text-right' : 'text-left')}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} className="border-t border-border/60 hover:bg-muted/30">
              {columns.map((c) => (
                <td key={c.key} className={cn('px-3 py-2 whitespace-nowrap', c.align === 'right' ? 'text-right tabular-nums' : 'text-left')}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
          {footer && (
            <tr className="border-t-2 border-border bg-muted/30 font-bold">
              {columns.map((c) => (
                <td key={c.key} className={cn('px-3 py-2 whitespace-nowrap', c.align === 'right' ? 'text-right tabular-nums' : 'text-left')}>{c.render(footer)}</td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Estado vacío de una gráfica, a la altura del plot. */
export function ChartEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center text-sm text-muted-foreground rounded-xl border border-dashed border-border" style={{ height: CHART_HEIGHT }}>
      {children}
    </div>
  );
}
