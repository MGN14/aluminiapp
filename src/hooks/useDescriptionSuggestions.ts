/**
 * Descripciones existentes en los extractos del usuario, con frecuencia de uso.
 * Excluye las sintéticas de tarjeta ("Compra TC *2047" / "Pago/abono TC")
 * que son justo lo que se quiere reemplazar.
 *
 * Compartido por el lápiz de descripción de tarjeta (CardDescriptionEditor) y
 * el formulario de reglas inversas (CardDescriptionRulesSection). Query lazy
 * (enabled) de una sola columna, cacheada 10 min — cero costo si nadie la abre.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface DescriptionSuggestion {
  description: string;
  count: number;
}

async function querySuggestions(): Promise<DescriptionSuggestion[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('description')
    .is('deleted_at', null)
    .not('description', 'ilike', 'compra tc %')
    .not('description', 'ilike', 'pago/abono tc %')
    .limit(10000);
  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { description: string | null }[]) {
    const d = (row.description ?? '').trim();
    if (!d) continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([description, count]) => ({ description, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 400);
}

export function useDescriptionSuggestions(enabled: boolean) {
  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: ['conciliacion', 'descripciones-sugeridas'],
    queryFn: querySuggestions,
    enabled,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
  });
  return { suggestions, isLoading };
}
