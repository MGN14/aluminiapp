import { normalizeRef } from '@/lib/qrLabel';

// Construye la RUTA de picking de un pedido: reparte la cantidad pedida de cada
// referencia entre sus ubicaciones (bins) y agrupa las tareas por ubicación,
// para guiar el despacho una ubicación a la vez ("andá a A1, tomá 30").

export interface PedidoLine { reference: string; name: string; needed: number; }
export interface ProductRef { id: string; reference: string; name: string; }
export interface Bin { location: string; quantity: number; createdAt?: string | null; }
export interface PickTask { key: string; location: string; reference: string; name: string; qty: number; }
export interface PickStep { location: string; tasks: PickTask[]; }

export const NO_LOC = 'SIN UBICACIÓN';

export function buildPickPath(
  lines: PedidoLine[],
  productByRef: Map<string, ProductRef>,
  binsByProduct: Map<string, Bin[]>,
): PickStep[] {
  // Agregamos por referencia (un pedido puede repetir la misma ref en 2 líneas).
  const neededByRef = new Map<string, { reference: string; name: string; needed: number }>();
  for (const l of lines) {
    const k = normalizeRef(l.reference);
    if (!k) continue;
    const prev = neededByRef.get(k);
    if (prev) prev.needed += l.needed;
    else neededByRef.set(k, { reference: l.reference, name: l.name, needed: l.needed });
  }

  const tasks: PickTask[] = [];
  let idx = 0;
  for (const [k, line] of neededByRef.entries()) {
    const prod = productByRef.get(k);
    const bins = prod ? (binsByProduct.get(prod.id) ?? []) : [];
    // FIFO: primero el bin más viejo (el que se registró antes). Si no hay
    // fecha, caemos a orden alfanumérico de la ubicación.
    const sorted = [...bins].sort((a, b) => {
      const ta = a.createdAt || '';
      const tb = b.createdAt || '';
      if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
      return a.location.localeCompare(b.location, 'es', { numeric: true });
    });
    let remaining = line.needed;
    for (const bin of sorted) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(bin.quantity) || 0);
      if (take > 0) {
        tasks.push({ key: `t${idx++}`, location: (bin.location || '').trim().toUpperCase(), reference: line.reference, name: line.name, qty: take });
        remaining -= take;
      }
    }
    // Lo que no tiene bin (o excede lo ubicado) cae en "SIN UBICACIÓN".
    if (remaining > 0) {
      tasks.push({ key: `t${idx++}`, location: NO_LOC, reference: line.reference, name: line.name, qty: remaining });
    }
  }

  const byLoc = new Map<string, PickTask[]>();
  for (const t of tasks) {
    const arr = byLoc.get(t.location) ?? [];
    arr.push(t);
    byLoc.set(t.location, arr);
  }

  const locs = Array.from(byLoc.keys()).sort((a, b) => {
    if (a === NO_LOC) return 1;
    if (b === NO_LOC) return -1;
    return a.localeCompare(b, 'es', { numeric: true });
  });

  return locs.map(location => ({ location, tasks: byLoc.get(location)! }));
}
