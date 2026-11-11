import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { normalizeForMatch } from '@/lib/stringUtils';
import { type MovementNature } from '@/types/transaction';

export interface ReconciliationRule {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  pattern_ref?: string;
  keyword?: string;
  /** Si true, keyword se interpreta como regex POSIX (case-insensitive en backend) */
  keyword_is_regex?: boolean;
  amount_min?: number;
  amount_max?: number;
  day_min?: number;
  day_max?: number;
  tx_type: 'ingreso' | 'egreso';
  category_id?: string;
  category_name?: string;
  responsible_id?: string;
  responsible_name?: string;
  /** Si no es null, la regla setea transactions.movement_nature al matchear
   *  (ej: 'traspaso' para excluir "PAGO TARJETA" del P&G). */
  movement_nature?: MovementNature;
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
  keyword_is_regex?: boolean;
  amount_min?: number;
  amount_max?: number;
  day_min?: number;
  day_max?: number;
  tx_type: 'ingreso' | 'egreso';
  category_id?: string;
  category_name?: string;
  responsible_id?: string;
  responsible_name?: string;
  movement_nature?: MovementNature;
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
    const desc = normalizeForMatch(tx.description ?? '');
    if (rule.keyword_is_regex) {
      try {
        const re = new RegExp(rule.keyword, 'i');
        if (!re.test(desc)) return false;
      } catch {
        return false; // regex inválido = no matchea (proteger UI)
      }
    } else {
      const kw = normalizeForMatch(rule.keyword);
      if (!desc.includes(kw)) return false;
    }
  }
  return true;
}

/**
 * Firma de las reglas ACTIVAS que aportan algo (categoría, beneficiario o
 * naturaleza). Cambia cuando se crea, edita, activa o apaga una regla; NO
 * cambia con match_count / last_matched_at / updated_at, que el propio
 * barrido mueve (si entraran a la firma, el barrido se dispararía solo).
 * Devuelve "<cantidad>:<hash corto>" — el hash es para no guardar el texto
 * entero en sessionStorage, no es seguridad.
 */
export function firmaReglasActivas(rules: ReconciliationRule[]): string {
  const partes = rules
    .filter((r) => r.active && (r.category_id || r.responsible_id || r.movement_nature))
    .map((r) => [
      r.id, r.tx_type, r.keyword ?? '', r.keyword_is_regex ? 1 : 0,
      r.amount_min ?? '', r.amount_max ?? '', r.day_min ?? '', r.day_max ?? '',
      r.category_id ?? '', r.responsible_id ?? '', r.movement_nature ?? '',
    ].join('~'))
    .sort();
  const texto = partes.join('|');
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  return `${partes.length}:${(h >>> 0).toString(36)}`;
}

/** sessionStorage: con qué firma de reglas ya se barrió en esta sesión. */
const BARRIDO_SESION_KEY = 'aluminia_reglas_barrido_v1';

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
    const activeRules = rules.filter(r => r.active && (r.category_id || r.responsible_id || r.movement_nature));
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

    type Update = { category_id?: string; responsible_id?: string; movement_nature?: string };
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
          if (rule.movement_nature) update.movement_nature = rule.movement_nature;
          const key = `${update.category_id ?? ''}__${update.responsible_id ?? ''}__${update.movement_nature ?? ''}`;
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
      qc.invalidateQueries({ queryKey: ['conciliacion'] });
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
    const activeRules = rules.filter(r => r.active && (r.category_id || r.responsible_id || r.movement_nature));
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
          const update: { category_id?: string; responsible_id?: string; movement_nature?: string } = {};
          if (rule.category_id) update.category_id = rule.category_id;
          if (rule.responsible_id) update.responsible_id = rule.responsible_id;
          if (rule.movement_nature) update.movement_nature = rule.movement_nature;
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
      qc.invalidateQueries({ queryKey: ['conciliacion'] });
    }

    return { total, categorized, skipped, errors };
  };

  /**
   * Apply rules to a set of transactions (for manual re-processing).
   * Returns the number of transactions categorized.
   */
  const applyRulesToTransactions = async (transactionIds: string[]): Promise<number> => {
    if (!rules.length || !transactionIds.length) return 0;
    const activeRules = rules.filter(r => r.active && (r.category_id || r.responsible_id || r.movement_nature));
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
          const update: { category_id?: string; responsible_id?: string; movement_nature?: string } = {};
          if (rule.category_id) update.category_id = rule.category_id;
          if (rule.responsible_id) update.responsible_id = rule.responsible_id;
          if (rule.movement_nature) update.movement_nature = rule.movement_nature;
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
      qc.invalidateQueries({ queryKey: ['conciliacion'] });
      toast.success(`Nico aplicó ${applied} regla${applied > 1 ? 's' : ''} automáticamente`);
    }

    return applied;
  };

  /**
   * Aplica reglas RETROACTIVAMENTE a TX sin matchear vía RPC en DB.
   * Mucho más rápido que applyRulesToAllUserTransactions (que itera en JS).
   * Usa la función SQL apply_pending_rules_for_user implementada en migration auto_matching_v2.
   */
  const applyPendingRulesViaRPC = async (
    limit = 5000,
    opts?: { quiet?: boolean },
  ): Promise<{ processed: number; matched: number }> => {
    const { data, error } = await (supabase as any).rpc('apply_pending_rules_for_user', {
      p_user_id: user?.id ?? null,
      p_limit: limit,
      p_source: 'frontend',
    });
    if (error) throw error;
    const stats = data as { processed: number; matched: number };
    // `matched` = filas donde una regla LLENÓ algo (categoría, beneficiario o
    // naturaleza). Antes contaba también las que la regla volvía a tocar sin
    // cambiar nada y el aviso "19 de 53 categorizadas" salía en cada entrada
    // (Nico 2026-11-11) — ver migración 20261111140000.
    if (stats?.matched > 0) {
      qc.invalidateQueries({ queryKey: ['reconciliation-rules'] });
      qc.invalidateQueries({ queryKey: ['conciliacion'] });
      const s = stats.matched === 1 ? '' : 's';
      toast.success(`${stats.matched} movimiento${s} pendiente${s} clasificado${s} por tus reglas`);
    } else if (stats?.processed > 0 && !opts?.quiet) {
      // quiet: la pasada automática al abrir Conciliación no hace ruido si
      // no había nada que conciliar.
      toast.info(`Procesadas ${stats.processed} transacciones — ninguna matcheó una regla activa`);
    }
    return stats ?? { processed: 0, matched: 0 };
  };

  /**
   * Barrido automático al abrir Conciliación: UNA vez por sesión del
   * navegador y por versión de las reglas, no en cada entrada a la página.
   * Las transacciones nuevas ya pasan por las reglas al insertarse (trigger)
   * y crear/editar una regla barre en el momento; esto es solo la red de
   * seguridad. Si las reglas cambian (firma distinta), vuelve a correr.
   */
  const barrerPendientesUnaVezPorSesion = async (): Promise<void> => {
    if (!user?.id) return;
    const firma = firmaReglasActivas(rules);
    if (firma.startsWith('0:')) return; // ninguna regla activa que aporte algo
    const key = `${BARRIDO_SESION_KEY}:${user.id}`;
    try {
      if (sessionStorage.getItem(key) === firma) return;
      sessionStorage.setItem(key, firma); // antes del await: dos montajes seguidos no barren dos veces
    } catch { /* modo privado: se comporta como antes (una vez por montaje) */ }
    try {
      await applyPendingRulesViaRPC(5000, { quiet: true });
    } catch (e) {
      // Falló: que el próximo ingreso lo reintente.
      try { sessionStorage.removeItem(key); } catch { /* ignore */ }
      throw e;
    }
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
    applyPendingRulesViaRPC,
    barrerPendientesUnaVezPorSesion,
  };
}
