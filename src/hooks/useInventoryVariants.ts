/**
 * Inventario por VARIANTE de color (LIV-40, LIV-40-2, LIV-40-3, LIV-40-0…) —
 * control interno real, desprendido de la "-5" de Siigo. Es la fuente que lee
 * el módulo de Importaciones (cobertura / próximo pedido).
 *
 * Fase 1: maestra + conteo inicial subidos por Nico (Excel) y ajuste manual.
 * Las entradas (packing nacionalizado) y salidas (remisiones) automáticas
 * llegan en Fase 2 sobre el ledger inventory_variant_movements.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { applyColorSuffix, canonicalizeRef } from '@/lib/refFamily';

// La tabla es nueva; types.ts todavía no la conoce. Mismo cast que usa el
// resto del código para tablas recién creadas (ej. import_items).
const db = supabase as never as { from: (t: string) => any };

export interface InventoryVariant {
  id: string;
  variant_reference: string;
  name: string | null;
  system: string | null;
  stock: number;
  avg_cost: number;
  stock_inicial: number | null;
  stock_inicial_date: string | null;
  last_count_date: string | null;
  active: boolean;
}

/** Fila de la maestra ya parseada del Excel. */
export interface MaestraRow {
  reference: string;
  name: string;
  system: string;
  stock: number;
  cost: number;
}

/** Normaliza la referencia: sin espacios, en mayúsculas (evita duplicados por
 *  diferencias de caja). El sufijo de color se preserva. */
export function normalizeVariantRef(ref: string): string {
  return (ref ?? '').trim().toUpperCase();
}

// Calibrados contra los formatos reales de Nico: la maestra "formal"
// (Referencia/Stock inicial/Costo) Y el conteo de bodega (REF | DESCRIPCION |
// COLOR | UND) — este último es el que sube como inventario inicial.
const HEADER_HINTS = {
  reference: /^\s*ref\.?\s*$|refer|c[oó]digo|sku/i,
  name: /descrip|nombre/i,
  system: /sistema|l[ií]nea|grupo/i,
  color: /^\s*color(es)?\s*$/i,
  stock: /stock|inicial|cantidad|conteo|f[ií]sic|existen|^\s*unds?\.?\s*$|unidades/i,
  cost: /costo|cost|valor|unitario/i,
};

function toNum(s: string): number {
  const n = Number(String(s ?? '').replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parsea la maestra desde una matriz de strings (una hoja de readXlsxFile).
 * Detecta la fila de encabezados por los hints y mapea columnas por nombre —
 * el orden de columnas no importa. Referencia + stock son obligatorios.
 */
export function parseMaestra(rows: string[][]): { data: MaestraRow[]; error: string | null } {
  if (!rows.length) return { data: [], error: 'La hoja está vacía.' };

  // Fila de encabezados = la primera que menciona "referencia".
  const headerIdx = rows.findIndex((r) => r.some((c) => HEADER_HINTS.reference.test(c)));
  if (headerIdx < 0) return { data: [], error: 'No encontré una columna "Referencia" en el archivo.' };

  const header = rows[headerIdx];
  const col = (hint: RegExp) => header.findIndex((c) => hint.test(c));
  const iRef = col(HEADER_HINTS.reference);
  const iName = col(HEADER_HINTS.name);
  const iSys = col(HEADER_HINTS.system);
  const iColor = col(HEADER_HINTS.color);
  const iStock = col(HEADER_HINTS.stock);
  const iCost = col(HEADER_HINTS.cost);
  if (iStock < 0) return { data: [], error: 'No encontré una columna de stock/unidades (Stock, UND, Cantidad…).' };

  // Agregado por variante: el conteo puede repetir la misma referencia+color
  // en varias filas — un upsert con llaves repetidas revienta en Postgres.
  const acc = new Map<string, MaestraRow>();
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const rawRef = (r[iRef] ?? '').trim();
    if (!rawRef) continue;
    // Filas de totales/notas al pie: sin referencia válida las salta el continue.
    if (/^(total|nota|tope)/i.test(rawRef)) continue;
    // Columna COLOR (conteo de bodega): la variante es ref + sufijo según la
    // convención (Mate = base, Blanco -2, Negro -3, Crudo -0).
    const conSufijo = iColor >= 0 ? applyColorSuffix(rawRef, r[iColor] ?? null) : rawRef;
    const reference = normalizeVariantRef(conSufijo);
    if (!reference) continue;
    const fila: MaestraRow = {
      reference,
      name: iName >= 0 ? (r[iName] ?? '').trim() : '',
      system: iSys >= 0 ? (r[iSys] ?? '').trim() : '',
      stock: toNum(r[iStock] ?? '0'),
      cost: iCost >= 0 ? toNum(r[iCost] ?? '0') : 0,
    };
    const prev = acc.get(reference);
    if (prev) {
      prev.stock += fila.stock;
      if (!prev.name && fila.name) prev.name = fila.name;
      if (!prev.cost && fila.cost) prev.cost = fila.cost;
    } else {
      acc.set(reference, fila);
    }
  }
  const data = [...acc.values()];
  if (!data.length) return { data: [], error: 'No hay filas de datos debajo del encabezado.' };
  return { data, error: null };
}

export function useInventoryVariants() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['inventory-variants'],
    queryFn: async (): Promise<InventoryVariant[]> => {
      const { data, error } = await db
        .from('inventory_variants')
        .select('id, variant_reference, name, system, stock, avg_cost, stock_inicial, stock_inicial_date, last_count_date, active')
        .eq('active', true)
        .order('variant_reference');
      if (error) throw error;
      return (data ?? []) as InventoryVariant[];
    },
    staleTime: 5 * 60_000,
  });

  /**
   * Sube la maestra: re-ancla el conteo inicial. Cada fila fija
   * stock = stock_inicial = valor subido y registra un movimiento 'inicial'.
   * Re-subir vuelve a cuadrar (como "Cuadrar inventario" del -5).
   */
  const importMaestra = useMutation({
    mutationFn: async ({ filas, conteoCompleto = false }: { filas: MaestraRow[]; conteoCompleto?: boolean }) => {
      const nowIso = new Date().toISOString();

      // Cruce CANÓNICO contra lo que ya existe: si la maestra vieja dice
      // "38*38-3" y el conteo nuevo "38X38-3", es la MISMA variante — el
      // upsert exacto creaba una fila nueva y la vieja quedaba viva con su
      // stock (negativo tras meses de salidas): duplicados fantasma
      // (reporte de Nico 2026-07-28: "hay unos en negativo").
      const { data: existentes, error: exErr } = await db
        .from('inventory_variants')
        .select('id, variant_reference, active');
      if (exErr) throw exErr;
      const existentesRows = (existentes ?? []) as { id: string; variant_reference: string; active: boolean }[];
      const spellingExistente = new Map<string, string>();
      for (const v of existentesRows) {
        const k = canonicalizeRef(v.variant_reference);
        if (k && !spellingExistente.has(k)) spellingExistente.set(k, v.variant_reference);
      }

      // Si el archivo NO trae columna de costo (el conteo de bodega solo trae
      // unidades), NO pisar los costos existentes con $0 — el re-anclaje
      // borraba el costo landed que había entrado con los contenedores y la
      // tabla quedaba con "Valor $0" (reporte de Nico 2026-07-30).
      const traeCostos = filas.some((f) => Number(f.cost ?? 0) > 0);
      const payload = filas.map((f) => ({
        // Respetar la escritura YA registrada de la misma variante.
        variant_reference: spellingExistente.get(canonicalizeRef(f.reference)) ?? f.reference,
        name: f.name || null,
        system: f.system || null,
        stock: f.stock,
        stock_inicial: f.stock,
        stock_inicial_date: nowIso,
        last_count_date: nowIso,
        ...(traeCostos ? { avg_cost: f.cost || 0 } : {}),
        active: true,
      }));

      // Upsert por (user_id, variant_reference) — el trigger pone user_id.
      const { data: up, error } = await db
        .from('inventory_variants')
        .upsert(payload, { onConflict: 'user_id,variant_reference' })
        .select('id, variant_reference');
      if (error) throw error;

      // Conteo COMPLETO: lo que existe en la maestra pero NO vino en el
      // archivo se ancla en 0 — se contó todo y no apareció. Sin esto, las
      // variantes viejas quedaban arrastrando negativos de meses de salidas.
      let ancladasEnCero = 0;
      if (conteoCompleto) {
        const subidas = new Set(payload.map((p) => canonicalizeRef(p.variant_reference)));
        const faltantes = existentesRows.filter(
          (v) => v.active && !subidas.has(canonicalizeRef(v.variant_reference)),
        );
        if (faltantes.length) {
          const { error: zErr } = await db
            .from('inventory_variants')
            .update({ stock: 0, stock_inicial: 0, stock_inicial_date: nowIso, last_count_date: nowIso })
            .in('id', faltantes.map((v) => v.id));
          if (zErr) throw zErr;
          ancladasEnCero = faltantes.length;
        }
      }

      // Movimiento 'inicial' por variante (traza del conteo).
      const idPorRef = new Map<string, string>(
        (up ?? []).map((r: { id: string; variant_reference: string }) => [r.variant_reference, r.id]),
      );
      const movs = filas
        .map((f, i) => {
          // payload está alineado por índice con filas — la ref pudo cambiar
          // de escritura al cruzar con la existente (canónico).
          const id = idPorRef.get(payload[i].variant_reference);
          if (!id) return null;
          return {
            variant_id: id,
            movement_type: 'inicial' as const,
            quantity: f.stock,
            unit_cost: f.cost || 0,
            source_type: 'inicial' as const,
            source_id: null,
            nota: 'Conteo inicial (maestra)',
          };
        })
        .filter(Boolean);
      if (movs.length) {
        const { error: mErr } = await db.from('inventory_variant_movements').insert(movs);
        if (mErr) throw mErr;
      }
      return { count: payload.length, ancladasEnCero };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-variants'] });
      qc.invalidateQueries({ queryKey: ['imports'] }); // refresca cobertura/próximo pedido
    },
  });

  /** Ajuste manual de una variante (conteo puntual). Fija stock absoluto. */
  const adjustStock = useMutation({
    mutationFn: async ({ id, stock }: { id: string; stock: number }) => {
      const { error } = await db
        .from('inventory_variants')
        .update({ stock, last_count_date: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      await db.from('inventory_variant_movements').insert({
        variant_id: id, movement_type: 'ajuste', quantity: stock,
        source_type: 'manual', nota: 'Ajuste manual',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-variants'] });
      qc.invalidateQueries({ queryKey: ['imports'] });
    },
  });

  return { ...query, importMaestra, adjustStock };
}
