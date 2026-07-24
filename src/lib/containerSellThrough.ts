/**
 * Velocidad de venta por contenedor: ¿en cuántos días se vende cada
 * referencia de un contenedor entregado, y el contenedor completo?
 *
 * Fuente: import_items del pedido (packing manda) agrupados por FAMILIA -5
 * + ventas por remisión (la referencia tal como se despachó → familia).
 *
 * Atribución FIFO entre contenedores: si dos contenedores traen la misma
 * familia, las ventas llenan primero el más viejo (con entrega anterior a la
 * venta). Sin esto, la misma venta contaría para ambos y la velocidad se
 * inflaría. Aproximación: las ventas no distinguen físicamente el lote.
 *
 * Función pura → testeable.
 */

export interface ContainerFamiliaInput {
  famKey: string;
  label: string;
  qty: number;
}

export interface ContainerInput {
  id: string;
  label: string;
  /** Fecha en que el contenedor entró a bodega (estado 'entregado'). */
  entrega: string; // YYYY-MM-DD
  familias: ContainerFamiliaInput[];
}

export interface VentaInput {
  famKey: string;
  date: string; // YYYY-MM-DD
  qty: number;
}

export interface FamiliaSellThrough {
  famKey: string;
  label: string;
  qty: number;
  vendidas: number;
  pctVendido: number;
  /** Días reales hasta agotar (si se agotó). */
  diasAgote: number | null;
  /** Proyección de días para agotar al ritmo actual (si no se agotó y hay ventas). */
  diasProyectados: number | null;
  sinVentas: boolean;
}

export interface ContainerSellThrough {
  id: string;
  label: string;
  entrega: string;
  diasDesdeEntrega: number;
  totalQty: number;
  totalVendidas: number;
  pctVendido: number;
  /** Días ponderados (por unidades) para vender: real si agotó, proyección si no. */
  diasPonderados: number | null;
  /** true = todas las familias con ventas quedaron agotadas. */
  agotado: boolean;
  familias: FamiliaSellThrough[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / DAY_MS);

interface Slot {
  containerIdx: number;
  entrega: string;
  qty: number;
  restante: number;
  vendidas: number;
  fechaAgote: string | null;
}

export function computeContainerSellThrough(
  containers: ContainerInput[],
  ventas: VentaInput[],
  todayIso: string,
): ContainerSellThrough[] {
  // Contenedores en orden de entrega (FIFO) y slots por familia.
  const orden = [...containers].sort((a, b) => a.entrega.localeCompare(b.entrega));
  const slotsPorFam = new Map<string, Slot[]>();
  orden.forEach((c, idx) => {
    for (const f of c.familias) {
      if (f.qty <= 0) continue;
      const arr = slotsPorFam.get(f.famKey) ?? [];
      arr.push({ containerIdx: idx, entrega: c.entrega, qty: f.qty, restante: f.qty, vendidas: 0, fechaAgote: null });
      slotsPorFam.set(f.famKey, arr);
    }
  });

  // Ventas en orden cronológico llenan el slot más viejo YA entregado.
  const ventasOrd = [...ventas]
    .filter(v => v.qty > 0 && v.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const v of ventasOrd) {
    const slots = slotsPorFam.get(v.famKey);
    if (!slots) continue;
    let restanteVenta = v.qty;
    for (const s of slots) {
      if (restanteVenta <= 0) break;
      if (s.entrega > v.date || s.restante <= 0) continue;
      const toma = Math.min(s.restante, restanteVenta);
      s.restante -= toma;
      s.vendidas += toma;
      restanteVenta -= toma;
      if (s.restante <= 0 && !s.fechaAgote) s.fechaAgote = v.date;
    }
    // Sobrante sin slot (venta de stock anterior a estos contenedores): se ignora.
  }

  // Armar el resultado por contenedor.
  return orden.map((c, idx) => {
    const familias: FamiliaSellThrough[] = c.familias
      .filter(f => f.qty > 0)
      .map(f => {
        const slot = (slotsPorFam.get(f.famKey) ?? []).find(s => s.containerIdx === idx);
        const vendidas = slot?.vendidas ?? 0;
        const dias = Math.max(1, daysBetween(c.entrega, todayIso));
        const diasAgote = slot?.fechaAgote ? Math.max(1, daysBetween(c.entrega, slot.fechaAgote)) : null;
        const ritmo = vendidas / dias;
        const diasProyectados = diasAgote == null && ritmo > 0 ? Math.ceil(f.qty / ritmo) : null;
        return {
          famKey: f.famKey,
          label: f.label,
          qty: f.qty,
          vendidas,
          pctVendido: Math.round((vendidas / f.qty) * 100),
          diasAgote,
          diasProyectados,
          sinVentas: vendidas <= 0,
        };
      })
      .sort((a, b) => b.qty - a.qty);

    const totalQty = familias.reduce((s, f) => s + f.qty, 0);
    const totalVendidas = familias.reduce((s, f) => s + f.vendidas, 0);
    // Promedio ponderado por unidades: días reales si agotó, proyección si no.
    let peso = 0;
    let acum = 0;
    for (const f of familias) {
      const d = f.diasAgote ?? f.diasProyectados;
      if (d == null) continue;
      acum += d * f.qty;
      peso += f.qty;
    }
    const conVentas = familias.filter(f => !f.sinVentas);
    return {
      id: c.id,
      label: c.label,
      entrega: c.entrega,
      diasDesdeEntrega: Math.max(0, daysBetween(c.entrega, todayIso)),
      totalQty,
      totalVendidas,
      pctVendido: totalQty > 0 ? Math.round((totalVendidas / totalQty) * 100) : 0,
      diasPonderados: peso > 0 ? Math.round(acum / peso) : null,
      agotado: conVentas.length > 0 && conVentas.every(f => f.diasAgote != null) && familias.every(f => !f.sinVentas),
      familias,
    };
  }).reverse(); // más reciente primero para la UI
}
