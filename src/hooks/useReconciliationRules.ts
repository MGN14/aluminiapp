import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { normalizeForMatch } from '@/lib/stringUtils';
import { fetchAllPaged } from '@/lib/fetchAllPaged';
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
  // Día del mes leído del texto ISO, igual que EXTRACT(DAY FROM date) en la
  // base. `new Date('2026-10-01').getDate()` parsea en UTC y en Colombia
  // (UTC-5) devuelve 30: el día anterior.
  const day = Number((tx.date ?? '').slice(8, 10));
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

// ── UN SOLO CRITERIO: la app decide igual que la base ──────────────────────
// La referencia es la función SQL apply_reconciliation_rules_to_tx (trigger al
// insertar + barridos). Lo de abajo es su ESPEJO en TypeScript, para que los
// caminos de la app (subir un extracto, "aplicar a existentes") elijan la
// misma regla y escriban lo mismo. Antes diferían en tres cosas (auditoría
// 2026-11-11, pedido de Nico: "que ambos tengan los mismos criterios"):
//   · orden: la base va de la regla más específica a la menos; la app tomaba
//     la más recién creada;
//   · candidatas: la base llena lo que esté vacío (categoría O beneficiario);
//     la app solo tocaba filas con los dos vacíos;
//   · día del mes: la app lo leía con Date y en Colombia le salía el día anterior.
// Si cambiás uno, cambiá el otro: los casos de useReconciliationRules.test.ts
// son el contrato.

/** Lo mínimo de un movimiento para decidir qué regla le aplica. */
export interface TxParaRegla {
  description: string;
  amount: number | null;
  date: string;
  category_id?: string | null;
  responsible_id?: string | null;
  movement_nature?: string | null;
}

/** Espejo EXACTO de reconciliation_rule_specificity (SQL). */
export function reglaEspecificidad(r: ReconciliationRule): number {
  let score = 0;
  if (r.keyword) score += 10;
  if (r.amount_min != null) score += 3;
  if (r.amount_max != null) score += 3;
  if (r.day_min != null) score += 2;
  if (r.day_max != null) score += 2;
  if (r.responsible_id) score += 5;
  if (r.category_id) score += 5;
  return score;
}

/** Mismo ORDER BY que la base: especificidad DESC, creación ASC. */
export function ordenarReglasComoLaBase(rules: ReconciliationRule[]): ReconciliationRule[] {
  return [...rules].sort((a, b) =>
    reglaEspecificidad(b) - reglaEspecificidad(a)
    || (a.created_at ?? '').localeCompare(b.created_at ?? ''));
}

export interface ReglaAplicable {
  rule: ReconciliationRule;
  /** Solo los campos que estaban VACÍOS y la regla llena (nunca pisa). */
  update: { category_id?: string; responsible_id?: string; movement_nature?: MovementNature };
}

/**
 * Qué regla le aplica a un movimiento y qué le escribe — misma decisión que
 * la función SQL, paso a paso:
 *   1. si ya tiene categoría Y beneficiario, no se toca;
 *   2. gana la PRIMERA regla que coincide, en el orden de la base;
 *   3. solo llena campos vacíos;
 *   4. si esa regla no llena nada, no hay match (y no se pasa a la siguiente:
 *      mezclaría la categoría de una regla con el beneficiario de otra).
 */
export function resolverRegla(rules: ReconciliationRule[], tx: TxParaRegla): ReglaAplicable | null {
  if (tx.category_id && tx.responsible_id) return null;
  for (const rule of ordenarReglasComoLaBase(rules)) {
    if (!matchesRule(rule, tx)) continue;
    const update: ReglaAplicable['update'] = {};
    if (!tx.category_id && rule.category_id) update.category_id = rule.category_id;
    if (!tx.responsible_id && rule.responsible_id) update.responsible_id = rule.responsible_id;
    if (!tx.movement_nature && rule.movement_nature) update.movement_nature = rule.movement_nature;
    return Object.keys(update).length ? { rule, update } : null;
  }
  return null;
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

  type TxFila = TxParaRegla & { id: string };
  const CAMPOS_TX = 'id, description, amount, date, category_id, responsible_id, movement_nature';

  /**
   * Aplica el criterio único (resolverRegla) a un lote de movimientos y
   * escribe los cambios: 1 UPDATE por combinación distinta de campos. Devuelve
   * cuántos movimientos cambió. Es el mismo resultado que daría la función
   * SQL sobre esas filas.
   */
  const aplicarCriterioUnico = async (
    txs: TxFila[],
    onProgress?: (current: number, total: number) => void,
  ): Promise<{ applied: number; errors: number }> => {
    const activeRules = rules.filter(r => r.active && (r.category_id || r.responsible_id || r.movement_nature));
    if (!activeRules.length || !txs.length) return { applied: 0, errors: 0 };

    const buckets = new Map<string, { update: ReglaAplicable['update']; ids: string[] }>();
    const ruleHits: Record<string, number> = {};
    txs.forEach((tx, i) => {
      const r = resolverRegla(activeRules, tx);
      if (r) {
        const key = `${r.update.category_id ?? ''}__${r.update.responsible_id ?? ''}__${r.update.movement_nature ?? ''}`;
        const bucket = buckets.get(key) ?? { update: r.update, ids: [] };
        bucket.ids.push(tx.id);
        buckets.set(key, bucket);
        ruleHits[r.rule.id] = (ruleHits[r.rule.id] ?? 0) + 1;
      }
      onProgress?.(i + 1, txs.length);
    });

    let applied = 0;
    let errors = 0;
    for (const { update, ids } of buckets.values()) {
      for (let i = 0; i < ids.length; i += 200) {
        const lote = ids.slice(i, i + 200);
        const { error: updErr } = await supabase
          .from('transactions')
          .update(update as never)
          .in('id', lote);
        if (updErr) errors += lote.length;
        else applied += lote.length;
      }
    }

    // Contadores de las reglas que dispararon.
    const now = new Date().toISOString();
    await Promise.all(
      Object.entries(ruleHits).map(([ruleId, hits]) => {
        const rule = activeRules.find(r => r.id === ruleId);
        if (!rule) return null;
        return (supabase as any)
          .from('reconciliation_rules')
          .update({ match_count: rule.match_count + hits, last_matched_at: now })
          .eq('id', ruleId);
      }),
    );

    if (applied > 0) {
      qc.invalidateQueries({ queryKey: ['reconciliation-rules'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['conciliacion'] });
    }
    return { applied, errors };
  };

  /**
   * Reglas sobre un extracto recién subido. La base YA las aplicó al insertar
   * cada fila (trigger); esta pasada usa el mismo criterio y solo completa lo
   * que haya quedado. Devuelve cuántos movimientos del extracto quedaron
   * clasificados por reglas en total (los del trigger + los de esta pasada),
   * que es lo que el aviso de subida le cuenta al usuario.
   */
  const applyRulesToStatement = async (statementId: string): Promise<number> => {
    if (!statementId) return 0;

    const txs = await fetchAllPaged<TxFila>((a, b) => supabase
      .from('transactions')
      .select(CAMPOS_TX as never)
      .eq('statement_id', statementId)
      .is('deleted_at', null)
      .order('id')
      .range(a, b));
    if (!txs.length) return 0;

    const { applied } = await aplicarCriterioUnico(txs);

    // Lo que el trigger clasificó al insertar queda en el log de matches.
    let porTrigger = 0;
    try {
      const { count } = await (supabase as any)
        .from('transaction_match_log')
        .select('id, transactions!inner(statement_id)', { count: 'exact', head: true })
        .eq('transactions.statement_id', statementId);
      porTrigger = count ?? 0;
    } catch { /* sin acceso al log: se informa solo lo de esta pasada */ }

    return porTrigger + applied;
  };

  /**
   * Respaldo de "aplicar a existentes" cuando el RPC no está disponible:
   * mismas candidatas que la base (categoría O beneficiario vacío) y mismo
   * criterio. El camino normal es applyPendingRulesViaRPC.
   */
  const applyRulesToAllUserTransactions = async (
    onProgress?: (current: number, total: number) => void,
  ): Promise<{ total: number; categorized: number; skipped: number; errors: number }> => {
    if (!user?.id) return { total: 0, categorized: 0, skipped: 0, errors: 0 };

    const txs = await fetchAllPaged<TxFila>((a, b) => supabase
      .from('transactions')
      .select(CAMPOS_TX as never)
      .is('deleted_at', null)
      .or('category_id.is.null,responsible_id.is.null')
      .order('id')
      .range(a, b), { maxRows: 5000 });
    if (!txs.length) return { total: 0, categorized: 0, skipped: 0, errors: 0 };

    const { applied, errors } = await aplicarCriterioUnico(txs, onProgress);
    return { total: txs.length, categorized: applied, skipped: txs.length - applied - errors, errors };
  };

  /**
   * Reglas sobre un conjunto puntual de movimientos (re-proceso manual).
   * Mismo criterio. Devuelve cuántos cambió.
   */
  const applyRulesToTransactions = async (transactionIds: string[]): Promise<number> => {
    if (!transactionIds.length) return 0;

    const txs: TxFila[] = [];
    for (let i = 0; i < transactionIds.length; i += 200) {
      const { data } = await supabase
        .from('transactions')
        .select(CAMPOS_TX as never)
        .in('id', transactionIds.slice(i, i + 200))
        .is('deleted_at', null);
      txs.push(...(((data ?? []) as unknown) as TxFila[]));
    }
    if (!txs.length) return 0;

    const { applied } = await aplicarCriterioUnico(txs);
    if (applied > 0) {
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
