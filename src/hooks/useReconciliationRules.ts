import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

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
    const kw = rule.keyword.toLowerCase().trim();
    if (!tx.description?.toLowerCase().includes(kw)) return false;
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
      const { data, error } = await rulesTable
        .select('*')
        .eq('user_id', user!.id)
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
    const activeRules = rules.filter(r => r.active && r.category_id);
    if (!activeRules.length) return 0;

    const { data: txs, error } = await supabase
      .from('transactions')
      .select('id, description, amount, date, category_id')
      .eq('statement_id', statementId)
      .is('deleted_at', null);

    if (error || !txs?.length) return 0;

    // Only process uncategorized transactions
    const uncategorized = txs.filter((tx: any) => !tx.category_id);
    if (!uncategorized.length) return 0;

    let applied = 0;
    const ruleUpdates: { ruleId: string; matchCount: number }[] = [];

    for (const tx of uncategorized) {
      for (const rule of activeRules) {
        if (matchesRule(rule, tx as any)) {
          const { error: updErr } = await supabase
            .from('transactions')
            .update({ category_id: rule.category_id })
            .eq('id', (tx as any).id);

          if (!updErr) {
            applied++;
            const existing = ruleUpdates.find(u => u.ruleId === rule.id);
            if (existing) existing.matchCount++;
            else ruleUpdates.push({ ruleId: rule.id, matchCount: 1 });
          }
          break; // first matching rule wins
        }
      }
    }

    // Update match counts for all matched rules in one batch
    for (const { ruleId, matchCount } of ruleUpdates) {
      const rule = activeRules.find(r => r.id === ruleId);
      if (rule) {
        await (supabase as any)
          .from('reconciliation_rules')
          .update({
            match_count: rule.match_count + matchCount,
            last_matched_at: new Date().toISOString(),
          })
          .eq('id', ruleId);
      }
    }

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
    const activeRules = rules.filter(r => r.active && r.category_id);
    if (!activeRules.length) return { total: 0, categorized: 0, skipped: 0, errors: 0 };

    const { data: txs, error } = await supabase
      .from('transactions')
      .select('id, description, amount, date, category_id')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .is('category_id', null); // only touch uncategorized — never overwrite

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
          const { error: updErr } = await supabase
            .from('transactions')
            .update({ category_id: rule.category_id })
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
    const activeRules = rules.filter(r => r.active && r.category_id);
    if (!activeRules.length) return 0;

    const { data: txs } = await supabase
      .from('transactions')
      .select('id, description, amount, date, category_id')
      .in('id', transactionIds)
      .is('deleted_at', null);

    if (!txs?.length) return 0;

    const uncategorized = txs.filter((tx: any) => !tx.category_id);
    if (!uncategorized.length) return 0;

    let applied = 0;
    for (const tx of uncategorized) {
      for (const rule of activeRules) {
        if (matchesRule(rule, tx as any)) {
          const { error } = await supabase
            .from('transactions')
            .update({ category_id: rule.category_id })
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
