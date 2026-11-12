import { supabase } from '@/integrations/supabase/client';
import { fetchAllPaged } from '@/lib/fetchAllPaged';
import { canonicalizeRef, colorFromSuffix } from '@/lib/refFamily';

interface RemisionLine {
  reference: string;
  product_name: string;
  units: number;
}

export interface CatalogCandidate {
  reference: string;
  name: string;
}

export function missingCatalogReferences(
  lines: RemisionLine[],
  variants: string[],
  aliases: string[],
): { candidates: CatalogCandidate[]; omitted: string[] } {
  const known = new Set([...variants, ...aliases].map(canonicalizeRef));
  const candidates = new Map<string, CatalogCandidate>();
  const omitted = new Set<string>();

  for (const line of lines) {
    const key = canonicalizeRef(line.reference);
    if (!key || known.has(key) || !Number.isFinite(Number(line.units)) || Number(line.units) <= 0) continue;
    const looksLikeCode = /^[a-z0-9][a-z0-9./_-]*$/.test(key) && /\d/.test(key);
    if (!looksLikeCode || colorFromSuffix(key) === 'total' || /^(servicio|flete|transporte|descuento)/.test(key)) {
      omitted.add(line.reference.trim());
      continue;
    }
    const name = line.product_name?.trim();
    if (!candidates.has(key) || (!candidates.get(key)?.name && name)) {
      candidates.set(key, { reference: key.toUpperCase(), name: name || '' });
    }
  }

  return {
    candidates: [...candidates.values()].sort((a, b) => a.reference.localeCompare(b.reference, 'es', { numeric: true })),
    omitted: [...omitted].sort(),
  };
}

async function fetchCatalogKeys() {
  return Promise.all([
    fetchAllPaged<{ variant_reference: string }>((from, to) =>
      supabase.from('inventory_variants').select('variant_reference').order('id').range(from, to)),
    fetchAllPaged<{ alias: string }>((from, to) =>
      supabase.from('product_aliases').select('alias').order('alias').order('id').range(from, to)),
  ]);
}

export async function previewRemisionCatalog() {
  const [[variants, aliases], lines] = await Promise.all([
    fetchCatalogKeys(),
    fetchAllPaged<RemisionLine>((from, to) =>
      supabase.from('remision_items')
        .select('reference, product_name, units, remisiones!inner(status)')
        .or('status.neq.cancelado,status.is.null', { referencedTable: 'remisiones' })
        .order('created_at', { ascending: false }).order('id').range(from, to)),
  ]);
  return missingCatalogReferences(lines, variants.map((row) => row.variant_reference), aliases.map((row) => row.alias));
}

export function addRemisionCatalogReferences(lines: RemisionLine[], userId: string) {
  return addCatalogCandidates(missingCatalogReferences(lines, [], []).candidates, userId);
}

export async function addCatalogCandidates(confirmed: CatalogCandidate[], userId: string) {
  if (!confirmed.length) return 0;
  const [variants, aliases] = await fetchCatalogKeys();
  const existing = new Set([
    ...variants.map((row) => canonicalizeRef(row.variant_reference)),
    ...aliases.map((row) => canonicalizeRef(row.alias)),
  ]);
  const candidates = confirmed.filter(({ reference }) => !existing.has(canonicalizeRef(reference)));
  let inserted = 0;
  for (let offset = 0; offset < candidates.length; offset += 250) {
    const rows = candidates.slice(offset, offset + 250).map(({ reference, name }) => ({
      user_id: userId,
      variant_reference: reference,
      name: name || null,
      // La conciliación automática solo debe tomar variantes ya activas.
      active: false,
    }));
    const { data, error } = await supabase.from('inventory_variants')
      .upsert(rows, { onConflict: 'user_id,variant_reference', ignoreDuplicates: true })
      .select('id');
    if (error) throw error;
    inserted += data.length;
  }
  return inserted;
}
