// Hook: sugerencias de matching banco→factura (pending).
// + acciones: confirmar / rechazar / disparar batch retroactivo.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { extraerAliasAprendible } from '@/lib/matchLearning';

export interface BankMatchSuggestion {
  id: string;
  user_id: string;
  transaction_id: string;
  invoice_id: string;
  confidence: number;
  signals: {
    amount_match?: 'exact' | 'exact_total' | 'near' | 'near_total' | 'none';
    ref_in_desc?: boolean;
    client_match?: 'name' | 'nit' | 'none';
    days_from_issue?: number;
    expected_payment_match?: boolean;
    invoice_number?: string | null;
    counterparty_name?: string | null;
    balance_pending?: number | null;
    total_amount?: number | null;
  };
  status: 'pending' | 'confirmed' | 'rejected' | 'auto_applied' | 'expired';
  suggested_at: string;
  // Enriched (joined)
  tx_date?: string;
  tx_description?: string;
  tx_amount?: number;
}

export function useBankInvoiceMatches() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const pendingQuery = useQuery<BankMatchSuggestion[]>({
    queryKey: ['bank-match-suggestions', user?.id, 'pending'],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await (supabase as any)
        .from('invoice_match_suggestions')
        .select(`
          id, user_id, transaction_id, invoice_id, confidence, signals, status, suggested_at,
          transactions(date, description, amount),
          invoices(invoice_number, counterparty_name, total_amount, balance_pending)
        `)
        .eq('status', 'pending')
        .order('confidence', { ascending: false })
        .order('suggested_at', { ascending: false })
        .limit(100);
      if (error) {
        console.warn('bank match suggestions query failed:', error.message);
        return [];
      }
      return ((data ?? []) as any[]).map((r: any) => ({
        ...r,
        tx_date: r.transactions?.date,
        tx_description: r.transactions?.description,
        tx_amount: r.transactions?.amount,
        // override signals con datos frescos del invoice (por si cambió balance)
        signals: {
          ...r.signals,
          invoice_number: r.invoices?.invoice_number ?? r.signals?.invoice_number,
          counterparty_name: r.invoices?.counterparty_name ?? r.signals?.counterparty_name,
          balance_pending: r.invoices?.balance_pending ?? r.signals?.balance_pending,
          total_amount: r.invoices?.total_amount ?? r.signals?.total_amount,
        },
      })) as BankMatchSuggestion[];
    },
  });

  const confirm = useMutation({
    mutationFn: async (suggestion: BankMatchSuggestion) => {
      // 0. El pago es de esta factura ⇒ beneficiario = su cliente, categoría
      //    = Ventas. Solo si la fila los tenía vacíos (lo manual manda) —
      //    así el ingreso queda CONCILIADO, no solo vinculado (Nico 2026-08-07).
      const [{ data: inv }, { data: cats }, { data: tx }] = await Promise.all([
        supabase.from('invoices').select('responsible_id').eq('id', suggestion.invoice_id).limit(1),
        supabase.from('categories').select('id, name, active').eq('active', true),
        supabase.from('transactions').select('responsible_id, category_id').eq('id', suggestion.transaction_id).limit(1),
      ]);
      const ventasCat = (cats ?? []).find((c) => c.name.toLowerCase().includes('venta'))?.id ?? null;
      const actual = (tx ?? [])[0];

      // 1. Linkear la TX a la invoice (+ conciliar si faltaba)
      const { error: linkErr } = await supabase
        .from('transactions')
        .update({
          invoice_id: suggestion.invoice_id,
          ...(actual && !actual.responsible_id && (inv ?? [])[0]?.responsible_id
            ? { responsible_id: (inv ?? [])[0].responsible_id }
            : {}),
          ...(actual && !actual.category_id && ventasCat ? { category_id: ventasCat } : {}),
        })
        .eq('id', suggestion.transaction_id);
      if (linkErr) throw linkErr;

      // 2. Marcar sugerencia como confirmada
      const { error: updErr } = await (supabase as any)
        .from('invoice_match_suggestions')
        .update({
          status: 'confirmed',
          resolved_at: new Date().toISOString(),
          resolved_by_user_id: user?.id,
        })
        .eq('id', suggestion.id);
      if (updErr) throw updErr;

      // 3. Marcar las OTRAS sugerencias para la misma TX como rechazadas
      // (solo una factura por TX)
      await (supabase as any)
        .from('invoice_match_suggestions')
        .update({
          status: 'rejected',
          resolved_at: new Date().toISOString(),
          resolved_by_user_id: user?.id,
        })
        .eq('transaction_id', suggestion.transaction_id)
        .eq('status', 'pending')
        .neq('id', suggestion.id);

      // 4. FASE 3 — aprender: si la descripción trae un fragmento
      //    identificable que la app aún no conoce, se guarda como alias del
      //    cliente ('auto-detected'). El scorer SQL lo reconoce la próxima
      //    vez (+25). Best-effort: un fallo acá no rompe la confirmación.
      let aprendido: { alias: string; cliente: string } | null = null;
      try {
        const respId = (inv ?? [])[0]?.responsible_id as string | null | undefined;
        const desc = suggestion.tx_description ?? '';
        if (respId && desc && user) {
          const [{ data: resp }, { data: aliasRows }] = await Promise.all([
            supabase.from('responsibles').select('name').eq('id', respId).limit(1),
            (supabase as any).from('responsible_aliases').select('alias').eq('responsible_id', respId),
          ]);
          const nombre = (resp ?? [])[0]?.name ?? suggestion.signals.counterparty_name ?? '';
          const existentes = ((aliasRows ?? []) as { alias: string }[]).map((a) => a.alias);
          const alias = extraerAliasAprendible(desc, nombre, existentes);
          if (alias) {
            const { error: aliasErr } = await (supabase as any)
              .from('responsible_aliases')
              .insert({ user_id: user.id, responsible_id: respId, alias, source: 'auto-detected' });
            if (!aliasErr) aprendido = { alias, cliente: nombre };
          }
        }
      } catch { /* aprender es un plus, nunca un bloqueo */ }
      return aprendido;
    },
    onSuccess: (aprendido) => {
      qc.invalidateQueries({ queryKey: ['bank-match-suggestions'] });
      qc.invalidateQueries({ queryKey: ['accounts-receivable-by-client'] });
      qc.invalidateQueries({ queryKey: ['collection-data'] });
      qc.invalidateQueries({ queryKey: ['conciliacion'] });
      toast.success('Pago vinculado a la factura y conciliado');
      if (aprendido) {
        toast.info(
          `🧠 Aprendí: «${aprendido.alias}» = ${aprendido.cliente}. Los próximos pagos con esa descripción suben de confianza.`,
          { duration: 8000 },
        );
      }
    },
    onError: (err: Error) => {
      toast.error('Error: ' + err.message);
    },
  });

  const reject = useMutation({
    mutationFn: async (suggestionId: string) => {
      const { error } = await (supabase as any)
        .from('invoice_match_suggestions')
        .update({
          status: 'rejected',
          resolved_at: new Date().toISOString(),
          resolved_by_user_id: user?.id,
        })
        .eq('id', suggestionId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank-match-suggestions'] });
      toast.info('Sugerencia descartada');
    },
  });

  const runBatch = useMutation<
    { processed: number; auto_applied: number; suggested: number; skipped: number },
    Error,
    number | undefined
  >({
    mutationFn: async (limit) => {
      const { data, error } = await (supabase as any).rpc('run_bank_matching_for_user', {
        p_user_id: user?.id ?? null,
        p_limit: limit ?? 1000,
      });
      if (error) throw error;
      return data as { processed: number; auto_applied: number; suggested: number; skipped: number };
    },
    onSuccess: (stats) => {
      qc.invalidateQueries({ queryKey: ['bank-match-suggestions'] });
      qc.invalidateQueries({ queryKey: ['accounts-receivable-by-client'] });
      qc.invalidateQueries({ queryKey: ['collection-data'] });
      toast.success(
        `Procesadas ${stats.processed} · ${stats.auto_applied} auto-vinculadas · ${stats.suggested} sugerencias`,
      );
    },
    onError: (err: Error) => {
      toast.error('Error: ' + err.message);
    },
  });

  return {
    pending: pendingQuery.data ?? [],
    isLoading: pendingQuery.isLoading,
    confirm,
    reject,
    runBatch,
  };
}
