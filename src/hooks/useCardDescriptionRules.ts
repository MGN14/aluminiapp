/**
 * Reglas INVERSAS de tarjeta de crédito: categoría + beneficiario → descripción.
 *
 * El CSV de tarjeta no trae comercio ("Compra TC *2047"). La regla normal va
 * descripción→categoría; acá es al revés: cuando el usuario asigna cierta
 * combinación (ej: Impuestos + DIAN) a un movimiento de tarjeta cuya
 * descripción sigue siendo la sintética, se reemplaza automáticamente
 * (ej: "IMPTO GOBIERNO 4X1000").
 *
 * Tabla propia (card_description_rules) — NO reconciliation_rules — para que
 * los appliers de reglas normales (frontend, trigger, RPC) jamás las tomen
 * como reglas de categorización sin keyword (matchearían todo).
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface CardDescriptionRule {
  id: string;
  user_id: string;
  category_id: string | null;
  responsible_id: string | null;
  description: string;
  active: boolean;
  match_count: number;
  created_at: string;
}

export interface NewCardDescriptionRule {
  category_id: string | null;
  responsible_id: string | null;
  description: string;
}

/** ¿La descripción sigue siendo la sintética del import de tarjeta?
 *  Solo esas se reemplazan automáticamente — si el usuario ya escribió algo
 *  a mano (o la regla ya corrió), no se pisa. */
export function isSyntheticCardDescription(description: string | null | undefined): boolean {
  const d = (description ?? '').trim().toLowerCase();
  return d.startsWith('compra tc ') || d.startsWith('pago/abono tc ');
}

/** Primera regla activa cuyas condiciones (las no-nulas) satisface la tx.
 *  Una regla con categoría Y beneficiario exige ambos — no dispara hasta que
 *  el movimiento tenga los dos asignados. */
export function findMatchingCardRule(
  rules: CardDescriptionRule[],
  categoryId: string | null | undefined,
  responsibleId: string | null | undefined,
): CardDescriptionRule | null {
  for (const rule of rules) {
    if (!rule.active) continue;
    if (rule.category_id && rule.category_id !== categoryId) continue;
    if (rule.responsible_id && rule.responsible_id !== responsibleId) continue;
    return rule;
  }
  return null;
}

export function useCardDescriptionRules() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const table = () => (supabase as any).from('card_description_rules');

  const { data: cardRules = [], isLoading } = useQuery({
    queryKey: ['card-description-rules', user?.id],
    queryFn: async () => {
      // RLS filtra por owner (colaboradores ven las del owner).
      const { data, error } = await table()
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as CardDescriptionRule[];
    },
    enabled: !!user?.id,
    staleTime: 10 * 60_000,
  });

  /**
   * Renombra retroactivamente los movimientos de tarjeta que YA tienen la
   * categoría/beneficiario de la regla y siguen con descripción sintética.
   * Devuelve cuántos renombró.
   */
  const applyRuleToExisting = async (rule: CardDescriptionRule): Promise<number> => {
    let query = supabase
      .from('transactions')
      .update({ description: rule.description } as never)
      .ilike('description', 'compra tc %')
      .is('deleted_at', null);
    if (rule.category_id) query = query.eq('category_id', rule.category_id);
    if (rule.responsible_id) query = query.eq('responsible_id', rule.responsible_id);
    const { data, error } = await query.select('id');
    if (error) throw error;

    const renamed = data?.length ?? 0;
    if (renamed > 0) {
      // Contador best-effort (RMW simple: un solo usuario edita reglas).
      await table().update({ match_count: rule.match_count + renamed }).eq('id', rule.id);
      qc.invalidateQueries({ queryKey: ['conciliacion'] });
      qc.invalidateQueries({ queryKey: ['card-description-rules'] });
    }
    return renamed;
  };

  const createRule = useMutation({
    mutationFn: async (rule: NewCardDescriptionRule) => {
      const { data, error } = await table()
        .insert({ ...rule, user_id: user!.id })
        .select()
        .single();
      if (error) throw error;
      return data as CardDescriptionRule;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['card-description-rules'] }),
  });

  const toggleRule = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await table().update({ active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['card-description-rules'] }),
  });

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await table().delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['card-description-rules'] }),
  });

  return { cardRules, isLoading, createRule, toggleRule, deleteRule, applyRuleToExisting };
}
