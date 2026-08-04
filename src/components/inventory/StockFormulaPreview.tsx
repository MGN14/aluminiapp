/**
 * COMPARADOR DE FÓRMULA — Fase 1 del plan del 2026-08-04. SOLO LECTURA.
 *
 * Pone lado a lado el stock que muestra la app hoy y el que da la fórmula
 * única (inicial + contenedor − remisiones, con una sola fecha de corte), para
 * que Nico lo cuadre contra su Excel ANTES de que se toque el motor.
 *
 * No escribe absolutamente nada. Mover la fecha de corte solo recalcula.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Calculator, Loader2, FileSpreadsheet, Search, X, AlertTriangle, ChevronRight, Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  fetchStockPreviewData, computeStockConCorte, agruparMovsPorVariante,
  auditarMovimientos, detectarSinCruce, corteSugerido,
  type PreviewVariant, type StockDesglose,
} from '@/lib/variantStockPreview';

const fmt = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

interface Fila extends StockDesglose {
  v: PreviewVariant;
  delta: number;          // stock nuevo − stock de hoy
  valorNuevo: number;
}

export default function StockFormulaPreview({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const { data, isPending, error } = useQuery({
    queryKey: ['stock-formula-preview'],
    queryFn: fetchStockPreviewData,
    staleTime: 60_000,
  });

  const [corte, setCorte] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [soloDelta, setSoloDelta] = useState(false);
  const [detalle, setDetalle] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);

  const corteEfectivo = corte ?? (data ? corteSugerido(data.movs) : '');

  const movsPorVariante = useMemo(
    () => (data ? agruparMovsPorVariante(data.movs) : new Map()),
    [data],
  );
  const remPorId = useMemo(
    () => new Map((data?.remisiones ?? []).map((r) => [r.id, r])),
    [data],
  );

  const filas = useMemo((): Fila[] => {
    if (!data || !corteEfectivo) return [];
    return data.variantes.map((v) => {
      const d = computeStockConCorte(v, movsPorVariante.get(v.id) ?? [], corteEfectivo);
      return { ...d, v, delta: d.stock - v.stock_hoy, valorNuevo: d.stock * v.avg_cost };
    });
  }, [data, movsPorVariante, corteEfectivo]);

  const totales = useMemo(() => {
    const t = { undsNuevo: 0, undsHoy: 0, valorNuevo: 0, valorHoy: 0, conDelta: 0, remisiones: 0, contenedor: 0 };
    for (const f of filas) {
      t.undsNuevo += f.stock;
      t.undsHoy += f.v.stock_hoy;
      t.valorNuevo += f.valorNuevo;
      t.valorHoy += f.v.stock_hoy * f.v.avg_cost;
      t.remisiones += f.remisiones;
      t.contenedor += f.contenedor;
      if (Math.round(f.delta) !== 0) t.conDelta++;
    }
    return t;
  }, [filas]);

  const sinCruce = useMemo(() => (data ? detectarSinCruce(data) : []), [data]);
  const undsSinCruce = useMemo(() => sinCruce.reduce((s, l) => s + l.units, 0), [sinCruce]);

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    let arr = filas;
    if (s) arr = arr.filter((f) =>
      f.v.variant_reference.toLowerCase().includes(s) || (f.v.name ?? '').toLowerCase().includes(s));
    if (soloDelta) arr = arr.filter((f) => Math.round(f.delta) !== 0);
    return [...arr].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [filas, q, soloDelta]);

  async function exportar() {
    setExportando(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();

      const ws = XLSX.utils.json_to_sheet(filas.map((f) => ({
        'Referencia': f.v.variant_reference,
        'Descripción': f.v.name ?? '',
        'Inicial': f.inicial,
        'De dónde sale el inicial': f.inicialOrigen,
        '+ Contenedor': f.contenedor,
        '− Remisiones': f.remisiones,
        'STOCK (fórmula)': f.stock,
        'Stock que muestra hoy': f.v.stock_hoy,
        'Diferencia': Math.round(f.delta),
        'Costo unitario': Math.round(f.v.avg_cost),
        'Valor (fórmula)': Math.round(f.valorNuevo),
      })));
      ws['!cols'] = [{ wch: 16 }, { wch: 34 }, { wch: 10 }, { wch: 26 }, { wch: 13 }, { wch: 13 },
        { wch: 16 }, { wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, ws, 'Comparación');

      if (sinCruce.length) {
        const wsSC = XLSX.utils.json_to_sheet(sinCruce.map((l) => ({
          'Remisión': l.remision, 'Fecha': l.fecha, 'Cliente': l.cliente,
          'Referencia despachada': l.reference, 'Unidades': l.units,
          '¿Quiso decir?': l.sugerencia ?? '',
        })));
        wsSC['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 30 }, { wch: 22 }, { wch: 10 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(wb, wsSC, 'Sin cruce');
      }

      const wsR = XLSX.utils.json_to_sheet([
        { Concepto: 'Fecha de corte usada (F0)', Valor: corteEfectivo },
        { Concepto: 'Referencias', Valor: filas.length },
        { Concepto: 'Unidades — fórmula', Valor: Math.round(totales.undsNuevo) },
        { Concepto: 'Unidades — muestra hoy', Valor: Math.round(totales.undsHoy) },
        { Concepto: 'Valor — fórmula (COP)', Valor: Math.round(totales.valorNuevo) },
        { Concepto: 'Valor — muestra hoy (COP)', Valor: Math.round(totales.valorHoy) },
        { Concepto: 'Referencias que difieren', Valor: totales.conDelta },
        { Concepto: 'Unidades en líneas sin cruce', Valor: undsSinCruce },
      ]);
      wsR['!cols'] = [{ wch: 34 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, wsR, 'Resumen');

      XLSX.writeFile(wb, `comparacion-stock-corte-${corteEfectivo}.xlsx`);
    } catch (e) {
      toast({ title: 'No se pudo exportar', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setExportando(false);
    }
  }

  const filaDetalle = filas.find((f) => f.v.id === detalle) ?? null;
  const auditoria = useMemo(() => {
    if (!filaDetalle) return [];
    return auditarMovimientos(movsPorVariante.get(filaDetalle.v.id) ?? [], corteEfectivo, remPorId);
  }, [filaDetalle, movsPorVariante, corteEfectivo, remPorId]);

  return (
    <div className="rounded-xl border-2 border-primary/40 bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" /> Comparador de fórmula — solo lectura
          </h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
            <strong>No escribe nada.</strong> Mové la fecha de corte hasta que el total cuadre con tu Excel.
            La fórmula es <span className="font-mono">inicial + contenedor − remisiones</span>, cortando por la
            <strong> fecha del hecho</strong> (cuándo salió la mercancía), no por cuándo se digitó.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4 mr-1" /> Cerrar</Button>
      </div>

      {isPending ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Leyendo el ledger completo…
        </div>
      ) : error ? (
        <p className="text-sm text-destructive py-8 text-center">{(error as Error).message}</p>
      ) : (
        <>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-[11px] text-muted-foreground block mb-1 font-medium">
                Fecha de corte (F0) — el stock sale de acá en adelante
              </label>
              <Input type="date" value={corteEfectivo} onChange={(e) => setCorte(e.target.value)}
                className="h-9 w-44 text-xs" />
            </div>
            <Button size="sm" variant="outline" className="h-9" onClick={exportar} disabled={exportando}>
              {exportando ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                : <FileSpreadsheet className="h-4 w-4 mr-1" />}
              Exportar a Excel
            </Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Caja label="Unidades — fórmula" value={fmt(totales.undsNuevo)}
              hint={`hoy muestra ${fmt(totales.undsHoy)}`} destacado />
            <Caja label="Valor — fórmula" value={fmtCOP(totales.valorNuevo)}
              hint={`hoy muestra ${fmtCOP(totales.valorHoy)}`} destacado />
            <Caja label="Refs que difieren" value={fmt(totales.conDelta)}
              hint={`de ${fmt(filas.length)}`} />
            <Caja label="Remisiones descontadas" value={fmt(totales.remisiones)}
              hint={`+ ${fmt(totales.contenedor)} de contenedor`} />
          </div>

          {sinCruce.length > 0 && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/[0.05] p-3 space-y-2">
              <p className="text-xs font-semibold flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                {sinCruce.length} línea(s) de remisión no cruzan con ninguna referencia — {fmt(undsSinCruce)} unidades que NUNCA descuentan
              </p>
              <p className="text-[11px] text-muted-foreground">
                La referencia despachada no existe en el inventario por variante (typo, o se despachó con la
                «-5» de Siigo). Estas unidades salieron de bodega pero el sistema nunca las restó.
              </p>
              <div className="overflow-x-auto rounded border border-border bg-background">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/60">
                    <tr className="text-left">
                      <th className="px-2 py-1.5 font-semibold">Remisión</th>
                      <th className="px-2 py-1.5 font-semibold">Fecha</th>
                      <th className="px-2 py-1.5 font-semibold">Ref. despachada</th>
                      <th className="px-2 py-1.5 font-semibold text-right">Unds</th>
                      <th className="px-2 py-1.5 font-semibold">¿Quiso decir?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sinCruce.slice(0, 40).map((l, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="px-2 py-1 font-medium">{l.remision}</td>
                        <td className="px-2 py-1 text-muted-foreground">{l.fecha}</td>
                        <td className="px-2 py-1 font-mono">{l.reference}</td>
                        <td className="px-2 py-1 text-right tabular-nums font-semibold">{fmt(l.units)}</td>
                        <td className="px-2 py-1 font-mono text-muted-foreground">{l.sugerencia ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sinCruce.length > 40 && (
                  <p className="px-2 py-1.5 text-[10px] text-muted-foreground">
                    Mostrando 40 de {sinCruce.length}. El Excel las trae todas (hoja «Sin cruce»).
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative max-w-xs flex-1">
              <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar referencia…"
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-md border border-border bg-background" />
            </div>
            <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs">
              <input type="checkbox" checked={soloDelta} onChange={(e) => setSoloDelta(e.target.checked)} />
              Solo las que difieren de lo que muestra hoy
            </label>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/60">
                <tr className="text-left">
                  <th className="px-3 py-2 font-semibold">Referencia</th>
                  <th className="px-3 py-2 font-semibold text-right">Inicial</th>
                  <th className="px-3 py-2 font-semibold text-right">+ Contenedor</th>
                  <th className="px-3 py-2 font-semibold text-right">− Remisiones</th>
                  <th className="px-3 py-2 font-semibold text-right">Stock (fórmula)</th>
                  <th className="px-3 py-2 font-semibold text-right">Muestra hoy</th>
                  <th className="px-3 py-2 font-semibold text-right">Δ</th>
                </tr>
              </thead>
              <tbody>
                {visibles.slice(0, 300).map((f) => {
                  const d = Math.round(f.delta);
                  return (
                    <tr key={f.v.id}
                      className="border-t border-border/60 hover:bg-muted/40 cursor-pointer"
                      onClick={() => setDetalle(detalle === f.v.id ? null : f.v.id)}
                      title="Clic para ver todos sus movimientos">
                      <td className="px-3 py-1.5">
                        <ChevronRight className={cn('h-3 w-3 inline mr-1 text-muted-foreground transition-transform',
                          detalle === f.v.id && 'rotate-90')} />
                        <span className="font-mono font-medium">{f.v.variant_reference}</span>
                        {f.v.name && <span className="text-muted-foreground ml-1.5">{f.v.name}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmt(f.inicial)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-success">{f.contenedor ? `+${fmt(f.contenedor)}` : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-destructive">{f.remisiones ? `−${fmt(f.remisiones)}` : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-bold">{fmt(f.stock)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmt(f.v.stock_hoy)}</td>
                      <td className={cn('px-3 py-1.5 text-right tabular-nums font-semibold',
                        d < 0 ? 'text-destructive' : d > 0 ? 'text-success' : 'text-muted-foreground')}>
                        {d === 0 ? '✓' : `${d > 0 ? '+' : ''}${fmt(d)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visibles.length > 300 && (
              <p className="px-3 py-2 text-[11px] text-muted-foreground">
                Mostrando 300 de {visibles.length}. El Excel las trae todas.
              </p>
            )}
          </div>

          {filaDetalle && (
            <div className="rounded-lg border border-primary/40 bg-muted/20 p-3 space-y-2">
              <p className="text-xs font-bold font-mono">
                {filaDetalle.v.variant_reference}
                <span className="font-sans font-normal text-muted-foreground ml-2">
                  {filaDetalle.inicial} inicial ({filaDetalle.inicialOrigen})
                  {' '}+ {filaDetalle.contenedor} contenedor − {filaDetalle.remisiones} remisiones
                  {' '}= <strong className="text-foreground">{filaDetalle.stock}</strong>
                </span>
              </p>
              <div className="overflow-x-auto rounded border border-border bg-background max-h-80 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/60 sticky top-0">
                    <tr className="text-left">
                      <th className="px-2 py-1.5 font-semibold">Fecha</th>
                      <th className="px-2 py-1.5 font-semibold">Tipo</th>
                      <th className="px-2 py-1.5 font-semibold">Origen</th>
                      <th className="px-2 py-1.5 font-semibold text-right">Unds</th>
                      <th className="px-2 py-1.5 font-semibold">¿Cuenta?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditoria.length === 0 ? (
                      <tr><td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">
                        Sin movimientos en el ledger.
                      </td></tr>
                    ) : auditoria.map((a, i) => (
                      <tr key={i} className={cn('border-t border-border/60', !a.cuenta && 'opacity-50')}>
                        <td className="px-2 py-1 tabular-nums">{a.fecha}</td>
                        <td className="px-2 py-1">{a.tipo}</td>
                        <td className="px-2 py-1">{a.origen}</td>
                        <td className="px-2 py-1 text-right tabular-nums font-semibold">{fmt(a.unidades)}</td>
                        <td className="px-2 py-1">
                          {a.cuenta ? <span className="text-success inline-flex items-center gap-1"><Check className="h-3 w-3" /> {a.porque}</span>
                            : <span className="text-muted-foreground">✕ {a.porque}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Caja({ label, value, hint, destacado }: {
  label: string; value: string; hint?: string; destacado?: boolean;
}) {
  return (
    <div className={cn('rounded-lg border px-3 py-2',
      destacado ? 'border-primary/40 bg-primary/[0.04]' : 'border-border bg-muted/20')}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p>
      <p className="text-base font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
