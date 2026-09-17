/**
 * Kit visual de las tarjetas del Dashboard (pedido de Nico 2026-09-16/17:
 * "el diseño nuevo me gustó, haz el mismo trabajo con los otros banners").
 * Un solo lenguaje: tarjeta redondeada con degradado suave según el tono,
 * cuadro de ícono grande, título en negrita, número grande tabular, filas
 * con borde y píldora de urgencia de alto contraste, pie con link.
 */
import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRight, Info, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

export type Tone = 'default' | 'alarm' | 'warn' | 'success' | 'muted';

const CARD_TONE: Record<Tone, string> = {
  default: 'border-border bg-gradient-to-br from-primary/[0.04] via-card to-card hover:border-primary/40',
  alarm: 'border-destructive/30 bg-gradient-to-br from-destructive/[0.07] via-card to-card hover:border-destructive/50',
  warn: 'border-amber-300/60 dark:border-amber-800/50 bg-gradient-to-br from-amber-500/[0.08] via-card to-card hover:border-amber-400/70',
  success: 'border-success/30 bg-gradient-to-br from-success/10 via-card to-card hover:border-success/50',
  muted: 'border-border bg-card hover:border-primary/30',
};

const TILE_TONE: Record<Tone, string> = {
  default: 'bg-primary/10 text-primary',
  alarm: 'bg-destructive/15 text-destructive',
  warn: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  success: 'bg-success/15 text-success',
  muted: 'bg-muted/60 text-muted-foreground',
};

export function DashCard({ tone = 'default', className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <Card className={cn('overflow-hidden border transition-colors cursor-pointer h-full rounded-2xl', CARD_TONE[tone], className)}>
      {children}
    </Card>
  );
}

/** Cuadro de ícono grande del encabezado (o chico en filas con `size="sm"`). */
export function DashTile({ icon: Icon, tone = 'default', className, size = 'md' }: { icon: LucideIcon; tone?: Tone; className?: string; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'rounded-2xl flex items-center justify-center shrink-0',
        size === 'md' ? 'w-11 h-11' : 'w-9 h-9 rounded-xl',
        TILE_TONE[tone],
        className,
      )}
    >
      <Icon className={size === 'md' ? 'h-5 w-5' : 'h-4 w-4'} strokeWidth={2.25} />
    </span>
  );
}

export function DashHeader({ icon, tone = 'default', tileClassName, title, subtitle, right, children }: {
  icon: LucideIcon; tone?: Tone; tileClassName?: string; title: string; subtitle?: ReactNode; right?: ReactNode; children?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="flex items-start gap-3 min-w-0">
        <DashTile icon={icon} tone={tone} className={tileClassName} />
        <div className="min-w-0">
          <p className="text-[15px] font-bold tracking-tight text-foreground leading-tight">{title}</p>
          {children}
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/** Número grande del encabezado. */
export function DashBig({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-2xl font-extrabold tracking-tight tabular-nums leading-tight mt-0.5 text-foreground', className)}>{children}</p>;
}

export type Urgency = 'overdue' | 'critical' | 'soon' | 'week' | 'later';

export function urgencyOf(days: number): Urgency {
  if (days < 0) return 'overdue';
  if (days <= 1) return 'critical';
  if (days <= 3) return 'soon';
  if (days <= 7) return 'week';
  return 'later';
}

/** Fondo de la fila: la urgencia se ve antes de leer. */
export const ROW_BG: Record<Urgency, string> = {
  overdue: 'bg-destructive/10 border-destructive/40 hover:bg-destructive/15',
  critical: 'bg-destructive/[0.06] border-destructive/30 hover:bg-destructive/10',
  soon: 'bg-orange-500/[0.07] border-orange-300/70 dark:border-orange-800/60 hover:bg-orange-500/10',
  week: 'bg-amber-500/[0.06] border-amber-300/60 dark:border-amber-800/50 hover:bg-amber-500/10',
  later: 'bg-card border-border/60 hover:bg-muted/40',
};

/** Píldora de días: contraste alto, se lee desde lejos. */
export const PILL: Record<Urgency, string> = {
  overdue: 'bg-destructive text-destructive-foreground',
  critical: 'bg-destructive text-destructive-foreground',
  soon: 'bg-orange-500 text-white',
  week: 'bg-amber-400 text-amber-950',
  later: 'bg-muted text-muted-foreground',
};

export function pillLabel(days: number, overdueWord = 'Vencida'): string {
  if (days < 0) return `${overdueWord} ${Math.abs(days)}d`;
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  return `${days} días`;
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full leading-none whitespace-nowrap', className)}>
      {children}
    </span>
  );
}

export function UrgencyPill({ days, overdueWord }: { days: number; overdueWord?: string }) {
  return <Pill className={PILL[urgencyOf(days)]}>{pillLabel(days, overdueWord)}</Pill>;
}

/** Fila estándar: borde, radio, fondo según urgencia (o neutro). */
export function DashRow({ children, urgency = 'later', className, title }: { children: ReactNode; urgency?: Urgency; className?: string; title?: string }) {
  return (
    <div className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 border transition-colors', ROW_BG[urgency], className)} title={title}>
      {children}
    </div>
  );
}

/**
 * Fila de lista en DOS líneas — pensada para tarjetas angostas (4 columnas
 * ≈ 300 px, Nico 2026-09-17: "los textos no se ven, están muy apretados"):
 *   línea 1: [leading] título ················ valor
 *   línea 2:           detalle ··············· píldora · acciones
 * El título y el detalle usan todo el ancho que dejan el chip y el valor.
 */
export function DashItem({ leading, title, subtitle, value, pill, actions, urgency = 'later', titleAttr, className, onClick }: {
  leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; value?: ReactNode; pill?: ReactNode; actions?: ReactNode;
  urgency?: Urgency; titleAttr?: string; className?: string; onClick?: () => void;
}) {
  return (
    <div
      className={cn('rounded-xl px-3 py-2.5 border transition-colors', ROW_BG[urgency], onClick && 'cursor-pointer', className)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {leading}
        <p className="text-[13px] font-semibold text-foreground leading-tight truncate flex-1 min-w-0" title={titleAttr ?? (typeof title === 'string' ? title : undefined)}>{title}</p>
        {value != null && <span className="text-[14px] font-bold tabular-nums leading-none text-foreground shrink-0 whitespace-nowrap">{value}</span>}
      </div>
      {(subtitle || pill || actions) && (
        <div className="flex items-center gap-2 mt-1.5 min-w-0">
          <p className="text-xs text-muted-foreground leading-snug truncate flex-1 min-w-0">{subtitle}</p>
          {pill}
          {actions}
        </div>
      )}
    </div>
  );
}

/** Chip de referencia (2026-2, VR25…) para el `leading` de una fila. */
export function DashChip({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={cn('inline-flex items-center h-7 px-2 rounded-lg text-[11px] font-bold tracking-tight shrink-0 whitespace-nowrap', className)} title={title}>
      {children}
    </span>
  );
}

/** Pie: nota chica (opcional) + link. Si no caben en una línea, la nota
 *  pasa arriba entera en vez de truncarse. */
export function DashFooter({ note, children }: { note?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-3 mt-auto">
      {note && <span className="text-[11px] text-muted-foreground leading-snug min-w-0">{note}</span>}
      <span className="flex items-center gap-1 text-xs text-primary/80 group-hover:text-primary font-semibold transition-colors shrink-0 ml-auto">
        {children} <ArrowRight className="h-3.5 w-3.5" />
      </span>
    </div>
  );
}

/** Estado vacío / CTA: mismo encabezado, mensaje en negrita y pista. */
export function DashEmpty({ icon, title, headline, hint, cta, tone = 'muted' }: {
  icon: LucideIcon; title: string; headline: string; hint: string; cta: string; tone?: Tone;
}) {
  return (
    <DashCard tone={tone}>
      <CardContent className="p-4 sm:p-5 h-full flex flex-col justify-center">
        <div className="flex items-start gap-3">
          <DashTile icon={icon} tone={tone === 'muted' ? 'muted' : tone} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
            <p className="text-base font-bold text-foreground mt-0.5">{headline}</p>
            <p className="text-xs text-muted-foreground leading-snug mt-1">{hint}</p>
            <div className="flex items-center gap-1 text-xs text-primary/80 group-hover:text-primary font-semibold transition-colors pt-2">
              {cta} <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </div>
        </div>
      </CardContent>
    </DashCard>
  );
}

export function DashLoading({ lines = 3 }: { lines?: number }) {
  return (
    <Card className="h-full rounded-2xl border-border">
      <CardContent className="p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-3">
          <Skeleton className="w-11 h-11 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
        {Array.from({ length: lines }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-xl" />)}
      </CardContent>
    </Card>
  );
}


/**
 * Tarjeta de MÉTRICA (Facturado, IVA, Retefuente, 4x1000…): etiqueta en
 * mayúsculas chicas, número grande, subtítulo, nota opcional y link opcional.
 */
export function MetricCard({ icon, tone = 'default', tileClassName, title, badge, value, valueClassName, subtitle, note, link, children, className }: {
  icon: LucideIcon; tone?: Tone; tileClassName?: string; title: string; badge?: ReactNode; value: ReactNode; valueClassName?: string;
  subtitle?: ReactNode; note?: ReactNode; link?: { to: string; label: string }; children?: ReactNode; className?: string;
}) {
  return (
    <DashCard tone={tone} className={cn(!link && 'cursor-default', className)}>
      <CardContent className="p-4 sm:p-5 h-full flex flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2 flex-wrap">
              <span>{title}</span>
              {badge}
            </p>
            <p className={cn('text-2xl font-extrabold tracking-tight tabular-nums leading-tight mt-1.5 break-words', valueClassName ?? 'text-foreground')}>{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1.5">{subtitle}</p>}
          </div>
          <DashTile icon={icon} tone={tone} className={tileClassName} />
        </div>
        {children}
        {note && (
          <div className="mt-3 flex items-start gap-1.5 rounded-xl border border-border/60 bg-card/60 px-3 py-2 text-[11px] text-muted-foreground leading-snug">
            <Info className="h-3.5 w-3.5 mt-px shrink-0" />
            <span>{note}</span>
          </div>
        )}
        {link && (
          <Link to={link.to} className="mt-auto pt-3 flex items-center gap-1 text-xs text-primary/80 hover:text-primary font-semibold transition-colors">
            {link.label} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </CardContent>
    </DashCard>
  );
}

/** Encabezado de tarjetas de LISTA o GRÁFICA: título 17px bold + subtítulo + cuadro de ícono. */
export function SectionHeader({ icon, tone = 'default', tileClassName, title, subtitle, right, className }: {
  icon: LucideIcon; tone?: Tone; tileClassName?: string; title: ReactNode; subtitle?: ReactNode; right?: ReactNode; className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="flex items-start gap-3 min-w-0">
        <DashTile icon={icon} tone={tone} className={tileClassName} />
        <div className="min-w-0">
          <p className="text-[17px] font-bold tracking-tight text-foreground leading-tight">{title}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

const RANK_STYLE = ['bg-amber-400 text-amber-950', 'bg-slate-300 text-slate-900 dark:bg-slate-600 dark:text-slate-100', 'bg-amber-700/80 text-white'];

/** Fila de ranking (Top 3): medalla, nombre, detalle y valor. */
export function RankRow({ rank, title, subtitle, value, valueSub, titleAttr }: {
  rank: number; title: ReactNode; subtitle?: ReactNode; value: ReactNode; valueSub?: ReactNode; titleAttr?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 border border-border/60 bg-card hover:bg-muted/40 transition-colors">
      <span className={cn('h-8 w-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-extrabold', RANK_STYLE[rank - 1] ?? 'bg-muted text-muted-foreground')}>
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-foreground leading-tight truncate" title={titleAttr}>{title}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[14px] font-bold tabular-nums leading-none text-foreground whitespace-nowrap">{value}</p>
        {valueSub && <p className="text-[11px] text-muted-foreground mt-1 whitespace-nowrap">{valueSub}</p>}
      </div>
    </div>
  );
}

export const fmtCop = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
export const fmtNum = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
export const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
export const fmtFecha = (d: Date) =>
  d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
