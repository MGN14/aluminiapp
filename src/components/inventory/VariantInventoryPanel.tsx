/**
 * Inventario por VARIANTE de color — control interno real, desprendido de la
 * "-5" de Siigo. Fuente de stock del módulo de Importaciones.
 *
 * Fase 1: subir maestra + conteo inicial (Excel) y ajuste manual por fila.
 * (Entradas por packing nacionalizado y salidas por remisión llegan en Fase 2.)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Loader2, Layers, Search, Check, X, RefreshCcw, ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { readXlsxFile, isExcelFile } from '@/lib/readXlsx';
import { supabase } from '@/integrations/supabase/client';
import {
  applyVariantImportEntrada,
  backfillVariantRemisionesDesdeDB,
  purgeStaleImportMovements,
  computeVariantDesglose,
  fetchAllVariantMovements,
  syncVariantStockToLedger,
  type VariantDesglose,
} from '@/lib/variantInventory';
import { useInventoryVariants, parseMaestra, type InventoryVariant } from '@/hooks/useInventoryVariants';
import InventoryCountClosing from '@/components/inventory/InventoryCountClosing';

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

/** Columnas numéricas ordenables (Referencia/Descripción se buscan, no se ordenan). */
type SortKey = 'inicial' | 'contenedor' | 'remisiones' | 'stock' | 'costo';

export default function VariantInventoryPanel() {
  const { data: variants = [], isPending, importMaestra, adjustStock } = useInventoryVariants();
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [recuadrando, setRecuadrando] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortAsc, setSortAsc] = useState(false);

  // Movimientos de TODAS las variantes — para el desglose por columna
  // (reporte de Nico 2026-07-30: "siento que no suma el contenedor ni resta
  // las remisiones, es muy fijo" — con el desglose se VE de dónde sale cada
  // número y cualquier descuadre queda en evidencia).
  // PAGINADO: PostgREST corta en 1000 filas y el ledger ya pasa de eso — con
  // la historia cortada el desglose salía mal (reporte de Nico 2026-08-01).
  const { data: movs = [], isPending: movsPending } = useQuery({
    queryKey: ['inventory-variant-movs'],
    staleTime: 60_000,
    queryFn: async (): Promise<MovRow[]> => fetchAllVariantMovements(),
  });

  // Desglose: el ANCLA es el conteo (stock_inicial) o el último ajuste manual
  // posterior; encima corren contenedores (+) y remisiones (−) POSTERIORES.
  // La cuenta vive en computeVariantDesglose — compartida con el cuadre.
  // Mientras cargan los movimientos el map queda vacío (la tabla cae al
  // stock guardado) — sin esto se veía un flash con teóricos sin historia.
  const desglose = useMemo(() => {
    const out = new Map<string, VariantDesglose>();
    if (movsPending) return out;
    const porVariante = new Map<string, MovRow[]>();
    for (const m of movs) {
      const arr = porVariante.get(m.variant_id) ?? [];
      arr.push(m);
      porVariante.set(m.variant_id, arr);
    }
    for (const v of variants) {
      out.set(v.id, computeVariantDesglose(v, porVariante.get(v.id) ?? []));
    }
    return out;
  }, [variants, movs, movsPending]);

  // AUTO-CONCILIACIÓN (una pasada por sesión, sin botón): primero se concilia
  // el ledger contra remision_items — inserta descuentos que faltaban dentro
  // de la vida rastreada de cada referencia (posteriores a su ancla), corrige
  // cantidades de remisiones editadas y limpia canceladas y filas resucitadas
  // por error — y después cuadra el stock guardado al teórico. Antes solo se
  // cuadraba el stock: si el ledger estaba mal, el teórico mismo estaba mal y
  // el cuadre lo daba por bueno (reportes de Nico 2026-08-02).
  const autoCuadreCorrido = useRef(false);
  useEffect(() => {
    if (autoCuadreCorrido.current || desglose.size === 0 || movsPending) return;
    autoCuadreCorrido.current = true; // una sola pasada por sesión (sin loops)
    (async () => {
      try {
        const r = await backfillVariantRemisionesDesdeDB();
        const n = await syncVariantStockToLedger();
        const tocadas = r.insertadas + r.corregidas + r.eliminadas;
        if (tocadas > 0 || n > 0) {
          qc.invalidateQueries({ queryKey: ['inventory-variants'] });
          qc.invalidateQueries({ queryKey: ['inventory-variant-movs'] });
          qc.invalidateQueries({ queryKey: ['imports'] });
          const partes = [
            r.insertadas ? `${r.insertadas} descuento(s) de remisión que faltaban` : '',
            r.corregidas ? `${r.corregidas} cantidad(es) corregidas` : '',
            r.eliminadas ? `${r.eliminadas} residuo(s) de canceladas limpiados` : '',
            n ? `${n} stock(s) cuadrados al ledger` : '',
          ].filter(Boolean);
          toast({ title: 'Inventario cuadrado automáticamente', description: partes.join(' · ') + '.', duration: 8000 });
        }
      } catch { /* best-effort: la tabla ya muestra el teórico igual */ }
    })();
  }, [variants, desglose, movsPending, qc, toast]);

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
    // TODAS las remisiones, sin filtro de fecha: el filtro viejo (created_at
    // >= MAX ancla de TODAS las variantes) se corría a "ahora" cada vez que un
    // contenedor auto-creaba una referencia, y el recuadre terminaba sin mirar
    // casi ninguna remisión. El corte por conteo es POR VARIANTE y lo aplica
    // la conciliación (guardia last_count_date).
    const { count: remCount } = await (supabase as any)
      .from('remisiones')
      .select('id', { count: 'exact', head: true });
    const pedidos = (imps ?? []) as { id: string; ref_pedido: string | null; proveedor_nombre: string }[];
    const ok = window.confirm(
      `Voy a verificar y aplicar al inventario por variante:\n\n` +
      `· ${pedidos.length} contenedor(es) entregado(s) — entradas (crea referencias nuevas si faltan)\n` +
      `· ${remCount ?? 0} remisión(es) — se aplican los descuentos que falten, se corrigen cantidades editadas y se limpian canceladas (cada referencia respeta su propio conteo)\n\n` +
      'Lo que ya está aplicado NO se duplica. ¿Continuar?',
    );
    if (!ok) return;
    setRecuadrando(true);
    try {
      let entradas = 0;
      let creadas = 0;
      const sinMatch = new Set<string>();
      // Entradas de contenedor PISADAS por el re-anclaje del conteo: sus
      // movimientos son anteriores al ancla (el conteo redefinió el stock,
      // borrando su efecto) pero la idempotencia decía "ya aplicado" y el
      // contenedor nunca re-entraba. Se purgan esas filas muertas y se
      // aplica limpio — el stock actual no se toca al purgar.
      const { data: movImp } = await (supabase as any)
        .from('inventory_variant_movements')
        .select('source_id, created_at')
        .eq('source_type', 'import');
      const maxPorImport = new Map<string, string>();
      for (const m of (movImp ?? []) as { source_id: string | null; created_at: string }[]) {
        if (!m.source_id) continue;
        const prev = maxPorImport.get(m.source_id) ?? '';
        if (m.created_at > prev) maxPorImport.set(m.source_id, m.created_at);
      }
      for (const p of pedidos) {
        const maxMov = maxPorImport.get(p.id);
        if (maxMov && fechaAncla && maxMov <= fechaAncla) {
          await purgeStaleImportMovements(p.id, fechaAncla);
        }
        const r = await applyVariantImportEntrada(p.id);
        if (r.applied > 0) entradas += 1;
        creadas += r.created ?? 0;
        r.unmatched.forEach((u) => sinMatch.add(u));
      }
      // Conciliación remisiones ↔ ledger POR LÍNEA: inserta descuentos que
      // faltaban (variante nacida después del despacho), corrige cantidades
      // de remisiones editadas y limpia residuos de canceladas/borradas.
      const rec = await backfillVariantRemisionesDesdeDB();
      rec.unmatched.forEach((u) => sinMatch.add(u));
      const salidas = rec.insertadas + rec.corregidas + rec.eliminadas;
      // Paso final: stock guardado := teórico del ledger. Repara los saldos
      // que quedaron descuadrados por bugs viejos (las filas en ámbar) — el
      // stock ES inicial + contenedor − remisiones, sin excepciones.
      const cuadradas = await syncVariantStockToLedger();
      qc.invalidateQueries({ queryKey: ['inventory-variants'] });
      qc.invalidateQueries({ queryKey: ['inventory-variant-movs'] });
      qc.invalidateQueries({ queryKey: ['imports'] });
      toast({
        title: `Recuadre listo: ${entradas} contenedor(es) entrados${creadas ? ` (${creadas} refs nuevas)` : ''} · ${salidas} movimiento(s) de remisión conciliados${cuadradas ? ` · ${cuadradas} stocks cuadrados` : ''}`,
        description: sinMatch.size
          ? `Sin match (revisá typos): ${[...sinMatch].slice(0, 6).join(', ')}${sinMatch.size > 6 ? '…' : ''}`
          : 'Todo lo pendiente quedó aplicado y el stock quedó igual a inicial + contenedor − remisiones.',
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

  // 1er clic: mayor a menor · 2do: menor a mayor · 3ro: vuelve al orden A-Z.
  function toggleSort(k: SortKey) {
    if (sortKey !== k) {
      setSortKey(k);
      setSortAsc(false);
    } else if (!sortAsc) {
      setSortAsc(true);
    } else {
      setSortKey(null);
      setSortAsc(false);
    }
  }

  // Stock visible = TEÓRICO del ledger (inicial + contenedor − remisiones).
  // El guardado queda de cache para Importaciones y lo cuadra el auto-cuadre.
  const stockView = (v: InventoryVariant): number => desglose.get(v.id)?.teorico ?? Number(v.stock ?? 0);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const val = (v: InventoryVariant): number => {
      const d = desglose.get(v.id);
      switch (sortKey) {
        case 'inicial': return d?.ancla ?? 0;
        case 'contenedor': return d?.contenedor ?? 0;
        case 'remisiones': return d?.remisiones ?? 0;
        case 'stock': return d?.teorico ?? Number(v.stock ?? 0);
        case 'costo': return Number(v.avg_cost ?? 0);
      }
    };
    return [...filtered].sort((a, b) => (sortAsc ? val(a) - val(b) : val(b) - val(a)));
  }, [filtered, sortKey, sortAsc, desglose]);

  // Totales sobre el TEÓRICO — el mismo número que muestra cada fila.
  const totalUnidades = useMemo(
    () => variants.reduce((a, v) => a + (desglose.get(v.id)?.teorico ?? Number(v.stock ?? 0)), 0),
    [variants, desglose],
  );
  const totalValor = useMemo(
    () => variants.reduce((a, v) => a + (desglose.get(v.id)?.teorico ?? Number(v.stock ?? 0)) * Number(v.avg_cost ?? 0), 0),
    [variants, desglose],
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
    setEditVal(String(stockView(v)));
  }
  async function commitEdit(v: InventoryVariant) {
    const n = Number(editVal.replace(',', '.'));
    setEditId(null);
    // Comparar contra lo VISIBLE (teórico): cerrar sin cambiar no debe
    // registrar un ajuste fantasma.
    if (!Number.isFinite(n) || n === stockView(v)) return;
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

      {/* Cierre de inventario: subir conteo → revisar diferencias → confirmar
          (solo admin) → el conteo queda como fuente de verdad. */}
      <InventoryCountClosing />

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
                        − remisiones = lo que debe haber físicamente. Las
                        columnas numéricas ordenan con clic (mayor a menor →
                        menor a mayor → orden A-Z). */}
                    {([
                      ['inicial', 'Inicial', 'Tu conteo inicial (o el último ajuste manual)', 'px-3'],
                      ['contenedor', '+ Contenedor', 'Entradas de contenedores posteriores al conteo', 'px-3'],
                      ['remisiones', '− Remisiones', 'Salidas por remisión posteriores al conteo (las compras suman)', 'px-3'],
                      ['stock', 'Stock', 'Inicial + contenedor − remisiones — calculado del ledger, siempre suma.', 'px-4'],
                      ['costo', 'Costo unit.', 'Costo landed promedio por unidad', 'px-4'],
                    ] as [SortKey, string, string, string][]).map(([key, label, tip, px]) => (
                      <th key={key} className={`text-right font-medium ${px} py-2.5`}>
                        <button
                          onClick={() => toggleSort(key)}
                          title={`${tip} · Clic para ordenar`}
                          className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${sortKey === key ? 'text-foreground' : ''}`}
                        >
                          {label}
                          {sortKey === key
                            ? (sortAsc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
                            : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                        </button>
                      </th>
                    ))}
                    <th className="px-2 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sorted.map((v) => {
                    const d = desglose.get(v.id);
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
                      {/* SIEMPRE el teórico: inicial + contenedor − remisiones.
                          La fila suma por construcción — ya no hay ámbar. */}
                      <td className="px-4 py-2 text-right tabular-nums font-medium">
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
                            title="Clic para ajustar (el ajuste re-ancla el conteo de esta referencia)"
                          >
                            {fmt(stockView(v))}
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
