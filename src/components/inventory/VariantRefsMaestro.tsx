/**
 * REFERENCIAS POR VARIANTE — la fuente de verdad de referencias del
 * inventario interno (decisión de Nico, 2026-08-04).
 *
 * Acá se sube el listado COMPLETO de referencias (con sufijo de color). Con
 * esto toda línea de remisión cruza y descuenta; la Fase 1 encontró 824
 * unidades despachadas que nunca descontaron porque su referencia no existía
 * (el auto-create desde contenedores no alcanzaba).
 *
 * SOLO crea/actualiza referencias (nombre, sistema, piezas por paquete y peso
 * por pieza). NUNCA toca stock, costo ni conteos — eso es del conteo de bodega
 * (Cierre de inventario).
 *
 * Paquete y peso (2026-11-12): los usa el cargue de la remisión para contar
 * paquetes y planear el camión por peso. Se suben en el Excel, se editan en la
 * tabla, se sugieren desde los packing lists de Importaciones y se aprenden
 * desde el plan de cargue.
 */

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Search, Upload, Wand2, Copy, Pencil, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { readXlsxFile, isExcelFile } from '@/lib/readXlsx';
import { applyColorSuffix, canonicalizeRef, colorLabel } from '@/lib/refFamily';
import { fetchAllPaged } from '@/lib/fetchAllPaged';
import { resolverEmpaques, type ImportItemLite } from '@/lib/cargueEmpaque';
import { esFaltaColumna, parseDecimal, planGuardadoEmpaque, type CambioEmpaque } from '@/lib/referenciaEmpaque';

const db = supabase as never as { from: (t: string) => any };

interface VariantRef {
  id: string;
  variant_reference: string;
  name: string | null;
  system: string | null;
  active: boolean;
  catalog_color?: string | null;
  unidades_por_paquete?: number | null;
  kg_por_unidad?: number | null;
}

interface FilaArchivo {
  reference: string;
  name: string;
  system: string;
  /** Piezas por paquete (opcional en el Excel). */
  porPaquete?: number | null;
  /** Peso de una pieza en kg (opcional en el Excel). */
  kg?: number | null;
}

const HINTS = {
  reference: /^\s*ref\.?\s*$|refer|c[oó]digo|sku/i,
  name: /descrip|nombre/i,
  system: /sistema|l[ií]nea|grupo/i,
  color: /^\s*color(es)?\s*$/i,
  paquete: /paquete|empaque|piezas?\s*x|unid.*paq|por\s*paq/i,
  peso: /peso|kg|kilo/i,
};

/**
 * Parser laxo: solo exige la columna de referencia. Descripción, sistema y
 * color son opcionales; columnas de stock/costo se IGNORAN a propósito.
 */
export function parseReferencias(rows: string[][]): { data: FilaArchivo[]; error: string | null } {
  if (!rows.length) return { data: [], error: 'La hoja está vacía.' };
  const headerIdx = rows.findIndex((r) => r.some((c) => HINTS.reference.test(c)));
  if (headerIdx < 0) return { data: [], error: 'No encontré una columna "Referencia" (REF, Código, SKU…).' };
  const header = rows[headerIdx];
  const col = (h: RegExp) => header.findIndex((c) => h.test(c));
  const iRef = col(HINTS.reference);
  const iName = col(HINTS.name);
  const iSys = col(HINTS.system);
  const iColor = col(HINTS.color);
  const iPaq = col(HINTS.paquete);
  const iPeso = col(HINTS.peso);

  const acc = new Map<string, FilaArchivo>();
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const rawRef = (r[iRef] ?? '').trim();
    if (!rawRef || /^(total|nota|tope)/i.test(rawRef)) continue;
    const conSufijo = iColor >= 0 ? applyColorSuffix(rawRef, r[iColor] ?? null) : rawRef;
    const reference = conSufijo.trim().toUpperCase();
    const canon = canonicalizeRef(reference);
    if (!canon) continue;
    const prev = acc.get(canon);
    const paq = iPaq >= 0 ? parseDecimal(r[iPaq] ?? '') : null;
    const fila: FilaArchivo = {
      reference,
      name: iName >= 0 ? (r[iName] ?? '').trim() : '',
      system: iSys >= 0 ? (r[iSys] ?? '').trim() : '',
      porPaquete: paq != null ? Math.round(paq) : null,
      kg: iPeso >= 0 ? parseDecimal(r[iPeso] ?? '') : null,
    };
    if (prev) {
      if (!prev.name && fila.name) prev.name = fila.name;
      if (!prev.system && fila.system) prev.system = fila.system;
      if (prev.porPaquete == null && fila.porPaquete != null) prev.porPaquete = fila.porPaquete;
      if (prev.kg == null && fila.kg != null) prev.kg = fila.kg;
    } else {
      acc.set(canon, fila);
    }
  }
  const data = [...acc.values()];
  return data.length ? { data, error: null } : { data: [], error: 'No hay filas de datos debajo del encabezado.' };
}

export default function VariantRefsMaestro({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');

  const [system, setSystem] = useState('');
  const [color, setColor] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<VariantRef | null>(null);
  const { data: refsData, isPending, isError, refetch } = useQuery({
    queryKey: ['variant-refs-maestro'],
    queryFn: async () => {
      const refs = await fetchAllPaged<VariantRef>((from, to) =>
        db.from('inventory_variants').select('*').order('variant_reference').order('id').range(from, to));
      if (refs.length) {
        return {
          refs,
          faltaMigracion: !('unidades_por_paquete' in refs[0] && 'kg_por_unidad' in refs[0]),
          colorEditable: 'catalog_color' in refs[0],
        };
      }
      const { error } = await db.from('inventory_variants').select('unidades_por_paquete, kg_por_unidad').limit(1);
      if (error && !esFaltaColumna(error)) throw error;
      return { refs, faltaMigracion: !!error, colorEditable: false };
    },
    staleTime: 60_000,
  });
  const refs = useMemo(() => refsData?.refs ?? [], [refsData]);
  const faltaMigracion = !!refsData?.faltaMigracion;

  // Packing lists de Importaciones: sugerencia de paquete y peso.
  const { data: importItems = [] } = useQuery({
    queryKey: ['cargue-import-items', 'maestro'],
    staleTime: 30 * 60_000,
    queryFn: async () => {
      try {
        return await fetchAllPaged<ImportItemLite>((from, to) =>
          db.from('import_items').select('reference, cantidad, bultos, unidad, peso_kg, created_at')
            .order('created_at', { ascending: true }).range(from, to), { maxRows: 20_000 });
      } catch { return [] as ImportItemLite[]; }
    },
  });
  const sugerencias = useMemo(() => resolverEmpaques(
    refs.map((r) => ({ key: canonicalizeRef(r.variant_reference), reference: r.variant_reference })),
    canonicalizeRef,
    { importItems },
  ), [refs, importItems]);
  const sugerenciaDe = (r: VariantRef) => {
    const e = sugerencias[canonicalizeRef(r.variant_reference)];
    const pp = e && e.fuente.startsWith('contenedor') ? e.porPaquete : null;
    return { pp, kg: e?.kgPorUnidad ?? null, familia: e?.fuente === 'contenedor-familia' };
  };

  const guardar = useMutation({
    mutationFn: async (p: { reference: string; cambio: CambioEmpaque; todosLosColores?: boolean }) => {
      const plan = planGuardadoEmpaque(
        refs.filter((r) => r.active).map((r) => ({ id: r.id, variant_reference: r.variant_reference, unidades_por_paquete: r.unidades_por_paquete ?? null, kg_por_unidad: r.kg_por_unidad ?? null })),
        p.reference, p.cambio, p.todosLosColores,
      );
      for (const { id, patch } of plan) {
        const { error } = await db.from('inventory_variants').update(patch).eq('id', id);
        if (error) throw error;
      }
      return plan.length;
    },
    onSuccess: (n, p) => {
      qc.invalidateQueries({ queryKey: ['variant-refs-maestro'] });
      qc.invalidateQueries({ queryKey: ['cargue-variantes-empaque'] });
      qc.invalidateQueries({ queryKey: ['inventory-variants'] });
      if (n > 1) toast({ title: `${p.reference}: guardado en ${n} referencias`, description: p.todosLosColores ? 'Se aplicó a todos los colores de la familia.' : 'También se llenaron los otros colores que no tenían dato.' });
    },
    onError: (e) => toast({ title: 'No se pudo guardar', description: (e as Error).message, variant: 'destructive' }),
  });

  const guardarFila = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, string | number | null> }) => {
      const { error } = await db.from('inventory_variants').update(patch).eq('id', id).select('id').single();
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['variant-refs-maestro'] }),
        qc.invalidateQueries({ queryKey: ['inventory-variants'] }),
        qc.invalidateQueries({ queryKey: ['cargue-variantes-empaque'] }),
      ]);
      setEditing(null);
      toast({ title: 'Referencia actualizada' });
    },
    onError: (e) => toast({ title: 'No se pudo guardar', description: (e as Error).message, variant: 'destructive' }),
  });

  /** Llena con la sugerencia del contenedor todo lo que esté vacío. */
  const usarTodas = useMutation({
    mutationFn: async () => {
      let n = 0;
      for (const r of refs.filter((x) => x.active)) {
        const sug = sugerenciaDe(r);
        const patch: CambioEmpaque = {};
        if (r.unidades_por_paquete == null && sug.pp) patch.unidades_por_paquete = sug.pp;
        if (r.kg_por_unidad == null && sug.kg) patch.kg_por_unidad = Math.round(sug.kg * 1000) / 1000;
        if (!Object.keys(patch).length) continue;
        const { error } = await db.from('inventory_variants').update(patch).eq('id', r.id);
        if (error) throw error;
        n++;
      }
      return n;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ['variant-refs-maestro'] });
      qc.invalidateQueries({ queryKey: ['cargue-variantes-empaque'] });
      qc.invalidateQueries({ queryKey: ['inventory-variants'] });
      toast({ title: `${n} referencias completadas con los packing lists`, description: 'Las que queden vacías no vinieron en ningún contenedor: llenalas a mano o en el Excel.' });
    },
    onError: (e) => toast({ title: 'No se pudo completar', description: (e as Error).message, variant: 'destructive' }),
  });

  const subir = useMutation({
    mutationFn: async (filas: FilaArchivo[]) => {
      // Cruce canónico contra lo existente: "38*38-3" y "38X38-3" son la
      // misma variante — respetar la escritura ya registrada.
      const existentes = await fetchAllPaged<VariantRef>((from, to) =>
        db.from('inventory_variants')
          .select(faltaMigracion ? 'id, variant_reference, name, system, active' : 'id, variant_reference, name, system, active, unidades_por_paquete, kg_por_unidad')
          .order('id').range(from, to));
      const porCanon = new Map<string, VariantRef>();
      for (const v of existentes) {
        const k = canonicalizeRef(v.variant_reference);
        if (k && !porCanon.has(k)) porCanon.set(k, v);
      }

      let creadas = 0;
      let actualizadas = 0;
      let reactivadas = 0;
      const nuevas: Record<string, unknown>[] = [];
      for (const f of filas) {
        const v = porCanon.get(canonicalizeRef(f.reference));
        if (!v) {
          // Nueva: nace SIN stock — el conteo de bodega es quien pone números.
          nuevas.push({
            variant_reference: f.reference,
            name: f.name || null,
            system: f.system || null,
            stock: 0,
            avg_cost: 0,
            stock_inicial: 0,
            active: true,
            ...(!faltaMigracion && f.porPaquete ? { unidades_por_paquete: f.porPaquete } : {}),
            ...(!faltaMigracion && f.kg ? { kg_por_unidad: f.kg } : {}),
          });
          creadas++;
          continue;
        }
        const patch: Record<string, unknown> = {};
        if (f.name && f.name !== (v.name ?? '')) patch.name = f.name;
        if (f.system && f.system !== (v.system ?? '')) patch.system = f.system;
        if (!faltaMigracion && f.porPaquete && f.porPaquete !== (v.unidades_por_paquete ?? null)) patch.unidades_por_paquete = f.porPaquete;
        if (!faltaMigracion && f.kg && f.kg !== (v.kg_por_unidad ?? null)) patch.kg_por_unidad = f.kg;
        if (!v.active) { patch.active = true; reactivadas++; }
        if (Object.keys(patch).length) {
          const { error } = await db.from('inventory_variants').update(patch).eq('id', v.id);
          if (error) throw error;
          actualizadas++;
        }
      }
      for (let i = 0; i < nuevas.length; i += 500) {
        const { error } = await db
          .from('inventory_variants')
          .upsert(nuevas.slice(i, i + 500), { onConflict: 'user_id,variant_reference' });
        if (error) throw error;
      }
      return { creadas, actualizadas, reactivadas, total: filas.length };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['variant-refs-maestro'] });
      qc.invalidateQueries({ queryKey: ['inventory-variants'] });
      qc.invalidateQueries({ queryKey: ['remisiones-sin-cruce'] });
      qc.invalidateQueries({ queryKey: ['cargue-variantes-empaque'] });
      toast({
        title: `Referencias cargadas: ${r.creadas} nuevas · ${r.actualizadas} actualizadas${r.reactivadas ? ` · ${r.reactivadas} reactivadas` : ''}`,
        description: `${r.total} referencias en el archivo. El stock NO se tocó — eso lo pone el conteo de bodega. Si había remisiones sin cruce, andá a Por variante y apretá «Recuadrar movimientos».`,
        duration: 12000,
      });
    },
    onError: (e) => toast({ title: 'Error subiendo referencias', description: (e as Error).message, variant: 'destructive' }),
  });

  async function onFile(file: File) {
    try {
      if (!isExcelFile(file)) {
        toast({ title: 'Archivo no válido', description: 'Subí un Excel (.xlsx/.xls).', variant: 'destructive' });
        return;
      }
      const sheets = await readXlsxFile(file);
      let parsed = parseReferencias(sheets[0]?.rows ?? []);
      for (let i = 1; i < sheets.length && parsed.error; i++) parsed = parseReferencias(sheets[i].rows);
      if (parsed.error) {
        toast({ title: 'No pude leer el archivo', description: parsed.error, variant: 'destructive' });
        return;
      }
      if (faltaMigracion && parsed.data.some((row) => row.porPaquete != null || row.kg != null)) {
        toast({ title: 'El guardado de empaque y peso está pendiente', description: 'Habilitá esos campos en la base antes de subir el archivo con esos datos.', variant: 'destructive' });
        return;
      }
      if (!window.confirm(
        `Leí ${parsed.data.length} referencias.\n\n` +
        'Se crean las que falten y se actualiza nombre, sistema, paquete y peso de las existentes. ' +
        'El stock y los costos NO se tocan.\n\n¿Continuar?',
      )) return;
      subir.mutate(parsed.data);
    } catch (error) {
      toast({ title: 'No se pudo leer el Excel', description: (error as Error).message, variant: 'destructive' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const [soloSinDato, setSoloSinDato] = useState(false);
  const activas = useMemo(() => refs.filter((r) => r.active), [refs]);
  const sinDato = useMemo(() => activas.filter((r) => r.unidades_por_paquete == null || r.kg_por_unidad == null).length, [activas]);
  const conSugerencia = activas.filter((r) => {
    const sug = sugerenciaDe(r);
    return (r.unidades_por_paquete == null && !!sug.pp) || (r.kg_por_unidad == null && !!sug.kg);
  }).length;
  const systems = [...new Set(activas.map((r) => r.system).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, 'es'));
  const colors = [...new Set(activas.map(getColor))].sort((a, b) => a.localeCompare(b, 'es'));
  const search = q.trim().toLocaleLowerCase('es-CO');
  const visibles = activas.filter((r) =>
    (!search || [r.variant_reference, r.name].some((value) => value?.toLocaleLowerCase('es-CO').includes(search))) &&
    (!system || (r.system ?? '') === system) &&
    (!color || getColor(r) === color) &&
    (!soloSinDato || r.unidades_por_paquete == null || r.kg_por_unidad == null)
  );
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(visibles.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * pageSize;
  const filtered = !!(q || system || color || soloSinDato);
  const colorEditable = !!refsData?.colorEditable;
  const busy = guardar.isPending || guardarFila.isPending || usarTodas.isPending || subir.isPending;

  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm" aria-label="Referencias por variante">
      <div className="space-y-4 border-b p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Referencias por variante</h3>
            <p className="mt-1 text-sm text-muted-foreground">Administrá los datos de cada referencia del inventario interno.</p>
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              {!faltaMigracion && conSugerencia > 0 && (
                <Button size="sm" variant="outline" disabled={busy || !!editing}
                  onClick={() => { if (window.confirm(`¿Completar ${conSugerencia} referencias con datos de los contenedores?`)) usarTodas.mutate(); }}>
                  <Wand2 className="mr-2 h-4 w-4" /> Completar desde contenedores
                </Button>
              )}
              <Button size="sm" disabled={busy || !!editing || isPending || isError} onClick={() => fileRef.current?.click()}>
                {subir.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Subí referencias
              </Button>
              <details className="w-full text-xs text-muted-foreground">
                <summary className="w-fit cursor-pointer">Formato del Excel</summary>
                <p className="mt-1">REF obligatoria · Descripción · Sistema · Color (sufijo) · Paquete (piezas) · Peso (kg por pieza)</p>
              </details>
            </div>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1fr)_minmax(9rem,auto)_minmax(9rem,auto)_auto_auto]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <input aria-label="Buscar referencia o descripción" value={q} placeholder="Buscá referencia o descripción"
              onChange={(e) => { setQ(e.target.value); setPage(1); }} className={fieldClass + ' pl-9'} />
          </label>
          <select aria-label="Filtrar por sistema" value={system} onChange={(e) => { setSystem(e.target.value); setPage(1); }} className={fieldClass}>
            <option value="">Todos los sistemas</option>
            {systems.map((value) => <option key={value}>{value}</option>)}
          </select>
          <select aria-label="Filtrar por color" value={color} onChange={(e) => { setColor(e.target.value); setPage(1); }} className={fieldClass}>
            <option value="">Todos los colores</option>
            {colors.map((value) => <option key={value}>{value}</option>)}
          </select>
          {!faltaMigracion && (
            <Button variant={soloSinDato ? 'secondary' : 'outline'} aria-pressed={soloSinDato}
              onClick={() => { setSoloSinDato(!soloSinDato); setPage(1); }}>Sin paquete o peso · {sinDato}</Button>
          )}
          {filtered && <Button variant="ghost" onClick={() => { setQ(''); setSystem(''); setColor(''); setSoloSinDato(false); setPage(1); }}>Limpiá filtros</Button>}
        </div>
        {canEdit && refsData && (faltaMigracion || !colorEditable) && (
          <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">
            Habilitá en la base el guardado de {faltaMigracion && !colorEditable ? 'color de catálogo, piezas y peso' : faltaMigracion ? 'piezas y peso' : 'color de catálogo'}.
          </p>
        )}
      </div>

      {isError ? (
        <div className="p-8 text-center text-sm">No se pudieron cargar las referencias. <Button variant="outline" onClick={() => refetch()}>Reintentá</Button></div>
      ) : isPending ? (
        <div role="status" className="flex justify-center gap-2 p-12 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Cargando referencias…</div>
      ) : (
        <>
          <div className="md:max-h-[65vh] md:overflow-auto">
            <table className="block w-full text-sm md:table">
              <thead className="sr-only bg-muted md:not-sr-only md:sticky md:top-0 md:z-10">
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-3">Referencia</th>
                  <th scope="col" className="px-3 py-3">Sistema</th>
                  <th scope="col" className="px-3 py-3">Color</th>
                  <th scope="col" className="px-3 py-3 text-right">Piezas por paquete</th>
                  <th scope="col" className="px-3 py-3 text-right">Peso por pieza</th>
                  {canEdit && <th scope="col" className="px-4 py-3 text-right">Acciones</th>}
                </tr>
              </thead>
              <tbody className="block md:table-row-group">
                {!visibles.length && <tr className="block md:table-row"><td className="block p-8 text-center text-muted-foreground md:table-cell" colSpan={canEdit ? 6 : 5}>{filtered ? 'No hay referencias con esos filtros.' : 'Todavía no hay referencias activas.'}</td></tr>}
                {visibles.slice(offset, offset + pageSize).map((r) => {
                  return (
                    <tr key={r.id} className="grid grid-cols-2 gap-3 border-b p-4 last:border-b-0 md:table-row md:p-0 md:hover:bg-muted/30">
                      <td className="col-span-2 md:px-4 md:py-3">
                        <span className="font-semibold">{r.variant_reference}</span>
                        {r.name && <span className="mt-0.5 block text-xs text-muted-foreground">{r.name}</span>}
                      </td>
                      <td className="md:px-3 md:py-3"><MobileLabel>Sistema</MobileLabel>{r.system || 'Sin sistema'}</td>
                      <td className="md:px-3 md:py-3"><MobileLabel>Color</MobileLabel><span className="inline-block rounded-md bg-muted px-2 py-0.5 text-xs capitalize">{getColor(r)}</span></td>
                      <td className="tabular-nums md:px-3 md:py-3 md:text-right"><MobileLabel>Piezas por paquete</MobileLabel>{formatMeasure(r.unidades_por_paquete, 'piezas', faltaMigracion)}</td>
                      <td className="tabular-nums md:px-3 md:py-3 md:text-right"><MobileLabel>Peso por pieza</MobileLabel>{formatMeasure(r.kg_por_unidad, 'kg', faltaMigracion)}</td>
                      {canEdit && (
                        <td className="col-span-2 md:px-4 md:py-2 md:text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" disabled={busy} aria-label={`Editar ${r.variant_reference}`} onClick={() => setEditing(r)}>
                              <Pencil className="mr-1.5 h-3.5 w-3.5" /> Editá
                            </Button>
                            {!faltaMigracion && (r.unidades_por_paquete != null || r.kg_por_unidad != null) && (
                              <Button size="icon" variant="ghost" className="h-9 w-9" disabled={busy}
                                aria-label={`Aplicar empaque y peso de ${r.variant_reference} a todos sus colores`}
                                title="Aplicar empaque y peso a todos sus colores"
                                onClick={() => {
                                  const cambio: CambioEmpaque = {};
                                  if (r.unidades_por_paquete != null) cambio.unidades_por_paquete = r.unidades_por_paquete;
                                  if (r.kg_por_unidad != null) cambio.kg_por_unidad = r.kg_por_unidad;
                                  if (window.confirm(`¿Reemplazar el empaque y peso de todos los colores con los datos de ${r.variant_reference}?`)) {
                                    guardar.mutate({ reference: r.variant_reference, cambio, todosLosColores: true });
                                  }
                                }}>
                                <Copy className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
            <p className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
              {visibles.length ? `${offset + 1}–${Math.min(offset + pageSize, visibles.length)} de ${visibles.length}` : '0 resultados'} · {activas.length} activas
            </p>
            <div className="flex items-center gap-2">
              <Button size="icon" variant="outline" aria-label="Página anterior" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="text-xs tabular-nums">{currentPage} de {pageCount}</span>
              <Button size="icon" variant="outline" aria-label="Página siguiente" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </>
      )}
      {canEdit && editing && <VariantEditor row={editing} systems={systems} colors={colors}
        suggestion={sugerenciaDe(editing)} faltaMigracion={faltaMigracion} colorEditable={colorEditable}
        saving={guardarFila.isPending} onClose={() => setEditing(null)}
        onSave={(patch) => guardarFila.mutate({ id: editing.id, patch })} />}
    </section>
  );
}

const fieldClass = 'h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const numberFormat = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 });
const getColor = (r: VariantRef) => r.catalog_color?.trim() || colorLabel(r.variant_reference);

function formatMeasure(value: number | null | undefined, unit: string, unavailable: boolean) {
  if (value != null) return `${numberFormat.format(value)} ${unit}`;
  return <span className="text-xs text-muted-foreground">{unavailable ? 'Por habilitar' : 'Sin dato'}</span>;
}

function MobileLabel({ children }: { children: string }) {
  return <span className="mb-0.5 block text-xs text-muted-foreground md:hidden">{children}</span>;
}

function VariantEditor({ row, systems, colors, suggestion, faltaMigracion, colorEditable, saving, onClose, onSave }: {
  row: VariantRef;
  systems: string[];
  colors: string[];
  suggestion: { pp: number | null; kg: number | null; familia: boolean };
  faltaMigracion: boolean;
  colorEditable: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (patch: Record<string, string | number | null>) => void;
}) {
  const [system, setSystem] = useState(row.system ?? '');
  const [color, setColor] = useState(row.catalog_color ?? '');
  const [pieces, setPieces] = useState(String(row.unidades_por_paquete ?? ''));
  const [weight, setWeight] = useState(String(row.kg_por_unidad ?? '').replace('.', ','));
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const count = pieces.trim() ? Number(pieces.trim()) : null;
    const kg = weight.trim() ? Number(weight.trim().replace(',', '.')) : null;
    if (!faltaMigracion && count !== null && count !== row.unidades_por_paquete && (!/^\d+$/.test(pieces.trim()) || !Number.isSafeInteger(count) || count < 1)) {
      setError('Ingresá una cantidad entera de piezas mayor que cero.');
      return;
    }
    if (!faltaMigracion && kg !== null && kg !== row.kg_por_unidad && (!/^\d+(?:[.,]\d{1,3})?$/.test(weight.trim()) || !Number.isFinite(kg) || kg <= 0)) {
      setError('Ingresá un peso mayor que cero, con hasta tres decimales.');
      return;
    }
    const patch: Record<string, string | number | null> = {};
    if ((system.trim() || null) !== (row.system ?? null)) patch.system = system.trim() || null;
    if (colorEditable && (color.trim() || null) !== (row.catalog_color ?? null)) patch.catalog_color = color.trim() || null;
    if (!faltaMigracion && count !== (row.unidades_por_paquete ?? null)) patch.unidades_por_paquete = count;
    if (!faltaMigracion && kg !== (row.kg_por_unidad ?? null)) patch.kg_por_unidad = kg;
    if (Object.keys(patch).length) onSave(patch);
    else onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editá {row.variant_reference}</DialogTitle>
          <DialogDescription>{row.name || 'Datos de la referencia'} · Color del código: {colorLabel(row.variant_reference)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <fieldset disabled={saving} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span>Sistema</span>
              <input autoFocus list="maestro-sistemas" className={fieldClass} value={system} onChange={(e) => setSystem(e.target.value)} placeholder="Elegí o escribí" />
              <datalist id="maestro-sistemas">{systems.map((value) => <option key={value} value={value} />)}</datalist>
            </label>
            <label className="space-y-1 text-sm">
              <span>Color de catálogo</span>
              <input list="maestro-colores" className={fieldClass} disabled={!colorEditable} value={color} onChange={(e) => setColor(e.target.value)} placeholder={colorLabel(row.variant_reference)} />
              <datalist id="maestro-colores">{colors.map((value) => <option key={value} value={value} />)}</datalist>
            </label>
            <div className="space-y-1">
              <label className="block space-y-1 text-sm">
                <span>Piezas por paquete</span>
                <input className={fieldClass + ' tabular-nums'} inputMode="numeric" disabled={faltaMigracion} value={pieces} onChange={(e) => setPieces(e.target.value)} placeholder="Ej. 20" />
              </label>
              {!faltaMigracion && row.unidades_por_paquete == null && suggestion.pp != null && (
                <Button type="button" size="sm" variant="outline" onClick={() => setPieces(String(suggestion.pp))}>Usá {suggestion.pp} piezas</Button>
              )}
            </div>
            <div className="space-y-1">
              <label className="block space-y-1 text-sm">
                <span>Peso por pieza (kg)</span>
                <input className={fieldClass + ' tabular-nums'} inputMode="decimal" disabled={faltaMigracion} value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="Ej. 1,250" />
              </label>
              {!faltaMigracion && row.kg_por_unidad == null && suggestion.kg != null && (
                <Button type="button" size="sm" variant="outline" onClick={() => setWeight(String(Number(suggestion.kg.toFixed(3))).replace('.', ','))}>Usá {numberFormat.format(suggestion.kg)} kg</Button>
              )}
            </div>
          </fieldset>
          {!faltaMigracion && ((row.unidades_por_paquete == null && suggestion.pp != null) || (row.kg_por_unidad == null && suggestion.kg != null)) &&
            <p className="text-xs text-muted-foreground">Sugerencia de contenedor{suggestion.familia ? ' de otro color de la misma referencia' : ''}.</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancelá</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardá cambios'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
