/**
 * Inventario por VARIANTE de color — control interno real, desprendido de la
 * "-5" de Siigo. Fuente de stock del módulo de Importaciones.
 *
 * Fase 1: subir maestra + conteo inicial (Excel) y ajuste manual por fila.
 * (Entradas por packing nacionalizado y salidas por remisión llegan en Fase 2.)
 */

import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Loader2, Layers, Search, Check, X, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { readXlsxFile, isExcelFile } from '@/lib/readXlsx';
import { supabase } from '@/integrations/supabase/client';
import { applyVariantImportEntrada, applyVariantRemision } from '@/lib/variantInventory';
import { useInventoryVariants, parseMaestra, type InventoryVariant } from '@/hooks/useInventoryVariants';

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);
}

interface MovRow {
  variant_id: string;
  movement_type: string;
  quantity: number;
  source_type: string | null;
  created_at: string;
}

/** Desglose por variante: ancla (conteo/ajuste) + contenedores − remisiones. */
interface Desglose {
  ancla: number;
  contenedor: number;
  remisiones: number; // ventas − compras (neto que RESTA)
  teorico: number;
}

export default function VariantInventoryPanel() {
  const { data: variants = [], isPending, importMaestra, adjustStock } = useInventoryVariants();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [recuadrando, setRecuadrando] = useState(false);

  // Movimientos de TODAS las variantes — para el desglose por columna
  // (reporte de Nico 2026-07-30: "siento que no suma el contenedor ni resta
  // las remisiones, es muy fijo" — con el desglose se VE de dónde sale cada
  // número y cualquier descuadre queda en evidencia).
  const { data: movs = [] } = useQuery({
    queryKey: ['inventory-variant-movs'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('inventory_variant_movements')
        .select('variant_id, movement_type, quantity, source_type, created_at');
      return (data ?? []) as MovRow[];
    },
  });

  // Desglose: el ANCLA es el conteo (stock_inicial) o el último ajuste manual
  // posterior; encima corren contenedores (+) y remisiones (−) POSTERIORES.
  const desglose = useMemo(() => {
    const porVariante = new Map<string, MovRow[]>();
    for (const m of movs) {
      const arr = porVariante.get(m.variant_id) ?? [];
      arr.push(m);
      porVariante.set(m.variant_id, arr);
    }
    const out = new Map<string, Desglose>();
    for (const v of variants) {
      const lista = porVariante.get(v.id) ?? [];
      let anclaTime = v.stock_inicial_date ?? '';
      let ancla = Number(v.stock_inicial ?? 0);
      for (const m of lista) {
        if (m.movement_type === 'ajuste' && m.created_at > anclaTime) {
          anclaTime = m.created_at;
          ancla = Number(m.quantity ?? 0); // el ajuste guarda el stock ABSOLUTO
        }
      }
      let contenedor = 0;
      let remisiones = 0;
      for (const m of lista) {
        if (m.created_at <= anclaTime) continue; // ya está dentro del ancla
        const qty = Number(m.quantity ?? 0);
        if (m.source_type === 'import' && m.movement_type === 'entrada') contenedor += qty;
        if (m.source_type === 'remision' && m.movement_type === 'salida') remisiones += qty;
        if (m.source_type === 'remision' && m.movement_type === 'entrada') remisiones -= qty;
      }
      out.set(v.id, { ancla, contenedor, remisiones, teorico: ancla + contenedor - remisiones });
    }
    return out;
  }, [variants, movs]);

  /**
   * RECUADRE: aplica lo que quedó sin aplicar por los bugs viejos (refs que
   * no matcheaban, contenedor aplicado con código anterior). Idempotente —
   * lo ya aplicado no se duplica (chequeo por fuente).
   */
  async function recuadrar() {
    const fechaAncla = variants.reduce((mx, v) => ((v.stock_inicial_date ?? '') > mx ? v.stock_inicial_date! : mx), '');
    const { data: imps } = await (supabase as any)
      .from('imports')
      .select('id, ref_pedido, proveedor_nombre')
      .in('estado', ['entregado', 'cerrado']);
    const { data: rems } = await (supabase as any)
      .from('remisiones')
      .select('id, number, date, created_at, remision_type, status, remision_items(reference, units)')
      .neq('status', 'cancelado')
      .gte('created_at', fechaAncla || '1970-01-01');
    const pedidos = (imps ?? []) as { id: string; ref_pedido: string | null; proveedor_nombre: string }[];
    const remisiones = (rems ?? []) as { id: string; number: string; date: string; remision_type: 'venta' | 'compra'; remision_items: { reference: string; units: number }[] }[];
    const ok = window.confirm(
      `Voy a verificar y aplicar al inventario por variante:\n\n` +
      `· ${pedidos.length} contenedor(es) entregado(s) — entradas (crea referencias nuevas si faltan)\n` +
      `· ${remisiones.length} remisión(es) posteriores al conteo — salidas\n\n` +
      'Lo que ya está aplicado NO se duplica. ¿Continuar?',
    );
    if (!ok) return;
    setRecuadrando(true);
    try {
      let entradas = 0;
      let creadas = 0;
      let salidas = 0;
      const sinMatch = new Set<string>();
      for (const p of pedidos) {
        const r = await applyVariantImportEntrada(p.id);
        if (r.applied > 0) entradas += 1;
        creadas += r.created ?? 0;
        r.unmatched.forEach((u) => sinMatch.add(u));
      }
      for (const rem of remisiones) {
        const r = await applyVariantRemision({
          remisionId: rem.id,
          remisionType: rem.remision_type === 'compra' ? 'compra' : 'venta',
          movementDate: rem.date,
          items: (rem.remision_items ?? []).map((i) => ({ reference: i.reference, units: Number(i.units ?? 0) })),
        });
        if (r.applied > 0) salidas += 1;
        r.unmatched.forEach((u) => sinMatch.add(u));
      }
      qc.invalidateQueries({ queryKey: ['inventory-variants'] });
      qc.invalidateQueries({ queryKey: ['inventory-variant-movs'] });
      qc.invalidateQueries({ queryKey: ['imports'] });
      toast({
        title: `Recuadre listo: ${entradas} contenedor(es) entrados${creadas ? ` (${creadas} refs nuevas)` : ''} · ${salidas} remisión(es) descontadas`,
        description: sinMatch.size
          ? `Sin match (revisá typos): ${[...sinMatch].slice(0, 6).join(', ')}${sinMatch.size > 6 ? '…' : ''}`
          : 'Todo lo pendiente quedó aplicado. El desglose de la tabla ya lo refleja.',
        duration: 12000,
      });
    } catch (e) {
      toast({ title: 'Error en el recuadre', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setRecuadrando(false);
    }
  }

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
      // Conteo COMPLETO: lo que no aparece en el archivo queda en 0 — evita
      // que variantes viejas arrastren negativos de meses de salidas. Se
      // confirma porque pone en 0 lo no contado (irreversible sin re-subir).
      const conteoCompleto = window.confirm(
        `Leí ${parsed.data.length} referencias del archivo.\n\n` +
        '¿Este archivo es el conteo COMPLETO de la bodega?\n\n' +
        '· Aceptar: lo que NO aparece en el archivo queda con stock 0 (se contó todo y no estaba).\n' +
        '· Cancelar: solo se actualizan las referencias del archivo; el resto queda como está.',
      );
      const res = await importMaestra.mutateAsync({ filas: parsed.data, conteoCompleto });
      toast({
        title: 'Maestra cargada',
        description: `${res.count} variantes ancladas al conteo${res.ancladasEnCero > 0 ? ` · ${res.ancladasEnCero} que no venían en el archivo quedaron en 0` : ''}.`,
        duration: 9000,
      });
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
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={recuadrar}
              disabled={recuadrando || variants.length === 0}
              title="Aplica lo que quedó pendiente: entradas de contenedores entregados (crea refs nuevas) y salidas de remisiones posteriores al conteo. Idempotente — no duplica."
            >
              {recuadrando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              Recuadrar movimientos
            </Button>
            <Button onClick={() => fileRef.current?.click()} disabled={importMaestra.isPending}>
              {importMaestra.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Subir maestra + conteo
            </Button>
          </div>
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
                    {/* La cuenta VISIBLE (pedido de Nico): conteo + contenedor
                        − remisiones = lo que debe haber físicamente. */}
                    <th className="text-right font-medium px-3 py-2.5" title="Tu conteo inicial (o el último ajuste manual)">Inicial</th>
                    <th className="text-right font-medium px-3 py-2.5" title="Entradas de contenedores posteriores al conteo">+ Contenedor</th>
                    <th className="text-right font-medium px-3 py-2.5" title="Salidas por remisión posteriores al conteo (las compras suman)">− Remisiones</th>
                    <th className="text-right font-medium px-4 py-2.5" title="Inicial + contenedor − remisiones = lo que debe haber. Si difiere del stock, se marca en ámbar.">Stock</th>
                    <th className="text-right font-medium px-4 py-2.5">Costo unit.</th>
                    <th className="px-2 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((v) => {
                    const d = desglose.get(v.id);
                    const descuadre = d != null && Math.round(Number(v.stock ?? 0)) !== Math.round(d.teorico);
                    return (
                    <tr key={v.id} className="hover:bg-muted/30">
                      <td className="px-4 py-2 font-medium text-foreground whitespace-nowrap">{v.variant_reference}</td>
                      <td className="px-4 py-2 text-muted-foreground">{v.name ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{d ? fmt(d.ancla) : '—'}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${d && d.contenedor > 0 ? 'text-success font-medium' : 'text-muted-foreground'}`}>
                        {d && d.contenedor > 0 ? `+${fmt(d.contenedor)}` : '—'}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${d && d.remisiones !== 0 ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                        {d && d.remisiones !== 0 ? `−${fmt(d.remisiones)}` : '—'}
                      </td>
                      <td className={`px-4 py-2 text-right tabular-nums ${descuadre ? 'bg-amber-50 dark:bg-amber-950/20' : ''}`}
                        title={descuadre && d ? `Descuadre: el teórico (inicial + contenedor − remisiones) da ${fmt(d.teorico)} pero el stock dice ${fmt(v.stock)} — probá "Recuadrar movimientos" o ajustá a mano` : undefined}>
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
                    );
                  })}
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
