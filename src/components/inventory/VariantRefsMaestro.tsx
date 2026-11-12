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

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Loader2, Search, Upload, Wand2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { readXlsxFile, isExcelFile } from '@/lib/readXlsx';
import { applyColorSuffix, canonicalizeRef } from '@/lib/refFamily';
import { fetchAllPaged } from '@/lib/fetchAllPaged';
import { resolverEmpaques, type ImportItemLite } from '@/lib/cargueEmpaque';
import { actualizarVariante, esFaltaColumna, parseDecimal, planGuardadoEmpaque, type CambioEmpaque } from '@/lib/referenciaEmpaque';

const db = supabase as never as { from: (t: string) => any };

interface VariantRef {
  id: string;
  variant_reference: string;
  name: string | null;
  system: string | null;
  active: boolean;
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

export default function VariantRefsMaestro() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');

  const { data: refsData, isPending } = useQuery({
    queryKey: ['variant-refs-maestro'],
    queryFn: async (): Promise<{ refs: VariantRef[]; faltaMigracion: boolean }> => {
      const full = await db
        .from('inventory_variants')
        .select('id, variant_reference, name, system, active, unidades_por_paquete, kg_por_unidad')
        .order('variant_reference');
      if (!full.error) return { refs: (full.data ?? []) as VariantRef[], faltaMigracion: false };
      if (!esFaltaColumna(full.error)) throw full.error;
      // Migración de paquete/peso sin aplicar: la lista sigue funcionando.
      const { data, error } = await db
        .from('inventory_variants')
        .select('id, variant_reference, name, system, active')
        .order('variant_reference');
      if (error) throw error;
      return { refs: (data ?? []) as VariantRef[], faltaMigracion: true };
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
      for (const { id, patch } of plan) await actualizarVariante(id, patch);
      return plan.length;
    },
    onSuccess: (n, p) => {
      qc.invalidateQueries({ queryKey: ['variant-refs-maestro'] });
      qc.invalidateQueries({ queryKey: ['cargue-variantes-empaque'] });
      if (n > 1) toast({ title: `${p.reference}: guardado en ${n} referencias`, description: p.todosLosColores ? 'Se aplicó a todos los colores de la familia.' : 'También se llenaron los otros colores que no tenían dato.' });
      else if (n === 1) toast({ title: `${p.reference}: guardado` });
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
        await actualizarVariante(r.id, patch);
        n++;
      }
      return n;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ['variant-refs-maestro'] });
      qc.invalidateQueries({ queryKey: ['cargue-variantes-empaque'] });
      toast({ title: `${n} referencias completadas con los packing lists`, description: 'Las que queden vacías no vinieron en ningún contenedor: llenalas a mano o en el Excel.' });
    },
    onError: (e) => toast({ title: 'No se pudo completar', description: (e as Error).message, variant: 'destructive' }),
  });

  const subir = useMutation({
    mutationFn: async (filas: FilaArchivo[]) => {
      // Cruce canónico contra lo existente: "38*38-3" y "38X38-3" son la
      // misma variante — respetar la escritura ya registrada.
      const { data: exData, error: exErr } = await db
        .from('inventory_variants')
        .select(faltaMigracion ? 'id, variant_reference, name, system, active' : 'id, variant_reference, name, system, active, unidades_por_paquete, kg_por_unidad');
      if (exErr) throw exErr;
      const existentes = (exData ?? []) as VariantRef[];
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
      if (!window.confirm(
        `Leí ${parsed.data.length} referencias.\n\n` +
        'Se crean las que falten y se actualiza nombre, sistema, paquete y peso de las existentes. ' +
        'El stock y los costos NO se tocan.\n\n¿Continuar?',
      )) return;
      subir.mutate(parsed.data);
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
  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    let arr = soloSinDato ? activas.filter((r) => r.unidades_por_paquete == null || r.kg_por_unidad == null) : activas;
    if (s) arr = arr.filter((r) => r.variant_reference.toLowerCase().includes(s) || (r.name ?? '').toLowerCase().includes(s));
    return arr;
  }, [activas, q, soloSinDato]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" /> Referencias por variante — fuente de verdad
          </h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            El listado completo de referencias del inventario interno (con sufijo de color). Toda remisión
            y todo contenedor cruzan contra esto. Subir el archivo <strong>solo crea/actualiza referencias</strong> —
            el stock lo pone el conteo de bodega en Inventario → Por variante.
          </p>
        </div>
        <div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <Button onClick={() => fileRef.current?.click()} disabled={subir.isPending}>
            {subir.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
            Subir referencias
          </Button>
          <p className="text-xs text-muted-foreground mt-1 text-right">
            Columnas: <strong>REF</strong> (obligatoria) · Descripción · Sistema · Color · Paquete · Peso
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-xs flex-1 min-w-48">
          <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar referencia…"
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-md border border-border bg-background" />
        </div>
        <span className="text-xs text-muted-foreground">{visibles.length} de {activas.length} referencias activas</span>
        {!faltaMigracion && sinDato > 0 && (
          <button type="button" onClick={() => setSoloSinDato((v) => !v)}
            className={`text-xs font-semibold px-2.5 py-1.5 rounded-md border ${soloSinDato ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted'}`}>
            Sin paquete o peso · {sinDato}
          </button>
        )}
        {!faltaMigracion && conSugerencia > 0 && (
          <Button size="sm" variant="outline" disabled={usarTodas.isPending}
            onClick={() => { if (window.confirm(`Llenar ${conSugerencia} referencias vacías con el paquete y el peso de los packing lists? Lo que ya tiene dato no se toca.`)) usarTodas.mutate(); }}>
            {usarTodas.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
            Completar desde contenedores · {conSugerencia}
          </Button>
        )}
      </div>
      {faltaMigracion && (
        <p className="rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
          Las columnas «Piezas por paquete» y «Peso por pieza» aparecen cuando se aplique en Supabase el SQL de paquete y peso (dos columnas nuevas en Referencias por variante).
        </p>
      )}

      {isPending ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/60">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold">Referencia</th>
                <th className="px-3 py-2 font-semibold">Descripción</th>
                <th className="px-3 py-2 font-semibold">Sistema</th>
                {!faltaMigracion && <th className="px-3 py-2 font-semibold text-right" title="Piezas que trae un paquete estándar">Piezas por paquete</th>}
                {!faltaMigracion && <th className="px-3 py-2 font-semibold text-right" title="Peso de una pieza">Peso por pieza</th>}
                {!faltaMigracion && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 ? (
                <tr><td colSpan={faltaMigracion ? 3 : 6} className="px-3 py-8 text-center text-muted-foreground">
                  {activas.length === 0
                    ? 'Todavía no hay referencias. Subí el listado completo con el botón de arriba.'
                    : 'Sin resultados para esa búsqueda.'}
                </td></tr>
              ) : visibles.slice(0, 400).map((r) => (
                <tr key={r.id} className="border-t border-border/60 hover:bg-muted/30">
                  <td className="px-3 py-1.5 font-mono font-medium">{r.variant_reference}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{r.name ?? '—'}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{r.system ?? '—'}</td>
                  {!faltaMigracion && (() => {
                    const sug = sugerenciaDe(r);
                    return (
                      <>
                        <td className="px-3 py-1 text-right">
                          <CeldaNumero
                            valor={r.unidades_por_paquete ?? null}
                            sugerido={sug.pp}
                            origen={sug.familia ? 'contenedor (otro color)' : 'contenedor'}
                            entero
                            sufijo="piezas"
                            onGuardar={(v) => guardar.mutate({ reference: r.variant_reference, cambio: { unidades_por_paquete: v } })}
                          />
                        </td>
                        <td className="px-3 py-1 text-right">
                          <CeldaNumero
                            valor={r.kg_por_unidad ?? null}
                            sugerido={sug.kg ? Math.round(sug.kg * 1000) / 1000 : null}
                            origen={sug.familia ? 'contenedor (otro color)' : 'contenedor'}
                            sufijo="kg"
                            onGuardar={(v) => guardar.mutate({ reference: r.variant_reference, cambio: { kg_por_unidad: v } })}
                          />
                        </td>
                        <td className="px-2 py-1 text-right">
                          {(r.unidades_por_paquete != null || r.kg_por_unidad != null) && (
                            <button type="button" title="Aplicar paquete y peso a todos los colores de esta referencia"
                              className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border hover:bg-muted"
                              onClick={() => {
                                const cambio: CambioEmpaque = {};
                                if (r.unidades_por_paquete != null) cambio.unidades_por_paquete = r.unidades_por_paquete;
                                if (r.kg_por_unidad != null) cambio.kg_por_unidad = r.kg_por_unidad;
                                if (window.confirm(`¿Poner el paquete y el peso de ${r.variant_reference} a TODOS sus colores (aunque ya tengan dato)?`)) {
                                  guardar.mutate({ reference: r.variant_reference, cambio, todosLosColores: true });
                                }
                              }}>
                              <Copy className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </>
                    );
                  })()}
                </tr>
              ))}
            </tbody>
          </table>
          {visibles.length > 400 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Mostrando 400 de {visibles.length} — usá el buscador.</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Celda editable de número: muestra el valor; si está vacía y hay un dato del
 * contenedor lo sugiere en gris con «Usar». Tocar edita en el lugar (Enter
 * guarda, Escape cancela). Vacío = borrar el dato.
 */
function CeldaNumero({ valor, sugerido, origen, entero = false, sufijo, onGuardar }: {
  valor: number | null;
  sugerido: number | null;
  origen: string;
  entero?: boolean;
  sufijo: string;
  onGuardar: (v: number | null) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState('');
  const fmt = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 3 });
  const guardar = () => {
    setEditando(false);
    const n = parseDecimal(texto);
    const v = n == null ? null : entero ? Math.round(n) : Math.round(n * 1000) / 1000;
    if (v !== valor) onGuardar(v);
  };
  if (editando) {
    return (
      <input
        autoFocus
        inputMode="decimal"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={guardar}
        onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEditando(false); }}
        className="w-24 h-8 px-2 text-right text-xs tabular-nums rounded-md border border-primary bg-background"
        aria-label={`Editar ${sufijo}`}
      />
    );
  }
  if (valor != null) {
    return (
      <button type="button" onClick={() => { setTexto(String(valor).replace('.', ',')); setEditando(true); }}
        className="h-8 px-2 rounded-md hover:bg-muted tabular-nums font-semibold">
        {fmt(valor)} <span className="font-normal text-muted-foreground">{sufijo}</span>
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 justify-end">
      {sugerido != null && (
        <button type="button" onClick={() => onGuardar(sugerido)} title={`Dato del ${origen}`}
          className="h-8 px-2 rounded-md border border-dashed border-border text-muted-foreground hover:bg-muted tabular-nums whitespace-nowrap">
          {fmt(sugerido)} {sufijo} · Usar
        </button>
      )}
      <button type="button" onClick={() => { setTexto(''); setEditando(true); }}
        className="h-8 px-2 rounded-md text-muted-foreground hover:bg-muted">
        {sugerido != null ? 'Otro' : 'Poner'}
      </button>
    </span>
  );
}
