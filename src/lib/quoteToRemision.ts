// Ciclo comercial — despiece de una cotización aceptada en ítems de remisión.
//
// Tres fuentes, en orden de precisión:
//   1. template_snapshot (plantilla paramétrica): despiece EXACTO congelado al
//      cotizar — qty por referencia para las dimensiones de ESA línea. Se
//      multiplica por la cantidad de la línea.
//   2. BOM por m² (aluminum_catalog_components del sistema+color): promedio
//      quantity_per_m2 × área × cantidad. Menos exacto, pero honesto.
//   3. Sin despiece: la línea entra a la remisión como descriptiva (reference
//      vacía). applyRemisionInventory la reporta "sin match" y NO toca stock —
//      el documento igual refleja la entrega completa.
//
// El resultado SIEMPRE pasa por un preview editable antes de crear la
// remisión: el despiece teórico casi nunca es exactamente lo que sale de
// bodega (retazos, perfiles completos, cambios de último minuto).

import { supabase } from '@/integrations/supabase/client';
import type { QuotationItem } from '@/types/quotation';
import type { RemisionItemInput } from '@/lib/remisionInventory';

export interface QuoteDespieceLine extends RemisionItemInput {
  /** De dónde salió la línea, para mostrarlo en el preview. */
  source: 'plantilla' | 'bom_m2' | 'sin_despiece';
}

export interface QuoteDespieceResult {
  lines: QuoteDespieceLine[];
  /** Descripciones de líneas de cotización que quedaron sin despiece. */
  sinDespiece: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const itemLabel = (it: QuotationItem) =>
  it.description?.trim() ||
  `${it.system} ${it.color} ${Number(it.width_m)}×${Number(it.height_m)}m`;

/**
 * Convierte las líneas de una cotización en ítems de remisión agregados por
 * referencia. Async porque las líneas sin plantilla intentan resolver el BOM
 * por m² de su sistema+color contra aluminum_catalog_components.
 */
export async function computeQuoteDespiece(
  items: QuotationItem[],
): Promise<QuoteDespieceResult> {
  // Agregación por referencia (los perfiles se repiten entre ventanas).
  const byRef = new Map<string, QuoteDespieceLine>();
  const sinDespiece: string[] = [];

  const addUnits = (
    reference: string,
    product_name: string,
    units: number,
    unit_cost: number,
    source: QuoteDespieceLine['source'],
  ) => {
    const key = reference.trim().toLowerCase();
    const cur = byRef.get(key);
    if (cur) {
      cur.units = round2(cur.units + units);
      // El costo unitario más reciente manda (son snapshots de la misma ref).
      if (unit_cost > 0) cur.unit_cost = unit_cost;
    } else {
      byRef.set(key, { reference: reference.trim(), product_name, units: round2(units), unit_cost, source });
    }
  };

  // ── 1. Plantillas: despiece congelado, exacto por línea ──
  const needBom: QuotationItem[] = [];
  for (const it of items) {
    const snap = it.template_snapshot;
    const qty = Math.max(1, Number(it.quantity) || 1);
    if (snap && Array.isArray(snap.despiece) && snap.despiece.length > 0) {
      let anyRef = false;
      for (const p of snap.despiece) {
        if (!p.reference) continue; // pieza sin producto de inventario (mano de obra, etc.)
        anyRef = true;
        addUnits(p.reference, p.label || p.reference, (Number(p.qty) || 0) * qty, Number(p.unit_cost) || 0, 'plantilla');
      }
      if (!anyRef) sinDespiece.push(itemLabel(it));
    } else {
      needBom.push(it);
    }
  }

  // ── 2. BOM por m² para las líneas del cotizador clásico ──
  if (needBom.length > 0) {
    // Un solo fetch: catálogo + componentes + producto. RLS filtra por owner.
    const { data, error } = await (supabase as any)
      .from('aluminum_catalog')
      .select('id, system, color, aluminum_catalog_components(quantity_per_m2, product:product_id(reference, name, cost_per_unit))');
    if (error) throw error;

    const norm = (s: string) => s.trim().toLowerCase();
    const bomByKey = new Map<string, Array<{ quantity_per_m2: number; reference: string; name: string; cost: number }>>();
    for (const cat of (data ?? []) as any[]) {
      const comps = (cat.aluminum_catalog_components ?? [])
        .filter((c: any) => c.product?.reference && Number(c.quantity_per_m2) > 0)
        .map((c: any) => ({
          quantity_per_m2: Number(c.quantity_per_m2),
          reference: String(c.product.reference),
          name: String(c.product.name ?? c.product.reference),
          cost: Number(c.product.cost_per_unit) || 0,
        }));
      if (comps.length > 0) bomByKey.set(`${norm(cat.system)}|${norm(cat.color)}`, comps);
    }

    for (const it of needBom) {
      const comps = bomByKey.get(`${norm(it.system)}|${norm(it.color)}`);
      const qty = Math.max(1, Number(it.quantity) || 1);
      const area = Number(it.area_m2) || 0;
      if (!comps || area <= 0) {
        sinDespiece.push(itemLabel(it));
        continue;
      }
      for (const c of comps) {
        addUnits(c.reference, c.name, c.quantity_per_m2 * area * qty, c.cost, 'bom_m2');
      }
    }
  }

  // ── 3. Las líneas sin despiece entran como descriptivas (sin stock) ──
  const lines = Array.from(byRef.values());
  for (const desc of sinDespiece) {
    lines.push({ reference: '', product_name: desc, units: 1, unit_cost: 0, source: 'sin_despiece' });
  }

  return { lines, sinDespiece };
}
