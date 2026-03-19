import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Banknote, History, Info, Link2, Check } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import AdvancesTable from './AdvancesTable';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

const currentYear = new Date().getFullYear();
const availableYears = Array.from({ length: 5 }, (_, i) => currentYear - i);

export default function AdvancesReport() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [year, setYear] = useState(currentYear);
  const [reconcilingDetail, setReconcilingDetail] = useState<string | null>(null);

  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const { data, isLoading } = useQuery({
    queryKey: ['advances-report', user?.id, year],
    queryFn: async () => {
      if (!user) return null;

      // Fetch transactions + initial state details in parallel
      const [txResult, initialDetailsResult, initialStateResult] = await Promise.all([
        supabase
          .from('transactions')
          .select('id, date, description, amount, owner, responsible_id, notes, statement_id, category, category_id, invoice_id, categories!transactions_category_id_fkey(name)')
          .eq('user_id', user.id)
          .eq('type', 'ingreso')
          .is('deleted_at', null)
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date', { ascending: false }),
        supabase
          .from('initial_state_details' as any)
          .select('*')
          .eq('user_id', user.id)
          .eq('field_type', 'anticipos_de_clientes'),
        supabase
          .from('initial_financial_state' as any)
          .select('anticipos_de_clientes, fecha_inicio')
          .eq('user_id', user.id)
          .maybeSingle(),
      ]);

      if (txResult.error) throw txResult.error;
      const transactions = txResult.data || [];
      const initialDetails = (initialDetailsResult.data as any[]) || [];
      const initialState = initialStateResult.data as any;

      // Get responsible names
      const allRespIds = [...new Set(transactions.filter(t => t.responsible_id).map(t => t.responsible_id!))];
      let respMap = new Map<string, string>();
      if (allRespIds.length > 0) {
        const { data: resps } = await supabase
          .from('responsibles')
          .select('id, name')
          .in('id', allRespIds);
        if (resps) resps.forEach(r => respMap.set(r.id, r.name));
      }

      // Filter: Ingreso + Category "Ventas" + Responsible != "Otros" + no invoice
      const filtered = transactions.filter((t: any) => {
        const catName = (t.categories?.name || t.category || '').trim().toLowerCase();
        const hasResponsible = Boolean(t.responsible_id);
        const isVentas = catName === 'ventas';
        const respName = t.responsible_id ? respMap.get(t.responsible_id) : null;
        const isRespOtros = respName?.toLowerCase() === 'otros';
        const hasNoInvoice = !t.invoice_id;
        return hasResponsible && isVentas && !isRespOtros && hasNoInvoice;
      });

      // Get statement names
      const statementIds = [...new Set(filtered.map(t => t.statement_id))];
      let statementsMap = new Map<string, string>();
      if (statementIds.length > 0) {
        const { data: statements } = await supabase
          .from('bank_statements')
          .select('id, display_name, bank_name')
          .in('id', statementIds);
        if (statements) statements.forEach(s => statementsMap.set(s.id, s.display_name || s.bank_name));
      }

      // Get user invoices for reconciliation
      const { data: invoices } = await supabase
        .from('invoices')
        .select('id, invoice_number, counterparty_name, total_amount, issue_date')
        .eq('user_id', user.id)
        .eq('type', 'venta')
        .order('issue_date', { ascending: false })
        .limit(200);

      return {
        transactions: filtered,
        statementsMap,
        respMap,
        invoices: invoices || [],
        initialDetails,
        initialAnticipo: initialState?.anticipos_de_clientes ?? 0,
        fechaInicio: initialState?.fecha_inicio,
      };
    },
    enabled: !!user,
  });

  const handleReconcileDetail = async (detailId: string, invoiceId: string) => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('initial_state_details' as any)
        .update({ invoice_id: invoiceId } as any)
        .eq('id', detailId)
        .eq('user_id', user.id);
      if (error) throw error;
      toast.success('Anticipo de periodo anterior vinculado a factura');
      queryClient.invalidateQueries({ queryKey: ['advances-report'] });
      setReconcilingDetail(null);
    } catch {
      toast.error('Error al vincular');
    }
  };

  // Only count unreconciled initial details
  const unreconciledDetails = useMemo(() => {
    return (data?.initialDetails || []).filter((d: any) => !d.invoice_id);
  }, [data]);

  const totalAdvancesTx = useMemo(() => {
    if (!data?.transactions) return 0;
    return data.transactions.reduce((s, t) => s + Math.abs(t.amount ?? 0), 0);
  }, [data]);

  const initialAnticipo = useMemo(() => {
    return unreconciledDetails.reduce((s: number, d: any) => s + (d.amount ?? 0), 0);
  }, [unreconciledDetails]);
  const totalAdvances = totalAdvancesTx + initialAnticipo;

  // Group by client (transactions + initial state details)
  const byClient = useMemo(() => {
    const map = new Map<string, number>();

    // From transactions
    if (data?.transactions) {
      for (const tx of data.transactions) {
        const clientName = tx.owner || (tx.responsible_id ? data.respMap.get(tx.responsible_id) : null) || 'Sin asignar';
        map.set(clientName, (map.get(clientName) ?? 0) + Math.abs(tx.amount ?? 0));
      }
    }

    // From initial state details
    if (data?.initialDetails) {
      for (const d of data.initialDetails) {
        const name = (d as any).responsible_name || 'Periodo anterior';
        map.set(name, (map.get(name) ?? 0) + ((d as any).amount ?? 0));
      }
    }

    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Header */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">Reporte de Anticipos</CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Ingresos bancarios sin factura asociada. Incluye saldos iniciales configurados en ajustes.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableYears.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
        </Card>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Total */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Anticipos</CardTitle>
              <div className="p-2 rounded-lg bg-warning/10">
                <Banknote className="h-4 w-4 text-warning" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-warning">{formatCurrency(totalAdvances)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {data?.transactions.length ?? 0} transacción{(data?.transactions.length ?? 0) !== 1 ? 'es' : ''} • {year}
                {initialAnticipo > 0 && ` + saldo inicial`}
              </p>
            </CardContent>
          </Card>

          {/* Previous period (initial state) */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Anticipos Periodo Anterior</CardTitle>
              <div className="p-2 rounded-lg bg-muted">
                <History className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-foreground">{formatCurrency(initialAnticipo)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {data?.fechaInicio
                  ? <><span className="font-bold">Corte: {data.fechaInicio}</span></>
                  : 'Sin estado inicial configurado'}
              </p>
              {data?.initialDetails && data.initialDetails.length > 0 && (
                <div className="mt-2 space-y-1 border-t pt-2">
                  {data.initialDetails.map((d: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="truncate mr-2 text-muted-foreground">{d.responsible_name || 'Sin nombre'}</span>
                      <span className="font-semibold whitespace-nowrap">{formatCurrency(d.amount ?? 0)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* By client summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Anticipos por Cliente</CardTitle>
            </CardHeader>
            <CardContent>
              {byClient.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin datos</p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {byClient.slice(0, 10).map(([name, amount]) => (
                    <div key={name} className="flex items-center justify-between text-sm">
                      <span className="truncate mr-2">{name}</span>
                      <span className="font-semibold text-warning whitespace-nowrap">{formatCurrency(amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <AdvancesTable
          transactions={data?.transactions ?? []}
          statementsMap={data?.statementsMap ?? new Map()}
          respMap={data?.respMap ?? new Map()}
          invoices={data?.invoices ?? []}
          isLoading={isLoading}
          showReconcile={true}
        />
      </div>
    </TooltipProvider>
  );
}
