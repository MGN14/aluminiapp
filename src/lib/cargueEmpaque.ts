import { refFamilyKey } from '@/lib/refFamily';
import type { CanonFn, CargueLine, ConteoEvent } from '@/lib/despachoCargue';
import { ordenarPorUbicacion } from '@/lib/despachoCargue';

// Empaque, peso y orden del CARGUE de una remisión.
//
// Los perfiles salen por PAQUETES de una medida estándar (6, 10, 20 piezas…)
// con excepciones (el último paquete viene de 4). Acá se calcula:
//   - de dónde sale la medida estándar y el peso por pieza: lo que se ajustó a
//     mano en el plan de ESA remisión > Referencias por variante (el dato
//     oficial) > packing list de Importaciones (cantidad ÷ bultos, peso ÷
//     cantidad) > maestro -5 (units_per_package);
//   - cuántos paquetes lleva cada línea (completos + uno incompleto);
//   - en qué orden se carga el camión (lo más pesado primero, por ubicación,
//     como viene la remisión o a mano).
//
// Todo con objetos planos (Record): parte de esto pasa por el cache persistido.

export type FuenteEmpaque = 'plan' | 'referencia' | 'referencia-familia' | 'contenedor' | 'contenedor-familia' | 'maestro' | 'sin-dato';

export interface EmpaqueRef {
  porPaquete: number | null;   // unidades por paquete estándar
  kgPorUnidad: number | null;
  fuente: FuenteEmpaque;
}

export interface ImportItemLite {
  reference: string;
  cantidad: number | null;
  bultos: number | null;
  unidad: string | null;
  peso_kg: number | null;
  created_at?: string | null;
}

export interface ProductoEmpaque {
  reference: string;
  units_per_package: number | null;
}

/** Dato oficial de Referencias por variante (inventory_variants). */
export interface ReferenciaEmpaque {
  variant_reference: string;
  unidades_por_paquete: number | null;
  kg_por_unidad: number | null;
}

/** Unidades que se cuentan por pieza (no por kilo/metro). */
function esPorPieza(unidad: string | null | undefined): boolean {
  const u = (unidad ?? '').trim().toLowerCase();
  if (!u) return true;
  return !/^(kg|kgs|kilo|kilos|kilogramos?|ton|t|m|mts|metros?|ml)$/.test(u);
}

interface Medida { porPaquete: number | null; kgPorUnidad: number | null; at: string }

/**
 * Del packing list de cada contenedor sale la medida real: cantidad ÷ bultos
 * = piezas por paquete, peso ÷ cantidad = kg por pieza. Se toma el contenedor
 * más reciente que traiga cada dato.
 */
function medidasDeContenedores(items: ImportItemLite[], llave: (ref: string) => string): Record<string, Medida> {
  const out: Record<string, Medida> = {};
  for (const it of items) {
    const k = llave(it.reference ?? '');
    if (!k || !esPorPieza(it.unidad)) continue;
    const cant = Number(it.cantidad) || 0;
    const bultos = Number(it.bultos) || 0;
    const peso = Number(it.peso_kg) || 0;
    const at = it.created_at ?? '';
    const pp = cant > 0 && bultos > 0 ? Math.round(cant / bultos) : null;
    const kg = cant > 0 && peso > 0 ? peso / cant : null;
    const cur = out[k] ?? { porPaquete: null, kgPorUnidad: null, at: '' };
    const masNuevo = at >= cur.at;
    out[k] = {
      porPaquete: pp && pp >= 1 && (masNuevo || cur.porPaquete == null) ? pp : cur.porPaquete,
      kgPorUnidad: kg && (masNuevo || cur.kgPorUnidad == null) ? kg : cur.kgPorUnidad,
      at: masNuevo ? at : cur.at,
    };
  }
  return out;
}

/**
 * Medida de empaque y peso por referencia (llave canónica de la línea).
 * Prioridad: ajuste del plan de esta remisión > Referencias por variante
 * (misma ref, luego otro color de la familia) > contenedor (misma ref, luego
 * familia: el empaque y el peso no cambian con el color) > maestro -5.
 */
export function resolverEmpaques(
  lines: Pick<CargueLine, 'key' | 'reference'>[],
  canon: CanonFn,
  opts: {
    importItems?: ImportItemLite[];
    productos?: ProductoEmpaque[];
    referencias?: ReferenciaEmpaque[];
    ajustes?: Record<string, number>;
  } = {},
): Record<string, EmpaqueRef> {
  const refExacta: Record<string, ReferenciaEmpaque> = {};
  const refFamilia: Record<string, { pp: number | null; kg: number | null }> = {};
  for (const r of opts.referencias ?? []) {
    const k = canon(r.variant_reference ?? '');
    if (k) refExacta[k] = r;
    const f = refFamilyKey(r.variant_reference);
    if (!f) continue;
    const cur = refFamilia[f] ?? { pp: null, kg: null };
    if (cur.pp == null && Number(r.unidades_por_paquete) > 0) cur.pp = Number(r.unidades_por_paquete);
    if (cur.kg == null && Number(r.kg_por_unidad) > 0) cur.kg = Number(r.kg_por_unidad);
    refFamilia[f] = cur;
  }
  const porRef = medidasDeContenedores(opts.importItems ?? [], canon);
  const porFamilia = medidasDeContenedores(opts.importItems ?? [], (r) => refFamilyKey(r));
  const maestro: Record<string, number> = {};
  const maestroFam: Record<string, number> = {};
  for (const p of opts.productos ?? []) {
    const n = Number(p.units_per_package) || 0;
    if (n <= 0) continue;
    maestro[canon(p.reference)] = n;
    const f = refFamilyKey(p.reference);
    if (f && !(f in maestroFam)) maestroFam[f] = n;
  }

  const out: Record<string, EmpaqueRef> = {};
  for (const l of lines) {
    const fam = refFamilyKey(l.reference);
    const exacta = porRef[l.key];
    const familia = porFamilia[fam];
    const oficial = refExacta[l.key];
    const oficialPp = Number(oficial?.unidades_por_paquete) > 0 ? Number(oficial!.unidades_por_paquete) : null;
    const oficialKg = Number(oficial?.kg_por_unidad) > 0 ? Number(oficial!.kg_por_unidad) : null;
    const famOficial = refFamilia[fam];
    const kg = oficialKg ?? famOficial?.kg ?? exacta?.kgPorUnidad ?? familia?.kgPorUnidad ?? null;
    const ajuste = Number(opts.ajustes?.[l.key]) || 0;
    if (ajuste > 0) { out[l.key] = { porPaquete: ajuste, kgPorUnidad: kg, fuente: 'plan' }; continue; }
    if (oficialPp) { out[l.key] = { porPaquete: oficialPp, kgPorUnidad: kg, fuente: 'referencia' }; continue; }
    if (famOficial?.pp) { out[l.key] = { porPaquete: famOficial.pp, kgPorUnidad: kg, fuente: 'referencia-familia' }; continue; }
    if (exacta?.porPaquete) { out[l.key] = { porPaquete: exacta.porPaquete, kgPorUnidad: kg, fuente: 'contenedor' }; continue; }
    if (familia?.porPaquete) { out[l.key] = { porPaquete: familia.porPaquete, kgPorUnidad: kg, fuente: 'contenedor-familia' }; continue; }
    const m = maestro[l.key] ?? maestroFam[fam];
    if (m) { out[l.key] = { porPaquete: m, kgPorUnidad: kg, fuente: 'maestro' }; continue; }
    out[l.key] = { porPaquete: null, kgPorUnidad: kg, fuente: 'sin-dato' };
  }
  return out;
}

export interface PaquetesPlan {
  completos: number;   // paquetes de la medida estándar
  resto: number;       // unidades del último paquete incompleto (0 = no hay)
  total: number;       // paquetes en total
}

/** 120 piezas de a 6 → 20 paquetes; 100 de a 6 → 16 de 6 + 1 de 4 = 17. */
export function paquetesDe(unidades: number, porPaquete: number | null): PaquetesPlan {
  const u = Math.max(0, Math.round(Number(unidades) || 0));
  const pp = Math.round(Number(porPaquete) || 0);
  if (pp <= 0) return { completos: 0, resto: u, total: u > 0 ? 1 : 0 };
  const completos = Math.floor(u / pp);
  const resto = u - completos * pp;
  return { completos, resto, total: completos + (resto > 0 ? 1 : 0) };
}

export function textoPaquetes(p: PaquetesPlan, porPaquete: number | null): string {
  if (!porPaquete || porPaquete <= 0) return 'Sin medida de paquete';
  if (p.total === 0) return '0 paquetes';
  if (p.resto === 0) return `${p.completos} paq × ${porPaquete}`;
  if (p.completos === 0) return `1 paq de ${p.resto}`;
  return `${p.completos} paq × ${porPaquete} + 1 de ${p.resto}`;
}

export interface CargadoPaquetes {
  paquetes: number;
  unidades: number;
}

/**
 * Lo cargado por referencia: cada evento es UN paquete (un escaneo de
 * etiqueta, "+ paquete" o "paquete especial"). Los eventos negativos de la
 * estación vieja restan un paquete.
 */
export function cargadoEnPaquetes(events: ConteoEvent[], canon: CanonFn): Record<string, CargadoPaquetes> {
  const out: Record<string, CargadoPaquetes> = {};
  for (const e of events) {
    const k = canon(e.reference ?? '');
    if (!k) continue;
    const q = Number(e.quantity) || 0;
    const cur = out[k] ?? { paquetes: 0, unidades: 0 };
    cur.paquetes += q > 0 ? 1 : q < 0 ? -1 : 0;
    cur.unidades += q;
    out[k] = cur;
  }
  for (const k of Object.keys(out)) {
    out[k].paquetes = Math.max(0, out[k].paquetes);
    out[k].unidades = Math.max(0, out[k].unidades);
  }
  return out;
}

/**
 * Cuántas unidades lleva el SIGUIENTE paquete de la línea: la medida estándar,
 * o lo que falta si es el último y viene incompleto (100 de a 6 → el paquete
 * 17 es de 4). Si ya está completa, la medida estándar (sobrante).
 */
export function siguientePaquete(pedido: number, cargado: number, porPaquete: number | null): number {
  const pp = Math.round(Number(porPaquete) || 0);
  const falta = Math.max(0, Math.round(pedido - cargado));
  if (pp <= 0) return Math.max(1, falta);
  if (falta > 0 && falta < pp) return falta;
  return pp;
}

export type CriterioCargue = 'peso' | 'ubicacion' | 'remision' | 'manual';

export const CRITERIOS: { id: Exclude<CriterioCargue, 'manual'>; label: string; ayuda: string }[] = [
  { id: 'peso', label: 'Lo más pesado primero', ayuda: 'Lo pesado va abajo y adelante; lo liviano arriba.' },
  { id: 'ubicacion', label: 'Lo que está a la mano', ayuda: 'Por ubicación en bodega: menos vueltas.' },
  { id: 'remision', label: 'Como viene la remisión', ayuda: 'El orden en que la oficina escribió el pedido.' },
];

export function pesoLinea(unidades: number, kgPorUnidad: number | null): number | null {
  if (!kgPorUnidad || kgPorUnidad <= 0) return null;
  return Math.max(0, unidades) * kgPorUnidad;
}

/**
 * Orden de cargue (primero = lo que sube primero al camión). Devuelve las
 * llaves. 'manual' respeta `ordenManual` y agrega al final lo que falte (la
 * oficina pudo agregar líneas después de planear).
 */
export function ordenarCargue<T extends Pick<CargueLine, 'key' | 'reference' | 'pedido'>>(
  lines: T[],
  criterio: CriterioCargue,
  opts: { empaques?: Record<string, EmpaqueRef>; ubicaciones?: Record<string, string[]>; ordenManual?: string[] } = {},
): string[] {
  if (criterio === 'manual') {
    const existe: Record<string, true> = {};
    for (const l of lines) existe[l.key] = true;
    const vistos: Record<string, true> = {};
    const out: string[] = [];
    for (const k of opts.ordenManual ?? []) if (existe[k] && !vistos[k]) { vistos[k] = true; out.push(k); }
    for (const l of lines) if (!vistos[l.key]) out.push(l.key);
    return out;
  }
  if (criterio === 'ubicacion') return ordenarPorUbicacion(lines, opts.ubicaciones ?? {}).map((l) => l.key);
  if (criterio === 'peso') {
    const peso = (l: T) => pesoLinea(l.pedido, opts.empaques?.[l.key]?.kgPorUnidad ?? null);
    return [...lines]
      .map((l, i) => ({ l, i, p: peso(l) }))
      .sort((a, b) => {
        if (a.p == null && b.p == null) return a.i - b.i;
        if (a.p == null) return 1;   // sin peso conocido, al final
        if (b.p == null) return -1;
        return b.p - a.p || a.i - b.i;
      })
      .map((x) => x.l.key);
  }
  return lines.map((l) => l.key);
}

/** Sube (delta −1) o baja (+1) una referencia en el orden. */
export function moverEnOrden(orden: string[], key: string, delta: number): string[] {
  const i = orden.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= orden.length) return orden;
  const out = [...orden];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export interface TotalesCargue {
  paquetesPlan: number;
  paquetesCargados: number;
  pesoKg: number;            // estimado de lo pedido (solo refs con peso conocido)
  refsSinPeso: number;
  refsSinEmpaque: number;
}

export function totalesCargue(
  lines: Pick<CargueLine, 'key' | 'pedido'>[],
  empaques: Record<string, EmpaqueRef>,
  cargado: Record<string, CargadoPaquetes>,
): TotalesCargue {
  let paquetesPlan = 0; let paquetesCargados = 0; let pesoKg = 0; let refsSinPeso = 0; let refsSinEmpaque = 0;
  for (const l of lines) {
    const e = empaques[l.key];
    paquetesPlan += paquetesDe(l.pedido, e?.porPaquete ?? null).total;
    paquetesCargados += cargado[l.key]?.paquetes ?? 0;
    const p = pesoLinea(l.pedido, e?.kgPorUnidad ?? null);
    if (p == null) refsSinPeso += 1; else pesoKg += p;
    if (!e?.porPaquete) refsSinEmpaque += 1;
  }
  return { paquetesPlan, paquetesCargados, pesoKg, refsSinPeso, refsSinEmpaque };
}

/** Checklist de seguridad que se confirma antes de despachar. */
export const SEGURIDAD = [
  { id: 'pesado_abajo', label: 'Lo más pesado y largo va abajo y adelante' },
  { id: 'amarrado', label: 'La carga quedó amarrada (cinta o estrobo) y no se corre' },
  { id: 'protegido', label: 'Los perfiles van protegidos para no rayarse' },
  { id: 'sobresale', label: 'Lo que sobresale lleva bandera roja (o no sobresale nada)' },
] as const;

export type SeguridadId = (typeof SEGURIDAD)[number]['id'];
