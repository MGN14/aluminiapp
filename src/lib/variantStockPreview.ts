/**
 * COMPARADOR DE FÓRMULA — Fase 1, SOLO LECTURA.
 *
 * No escribe una sola fila. Calcula el stock con la fórmula que pidió Nico
 * (2026-08-04) y lo pone al lado del que muestra la app hoy, para poder
 * cuadrarlo contra su Excel ANTES de cambiar el motor.
 *
 *   F0 = una sola fecha de corte GLOBAL (la del conteo que define el inicial)
 *
 *   stock = inicial (la última foto con fecha <= F0)
 *         + entradas de contenedor con fecha > F0
 *         − salidas de remisión    con fecha > F0
 *         + entradas de remisión de compra con fecha > F0
 *
 * Todo se corta por la columna `fecha` (cuándo pasó el hecho), NUNCA por
 * `created_at` (cuándo alguien lo digitó) — esa mezcla es la que hacía que el
 * mismo inventario valiera distinto según qué botón se hubiera apretado.
 */

import { supabase } from '@/integrations/supabase/client';
import { canonicalizeRef } from '@/lib/refFamily';

const db = supabase as never as { from: (t: string) => any };

export interface PreviewVariant {
  id: string;
  variant_reference: string;
  name: string | null;
  /** Lo que la app muestra HOY (cache de inventory_variants.stock). */
  stock_hoy: number;
  avg_cost: number;
  stock_inicial: number | null;
}

export interface PreviewMov {
  variant_id: string;
  movement_type: string;
  quantity: number;
  source_type: string | null;
  source_id: string | null;
  fecha: string | null;
  created_at: string;
  nota: string | null;
}

export interface PreviewRemisionItem {
  reference: string;
  units: number;
}

export interface PreviewRemision {
  id: string;
  number: string | null;
  date: string;
  beneficiary: string | null;
  status: string | null;
  remision_type: string;
  items: PreviewRemisionItem[];
}

export interface PreviewData {
  variantes: PreviewVariant[];
  movs: PreviewMov[];
  remisiones: PreviewRemision[];
  /** alias canónico → referencia destino (product_aliases). */
  aliases: Map<string, string>;
}

/** Día del hecho, en número. Sin `fecha` cae al día de created_at. */
const diaDe = (m: { fecha?: string | null; created_at?: string }): string => {
  const f = (m.fecha ?? '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(f)) return f;
  return (m.created_at ?? '').slice(0, 10);
};

async function paginar<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function fetchStockPreviewData(): Promise<PreviewData> {
  const [variantesRes, movs, remisionesRaw, aliasRes] = await Promise.all([
    db.from('inventory_variants')
      .select('id, variant_reference, name, stock, avg_cost, stock_inicial')
      .eq('active', true)
      .order('variant_reference'),
    paginar<PreviewMov>((from, to) =>
      db.from('inventory_variant_movements')
        .select('variant_id, movement_type, quantity, source_type, source_id, fecha, created_at, nota')
        .order('fecha', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)),
    paginar<any>((from, to) =>
      db.from('remisiones')
        .select('id, number, date, beneficiary, status, remision_type, remision_items(reference, units)')
        .order('date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)),
    db.from('product_aliases').select('alias, ref_siigo'),
  ]);

  if ((variantesRes as any).error) throw (variantesRes as any).error;

  const variantes = (((variantesRes as any).data ?? []) as any[]).map((v) => ({
    id: v.id,
    variant_reference: v.variant_reference,
    name: v.name,
    stock_hoy: Number(v.stock ?? 0),
    avg_cost: Number(v.avg_cost ?? 0),
    stock_inicial: v.stock_inicial == null ? null : Number(v.stock_inicial),
  }));

  const aliases = new Map<string, string>();
  for (const r of (((aliasRes as any).data ?? []) as { alias: string; ref_siigo: string }[])) {
    const k = canonicalizeRef(r.alias);
    if (k && r.ref_siigo) aliases.set(k, r.ref_siigo);
  }

  const remisiones: PreviewRemision[] = remisionesRaw.map((r) => ({
    id: r.id,
    number: r.number ?? null,
    date: r.date,
    beneficiary: r.beneficiary ?? null,
    status: r.status ?? null,
    remision_type: r.remision_type,
    items: (r.remision_items ?? []).map((it: any) => ({
      reference: it.reference, units: Number(it.units ?? 0),
    })),
  }));

  return { variantes, movs, remisiones, aliases };
}

// ── El cálculo ──────────────────────────────────────────────────────────────

export interface StockDesglose {
  inicial: number;
  /** De dónde salió el inicial, para poder explicarlo en la auditoría. */
  inicialOrigen: string;
  contenedor: number;
  /** Neto que RESTA (salidas de venta − entradas de compra). */
  remisiones: number;
  stock: number;
}

const esAncla = (m: PreviewMov) => m.movement_type === 'inicial' || m.movement_type === 'ajuste';

/**
 * Stock de una variante con la fórmula única.
 *
 * El INICIAL es la última foto (movimiento 'inicial' o 'ajuste', que guardan
 * el stock ABSOLUTO) con fecha <= F0. Si no hay ninguna, cae a
 * inventory_variants.stock_inicial — el conteo que subió Yolanda.
 */
export function computeStockConCorte(
  v: PreviewVariant,
  movs: PreviewMov[],
  corte: string,
): StockDesglose {
  let inicial = Number(v.stock_inicial ?? 0);
  let inicialOrigen = 'stock_inicial de la maestra';
  let mejorDia = '';

  for (const m of movs) {
    if (!esAncla(m)) continue;
    const d = diaDe(m);
    if (d > corte) continue;          // foto posterior al corte: no manda
    if (d < mejorDia) continue;
    mejorDia = d;
    inicial = Number(m.quantity ?? 0);
    inicialOrigen = `${m.movement_type} del ${d}`;
  }

  let contenedor = 0;
  let remisiones = 0;
  for (const m of movs) {
    if (esAncla(m)) continue;
    if (diaDe(m) <= corte) continue;  // ya está dentro del inicial
    const qty = Number(m.quantity ?? 0);
    if (m.source_type === 'import' && m.movement_type === 'entrada') contenedor += qty;
    if (m.source_type === 'remision' && m.movement_type === 'salida') remisiones += qty;
    if (m.source_type === 'remision' && m.movement_type === 'entrada') remisiones -= qty;
  }

  return { inicial, inicialOrigen, contenedor, remisiones, stock: inicial + contenedor - remisiones };
}

export function agruparMovsPorVariante(movs: PreviewMov[]): Map<string, PreviewMov[]> {
  const m = new Map<string, PreviewMov[]>();
  for (const mv of movs) {
    const arr = m.get(mv.variant_id) ?? [];
    arr.push(mv);
    m.set(mv.variant_id, arr);
  }
  return m;
}

// ── Auditoría por referencia ────────────────────────────────────────────────

export interface MovAuditado {
  fecha: string;
  tipo: string;
  origen: string;
  unidades: number;
  cuenta: boolean;
  porque: string;
}

/** La lista completa de movimientos de una referencia, con el veredicto de
 *  cada uno — para poder cotejar línea por línea contra el Excel. */
export function auditarMovimientos(
  movs: PreviewMov[],
  corte: string,
  remPorId: Map<string, PreviewRemision>,
): MovAuditado[] {
  return [...movs]
    .sort((a, b) => (diaDe(b) || '').localeCompare(diaDe(a) || ''))
    .map((m) => {
      const dia = diaDe(m);
      const rem = m.source_id ? remPorId.get(m.source_id) : undefined;
      const origen = m.source_type === 'remision'
        ? `${rem?.number ?? 'Remisión'}${rem?.beneficiary ? ` · ${rem.beneficiary}` : ''}`
        : m.source_type === 'import' ? 'Contenedor'
          : m.nota || m.source_type || '—';

      if (esAncla(m)) {
        return {
          fecha: dia, tipo: m.movement_type === 'inicial' ? 'Inicial' : 'Ajuste', origen,
          unidades: Number(m.quantity ?? 0),
          cuenta: dia <= corte,
          porque: dia <= corte ? 'define el inicial' : 'posterior al corte: se ignora',
        };
      }
      const cuenta = dia > corte;
      const esSalida = m.movement_type === 'salida';
      return {
        fecha: dia,
        tipo: m.source_type === 'import' ? 'Contenedor' : esSalida ? 'Salida' : 'Entrada',
        origen,
        unidades: Number(m.quantity ?? 0),
        cuenta,
        porque: cuenta ? `posterior al corte (${corte})` : `anterior al corte: ya está dentro del inicial`,
      };
    });
}

// ── Líneas de remisión que no cruzan con ninguna variante ───────────────────

export interface LineaSinCruce {
  remision: string;
  fecha: string;
  cliente: string;
  reference: string;
  units: number;
  /** Sugerencia: variante existente cuya familia coincide. */
  sugerencia: string | null;
}

/**
 * Las unidades que NUNCA descuentan de nada porque su referencia no resuelve.
 * Hoy esto solo sale en un toast que desaparece — es el sospechoso principal
 * de que el stock no cuadre contra el Excel de bodega.
 */
export function detectarSinCruce(data: PreviewData): LineaSinCruce[] {
  const porCanon = new Map<string, string>();
  for (const v of data.variantes) porCanon.set(canonicalizeRef(v.variant_reference), v.variant_reference);

  const resuelve = (ref: string): boolean => {
    const k = canonicalizeRef(ref);
    if (porCanon.has(k)) return true;
    const destino = data.aliases.get(k);
    return !!destino && porCanon.has(canonicalizeRef(destino));
  };

  /** Misma familia (sin sufijo de color): pista de cuál era la buena. */
  const sugerir = (ref: string): string | null => {
    const base = canonicalizeRef(ref).replace(/-(0|2|3|5)$/, '');
    for (const [k, original] of porCanon) {
      if (k.replace(/-(0|2|3|5)$/, '') === base) return original;
    }
    return null;
  };

  const out: LineaSinCruce[] = [];
  for (const r of data.remisiones) {
    if (r.status === 'cancelado') continue;
    for (const it of r.items) {
      const ref = (it.reference ?? '').trim();
      if (!ref || it.units <= 0) continue;
      if (resuelve(ref)) continue;
      out.push({
        remision: r.number ?? r.id.slice(0, 8),
        fecha: r.date,
        cliente: r.beneficiary ?? '',
        reference: ref,
        units: it.units,
        sugerencia: sugerir(ref),
      });
    }
  }
  return out.sort((a, b) => b.units - a.units);
}

/** Fecha del conteo más viejo que hay registrado — arranque razonable para F0. */
export function corteSugerido(movs: PreviewMov[]): string {
  let min = '';
  for (const m of movs) {
    if (m.movement_type !== 'inicial') continue;
    const d = diaDe(m);
    if (d && (!min || d < min)) min = d;
  }
  return min || new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
}
