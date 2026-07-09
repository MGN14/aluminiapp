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

const HEADER_HINTS = {
  reference: /refer/i,
  name: /descrip|nombre/i,
  system: /sistema|l[ií]nea|grupo/i,
  stock: /stock|inicial|cantidad|conteo|f[ií]sic|existen/i,
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
  const iStock = col(HEADER_HINTS.stock);
  const iCost = col(HEADER_HINTS.cost);
  if (iStock < 0) return { data: [], error: 'No encontré una columna de "Stock inicial".' };

  const data: MaestraRow[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const reference = normalizeVariantRef(r[iRef] ?? '');
    if (!reference) continue;
    // Filas de totales/notas al pie: sin referencia válida las salta el continue.
    if (/^(total|nota|tope)/i.test(reference)) continue;
    data.push({
      reference,
      name: iName >= 0 ? (r[iName] ?? '').trim() : '',
      system: iSys >= 0 ? (r[iSys] ?? '').trim() : '',
      stock: toNum(r[iStock] ?? '0'),
      cost: iCost >= 0 ? toNum(r[iCost] ?? '0') : 0,
    });
  }
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
    mutationFn: async (filas: MaestraRow[]) => {
      const nowIso = new Date().toISOString();
      const payload = filas.map((f) => ({
        variant_reference: f.reference,
        name: f.name || null,
        system: f.system || null,
        stock: f.stock,
        stock_inicial: f.stock,
        stock_inicial_date: nowIso,
        last_count_date: nowIso,
        avg_cost: f.cost || 0,
        active: true,
      }));

      // Upsert por (user_id, variant_reference) — el trigger pone user_id.
      const { data: up, error } = await db
        .from('inventory_variants')
        .upsert(payload, { onConflict: 'user_id,variant_reference' })
        .select('id, variant_reference');
      if (error) throw error;

      // Movimiento 'inicial' por variante (traza del conteo).
      const idPorRef = new Map<string, string>(
        (up ?? []).map((r: { id: string; variant_reference: string }) => [r.variant_reference, r.id]),
      );
      const movs = filas
        .map((f) => {
          const id = idPorRef.get(f.reference);
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
      return { count: payload.length };
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
