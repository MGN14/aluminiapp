import { useEffect, useState } from 'react';
import { AlertTriangle, Ban, Check, CheckCircle2, Cloud, CloudOff, CloudUpload, GraduationCap, ScanLine } from 'lucide-react';
import type { Flash } from './useCargue';

export const fmt = (n: number) => n.toLocaleString('es-CO');
export const fmtKg = (n: number) => `${Math.round(n).toLocaleString('es-CO')} kg`;

// Tinte = color de tarjeta + capa translúcida encima (background-image): el
// aviso se lee igual en claro y en oscuro.
export const TINT = {
  success: 'bg-card bg-gradient-to-r from-success/10 to-success/10',
  warning: 'bg-card bg-gradient-to-r from-warning/10 to-warning/10',
  destructive: 'bg-card bg-gradient-to-r from-destructive/10 to-destructive/10',
} as const;

/** Quita el foco del botón tocado: si no, el Enter de la pistola lo "presionaría". */
export function tap(fn: () => void) {
  return () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    fn();
  };
}

export function FlashBanner({ flash, hideIdle = false }: { flash: Flash | null; hideIdle?: boolean }) {
  if (!flash) {
    if (hideIdle) return null;
    return (
      <div className="rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
        <ScanLine className="h-5 w-5" /> Escaneá una etiqueta o tocá «+ 1 paquete»
      </div>
    );
  }
  const tone =
    flash.kind === 'ok' || flash.kind === 'done' ? `border-success/50 ${TINT.success} text-success`
    : flash.kind === 'warn' ? `border-warning/50 ${TINT.warning} text-warning`
    : `border-destructive ${TINT.destructive} text-destructive`;
  const Icon = flash.kind === 'ok' ? Check : flash.kind === 'done' ? CheckCircle2 : flash.kind === 'warn' ? AlertTriangle : Ban;
  return (
    <div key={flash.at} className={`rounded-2xl border-2 px-4 py-3 flex items-start gap-3 ${tone}`} role="status" aria-live="assertive">
      <Icon className="h-6 w-6 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="text-base font-bold leading-tight">{flash.title}</div>
        {flash.detail && <div className="text-sm font-medium opacity-90">{flash.detail}</div>}
      </div>
    </div>
  );
}

/** Marco rojo en toda la pantalla un instante: el error se ve sin mirar el iPad de frente. */
export function ErrorFrame({ flash }: { flash: Flash | null }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!flash || (flash.kind !== 'error' && flash.kind !== 'warn')) return;
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 1100);
    return () => window.clearTimeout(t);
  }, [flash]);
  if (!visible || !flash) return null;
  const color = flash.kind === 'error' ? 'border-destructive' : 'border-warning';
  return <div aria-hidden className={`pointer-events-none fixed inset-0 z-50 border-[14px] ${color} animate-pulse`} />;
}

export function SyncChip({ online, pendientes, syncing, practica, onSync }: {
  online: boolean; pendientes: number; syncing: boolean; practica: boolean; onSync: () => void;
}) {
  const base = 'h-9 px-3 rounded-full border text-sm font-semibold inline-flex items-center gap-1.5 whitespace-nowrap';
  if (practica) return <span className={`${base} border-warning/50 ${TINT.warning} text-warning`}><GraduationCap className="h-4 w-4" /> Práctica</span>;
  if (!online) {
    return (
      <span className={`${base} border-warning/50 ${TINT.warning} text-warning`}>
        <CloudOff className="h-4 w-4" /> Sin señal{pendientes ? ` · ${pendientes} en el iPad` : ''}
      </span>
    );
  }
  if (pendientes > 0) {
    return (
      <button type="button" onClick={tap(onSync)} className={`${base} border-border bg-card`}>
        <CloudUpload className={`h-4 w-4 ${syncing ? 'animate-pulse' : ''}`} /> Subiendo {pendientes}…
      </button>
    );
  }
  return <span className={`${base} border-success/40 ${TINT.success} text-success`}><Cloud className="h-4 w-4" /> Todo guardado</span>;
}
