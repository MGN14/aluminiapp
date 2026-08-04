/**
 * Líneas de remisión cuya referencia NO cruza con ninguna variante ni alias:
 * unidades que salieron de bodega y nunca descuentan de nada. El hallazgo de
 * la Fase 1 (824 unidades invisibles). La cura es subir la referencia al
 * Maestro de Productos → Referencias por variante y recuadrar.
 */

import { supabase } from '@/integrations/supabase/client';
import { canonicalizeRef } from '@/lib/refFamily';

const db = supabase as never as { from: (t: string) => any };

export interface LineaSinCruce {
  remision: string;
  fecha: string;
  cliente: string;
  reference: string;
  units: number;
  /** Variante existente de la misma familia (pista del typo). */
  sugerencia: string | null;
}

export async function fetchLineasSinCruce(): Promise<LineaSinCruce[]> {
  const [variantesRes, remRes, aliasRes] = await Promise.all([
    db.from('inventory_variants').select('variant_reference').eq('active', true),
    db.from('remisiones')
      .select('id, number, date, beneficiary, status, remision_items(reference, units)')
      .neq('status', 'cancelado'),
    db.from('product_aliases').select('alias, ref_siigo'),
  ]);
  if ((variantesRes as any).error) throw (variantesRes as any).error;
  if ((remRes as any).error) throw (remRes as any).error;

  const porCanon = new Map<string, string>();
  for (const v of (((variantesRes as any).data ?? []) as { variant_reference: string }[])) {
    const k = canonicalizeRef(v.variant_reference);
    if (k && !porCanon.has(k)) porCanon.set(k, v.variant_reference);
  }
  const aliases = new Map<string, string>();
  for (const r of (((aliasRes as any).data ?? []) as { alias: string; ref_siigo: string }[])) {
    const k = canonicalizeRef(r.alias);
    if (k && r.ref_siigo) aliases.set(k, r.ref_siigo);
  }

  const resuelve = (ref: string): boolean => {
    const k = canonicalizeRef(ref);
    if (porCanon.has(k)) return true;
    const destino = aliases.get(k);
    return !!destino && porCanon.has(canonicalizeRef(destino));
  };
  const sugerir = (ref: string): string | null => {
    const base = canonicalizeRef(ref).replace(/-(0|2|3|5)$/, '');
    for (const [k, original] of porCanon) {
      if (k.replace(/-(0|2|3|5)$/, '') === base) return original;
    }
    return null;
  };

  const out: LineaSinCruce[] = [];
  const rems = (((remRes as any).data ?? []) as {
    id: string; number: string | null; date: string; beneficiary: string | null;
    remision_items: { reference: string; units: number }[] | null;
  }[]);
  for (const r of rems) {
    for (const it of r.remision_items ?? []) {
      const ref = (it.reference ?? '').trim();
      const units = Number(it.units ?? 0);
      if (!ref || units <= 0 || resuelve(ref)) continue;
      out.push({
        remision: r.number ?? r.id.slice(0, 8),
        fecha: r.date,
        cliente: r.beneficiary ?? '',
        reference: ref,
        units,
        sugerencia: sugerir(ref),
      });
    }
  }
  return out.sort((a, b) => b.units - a.units);
}
