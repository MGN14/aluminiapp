import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { normalizeForMatch } from '@/lib/stringUtils';

export interface ReconciliationRule {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  pattern_ref?: string;
  keyword?: string;
  amount_min?: number;
  amount_max?: number;
  day_min?: number;
  day_max?: number;
  tx_type: 'ingreso' | 'egreso';
  category_id?: string;
  category_name?: string;
  responsible_id?: string;
  responsible_name?: string;
  auto_conciliate: boolean;
  active: boolean;
  match_count: number;
  last_matched_at?: string;
  created_at: string;
}

export interface NewReconciliationRule {
  name: string;
  description?: string;
  pattern_ref?: string;
  keyword?: string;
  amount_min?: number;
  amount_max?: number;
  day_min?: number;
  day_max?: number;
  tx_type: 'ingreso' | 'egreso';
  category_id?: string;
  category_name?: string;
  responsible_id?: string;
  responsible_name?: string;
  auto_conciliate?: boolean;
}

/** Returns true if a transaction matches a given rule */
export function matchesRule(
  rule: ReconciliationRule,
  tx: { description: string; amount: number | null; date: string }
): boolean {
  if (!rule.active) return false;
  const amt = Math.abs(tx.amount ?? 0);
  const isEgreso = (tx.amount ?? 0) < 0;
  const txType = isEgreso ? 'egreso' : 'ingreso';
  if (rule.tx_type !== txType) return false;
  if (rule.amount_min != null && amt < rule.amount_min) return false;
  if (rule.amount_max != null && amt > rule.amount_max) return false;
  const day = new Date(tx.date).getDate();
  if (rule.day_min != null && day < rule.day_min) return false;
  if (rule.day_max != null && day > rule.day_max) return false;
  if (rule.keyword) {
    const kw = normalizeForMatch(rule.keyword);
    const desc = normalizeForMatch(tx.description ?? '');
    if (!desc.includes(kw)) return false;
  }
  return true;
}

export function useReconciliationRules() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const rulesTable = (supabase as any).from('reconciliation_rules');

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['reconciliation-rules', user?.id],
    queryFn: async () => {
      // RLS filtra por owner; sin .eq('user_id', user.id) que rompía a colaboradores.
      const { data, error } = await rulesTable
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ReconciliationRule[];
    },
    enabled: !!user?.id,
  });

  const createRule = useMutation({
    mutationFn: async (rule: NewReconciliationRule) => {
      const { data, error } = await (supabase as any)
        .from('reconciliation_rules')
        .insert({ ...rule, user_id: user!.id })
        .select()
        .single();
      if (error) throw error;

      // Archive the source pattern so it stops appearing in the suggestions list.
      // Only applies to DB patterns (real UUIDs); local computed patterns have
      // string IDs like 'categoria-dominante' and are not in business_patterns.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (rule.pattern_ref && UUID_RE.test(rule.pattern_ref)) {
        await (supabase as any)
          .from('business_patterns')
          .update({ status: 'archived' })
          .eq('id', rule.pattern_ref)
          .eq('user_id', user!.id);
      }

      return data as unknown as ReconciliationRule;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reconciliation-rules'] });
      qc.invalidateQueries({ queryKey: ['business-patterns'] });
    },
  });

  const toggleRule = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await (supabase as any)
        .from('reconciliation_rules')
        .update({ active })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reconciliation-rules'] }),
  });

  const updateRule = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<NewReconciliationRule> }) => {
      const { data, error } = await (supabase as any)
        .from('reconciliation_rules')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as ReconciliationRule;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reconciliation-rules'] }),
  });

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('reconciliation_rules')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reconciliation-rules'] }),
  });

  /**
   * Fetches all transactions for a given statement_id and applies matching
   * reconciliation rules (auto-categorizes uncategorized transactions).
   * Returns the number of transactions categorized.
   */
  const applyRulesToStatement = async (statementId: string): Promise<number> => {
    if (!rules.length || !statementId) return 0;
    // Aceptar reglas que aporten al menos category_id O responsible_id —
    // antes filtrábamos por category_id obligatorio y descartábamos las
    // reglas que solo asignaban beneficiario.
    const activeRules = rules.filter(r => r.active && (r.category_id || r.responsible_id));
    if (!activeRules.length) return 0;

    const { data: txs, error } = await supabase
      .from('transactions')
      .select('id, description, amount, date, category_id, responsible_id')
      .eq('statement_id', statementId)
      .is('deleted_at', null);

    if (error || !txs?.length) return 0;

    // No tocar lo que ya está conciliado: si la tx ya tiene categoría O
    // beneficiario, la regla no debe pisar. El usuario decidió manualmente
    // y no queremos desconciliar lo trabajado de la semana anterior.
    const candidates = txs.filter((tx: any) => !tx.category_id && !tx.responsible_id);
    if (!candidates.length) return 0;

    type Update = { category_id?: string; responsible_id?: string };
    // Agrupar por la combinación exacta de campos a setear, para hacer 1 UPDATE
    // por combinación distinta en lugar de 1 por transacción.
    const updateBuckets = new Map<string, { update: Update; ids: string[] }>();
    const ruleHits: Record<string, number> = {};

    for (const tx of candidates) {
      for (const rule of activeRules) {
        if (matchesRule(rule, tx as any)) {
          const update: Update = {};
          if (rule.category_id) update.category_id = rule.category_id;
          if (rule.responsible_id) update.responsible_id = rule.responsible_id;
          const key = `${update.category_id ?? ''}__${update.responsible_id ?? ''}`;
          const bucket = updateBuckets.get(key) ?? { update, ids: [] };
          bucket.ids.push((tx as any).id);
          updateBuckets.set(key, bucket);
          ruleHits[rule.id] = (ruleHits[rule.id] ?? 0) + 1;
          break; // first matching rule wins
        }
      }
    }

    let applied = 0;
    for (const { update, ids } of updateBuckets.values()) {
      const { error: updErr } = await supabase
        .from('transactions')
        .update(update)
        .in('id', ids);
      if (!updErr) applied += ids.length;
    }

    // Update rule match counts in parallel
    await Promise.all(
      Object.entries(ruleHits).map(([ruleId, matchCount]) => {
        const rule = activeRules.find(r => r.id === ruleId);
        if (!rule) return null;
        return (supabase as any)
          .from('reconciliation_rules')
          .update({
            match_count: rule.match_count + matchCount,
            last_matched_at: new Date().toISOString(),
          })
          .eq('id', ruleId);
      }),
    );

    if (applied > 0) {
      qc.invalidateQueries({ queryKey: ['reconciliation-rules'] });
    }

    return applied;
  };

  /**
   * Batch-apply rules to ALL uncategorized transactions for the current user
   * (across every statement, including pre-migration data). Returns totals so
   * the UI can show a progress report.
   *
   * This is the retroactive counterpart to applyRulesToStatement, which only
   * runs at statement-upload time.
   */
  const applyRulesToAllUserTransactions = async (
    onProgress?: (current: number, total: number) => void,
  ): Promise<{ total: number; categorized: number; skipped: number; errors: number }> => {
    if (!user?.id) return { total: 0, categorized: 0, skipped: 0, errors: 0 };
    const activeRules = rules.filter(r => r.active && (r.category_id || r.responsible_id));
    if (!activeRules.length) return { total: 0, categorized: 0, skipped: 0, errors: 0 };

    // Solo tocar tx sin categoría Y sin beneficiario — no pisar trabajo manual.
    const { data: txs, error } = await supabase
      .from('transactions')
      .select('id, description, amount, date, category_id, responsible_id')
      .is('deleted_at', null)
      .is('category_id', null)
      .is('responsible_id', null);

    if (error || !txs?.length) {
      return { total: 0, categorized: 0, skipped: 0, errors: 0 };
    }

    const total = txs.length;
    let categorized = 0;
    let skipped = 0;
    let errors = 0;
    const ruleHits: Record<string, number> = {};

    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i] as any;
      let matched = false;
      for (const rule of activeRules) {
        if (matchesRule(rule, tx)) {
          const update: { category_id?: string; responsible_id?: string } = {};
          if (rule.category_id) update.category_id = rule.category_id;
          if (rule.responsible_id) update.responsible_id = rule.responsible_id;
          const { error: updErr } = await supabase
            .from('transactions')
            .update(update)
            .eq('id', tx.id);
          if (updErr) {
            errors++;
          } else {
            categorized++;
            ruleHits[rule.id] = (ruleHits[rule.id] ?? 0) + 1;
          }
          matched = true;
          break; // first match wins
        }
      }
      if (!matched) skipped++;
      onProgress?.(i + 1, total);
    }

    // Bump match_count / last_matched_at for the rules that fired.
    const now = new Date().toISOString();
    for (const [ruleId, hits] of Object.entries(ruleHits)) {
      const rule = activeRules.find(r => r.id === ruleId);
      if (!rule) continue;
      await (supabase as any)
        .from('reconciliation_rules')
        .update({ match_count: rule.match_count + hits, last_matched_at: now })
        .eq('id', ruleId);
    }

    if (categorized > 0) {
      qc.invalidateQueries({ queryKey: ['reconciliation-rules'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    }

    return { total, categorized, skipped, errors };
  };

  /**
   * Apply rules to a set of transactions (for manual re-processing).
   * Returns the number of transactions categorized.
   */
  const applyRulesToTransactions = async (transactionIds: string[]): Promise<number> => {
    if (!rules.length || !transactionIds.length) return 0;
    const activeRules = rules.filter(r => r.active && (r.category_id || r.responsible_id));
    if (!activeRules.length) return 0;

    const { data: txs } = await supabase
      .from('transactions')
      .select('id, description, amount, date, category_id, responsible_id')
      .in('id', transactionIds)
      .is('deleted_at', null);

    if (!txs?.length) return 0;

    // No tocar tx ya conciliada (categoría O beneficiario).
    const candidates = txs.filter((tx: any) => !tx.category_id && !tx.responsible_id);
    if (!candidates.length) return 0;

    let applied = 0;
    for (const tx of candidates) {
      for (const rule of activeRules) {
        if (matchesRule(rule, tx as any)) {
          const update: { category_id?: string; responsible_id?: string } = {};
          if (rule.category_id) update.category_id = rule.category_id;
          if (rule.responsible_id) update.responsible_id = rule.responsible_id;
          const { error } = await supabase
            .from('transactions')
            .update(update)
            .eq('id', (tx as any).id);
          if (!error) applied++;
          break;
        }
      }
    }

    if (applied > 0) {
      qc.invalidateQueries({ queryKey: ['reconciliation-rules'] });
      toast.success(`Nico aplicó ${applied} regla${applied > 1 ? 's' : ''} automáticamente`);
    }

    return applied;
  };

  return {
    rules,
    isLoading,
    createRule,
    updateRule,
    toggleRule,
    deleteRule,
    applyRulesToStatement,
    applyRulesToTransactions,
    applyRulesToAllUserTransactions,
  };
}
