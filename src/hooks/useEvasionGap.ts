import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { calculateEvasionGap, type EvasionGapResult } from '@/lib/evasionGap';
import { getYearRange } from '@/lib/dateUtils';

interface UseEvasionGapOptions {
  /** Año del periodo. Default: año actual */
  year?: number;
  /** Si es false, no consulta Supabase (ej. cuando no estás en modo gerencial).
   *  Default: true. */
  enabled?: boolean;
}

interface UseEvasionGapReturn {
  /** Resultado de calculateEvasionGap o null mientras carga */
  result: EvasionGapResult | null;
  /** Cantidad de meses del periodo consultado (para proyecciones) */
  periodMonths: number;
  loading: boolean;
}

/**
 * Hook compartido para Dashboard, Visita DIAN y futuro contexto de Nico
 * Gerencial. Obtiene los 4 inputs de calculateEvasionGap desde Supabase:
 *
 *   1. bankIncome              = SUM(transactions.amount > 0) del año.
 *   2. previousPeriodAdvances  = initial_financial_state.anticipos_de_clientes
 *                                (columna agregada que SIEMPRE se escribe en
 *                                Ajustes al guardar). Fallback: sumar
 *                                initial_state_details por si el agregado falló.
 *   3. cashIncome              = SUM(cash_movements.amount WHERE type='ingreso').
 *   4. invoicedAmount          = SUM(invoices.total_amount WHERE type='venta').
 *
 * Tira errores silenciosos a consola y deja el input en 0; la idea es que el
 * usuario vea el card aunque una fuente falle.
 */
export function useEvasionGap({
  year = new Date().getFullYear(),
  enabled = true,
}: UseEvasionGapOptions = {}): UseEvasionGapReturn {
  const [result, setResult] = useState<EvasionGapResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) {
      setResult(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const { start: yearStart, end: yearEnd } = getYearRange(year);

    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();

        const [txRes, cashRes, invRes, advRes, stateRes] = await Promise.all([
          supabase
            .from('transactions')
            .select('amount, date')
            .is('deleted_at', null)
            .gte('date', yearStart)
            .lte('date', yearEnd),
          supabase
            .from('cash_movements')
            .select('amount, type, date')
            .gte('date', yearStart)
            .lte('date', yearEnd),
          supabase
            .from('invoices')
            .select('total_amount, issue_date')
            .eq('status', 'confirmed')
            .eq('type', 'venta')
            .gte('issue_date', yearStart)
            .lte('issue_date', yearEnd),
          user
            ? supabase
                .from('initial_state_details' as never)
                .select('amount, invoice_id')
                .eq('field_type', 'anticipos_de_clientes')
            : Promise.resolve({ data: [], error: null }),
          user
            ? supabase
                .from('initial_financial_state' as never)
                .select('anticipos_de_clientes')
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);

        if (cancelled) return;

        if (txRes.error) throw txRes.error;
        if (cashRes.error) throw cashRes.error;
        if (invRes.error) throw invRes.error;
        if (advRes.error) throw advRes.error;
        if (stateRes.error) throw stateRes.error;

        const txRows = (txRes.data || []) as Array<{ amount: number | null; date: string }>;
        const cashRows = (cashRes.data || []) as Array<{ amount: number | null; type: string; date: string }>;
        const invRows = (invRes.data || []) as Array<{ total_amount: number | null; issue_date: string }>;
        const advRows = (advRes.data || []) as Array<{ amount: number | null; invoice_id: string | null }>;
        const stateRow = (stateRes.data || null) as { anticipos_de_clientes: number | null } | null;

        const bankIncome = txRows
          .filter(t => (t.amount ?? 0) > 0)
          .reduce((s, t) => s + (t.amount ?? 0), 0);

        const cashIncome = cashRows
          .filter(c => c.type === 'ingreso')
          .reduce((s, c) => s + (Number(c.amount) || 0), 0);

        const invoicedAmount = invRows.reduce(
          (s, i) => s + (Number(i.total_amount) || 0),
          0,
        );

        // Fuente canónica: columna agregada escrita en Ajustes al guardar.
        // Fallback: sumar detalles sin invoice_id (compat con datos viejos).
        const aggregatedAdvances = Number(stateRow?.anticipos_de_clientes) || 0;
        const detailAdvances = advRows
          .filter(a => !a.invoice_id)
          .reduce((s, a) => s + (Number(a.amount) || 0), 0);
        const previousPeriodAdvances = aggregatedAdvances > 0
          ? aggregatedAdvances
          : detailAdvances;

        setResult(
          calculateEvasionGap({
            bankIncome,
            previousPeriodAdvances,
            cashIncome,
            invoicedAmount,
          }),
        );
      } catch (e) {
        console.error('useEvasionGap:', e);
        if (!cancelled) setResult(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [year, enabled]);

  // Si hoy es antes de diciembre, los 12 meses del año no están completos.
  // Para proyecciones usamos los meses transcurridos del año (min 1).
  const now = new Date();
  const periodMonths =
    now.getFullYear() === year ? Math.max(1, now.getMonth() + 1) : 12;

  return { result, periodMonths, loading };
}
