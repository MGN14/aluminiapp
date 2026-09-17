// Monto ESTIMADO de IVA / retefuente / ICA para los eventos del calendario
// (pedido de Nico 2026-09-16). La aritmética vive en lib/taxEstimates (pura,
// testeada); acá solo se traen los datos del año y las tasas configuradas.
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { estimateForEventId, type InvoiceLite, type TaxEstimate } from '@/lib/taxEstimates';

interface Params {
  year: number;
  ivaCuatrimestral: boolean;
  autorretenedor: boolean;
  agenteRetencion: boolean;
}

interface TaxData {
  invoices: InvoiceLite[];
  importIva: Array<{ fecha: string; montoCop: number }>;
  retefuenteManual: Array<{ date: string; amount: number }>;
  icaRate: number;
  autoretefuenteRate: number;
  retefuenteCompraRate: number;
}

export function useTaxEstimates(p: Params) {
  const { user } = useAuth();

  const query = useQuery<TaxData>({
    queryKey: ['tax-estimates', user?.id, p.year],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const from = `${p.year}-01-01`;
      const to = `${p.year}-12-31`;
      const [invRes, settingsRes, manualRes, impRes] = await Promise.all([
        (supabase as any)
          .from('invoices')
          .select('type, issue_date, subtotal_base, iva_amount, reteica_amount, autoretefuente_amount, void_type')
          .eq('status', 'confirmed')
          .gte('issue_date', from)
          .lte('issue_date', to)
          .limit(5000),
        supabase.from('tax_settings').select('reteica_rate, autoretefuente_rate, retefuente_compra_rate').limit(1).maybeSingle(),
        supabase
          .from('transactions')
          .select('date, amount')
          .eq('notes', '[Retefuente - Sin factura]')
          .is('deleted_at', null)
          .gte('date', from)
          .lte('date', to),
        // IVA de importación pagado en aduana: descontable como el de una
        // factura de compra. Fecha = entrada a aduana / entrega (misma regla
        // que InvoiceSummaryCards).
        (supabase as any)
          .from('import_costs')
          .select('monto, moneda, trm, created_at, imports!inner(fecha_arribo_real, import_estado_history(estado, fecha))')
          .eq('tipo', 'iva_importacion'),
      ]);

      const invoices: InvoiceLite[] = ((invRes.data ?? []) as any[])
        .filter((r) => r?.void_type !== 'total' && (r?.type === 'venta' || r?.type === 'compra'))
        .map((r) => ({
          type: r.type,
          issue_date: String(r.issue_date),
          subtotal_base: Number(r.subtotal_base) || 0,
          iva_amount: Number(r.iva_amount) || 0,
          reteica_amount: Number(r.reteica_amount) || 0,
          autoretefuente_amount: Number(r.autoretefuente_amount) || 0,
        }));

      const importIva = ((impRes.data ?? []) as Array<{
        monto: number; moneda: string; trm: number | null; created_at: string;
        imports: { fecha_arribo_real: string | null; import_estado_history?: { estado: string; fecha: string }[] };
      }>).map((r) => {
        const hist = r.imports?.import_estado_history ?? [];
        const fecha = hist.find((h) => h.estado === 'aduana')?.fecha
          ?? hist.find((h) => h.estado === 'entregado')?.fecha
          ?? r.imports?.fecha_arribo_real
          ?? (r.created_at ?? '').slice(0, 10);
        const montoCop = r.moneda === 'COP'
          ? Number(r.monto) || 0
          : (Number(r.trm) > 0 ? (Number(r.monto) || 0) * Number(r.trm) : 0);
        return { fecha, montoCop };
      }).filter((r) => r.fecha && r.montoCop > 0);

      const retefuenteManual = ((manualRes.data ?? []) as Array<{ date: string; amount: number | null }>)
        .map((t) => ({ date: t.date, amount: Number(t.amount) || 0 }));

      const s = (settingsRes.data ?? {}) as { reteica_rate?: number | null; autoretefuente_rate?: number | null; retefuente_compra_rate?: number | null };
      return {
        invoices,
        importIva,
        retefuenteManual,
        icaRate: Number(s.reteica_rate) || 0,
        autoretefuenteRate: Number(s.autoretefuente_rate) || 0,
        retefuenteCompraRate: Number(s.retefuente_compra_rate) || 0,
      };
    },
  });

  const data = query.data;
  const estimate = useCallback((eventId: string): TaxEstimate | null => {
    if (!data) return null;
    return estimateForEventId({
      year: p.year,
      ivaCuatrimestral: p.ivaCuatrimestral,
      invoices: data.invoices,
      importIva: data.importIva,
      retefuenteManual: data.retefuenteManual,
      rates: {
        icaRate: data.icaRate,
        autoretefuenteRate: data.autoretefuenteRate,
        retefuenteCompraRate: data.retefuenteCompraRate,
        autorretenedor: p.autorretenedor,
        agenteRetencion: p.agenteRetencion,
      },
    }, eventId);
  }, [data, p.year, p.ivaCuatrimestral, p.autorretenedor, p.agenteRetencion]);

  return { estimate, isLoading: query.isLoading, ready: !!data };
}
