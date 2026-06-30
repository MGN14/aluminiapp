import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

export type ImportPaymentTipo = 'anticipo' | 'parcial' | 'saldo_final' | 'otro';

export interface ImportPaymentRow {
  id: string;
  user_id: string;
  import_id: string;
  fecha: string; // YYYY-MM-DD
  amount_usd: number;
  trm: number;
  amount_cop: number; // generated
  tipo: ImportPaymentTipo;
  notes: string | null;
  /** Si está vinculado a una transaction bancaria real (transferencia al exterior). */
  transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Transaction bancaria candidata para vincular a un abono de importación. */
export interface UnlinkedBankTransaction {
  id: string;
  date: string;
  description: string;
  amount: number; // negativo si es egreso
  // null si no tiene categoría aún
  category_name: string | null;
}

export interface ImportLiquidation {
  import_id: string;
  proveedor_nombre: string;
  monto_total_usd: number | null;
  total_pagado_usd: number;
  total_pagado_cop: number;
  saldo_pendiente_usd: number;
  trm_promedio_ponderada: number | null;
  abonos_count: number;
  liquidada: boolean;
}

/**
 * Fetch TRM oficial del día (más reciente <= fecha dada).
 * Devuelve null si no hay TRM cargada para esa fecha.
 */
export async function fetchTrmForDate(fecha: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('macro_indicators')
    .select('value, period_date')
    .eq('indicator_type', 'trm')
    .lte('period_date', fecha)
    .order('period_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data?.value ?? null;
}

export function useImportPayments(importId: string | null | undefined) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const enabled = !!user && !!importId;

  const paymentsQuery = useQuery<ImportPaymentRow[]>({
    queryKey: ['import_payments', importId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('import_payments' as never)
        .select('*')
        .eq('import_id', importId!)
        .order('fecha', { ascending: false });
      if (error) throw error;
      return ((data as unknown) as ImportPaymentRow[]) ?? [];
    },
  });

  const liquidationQuery = useQuery<ImportLiquidation | null>({
    queryKey: ['import_liquidation', importId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('imports_liquidation' as never)
        .select('*')
        .eq('import_id', importId!)
        .maybeSingle();
      if (error) throw error;
      return ((data as unknown) as ImportLiquidation) ?? null;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['import_payments', importId] });
    queryClient.invalidateQueries({ queryKey: ['import_liquidation', importId] });
    queryClient.invalidateQueries({ queryKey: ['imports', user?.id] });
  };

  const create = useMutation({
    mutationFn: async (input: {
      fecha: string;
      amount_usd: number;
      trm: number;
      tipo?: ImportPaymentTipo;
      notes?: string | null;
      transaction_id?: string | null;
    }) => {
      if (!user || !importId) throw new Error('No auth o import');
      const { error } = await supabase.from('import_payments' as never).insert({
        user_id: user.id,
        import_id: importId,
        fecha: input.fecha,
        amount_usd: input.amount_usd,
        trm: input.trm,
        tipo: input.tipo ?? 'parcial',
        notes: input.notes ?? null,
        transaction_id: input.transaction_id ?? null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Abono registrado' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error al registrar abono', description: err.message, variant: 'destructive' });
    },
  });

  const update = useMutation({
    mutationFn: async (input: {
      id: string;
      fecha?: string;
      amount_usd?: number;
      trm?: number;
      tipo?: ImportPaymentTipo;
      notes?: string | null;
      transaction_id?: string | null;
    }) => {
      const { id, ...patch } = input;
      const { error } = await supabase
        .from('import_payments' as never)
        .update(patch as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Abono actualizado' });
    },
    onError: (err: Error) => {
      toast({ title: 'Error al actualizar', description: err.message, variant: 'destructive' });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('import_payments' as never).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Abono eliminado' });
    },
  });

  // Transactions bancarias disponibles para vincular a un nuevo abono.
  // Filtramos: type='egreso' (transferencias al exterior), NO eliminadas,
  // categoría "Proveedores" (un abono de importación es un pago a proveedor;
  // mostrar todos los egresos ensuciaba el dropdown), y que NO estén ya
  // vinculadas a otro import_payment.
  const availableTransactionsQuery = useQuery<UnlinkedBankTransaction[]>({
    queryKey: ['import-payments-available-tx', user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [];

      // 1. Transactions egreso del último año
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      const { data: txs, error: txErr } = await supabase
        .from('transactions')
        .select('id, date, description, amount, categories:category_id(name)')
        .eq('type', 'egreso')
        .is('deleted_at', null)
        .gte('date', oneYearAgo.toISOString().slice(0, 10))
        .order('date', { ascending: false })
        .limit(500);
      if (txErr || !txs) return [];

      // 2. IDs ya vinculadas a import_payments
      const { data: linked } = await supabase
        .from('import_payments' as never)
        .select('transaction_id')
        .not('transaction_id', 'is', null);
      const linkedIds = new Set(((linked as unknown) as { transaction_id: string }[])?.map(r => r.transaction_id) ?? []);

      return (txs as any[])
        .filter(t => !linkedIds.has(t.id))
        // Solo egresos categorizados como "Proveedores" en Conciliación Bancaria.
        .filter(t => (t.categories?.name ?? '').toLowerCase().includes('proveedor'))
        .map(t => ({
          id: t.id,
          date: t.date,
          description: t.description ?? '',
          amount: Number(t.amount) || 0,
          category_name: t.categories?.name ?? null,
        }));
    },
  });

  return {
    payments: paymentsQuery.data ?? [],
    isLoading: paymentsQuery.isLoading,
    liquidation: liquidationQuery.data ?? null,
    availableTransactions: availableTransactionsQuery.data ?? [],
    create,
    update,
    remove,
  };
}
