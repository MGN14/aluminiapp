import { useState, useRef, useEffect } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DescriptionOption {
  description: string;
  count: number;
  /** Suma de montos (con signo: ingreso +, egreso −) de esa descripción. */
  total: number;
}

function fmt(n: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Descripciones distintas parseadas, con conteo y suma. */
  options: DescriptionOption[];
}

/**
 * Buscador de descripción con dropdown de las descripciones que la app parseó.
 * Sigue aceptando texto libre (substring), pero ahora ofrece una lista de las
 * descripciones reales — cada una con cuántos movimientos tiene y cuánto suma —
 * para elegir con un toque en vez de escribir a ciegas.
 */
export default function DescriptionSearch({ value, onChange, options }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const nq = norm(value.trim());
  const filtered = (nq ? options.filter((o) => norm(o.description).includes(nq)) : options).slice(0, 60);

  return (
    <div ref={wrapRef} className="relative flex-1 max-w-md">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Buscar por descripción (ej: 4x1000, NEQUI, transferencia...)"
        className="w-full h-8 pl-8 pr-8 text-xs rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring/30"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => { onChange(''); setOpen(false); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          title="Limpiar búsqueda"
        >
          ×
        </button>
      )}
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full min-w-[320px] max-h-72 overflow-y-auto rounded-xl border border-border bg-popover shadow-lg p-1">
          {filtered.map((o) => (
            <button
              key={o.description}
              type="button"
              onClick={() => { onChange(o.description); setOpen(false); }}
              className="w-full flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg text-left hover:bg-muted transition-colors"
            >
              <span className="text-xs truncate flex-1" title={o.description}>{o.description}</span>
              <span className="shrink-0 flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground tabular-nums">{o.count}×</span>
                <span className={cn('text-xs font-semibold tabular-nums', o.total >= 0 ? 'text-success' : 'text-destructive')}>
                  {fmt(o.total)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
