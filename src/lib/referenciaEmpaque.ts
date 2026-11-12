import { supabase } from '@/integrations/supabase/client';
import { canonicalizeRef, refFamilyKey } from '@/lib/refFamily';
import { parseLooseNumber } from '@/lib/delimitedParser';

// Medida de paquete (piezas por paquete) y peso por pieza de cada referencia,
// guardados en Referencias por variante (inventory_variants, migración
// 20261112150000). Los usa el plan de cargue de la remisión.

export interface EmpaqueVariante {
  id: string;
  variant_reference: string;
  unidades_por_paquete: number | null;
  kg_por_unidad: number | null;
}

const db = supabase as never as { from: (t: string) => any };

/** ¿El error es "esa columna no existe" (migración sin aplicar)? */
export function esFaltaColumna(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === '42703' || e.code === 'PGRST204'
    || /column .* does not exist|could not find the .* column|schema cache/i.test(String(e.message ?? ''));
}

/**
 * Número con decimales tal como lo escribe la gente: "2,35" y "2.35" son
 * 2,35 kg (no 235). Si trae separador de miles y decimal ("1.234,5") usa el
 * parser general.
 */
export function parseDecimal(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  const s = raw.trim();
  if (!s) return null;
  const simple = /^\d+(?:[.,]\d+)?$/.test(s) ? Number(s.replace(',', '.')) : parseLooseNumber(s);
  return Number.isFinite(simple) && simple > 0 ? simple : null;
}

export interface CambioEmpaque {
  unidades_por_paquete?: number | null;
  kg_por_unidad?: number | null;
}

/**
 * Qué variantes tocar al guardar el dato de UNA referencia:
 *  - la referencia misma, siempre;
 *  - los otros colores de la misma familia que NO tengan ese dato (rellena
 *    huecos, nunca pisa lo que alguien ya puso);
 *  - con `todosLosColores`, todos los de la familia aunque tengan dato.
 */
export function planGuardadoEmpaque(
  variantes: EmpaqueVariante[],
  reference: string,
  cambio: CambioEmpaque,
  todosLosColores = false,
): { id: string; patch: CambioEmpaque }[] {
  const canon = canonicalizeRef(reference);
  const fam = refFamilyKey(reference);
  const out: { id: string; patch: CambioEmpaque }[] = [];
  for (const v of variantes) {
    const esLaMisma = canonicalizeRef(v.variant_reference) === canon;
    const mismaFamilia = refFamilyKey(v.variant_reference) === fam;
    if (!esLaMisma && !mismaFamilia) continue;
    const patch: CambioEmpaque = {};
    for (const campo of ['unidades_por_paquete', 'kg_por_unidad'] as const) {
      if (!(campo in cambio)) continue;
      const nuevo = cambio[campo] ?? null;
      const actual = v[campo] ?? null;
      if (esLaMisma || todosLosColores || actual == null) {
        if (actual !== nuevo) patch[campo] = nuevo;
      }
    }
    if (Object.keys(patch).length) out.push({ id: v.id, patch });
  }
  return out;
}

export async function cargarEmpaquesVariantes(): Promise<{ variantes: EmpaqueVariante[]; faltaMigracion: boolean }> {
  const { data, error } = await db
    .from('inventory_variants')
    .select('id, variant_reference, unidades_por_paquete, kg_por_unidad')
    .eq('active', true);
  if (error) {
    if (esFaltaColumna(error)) return { variantes: [], faltaMigracion: true };
    throw error;
  }
  return { variantes: (data ?? []) as EmpaqueVariante[], faltaMigracion: false };
}

/**
 * A dónde va el dato que se escribe para una referencia del pedido:
 *  - 'exacta': la referencia está en Referencias por variante (LIV-35-3);
 *  - 'familia': no está, pero sí sus colores. Pasa con las remisiones que
 *    vienen de facturas DIAN/Siigo, que usan la "-5" (el total, que no es una
 *    variante): el dato es del perfil y va a TODOS sus colores;
 *  - 'ninguna': ni la referencia ni sus colores existen.
 */
export function destinoGuardado(variantes: Pick<EmpaqueVariante, 'variant_reference'>[], reference: string): 'exacta' | 'familia' | 'ninguna' {
  const canon = canonicalizeRef(reference);
  const fam = refFamilyKey(reference);
  let familia = false;
  for (const v of variantes) {
    if (canonicalizeRef(v.variant_reference) === canon) return 'exacta';
    if (refFamilyKey(v.variant_reference) === fam) familia = true;
  }
  return familia ? 'familia' : 'ninguna';
}

/** Actualiza una variante y avisa si no se guardó nada (permiso o fila borrada). */
export async function actualizarVariante(id: string, patch: CambioEmpaque): Promise<void> {
  const { data, error } = await db.from('inventory_variants').update(patch).eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('La base no dejó guardar el cambio (la referencia no existe o tu usuario no tiene permiso para editarla).');
}

/**
 * Guarda paquete y/o peso de una referencia (y rellena sus otros colores
 * vacíos). Si la referencia no es una variante pero sus colores sí (la "-5"),
 * lo guarda en todos sus colores. `existe` = false si no hay dónde guardarlo.
 */
export async function guardarEmpaqueReferencia(
  reference: string,
  cambio: CambioEmpaque,
  opts: { todosLosColores?: boolean; variantes?: EmpaqueVariante[] } = {},
): Promise<{ cambiadas: number; existe: boolean; enColores: boolean }> {
  const variantes = opts.variantes ?? (await cargarEmpaquesVariantes()).variantes;
  const destino = destinoGuardado(variantes, reference);
  if (destino === 'ninguna') return { cambiadas: 0, existe: false, enColores: false };
  const enColores = destino === 'familia';
  const plan = planGuardadoEmpaque(variantes, reference, cambio, opts.todosLosColores || enColores);
  for (const { id, patch } of plan) await actualizarVariante(id, patch);
  return { cambiadas: plan.length, existe: true, enColores };
}
