/**
 * CIERRE DE INVENTARIO — el "cerrar caja" del inventario por variante.
 *
 * Bodega sube el conteo → borrador con las diferencias contra el teórico →
 * el admin revisa, corrige errores de conteo y CONFIRMA → el conteo queda
 * como nueva fuente de verdad y el reporte se archiva.
 *
 * El ledger NO se borra: la historia de movimientos (lo que alimenta el
 * análisis de rotación y de cuándo montar pedido) queda intacta; el conteo
 * solo pone un ancla nueva y desde ahí vuelven a contar contenedores y
 * remisiones.
 */

import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ClipboardCheck, Upload, Loader2, Check, X, AlertTriangle, History, ChevronDown, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/usePermissions';
import { readXlsxFile, isExcelFile } from '@/lib/readXlsx';
import { parseMaestra } from '@/hooks/useInventoryVariants';
import { useInventoryCount, type CountLine } from '@/hooks/useInventoryCount';
import { cn } from '@/lib/utils';

const fmt = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
const hoyIso = () => new Date().toISOString().slice(0, 10);
const esNoContada = (l: CountLine) => (l.nota ?? '').includes('no vino en el archivo');

export default function InventoryCountClosing() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isAdmin } = usePermissions();
  const {
    sessions, borrador, lineasBorrador, lineasPending,
    crearBorrador, editarLinea, confirmarCierre, descartarBorrador,
  } = useInventoryCount();

  const fileRef = useRef<HTMLInputElement>(null);
  const [fechaConteo, setFechaConteo] = useState(hoyIso());
  const [soloDiferencias, setSoloDiferencias] = useState(true);
  const [faltantesCero, setFaltantesCero] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [verHistorial, setVerHistorial] = useState(false);

  const resumen = useMemo(() => {
    const conDif = lineasBorrador.filter((l) => Math.round(Number(l.diferencia ?? 0)) !== 0);
    const faltan = conDif.filter((l) => Number(l.diferencia) < 0);
    const sobran = conDif.filter((l) => Number(l.diferencia) > 0);
    const valorDe = (arr: CountLine[]) =>
      arr.reduce((s, l) => s + Number(l.diferencia ?? 0) * Number(l.costo_unitario ?? 0), 0);
    return {
      total: lineasBorrador.length,
      conDif: conDif.length,
      nuevas: lineasBorrador.filter((l) => l.es_nueva).length,
      noContadas: lineasBorrador.filter(esNoContada).length,
      unidadesFaltan: faltan.reduce((s, l) => s + Number(l.diferencia ?? 0), 0),
      unidadesSobran: sobran.reduce((s, l) => s + Number(l.diferencia ?? 0), 0),
      valorFaltan: valorDe(faltan),
      valorSobran: valorDe(sobran),
      valorNeto: valorDe(conDif),
    };
  }, [lineasBorrador]);

  const visibles = useMemo(() => {
    const arr = soloDiferencias
      ? lineasBorrador.filter((l) => Math.round(Number(l.diferencia ?? 0)) !== 0)
      : lineasBorrador;
    return [...arr].sort((a, b) =>
      Math.abs(Number(b.diferencia) * Number(b.costo_unitario)) -
      Math.abs(Number(a.diferencia) * Number(a.costo_unitario)));
  }, [lineasBorrador, soloDiferencias]);

  async function onFile(file: File) {
    try {
      if (!isExcelFile(file)) {
        toast({ title: 'Archivo no válido', description: 'Subí un Excel (.xlsx/.xls).', variant: 'destructive' });
        return;
      }
      const sheets = await readXlsxFile(file);
      let parsed = parseMaestra(sheets[0]?.rows ?? []);
      for (let i = 1; i < sheets.length && parsed.error; i++) parsed = parseMaestra(sheets[i].rows);
      if (parsed.error) {
        toast({ title: 'No pude leer el conteo', description: parsed.error, variant: 'destructive' });
        return;
      }
      const r = await crearBorrador.mutateAsync({ filas: parsed.data, fechaConteo });
      toast({
        title: 'Conteo cargado como borrador',
        description: `${parsed.data.length} referencias contadas · ${r.lineas} líneas para revisar. El inventario NO se tocó todavía.`,
        duration: 9000,
      });
    } catch (e) {
      toast({ title: 'Error subiendo el conteo', description: (e as Error).message, variant: 'destructive' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onConfirmar() {
    if (!borrador) return;
    const ok = window.confirm(
      `Confirmar el cierre de inventario del ${borrador.fecha_conteo}:\n\n` +
      `· ${resumen.conDif} referencia(s) con diferencia\n` +
      `· Faltantes: ${fmt(Math.abs(resumen.unidadesFaltan))} und (${fmtCOP(Math.abs(resumen.valorFaltan))})\n` +
      `· Sobrantes: ${fmt(resumen.unidadesSobran)} und (${fmtCOP(resumen.valorSobran)})\n` +
      (faltantesCero ? `· Las ${resumen.noContadas} que NO vinieron en el archivo quedan en 0\n` : '') +
      `\nEl conteo pasa a ser la fuente de verdad. Las remisiones y contenedores POSTERIORES vuelven a mover el saldo desde acá. La historia no se borra.\n\n¿Continuar?`,
    );
    if (!ok) return;
    try {
      const r = await confirmarCierre.mutateAsync({
        sessionId: borrador.id,
        cuentaFaltantesComoCero: faltantesCero,
      });
      qc.invalidateQueries({ queryKey: ['inventory-variants'] });
      toast({
        title: 'Inventario cerrado',
        description: `${r.ancladas} referencias ancladas al conteo · ${r.conDiferencia} con diferencia (${fmtCOP(r.totalValor)}). El reporte quedó archivado.`,
        duration: 12000,
      });
    } catch (e) {
      toast({ title: 'No se pudo cerrar', description: (e as Error).message, variant: 'destructive' });
    }
  }

  const confirmados = sessions.filter((s) => s.estado === 'confirmado');

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-bold flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-primary" /> Cierre de inventario
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
              Como cerrar caja: bodega sube el conteo, la app muestra las diferencias contra lo que
              debería haber, y al confirmar (solo admin) ese conteo queda como la verdad nueva.
              <strong> No se borra la historia</strong> — el análisis de rotación por referencia sigue
              intacto; solo se pone un ancla y desde ahí vuelven a contar remisiones y contenedores.
            </p>
          </div>
          {!borrador && (
            <div className="flex items-end gap-2">
              <div>
                <label className="text-[11px] text-muted-foreground block mb-1">Fecha del conteo</label>
                <Input type="date" value={fechaConteo} max={hoyIso()}
                  onChange={(e) => setFechaConteo(e.target.value)} className="h-9 w-40 text-xs" />
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
              <Button size="sm" onClick={() => fileRef.current?.click()} disabled={crearBorrador.isPending}>
                {crearBorrador.isPending
                  ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Leyendo…</>
                  : <><Upload className="h-4 w-4 mr-1" /> Subir conteo de bodega</>}
              </Button>
            </div>
          )}
        </div>

        {borrador && (
          <>
            <div className="rounded-lg border border-amber-400/50 bg-amber-50/70 dark:bg-amber-950/20 px-3 py-2 text-xs flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Borrador del {borrador.fecha_conteo} — sin aplicar.</strong> El inventario sigue
                como estaba. Revisá las diferencias y confirmá para que este conteo mande.
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Metric label="Referencias contadas" value={fmt(resumen.total - resumen.noContadas)}
                hint={resumen.nuevas > 0 ? `${resumen.nuevas} nuevas` : undefined} />
              <Metric label="Con diferencia" value={fmt(resumen.conDif)}
                hint={resumen.noContadas > 0 ? `${resumen.noContadas} sin contar` : undefined} tone="amber" />
              <Metric label="Faltan (merma)" value={fmt(Math.abs(resumen.unidadesFaltan))}
                hint={fmtCOP(Math.abs(resumen.valorFaltan))} tone="red" />
              <Metric label="Sobran" value={fmt(resumen.unidadesSobran)}
                hint={fmtCOP(resumen.valorSobran)} tone="green" />
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
              <div className="flex items-center gap-3 flex-wrap">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={soloDiferencias}
                    onChange={(e) => setSoloDiferencias(e.target.checked)} />
                  Solo las que tienen diferencia
                </label>
                {resumen.noContadas > 0 && (
                  <label className="inline-flex items-center gap-1.5 cursor-pointer" title="Si el conteo fue de TODA la bodega, lo que no aparece en el archivo es porque no está: se ancla en 0. Si fue parcial, dejalo sin marcar.">
                    <input type="checkbox" checked={faltantesCero}
                      onChange={(e) => setFaltantesCero(e.target.checked)} />
                    Las {resumen.noContadas} que no vinieron en el archivo van a 0 (conteo completo)
                  </label>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" className="h-8 text-xs"
                  onClick={() => { if (window.confirm('¿Descartar este borrador? El inventario no se toca.')) descartarBorrador.mutate(borrador.id); }}>
                  <X className="h-3.5 w-3.5 mr-1" /> Descartar
                </Button>
                <Button size="sm" className="h-8 text-xs" onClick={onConfirmar}
                  disabled={!isAdmin || confirmarCierre.isPending}
                  title={isAdmin ? 'Aplica el conteo como fuente de verdad' : 'Solo el admin puede confirmar un cierre'}>
                  {confirmarCierre.isPending
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Cerrando…</>
                    : <><Check className="h-3.5 w-3.5 mr-1" /> Confirmar cierre</>}
                </Button>
              </div>
            </div>
            {!isAdmin && (
              <p className="text-[11px] text-muted-foreground">
                El conteo quedó guardado. Un admin tiene que revisarlo y confirmarlo para que aplique.
              </p>
            )}

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
                  {lineasPending ? (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Cargando líneas…</td></tr>
                  ) : visibles.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-success font-medium">
                      Sin diferencias: el conteo cuadra con el sistema. ✓
                    </td></tr>
                  ) : visibles.slice(0, 300).map((l) => {
                    const dif = Math.round(Number(l.diferencia ?? 0));
                    const valor = dif * Number(l.costo_unitario ?? 0);
                    return (
                      <tr key={l.id} className="border-t border-border/60 hover:bg-muted/30">
                        <td className="px-3 py-1.5">
                          <span className="font-mono font-medium">{l.variant_reference}</span>
                          {l.descripcion && <span className="text-muted-foreground ml-1.5">{l.descripcion}</span>}
                          {l.es_nueva && <span className="ml-1.5 rounded bg-blue-50 text-blue-700 px-1 py-px text-[10px] dark:bg-blue-950/40 dark:text-blue-300">nueva</span>}
                          {esNoContada(l) && <span className="ml-1.5 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">no vino en el archivo</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmt(Number(l.stock_teorico))}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {editId === l.id ? (
                            <input
                              autoFocus type="number" value={editVal}
                              onChange={(e) => setEditVal(e.target.value)}
                              onBlur={() => {
                                const n = Number(editVal);
                                setEditId(null);
                                if (Number.isFinite(n) && n !== Number(l.stock_contado)) {
                                  editarLinea.mutate({ id: l.id, stock_contado: n });
                                }
                              }}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                              className="w-20 rounded border border-input bg-background px-1.5 py-0.5 text-right"
                            />
                          ) : (
                            <button className="hover:underline" title="Corregir un error de conteo"
                              onClick={() => { setEditId(l.id); setEditVal(String(Number(l.stock_contado))); }}>
                              {fmt(Number(l.stock_contado))}
                            </button>
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
                    );
                  })}
                </tbody>
              </table>
              {visibles.length > 300 && (
                <p className="px-3 py-2 text-[11px] text-muted-foreground">
                  Mostrando las 300 de mayor impacto en plata de {visibles.length}.
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {confirmados.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <button className="flex items-center gap-2 text-sm font-semibold"
            onClick={() => setVerHistorial((v) => !v)}>
            {verHistorial ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <History className="h-4 w-4 text-muted-foreground" />
            Cierres anteriores ({confirmados.length})
          </button>
          {verHistorial && (
            <div className="mt-3 space-y-1.5">
              {confirmados.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-border/60 px-3 py-2 text-xs">
                  <span className="font-medium">Conteo del {s.fecha_conteo}</span>
                  <span className="text-muted-foreground">
                    {fmt(s.total_referencias)} refs · {fmt(s.total_con_diferencia)} con diferencia
                  </span>
                  <span className={cn('font-mono font-semibold tabular-nums',
                    Number(s.total_valor_diferencia) < 0 ? 'text-destructive' : 'text-success')}>
                    {fmtCOP(Number(s.total_valor_diferencia))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: 'red' | 'green' | 'amber';
}) {
  return (
    <div className={cn('rounded-lg border px-3 py-2',
      tone === 'red' ? 'border-destructive/30 bg-destructive/[0.04]'
        : tone === 'green' ? 'border-success/30 bg-success/[0.04]'
          : tone === 'amber' ? 'border-amber-400/40 bg-amber-50/50 dark:bg-amber-950/10'
            : 'border-border bg-muted/20')}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground font-mono">{hint}</p>}
    </div>
  );
}
