// Ciclo comercial — estado derivado de cada cotización aceptada.
//
// La cadena es cotización → remisión (quotation_id) → factura
// (remision_invoices) → cobro (invoices.balance_pending). El estado NUNCA se
// digita: se DERIVA de los documentos reales (mismo principio que Terceros).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface QuoteCycleInvoice {
  id: string;
  invoice_number: string;
  total_amount: number;
  balance_pending: number;
}

export interface QuoteCycleRemision {
  id: string;
  number: string;
  date: string;
  status: string;
  total_cost: number;
  invoices: QuoteCycleInvoice[];
}

export type CycleStage = 'aceptada' | 'despachada' | 'facturada' | 'cobrada';

export const CYCLE_STAGE_LABEL: Record<CycleStage, string> = {
  aceptada: 'Aceptada',
  despachada: 'Despachada',
  facturada: 'Facturada',
  cobrada: 'Cobrada',
};

/** Deriva la etapa del ciclo desde las remisiones vinculadas a la cotización. */
export function deriveCycleStage(remisiones: QuoteCycleRemision[]): CycleStage {
  if (remisiones.length === 0) return 'aceptada';
  const invoices = remisiones.flatMap((r) => r.invoices);
  if (invoices.length === 0) return 'despachada';
  const allPaid = invoices.every((i) => Number(i.balance_pending) <= 0.5);
  return allPaid ? 'cobrada' : 'facturada';
}

/** Fila serializable de la query (react-query persiste JSON — nada de Map acá). */
export interface QuoteCycleRow extends QuoteCycleRemision {
  quotation_id: string;
}

/** Índice por cotización — se arma AL USAR, nunca viaja en la query. */
export function quoteCycleIndex(rows: QuoteCycleRow[] | null | undefined): Map<string, QuoteCycleRemision[]> {
  const map = new Map<string, QuoteCycleRemision[]>();
  for (const r of Array.isArray(rows) ? rows : []) {
    const arr = map.get(r.quotation_id) ?? [];
    arr.push(r);
    map.set(r.quotation_id, arr);
  }
  return map;
}

/**
 * Todas las remisiones nacidas de una cotización, con sus facturas.
 * Una sola query para lista y detalle (las remisiones con quotation_id son
 * pocas); consumidores indexan con quoteCycleIndex().
 */
export function useQuoteCycles() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['quote-cycle', user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<QuoteCycleRow[]> => {
      const { data, error } = await (supabase as any)
        .from('remisiones')
        .select('id, number, date, status, quotation_id, remision_items(total_cost), remision_invoices(invoice:invoice_id(id, invoice_number, total_amount, balance_pending))')
        .not('quotation_id', 'is', null)
        .order('date', { ascending: false });
      if (error) throw error;

      return ((data ?? []) as any[]).map((r) => ({
        quotation_id: r.quotation_id,
        id: r.id,
        number: r.number ?? '',
        date: r.date,
        status: r.status ?? '',
        total_cost: ((r.remision_items ?? []) as any[]).reduce((s, it) => s + (Number(it.total_cost) || 0), 0),
        invoices: ((r.remision_invoices ?? []) as any[])
          .map((ri) => ri.invoice)
          .filter(Boolean)
          .map((inv: any) => ({
            id: inv.id,
            invoice_number: inv.invoice_number ?? '',
            total_amount: Number(inv.total_amount) || 0,
            balance_pending: Number(inv.balance_pending) || 0,
          })),
      }));
    },
  });
}
