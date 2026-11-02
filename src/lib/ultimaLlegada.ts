/**
 * Lo que YA llegó: el último contenedor entregado que trajo cada variante y
 * cuánto de eso se vendió desde que entró a bodega.
 *
 * Es la otra mitad del análisis de cobertura (pedido de Nico 2026-10-31:
 * "con lo que ha llegado, lo que viene en tránsito y está en fabricación").
 * Sirve para dos cosas al montar el pedido: comparar el SUGERIDO contra lo
 * que se pidió la última vez, y ver si lo que llegó rotó o se quedó.
 *
 * Fuente: import_items de los pedidos entregados/cerrados (packing manda; si
 * no hay, proforma — el caller ya hizo ese filtro) con la fecha en que el
 * contenedor entró a bodega, + las remisiones de venta desde esa fecha.
 *
 * Granularidad: VARIANTE de color (la unidad con la que se monta pedido),
 * igual que la tabla de Cobertura. Al proforma se le pone el sufijo desde la
 * columna Color (applyColorSuffix); el packing ya viene con sufijo.
 *
 * Función pura → testeable sin base de datos.
 */

import { applyColorSuffix, variantKey } from '@/lib/refFamily';
import type { VentaRow } from '@/lib/coverageVariants';

export interface LoteEntregado {
  importId: string;
  /** ref_pedido o proveedor — como se nombra el contenedor en la app. */
  label: string;
  /** Fecha en que entró a bodega (YYYY-MM-DD). */
  fechaEntrega: string;
  items: { reference: string; cantidad: number; color?: string | null }[];
}

export interface UltimaLlegada {
  /** Llave de variante (variantKey). */
  key: string;
  importId: string;
  pedido: string;
  fechaEntrega: string;
  /** Unidades que trajo ESE contenedor de esta variante. */
  unidades: number;
  /** Unidades despachadas por remisión desde la entrega hasta hoy. */
  vendidas: number;
  /** vendidas ÷ unidades, en %, acotado a 100. */
  pctVendido: number;
  diasDesdeEntrega: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / DAY_MS);

/**
 * Para cada variante, el lote del contenedor entregado MÁS RECIENTE que la
 * trajo, con sus unidades y lo vendido desde la entrega. Si una variante vino
 * en dos contenedores, manda el último (lo que se compara es el último pedido
 * contra el que viene). Variantes que no vinieron en ningún lote no aparecen.
 */
export function ultimaLlegadaPorVariante(params: {
  todayIso: string;
  lotes: LoteEntregado[];
  ventas: VentaRow[];
}): UltimaLlegada[] {
  const { todayIso, ventas } = params;
  // Más reciente primero; a igual fecha, el orden de entrada.
  const lotes = [...params.lotes]
    .filter((l) => !!l.fechaEntrega)
    .sort((a, b) => b.fechaEntrega.localeCompare(a.fechaEntrega));

  const porKey = new Map<string, UltimaLlegada>();
  for (const lote of lotes) {
    for (const it of lote.items) {
      const key = variantKey(applyColorSuffix(it.reference, it.color ?? null));
      if (!key) continue;
      const qty = Math.max(0, Number(it.cantidad ?? 0));
      const prev = porKey.get(key);
      if (prev && prev.importId !== lote.importId) continue; // ya hay uno más nuevo
      if (prev) { prev.unidades += qty; continue; }           // misma variante repetida en el lote
      porKey.set(key, {
        key,
        importId: lote.importId,
        pedido: lote.label,
        fechaEntrega: lote.fechaEntrega,
        unidades: qty,
        vendidas: 0,
        pctVendido: 0,
        diasDesdeEntrega: Math.max(0, daysBetween(lote.fechaEntrega, todayIso)),
      });
    }
  }

  // Vendido desde la entrega: remisiones de esa variante con fecha ≥ entrega.
  for (const v of ventas) {
    const key = variantKey(v.reference);
    const u = porKey.get(key);
    if (!u) continue;
    const day = (v.date ?? '').slice(0, 10);
    if (!day || day < u.fechaEntrega || day > todayIso) continue;
    u.vendidas += Math.abs(Number(v.units ?? 0));
  }

  const out = [...porKey.values()];
  for (const u of out) {
    u.pctVendido = u.unidades > 0 ? Math.min(100, Math.round((u.vendidas / u.unidades) * 100)) : 0;
  }
  return out.sort((a, b) => b.fechaEntrega.localeCompare(a.fechaEntrega) || a.key.localeCompare(b.key));
}
