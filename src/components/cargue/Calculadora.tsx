import { useEffect, useState } from 'react';
import { borrarUltimo, evaluar, mostrar, resultadoComoExpresion, teclear } from '@/lib/calculadora';
import { Calculator, Delete, PackageCheck } from 'lucide-react';
import { tap } from './CargueUI';

const KEY = 'cargue:calculadora:v1';

interface Props {
  /** Pasa el resultado como total de paquetes de la referencia activa. */
  onUsarPaquetes?: { reference: string; usar: (n: number) => void } | null;
}

/**
 * Calculadora del cargue (debajo del contador de paquetes): 4 filas × 5
 * paquetes, 120 ÷ 6, etc. Lo escrito sobrevive si se sale y se vuelve a la
 * pantalla.
 */
export default function Calculadora({ onUsarPaquetes }: Props) {
  const [expr, setExpr] = useState<string>(() => {
    try { return sessionStorage.getItem(KEY) ?? ''; } catch { return ''; }
  });
  const [recienIgual, setRecienIgual] = useState(false);
  useEffect(() => { try { sessionStorage.setItem(KEY, expr); } catch { /* ignore */ } }, [expr]);

  const resultado = evaluar(expr);
  const tecla = (t: string) => {
    setExpr((e) => {
      // Después de "=", un número empieza una cuenta nueva; un operador sigue sobre el resultado.
      if (recienIgual && /^[\d,]$/.test(t)) return teclear('', t);
      return teclear(e, t);
    });
    setRecienIgual(false);
  };
  const igual = () => {
    if (resultado == null) return;
    setExpr(resultadoComoExpresion(resultado));
    setRecienIgual(true);
  };

  const base = 'h-11 rounded-xl border border-border bg-background text-xl font-bold tabular-nums active:scale-95 active:bg-muted transition-transform select-none';
  const op = 'h-11 rounded-xl border border-border bg-muted text-xl font-bold active:scale-95 transition-transform select-none';
  const enteroPositivo = resultado != null && resultado > 0 && Number.isInteger(resultado) && resultado <= 10_000;

  return (
    <section className="rounded-3xl border border-border bg-card p-3 space-y-2" aria-label="Calculadora">
      <div className="flex items-center gap-2 text-sm font-bold"><Calculator className="h-4 w-4" /> Calculadora</div>
      <div className="rounded-2xl border border-border bg-background px-3 py-2 text-right min-h-[56px]">
        <div className="text-sm text-muted-foreground tabular-nums truncate" aria-label="Cuenta">{expr || '0'}</div>
        <div className="text-3xl font-extrabold tabular-nums leading-tight" aria-live="polite">{resultado != null ? mostrar(resultado) : expr ? '—' : '0'}</div>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <button type="button" className={op} onClick={tap(() => { setExpr(''); setRecienIgual(false); })}>C</button>
        <button type="button" className={`${op} flex items-center justify-center`} aria-label="Borrar" onClick={tap(() => { setExpr((e) => borrarUltimo(e)); setRecienIgual(false); })}><Delete className="h-5 w-5" /></button>
        <button type="button" className={op} aria-label="Dividir" onClick={tap(() => tecla('÷'))}>÷</button>
        <button type="button" className={op} aria-label="Multiplicar" onClick={tap(() => tecla('×'))}>×</button>
        {['7', '8', '9'].map((d) => <button key={d} type="button" className={base} onClick={tap(() => tecla(d))}>{d}</button>)}
        <button type="button" className={op} aria-label="Restar" onClick={tap(() => tecla('−'))}>−</button>
        {['4', '5', '6'].map((d) => <button key={d} type="button" className={base} onClick={tap(() => tecla(d))}>{d}</button>)}
        <button type="button" className={op} aria-label="Sumar" onClick={tap(() => tecla('+'))}>+</button>
        {['1', '2', '3'].map((d) => <button key={d} type="button" className={base} onClick={tap(() => tecla(d))}>{d}</button>)}
        <button type="button" className="row-span-2 rounded-xl bg-primary text-primary-foreground text-2xl font-bold active:scale-95 select-none" aria-label="Igual" onClick={tap(igual)}>=</button>
        <button type="button" className={`${base} col-span-2`} onClick={tap(() => tecla('0'))}>0</button>
        <button type="button" className={base} aria-label="Coma decimal" onClick={tap(() => tecla(','))}>,</button>
      </div>
      {onUsarPaquetes && enteroPositivo && (
        <button
          type="button"
          onClick={tap(() => onUsarPaquetes.usar(resultado!))}
          className="w-full h-11 rounded-xl border border-border bg-background text-sm font-semibold inline-flex items-center justify-center gap-1.5 active:scale-[0.98]"
        >
          <PackageCheck className="h-4 w-4" /> Poner {mostrar(resultado)} paquetes en {onUsarPaquetes.reference}
        </button>
      )}
    </section>
  );
}
