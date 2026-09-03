/**
 * Top de referencias vendidas POR UNIDADES, restringido a la maestra de
 * aluminio (inventory_products).
 *
 * Por qué el filtro (verificado con datos reales, 2026-09-03): un ranking por
 * unidades sin filtrar lo ganan la tornillería y el vidrio — `TOR8*1/2` mete
 * 19.900 unidades en UNA línea contra 163 de un perfil `GL4102-5`, y el vidrio
 * (`CLARO*4`) se factura en m² (160 de sus 166 líneas traen decimales), así que
 * sumarlo con unidades sueltas es peras con manzanas. Filtrar contra la maestra
 * de aluminio deja el ranking en lo que Nico realmente vende, y se banca
 * referencias nuevas sin listas negras por nombre.
 *
 * Agrupa por referencia CANÓNICA (canonicalizeRef): "38*38-3" y "38X38-3" son
 * la misma pieza escrita distinto y deben sumar en una sola fila. No colapsa
 * sufijos de color (-0/-2/-3/-5): en Siigo solo existe la -5, agrupar por
 * familia no cambiaría nada y sí confundiría.
 *
 * SERIALIZABLE a propósito (arrays, no Map): esto viaja en data de react-query
 * y el cache se persiste como JSON.
 */
import { canonicalizeRef } from '@/lib/refFamily';

export interface SoldItemLine {
  reference: string | null;
  description: string | null;
  quantity: number;
  line_base: number;
}

export interface TopReferenceRow {
  /** Referencia como se muestra (la forma cruda, en mayúsculas). */
  reference: string;
  descripcion: string | null;
  unidades: number;
  importe: number;
  /** De cuántas líneas de factura salió (señal de recurrencia vs un pedidazo). */
  lineas: number;
}

export interface TopReferencesByUnits {
  top: TopReferenceRow[];
  /** Unidades de TODAS las referencias de aluminio del período (para el %). */
  totalUnidades: number;
  /** Cuántas referencias de aluminio distintas se vendieron. */
  referenciasDistintas: number;
}

export function rankAluminumReferencesByUnits(
  items: SoldItemLine[],
  aluminumRefs: string[],
  limit = 3,
): TopReferencesByUnits {
  const maestra = new Set<string>();
  for (const r of aluminumRefs) {
    const k = canonicalizeRef(r);
    if (k) maestra.add(k);
  }

  const acc = new Map<string, TopReferenceRow>();
  let totalUnidades = 0;

  for (const it of items) {
    const key = canonicalizeRef(it.reference);
    // Sin referencia no se puede saber si es aluminio (facturas viejas de PDF).
    if (!key || !maestra.has(key)) continue;

    const unidades = Number(it.quantity) || 0;
    if (unidades === 0) continue;

    const prev = acc.get(key);
    if (prev) {
      prev.unidades += unidades;
      prev.importe += Number(it.line_base) || 0;
      prev.lineas += 1;
      if (!prev.descripcion && it.description) prev.descripcion = it.description;
    } else {
      acc.set(key, {
        reference: (it.reference ?? '').trim().toUpperCase(),
        descripcion: it.description ?? null,
        unidades,
        importe: Number(it.line_base) || 0,
        lineas: 1,
      });
    }
    totalUnidades += unidades;
  }

  const top = Array.from(acc.values())
    .filter((r) => r.unidades > 0)
    .sort((a, b) => (b.unidades - a.unidades) || (b.importe - a.importe))
    .slice(0, limit);

  return { top, totalUnidades, referenciasDistintas: acc.size };
}
