import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { normalizeCompanyName } from './stringUtils';

/**
 * Fuente de verdad: tabla `responsibles` (Beneficiarios de Conciliación
 * Bancaria) + `responsible_aliases`. Cualquier módulo que muestre nombre
 * de cliente/proveedor/beneficiario debe pasar por este resolver para
 * unificar variantes (typos, S.A.S vs SAS, casing, tildes).
 */
export interface CounterpartyResolverData {
  /** responsible.id → name canónico */
  byId: Map<string, string>;
  /** alias normalizado (lower/trim/sin sufijos legales) → name canónico */
  byAlias: Map<string, string>;
  /** true cuando los maps ya están cargados */
  ready: boolean;
}

const EMPTY: CounterpartyResolverData = {
  byId: new Map(),
  byAlias: new Map(),
  ready: false,
};

export function useCounterpartyResolver(): CounterpartyResolverData {
  const [data, setData] = useState<CounterpartyResolverData>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [respRes, aliasRes] = await Promise.all([
        supabase.from('responsibles').select('id, name'),
        supabase.from('responsible_aliases' as never).select('responsible_id, alias') as unknown as Promise<{ data: Array<{ responsible_id: string; alias: string }> | null }>,
      ]);
      if (cancelled) return;
      const byId = new Map<string, string>();
      const byAlias = new Map<string, string>();
      for (const r of (respRes.data ?? []) as Array<{ id: string; name: string }>) {
        byId.set(r.id, r.name);
        byAlias.set(normalizeCompanyName(r.name), r.name);
      }
      for (const a of (aliasRes.data ?? [])) {
        const canonical = byId.get(a.responsible_id);
        if (!canonical) continue;
        byAlias.set(normalizeCompanyName(a.alias), canonical);
      }
      setData({ byId, byAlias, ready: true });
    })();
    return () => { cancelled = true; };
  }, []);

  return data;
}

/**
 * Devuelve el nombre canónico:
 *   1. Si tiene responsible_id válido → responsibles.name
 *   2. Si no, normaliza rawName y busca en aliases
 *   3. Si no hay match → rawName trimmeado (fallback)
 *   4. Si rawName está vacío → "Sin identificar"
 */
export function resolveCounterpartyName(
  rawName: string | null | undefined,
  responsibleId: string | null | undefined,
  data: CounterpartyResolverData,
): string {
  if (responsibleId) {
    const canonical = data.byId.get(responsibleId);
    if (canonical) return canonical;
  }
  const trimmed = (rawName ?? '').trim();
  if (!trimmed) return 'Sin identificar';
  const normalized = normalizeCompanyName(trimmed);
  const canonical = data.byAlias.get(normalized);
  return canonical ?? trimmed;
}
