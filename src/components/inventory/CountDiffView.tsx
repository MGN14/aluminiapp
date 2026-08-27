/**
 * Vista de diferencias de un conteo — métricas + filtros + tabla.
 *
 * Sirve para el BORRADOR (editable: se corrigen errores de conteo antes de
 * confirmar) y para un cierre YA CONFIRMADO (solo lectura). Antes vivía
 * embebida en InventoryCountClosing y solo se renderizaba para el borrador:
 * apenas se confirmaba, la evidencia desaparecía de la pantalla y el dueño
 * se quedaba sin con qué revisar lo que había hecho bodega (reporte de Nico
 * 2026-08-24: "Yolis subió el inventario y no lo pude ver por ningún lado").
 */

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { calcularLineas, totalizar } from '@/lib/inventoryCountExport';
import type { CountLine } from '@/hooks/useInventoryCount';

const fmt = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
export const esNoContada = (l: CountLine) => (l.nota ?? '').includes('no vino en el archivo');

export type CountFiltro = 'dif' | 'faltan' | 'sobran' | 'todas';

export function Metric({ label, value, hint, tone, onClick, activo }: {
  label: string; value: string; hint?: string; tone?: 'red' | 'green' | 'amber';
  onClick?: () => void; activo?: boolean;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      title={onClick ? (activo ? 'Clic para ver todas las diferencias' : 'Clic para ver solo estas en la tabla') : undefined}
      className={cn('rounded-lg border px-3 py-2 text-left w-full',
        onClick && 'cursor-pointer transition-colors hover:brightness-95',
        activo && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
        tone === 'red' ? 'border-destructive/30 bg-destructive/[0.04]'
          : tone === 'green' ? 'border-success/30 bg-success/[0.04]'
            : tone === 'amber' ? 'border-amber-400/40 bg-amber-50/50 dark:bg-amber-950/10'
              : 'border-border bg-muted/20')}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground font-mono">{hint}</p>}
    </Tag>
  );
}

interface Props {
  lineas: CountLine[];
  cargando?: boolean;
  /** Editable solo en borrador: corregir un error de digitación de bodega. */
  onEditarLinea?: (id: string, stockContado: number) => void;
  /** Slot de acciones a la derecha de los filtros (exportar, confirmar…). */
  acciones?: React.ReactNode;
}

export default function CountDiffView({ lineas, cargando, onEditarLinea, acciones }: Props) {
  const [filtro, setFiltro] = useState<CountFiltro>('dif');
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');

  const calc = useMemo(() => calcularLineas(lineas), [lineas]);
  const resumen = useMemo(() => {
    const t = totalizar(calc);
    return {
      ...t,
      noContadas: lineas.filter(esNoContada).length,
      nuevas: calc.filter((c) => c.nueva).length,
    };
  }, [calc, lineas]);

  const visibles = useMemo(() => {
    const base = filtro === 'todas' ? calc
      : filtro === 'faltan' ? calc.filter((c) => c.diferencia < 0)
        : filtro === 'sobran' ? calc.filter((c) => c.diferencia > 0)
          : calc.filter((c) => c.diferencia !== 0);
    return [...base].sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  }, [calc, filtro]);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Metric label="Referencias contadas" value={fmt(resumen.total - resumen.noContadas)}
          hint={resumen.nuevas > 0 ? `${resumen.nuevas} nuevas` : undefined} />
        <Metric label="Con diferencia" value={fmt(resumen.conDif)}
          hint={resumen.noContadas > 0 ? `${resumen.noContadas} no vinieron → cuentan 0` : undefined} tone="amber" />
        <Metric label="Faltan (merma)" value={fmt(Math.abs(resumen.unidadesFaltan))}
          hint={fmtCOP(Math.abs(resumen.valorFaltan))} tone="red"
          activo={filtro === 'faltan'} onClick={() => setFiltro(filtro === 'faltan' ? 'dif' : 'faltan')} />
        <Metric label="Sobran" value={fmt(resumen.unidadesSobran)}
          hint={fmtCOP(resumen.valorSobran)} tone="green"
          activo={filtro === 'sobran'} onClick={() => setFiltro(filtro === 'sobran' ? 'dif' : 'sobran')} />
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            {([
              ['dif', `Con diferencia (${fmt(resumen.conDif)})`],
              ['faltan', `Faltantes (${fmt(resumen.lineasFaltan)})`],
              ['sobran', `Sobrantes (${fmt(resumen.lineasSobran)})`],
              ['todas', 'Todas'],
            ] as [CountFiltro, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setFiltro(k)}
                className={cn('px-2.5 py-1 transition-colors border-r border-border last:border-r-0',
                  filtro === k ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-muted')}>
                {label}
              </button>
            ))}
          </div>
          {resumen.noContadas > 0 && (
            <span className="text-muted-foreground"
              title="Regla: si no se contó, no hay. Si de verdad hay stock sin contar, corregí la línea con el lápiz antes de confirmar.">
              {resumen.noContadas} referencias no vinieron en el archivo → quedan en 0
            </span>
          )}
        </div>
        {acciones}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/60">
            <tr className="text-left">
              <th className="px-3 py-2 font-semibold">Referencia</th>
              <th className="px-3 py-2 font-semibold text-right">Debería haber</th>
              <th className="px-3 py-2 font-semibold text-right">Contado</th>
              <th className="px-3 py-2 font-semibold text-right">Diferencia</th>
              <th className="px-3 py-2 font-semibold text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Cargando líneas…</td></tr>
            ) : visibles.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                {filtro === 'faltan' ? 'Ninguna referencia con faltante.'
                  : filtro === 'sobran' ? 'Ninguna referencia con sobrante.'
                    : <span className="text-success font-medium">Sin diferencias: el conteo cuadra con el sistema. ✓</span>}
              </td></tr>
            ) : visibles.slice(0, 300).map(({ linea: l, teorico, contado, diferencia: dif, valor }) => (
              <tr key={l.id} className="border-t border-border/60 hover:bg-muted/30">
                <td className="px-3 py-1.5">
                  <span className="font-mono font-medium">{l.variant_reference}</span>
                  {l.descripcion && <span className="text-muted-foreground ml-1.5">{l.descripcion}</span>}
                  {l.es_nueva && <span className="ml-1.5 rounded bg-blue-50 text-blue-700 px-1 py-px text-[10px] dark:bg-blue-950/40 dark:text-blue-300">nueva</span>}
                  {esNoContada(l) && <span className="ml-1.5 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">no vino en el archivo</span>}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmt(teorico)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {onEditarLinea && editId === l.id ? (
                    <input
                      autoFocus type="number" value={editVal}
                      onChange={(e) => setEditVal(e.target.value)}
                      onBlur={() => {
                        const n = Number(editVal);
                        setEditId(null);
                        if (Number.isFinite(n) && n !== Number(l.stock_contado)) onEditarLinea(l.id, n);
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      className="w-20 rounded border border-input bg-background px-1.5 py-0.5 text-right"
                    />
                  ) : onEditarLinea ? (
                    <button className="hover:underline" title="Corregir un error de conteo"
                      onClick={() => { setEditId(l.id); setEditVal(String(Number(l.stock_contado))); }}>
                      {fmt(contado)}
                    </button>
                  ) : (
                    <span>{fmt(contado)}</span>
                  )}
                </td>
                <td className={cn('px-3 py-1.5 text-right tabular-nums font-semibold',
                  dif < 0 ? 'text-destructive' : dif > 0 ? 'text-success' : 'text-muted-foreground')}>
                  {dif > 0 ? '+' : ''}{fmt(dif)}
                </td>
                <td className={cn('px-3 py-1.5 text-right tabular-nums font-mono',
                  valor < 0 ? 'text-destructive' : valor > 0 ? 'text-success' : 'text-muted-foreground')}>
                  {valor === 0 ? '—' : fmtCOP(valor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visibles.length > 300 && (
          <p className="px-3 py-2 text-[11px] text-muted-foreground">
            Mostrando las 300 de mayor impacto en plata de {visibles.length}.
          </p>
        )}
      </div>
    </>
  );
}
