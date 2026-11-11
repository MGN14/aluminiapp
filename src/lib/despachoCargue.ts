import { normalizeRef } from '@/lib/qrLabel';

// Lógica pura del CARGUE de un pedido en la estación de despacho (iPad).
//
// El pedido es una remisión de venta en estado "pendiente". La bodega cuenta lo
// que sube al camión (escaneando etiquetas QR o con +/−) contra lo pedido, y al
// cerrar la remisión queda "despachado". Si lo cargado no cuadra, la remisión se
// ajusta a lo que de verdad salió (el inventario lo recalcula la misma función
// que usa Editar remisión — acá no hay fórmulas de inventario).
//
// Todo trabaja con objetos planos (Record), nunca Map/Set: parte de esto viaja
// por el cache persistido de React Query.

export interface RemisionItemLite {
  id: string;
  reference: string;
  product_name: string | null;
  units: number | null;
}

/** Una línea del cargue = una referencia del pedido (agregada si se repite). */
export interface CargueLine {
  key: string;        // referencia canónica normalizada
  reference: string;  // como la escribió la oficina (primera aparición)
  name: string;
  pedido: number;
  itemIds: string[];  // remision_items que la componen, en orden
}

/** Evento de conteo: un escaneo o un ajuste manual (+1, −1, completar…). */
export interface ConteoEvent {
  id: string;
  reference: string;
  quantity: number;
  serial?: string | null;
  location?: string | null;
  operator_id?: string | null;
  scanned_at?: string | null;
}

export type CanonFn = (ref: string) => string;

/**
 * Llave canónica de una referencia: normalizada y pasada por los alias
 * confirmados a mano (product_aliases: "MN92" → "MN-92"). Así una etiqueta con
 * la referencia del maestro cruza con una línea que la oficina digitó distinto.
 * NO cruza por familia: PC635-2 y PC635-3 son colores distintos y confundirlos
 * es justo el error que el cargue tiene que atajar.
 */
export function makeCanon(aliases: Record<string, string> = {}): CanonFn {
  const norm: Record<string, string> = {};
  for (const [alias, destino] of Object.entries(aliases)) {
    const a = normalizeRef(alias);
    const d = normalizeRef(destino);
    if (a && d) norm[a] = d;
  }
  return (ref: string) => {
    const k = normalizeRef(ref);
    return norm[k] ?? k;
  };
}

export function buildCargueLines(items: RemisionItemLite[], canon: CanonFn): CargueLine[] {
  const lines: CargueLine[] = [];
  const byKey: Record<string, CargueLine> = {};
  for (const it of items) {
    const key = canon(it.reference ?? '');
    if (!key) continue;
    const units = Number(it.units) || 0;
    const cur = byKey[key];
    if (cur) {
      cur.pedido += units;
      cur.itemIds.push(it.id);
      if (!cur.name && it.product_name) cur.name = it.product_name;
    } else {
      const line: CargueLine = {
        key,
        reference: (it.reference ?? '').trim(),
        name: (it.product_name ?? '').trim(),
        pedido: units,
        itemIds: [it.id],
      };
      byKey[key] = line;
      lines.push(line);
    }
  }
  return lines;
}

/** Cuánto se cargó de cada referencia (suma de eventos; nunca negativo). */
export function cargadoPorLinea(events: ConteoEvent[], canon: CanonFn): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) {
    const k = canon(e.reference ?? '');
    if (!k) continue;
    out[k] = (out[k] ?? 0) + (Number(e.quantity) || 0);
  }
  for (const k of Object.keys(out)) out[k] = Math.max(0, out[k]);
  return out;
}

export type EstadoLinea = 'pendiente' | 'parcial' | 'completo' | 'sobrante';

export function estadoLinea(pedido: number, cargado: number): EstadoLinea {
  if (cargado <= 0) return pedido <= 0 ? 'completo' : 'pendiente';
  if (cargado < pedido) return 'parcial';
  if (cargado === pedido) return 'completo';
  return 'sobrante';
}

export type ResultadoConteo =
  | { tipo: 'fuera' }
  | { tipo: 'ok' | 'completo' | 'sobrante' | 'faltante'; nuevo: number; pedido: number };

/**
 * Qué pasa si a la referencia `key` se le suma `qty` (puede ser negativo).
 * 'fuera' = la referencia no va en el pedido (referencia equivocada / otro color).
 */
export function evaluarConteo(
  lines: CargueLine[],
  cargado: Record<string, number>,
  key: string,
  qty: number,
): ResultadoConteo {
  const line = lines.find((l) => l.key === key);
  if (!line) return { tipo: 'fuera' };
  const nuevo = Math.max(0, (cargado[key] ?? 0) + qty);
  const estado = estadoLinea(line.pedido, nuevo);
  if (estado === 'sobrante') return { tipo: 'sobrante', nuevo, pedido: line.pedido };
  if (estado === 'completo') return { tipo: 'completo', nuevo, pedido: line.pedido };
  return { tipo: qty < 0 ? 'faltante' : 'ok', nuevo, pedido: line.pedido };
}

/** ¿Ese paquete (serial único de la etiqueta) ya se contó en este pedido? */
export function serialYaContado(events: ConteoEvent[], serial: string | null | undefined): boolean {
  const s = (serial ?? '').trim().toLowerCase();
  if (!s) return false;
  return events.some((e) => (e.serial ?? '').trim().toLowerCase() === s);
}

export interface DiferenciaLinea {
  key: string;
  reference: string;
  pedido: number;
  cargado: number;
  diferencia: number; // positiva: cuántas faltan o sobran
}

export interface ResumenCargue {
  totalPedido: number;
  totalCargado: number;
  refsTotal: number;
  refsCompletas: number;
  faltantes: DiferenciaLinea[];
  sobrantes: DiferenciaLinea[];
  cuadra: boolean;
}

export function resumenCargue(lines: CargueLine[], cargado: Record<string, number>): ResumenCargue {
  let totalPedido = 0;
  let totalCargado = 0;
  let refsCompletas = 0;
  const faltantes: DiferenciaLinea[] = [];
  const sobrantes: DiferenciaLinea[] = [];
  for (const l of lines) {
    const c = cargado[l.key] ?? 0;
    totalPedido += l.pedido;
    totalCargado += c;
    if (c === l.pedido) refsCompletas += 1;
    else if (c < l.pedido) faltantes.push({ key: l.key, reference: l.reference, pedido: l.pedido, cargado: c, diferencia: l.pedido - c });
    else sobrantes.push({ key: l.key, reference: l.reference, pedido: l.pedido, cargado: c, diferencia: c - l.pedido });
  }
  return {
    totalPedido,
    totalCargado,
    refsTotal: lines.length,
    refsCompletas,
    faltantes,
    sobrantes,
    cuadra: faltantes.length === 0 && sobrantes.length === 0,
  };
}

export interface AjusteItems {
  updates: { id: string; units: number }[];
  deletes: string[];
}

/**
 * Cómo dejar los remision_items para que la remisión diga lo que de verdad se
 * cargó. Si una referencia viene en varias líneas, lo cargado llena las líneas
 * en orden y lo que sobre va a la última. Las líneas que quedan en 0 se borran.
 * Idempotente: aplicado sobre ítems ya ajustados devuelve un plan vacío.
 */
export function ajustarItemsALoCargado(
  items: RemisionItemLite[],
  canon: CanonFn,
  cargado: Record<string, number>,
): AjusteItems {
  const updates: AjusteItems['updates'] = [];
  const deletes: string[] = [];
  const porKey: Record<string, RemisionItemLite[]> = {};
  const orden: string[] = [];
  for (const it of items) {
    const k = canon(it.reference ?? '');
    if (!k) continue;
    if (!porKey[k]) { porKey[k] = []; orden.push(k); }
    porKey[k].push(it);
  }
  for (const k of orden) {
    const grupo = porKey[k];
    let restante = Math.max(0, cargado[k] ?? 0);
    grupo.forEach((it, i) => {
      const actual = Number(it.units) || 0;
      const esUltima = i === grupo.length - 1;
      const nuevo = esUltima ? restante : Math.min(actual, restante);
      restante -= nuevo;
      if (nuevo <= 0) deletes.push(it.id);
      else if (nuevo !== actual) updates.push({ id: it.id, units: nuevo });
    });
  }
  return { updates, deletes };
}

/** Ítems de la remisión como quedan después del ajuste (para imprimir/recuadrar). */
export function aplicarAjuste<T extends RemisionItemLite>(items: T[], ajuste: AjusteItems): T[] {
  const borrar: Record<string, true> = {};
  for (const id of ajuste.deletes) borrar[id] = true;
  const nuevas: Record<string, number> = {};
  for (const u of ajuste.updates) nuevas[u.id] = u.units;
  return items
    .filter((it) => !borrar[it.id])
    .map((it) => (it.id in nuevas ? { ...it, units: nuevas[it.id] } : it));
}

function fmtFechaHora(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Nota que queda en la remisión: reemplaza lo que antes se anotaba en el cuaderno. */
export function notaCargue(
  resumen: ResumenCargue,
  opts: { operador: string; cuando: Date; ajustada: boolean },
): string {
  const partes = [
    `Cargue verificado en bodega el ${fmtFechaHora(opts.cuando)}${opts.operador ? ` por ${opts.operador}` : ''}: ${resumen.totalCargado} de ${resumen.totalPedido} und.`,
  ];
  if (resumen.faltantes.length) {
    partes.push(`Faltó: ${resumen.faltantes.map((f) => `${f.reference} ×${f.diferencia} (pedido ${f.pedido}, cargado ${f.cargado})`).join('; ')}.`);
  }
  if (resumen.sobrantes.length) {
    partes.push(`Sobró: ${resumen.sobrantes.map((s) => `${s.reference} ×${s.diferencia} (pedido ${s.pedido}, cargado ${s.cargado})`).join('; ')}.`);
  }
  if (!resumen.cuadra) {
    partes.push(opts.ajustada ? 'Remisión ajustada a lo cargado.' : 'Remisión sin ajustar.');
  }
  return partes.join(' ');
}

/**
 * Orden de recorrido: por la primera ubicación de cada referencia (A1, A2, B1…),
 * lo que no tiene ubicación al final, y dentro de cada grupo por referencia.
 */
export function ordenarPorUbicacion<T extends { key: string; reference: string }>(
  lines: T[],
  ubicaciones: Record<string, string[]>,
): T[] {
  const primera = (k: string) => ubicaciones[k]?.[0] ?? '';
  return [...lines].sort((a, b) => {
    const la = primera(a.key);
    const lb = primera(b.key);
    if (la && !lb) return -1;
    if (!la && lb) return 1;
    if (la !== lb) return la.localeCompare(lb, 'es', { numeric: true });
    return a.reference.localeCompare(b.reference, 'es', { numeric: true });
  });
}
