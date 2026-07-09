/**
 * Inventario por VARIANTE de color — control interno real, desprendido de la
 * "-5" de Siigo. Fuente de stock del módulo de Importaciones.
 *
 * Fase 1: subir maestra + conteo inicial (Excel) y ajuste manual por fila.
 * (Entradas por packing nacionalizado y salidas por remisión llegan en Fase 2.)
 */

import { useMemo, useRef, useState } from 'react';
import { Upload, Loader2, Layers, Search, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { readXlsxFile, isExcelFile } from '@/lib/readXlsx';
import { useInventoryVariants, parseMaestra, type InventoryVariant } from '@/hooks/useInventoryVariants';

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
}

export default function VariantInventoryPanel() {
  const { data: variants = [], isPending, importMaestra, adjustStock } = useInventoryVariants();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return variants;
    return variants.filter(
      (v) => v.variant_reference.toLowerCase().includes(s) || (v.name ?? '').toLowerCase().includes(s),
    );
  }, [variants, q]);

  const totalUnidades = useMemo(() => variants.reduce((a, v) => a + Number(v.stock ?? 0), 0), [variants]);
  const totalValor = useMemo(
    () => variants.reduce((a, v) => a + Number(v.stock ?? 0) * Number(v.avg_cost ?? 0), 0),
    [variants],
  );

  async function onFile(file: File) {
    try {
      if (!isExcelFile(file)) {
        toast({ title: 'Archivo no válido', description: 'Subí un Excel (.xlsx/.xls).', variant: 'destructive' });
        return;
      }
      const sheets = await readXlsxFile(file);
      if (!sheets.length) {
        toast({ title: 'Excel vacío', description: 'No encontré filas en el archivo.', variant: 'destructive' });
        return;
      }
      // Primera hoja con una columna "Referencia".
      let parsed = parseMaestra(sheets[0].rows);
      for (let i = 1; i < sheets.length && parsed.error; i++) parsed = parseMaestra(sheets[i].rows);
      if (parsed.error) {
        toast({ title: 'No pude leer la maestra', description: parsed.error, variant: 'destructive' });
        return;
      }
      const res = await importMaestra.mutateAsync(parsed.data);
      toast({ title: 'Maestra cargada', description: `${res.count} variantes actualizadas con su conteo inicial.` });
    } catch (e) {
      toast({ title: 'Error subiendo la maestra', description: (e as Error).message, variant: 'destructive' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function startEdit(v: InventoryVariant) {
    setEditId(v.id);
    setEditVal(String(v.stock ?? 0));
  }
  async function commitEdit(v: InventoryVariant) {
    const n = Number(editVal.replace(',', '.'));
    setEditId(null);
    if (!Number.isFinite(n) || n === Number(v.stock)) return;
    try {
      await adjustStock.mutateAsync({ id: v.id, stock: n });
      toast({ title: 'Stock ajustado', description: `${v.variant_reference} → ${fmt(n)}` });
    } catch (e) {
      toast({ title: 'No se pudo ajustar', description: (e as Error).message, variant: 'destructive' });
    }
  }

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" /> Inventario por variante
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Control interno real por color (LIV-40, LIV-40-2, LIV-40-3…), separado de la «-5» de Siigo.
            Es la fuente de stock del módulo de <strong>Importaciones</strong>. El inventario «-5» (pestaña
            Inventario) queda solo para cuadrar contra lo declarado.
          </p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={importMaestra.isPending}>
            {importMaestra.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Subir maestra + conteo
          </Button>
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-[11px] text-muted-foreground">Variantes activas</p>
          <p className="text-xl font-bold text-foreground">{fmt(variants.length)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-[11px] text-muted-foreground">Unidades en stock</p>
          <p className="text-xl font-bold text-foreground">{fmt(totalUnidades)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-[11px] text-muted-foreground">Valor (costo landed)</p>
          <p className="text-xl font-bold text-foreground">${fmt(totalValor)}</p>
        </div>
      </div>

      {isPending ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando…
        </div>
      ) : variants.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
          <Layers className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">Todavía no hay inventario por variante</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            Subí tu maestra en Excel con columnas <strong>Referencia</strong> (con sufijo de color),
            <strong> Descripción</strong>, <strong>Sistema</strong> y <strong>Stock inicial</strong>
            (opcional: <strong>Costo unitario</strong>). Mientras tanto Importaciones sigue usando la «-5».
          </p>
        </div>
      ) : (
        <>
          <div className="relative max-w-xs">
            <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar referencia o descripción…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-border bg-background"
            />
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">Referencia</th>
                    <th className="text-left font-medium px-4 py-2.5">Descripción</th>
                    <th className="text-left font-medium px-4 py-2.5">Sistema</th>
                    <th className="text-right font-medium px-4 py-2.5">Stock</th>
                    <th className="text-right font-medium px-4 py-2.5">Costo unit.</th>
                    <th className="px-2 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((v) => (
                    <tr key={v.id} className="hover:bg-muted/30">
                      <td className="px-4 py-2 font-medium text-foreground whitespace-nowrap">{v.variant_reference}</td>
                      <td className="px-4 py-2 text-muted-foreground">{v.name ?? '—'}</td>
                      <td className="px-4 py-2 text-muted-foreground">{v.system ?? '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {editId === v.id ? (
                          <input
                            autoFocus
                            value={editVal}
                            onChange={(e) => setEditVal(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit(v);
                              if (e.key === 'Escape') setEditId(null);
                            }}
                            onBlur={() => commitEdit(v)}
                            className="w-20 px-2 py-1 text-right rounded border border-primary bg-background"
                          />
                        ) : (
                          <button
                            onClick={() => startEdit(v)}
                            className="tabular-nums hover:underline decoration-dotted"
                            title="Clic para ajustar"
                          >
                            {fmt(v.stock)}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {v.avg_cost ? `$${fmt(v.avg_cost)}` : '—'}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {editId === v.id && (
                          <span className="inline-flex gap-1">
                            <Check className="h-4 w-4 text-primary cursor-pointer" onMouseDown={() => commitEdit(v)} />
                            <X className="h-4 w-4 text-muted-foreground cursor-pointer" onMouseDown={() => setEditId(null)} />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {filtered.length} de {variants.length} variantes · clic en el stock para ajustar · re-subir la maestra
            vuelve a cuadrar el conteo inicial.
          </p>
        </>
      )}
    </div>
  );
}
