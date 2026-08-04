/**
 * REFERENCIAS POR VARIANTE — la fuente de verdad de referencias del
 * inventario interno (decisión de Nico, 2026-08-04).
 *
 * Acá se sube el listado COMPLETO de referencias (con sufijo de color). Con
 * esto toda línea de remisión cruza y descuenta; la Fase 1 encontró 824
 * unidades despachadas que nunca descontaron porque su referencia no existía
 * (el auto-create desde contenedores no alcanzaba).
 *
 * SOLO crea/actualiza referencias (nombre, sistema). NUNCA toca stock, costo
 * ni conteos — eso es del conteo de bodega (Cierre de inventario).
 */

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Loader2, Search, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { readXlsxFile, isExcelFile } from '@/lib/readXlsx';
import { applyColorSuffix, canonicalizeRef } from '@/lib/refFamily';

const db = supabase as never as { from: (t: string) => any };

interface VariantRef {
  id: string;
  variant_reference: string;
  name: string | null;
  system: string | null;
  active: boolean;
}

interface FilaArchivo {
  reference: string;
  name: string;
  system: string;
}

const HINTS = {
  reference: /^\s*ref\.?\s*$|refer|c[oó]digo|sku/i,
  name: /descrip|nombre/i,
  system: /sistema|l[ií]nea|grupo/i,
  color: /^\s*color(es)?\s*$/i,
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
    const fila: FilaArchivo = {
      reference,
      name: iName >= 0 ? (r[iName] ?? '').trim() : '',
      system: iSys >= 0 ? (r[iSys] ?? '').trim() : '',
    };
    if (prev) {
      if (!prev.name && fila.name) prev.name = fila.name;
      if (!prev.system && fila.system) prev.system = fila.system;
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

  const { data: refs = [], isPending } = useQuery({
    queryKey: ['variant-refs-maestro'],
    queryFn: async (): Promise<VariantRef[]> => {
      const { data, error } = await db
        .from('inventory_variants')
        .select('id, variant_reference, name, system, active')
        .order('variant_reference');
      if (error) throw error;
      return (data ?? []) as VariantRef[];
    },
    staleTime: 60_000,
  });

  const subir = useMutation({
    mutationFn: async (filas: FilaArchivo[]) => {
      // Cruce canónico contra lo existente: "38*38-3" y "38X38-3" son la
      // misma variante — respetar la escritura ya registrada.
      const { data: exData, error: exErr } = await db
        .from('inventory_variants')
        .select('id, variant_reference, name, system, active');
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
          });
          creadas++;
          continue;
        }
        const patch: Record<string, unknown> = {};
        if (f.name && f.name !== (v.name ?? '')) patch.name = f.name;
        if (f.system && f.system !== (v.system ?? '')) patch.system = f.system;
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
        'Se crean las que falten y se actualiza nombre/sistema de las existentes. ' +
        'El stock y los costos NO se tocan.\n\n¿Continuar?',
      )) return;
      subir.mutate(parsed.data);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const activas = useMemo(() => refs.filter((r) => r.active), [refs]);
  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return activas;
    return activas.filter((r) =>
      r.variant_reference.toLowerCase().includes(s) || (r.name ?? '').toLowerCase().includes(s));
  }, [activas, q]);

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
          <p className="text-[10px] text-muted-foreground mt-1 text-right">
            Columnas: <strong>REF</strong> (obligatoria) · Descripción · Sistema · Color
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
      </div>

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
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 ? (
                <tr><td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">
                  {activas.length === 0
                    ? 'Todavía no hay referencias. Subí el listado completo con el botón de arriba.'
                    : 'Sin resultados para esa búsqueda.'}
                </td></tr>
              ) : visibles.slice(0, 400).map((r) => (
                <tr key={r.id} className="border-t border-border/60 hover:bg-muted/30">
                  <td className="px-3 py-1.5 font-mono font-medium">{r.variant_reference}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{r.name ?? '—'}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{r.system ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibles.length > 400 && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">Mostrando 400 de {visibles.length} — usá el buscador.</p>
          )}
        </div>
      )}
    </div>
  );
}
