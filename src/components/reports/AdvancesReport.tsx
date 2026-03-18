import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Banknote, AlertCircle, History, Info } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
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
  const [year, setYear] = useState(currentYear);
  const [tab, setTab] = useState<'current' | 'previous'>('current');

  const displayYear = tab === 'current' ? year : year - 1;
  const startDate = `${displayYear}-01-01`;
  const endDate = `${displayYear}-12-31`;

  const { data, isLoading } = useQuery({
    queryKey: ['advances-report', user?.id, displayYear],
    queryFn: async () => {
      if (!user) return null;

      const { data: transactions, error } = await supabase
        .from('transactions')
        .select('id, date, description, amount, owner, responsible_id, notes, statement_id, category, category_id, invoice_id, categories!transactions_category_id_fkey(name)')
        .eq('user_id', user.id)
        .eq('type', 'ingreso')
        .is('deleted_at', null)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false });

      if (error) throw error;

      // Get responsible names
      const allRespIds = [...new Set((transactions || []).filter(t => t.responsible_id).map(t => t.responsible_id!))];
      let respMap = new Map<string, string>();
      if (allRespIds.length > 0) {
        const { data: resps } = await supabase
          .from('responsibles')
          .select('id, name')
          .in('id', allRespIds);
        if (resps) resps.forEach(r => respMap.set(r.id, r.name));
      }

      // Filter: Ingreso + Category "Ventas" + Responsible != "Otros" + no invoice
      const filtered = (transactions || []).filter((t: any) => {
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

      // Get user invoices for reconciliation (sales invoices)
      const { data: invoices } = await supabase
        .from('invoices')
        .select('id, invoice_number, counterparty_name, total_amount, issue_date')
        .eq('user_id', user.id)
        .eq('type', 'venta')
        .order('issue_date', { ascending: false })
        .limit(200);

      return { transactions: filtered, statementsMap, respMap, invoices: invoices || [] };
    },
    enabled: !!user,
  });

  const totalAdvances = useMemo(() => {
    if (!data?.transactions) return 0;
    return data.transactions.reduce((s, t) => s + Math.abs(t.amount ?? 0), 0);
  }, [data]);

  // Group by client
  const byClient = useMemo(() => {
    if (!data?.transactions) return [];
    const map = new Map<string, number>();
    for (const tx of data.transactions) {
      const clientName = tx.owner || (tx.responsible_id ? data.respMap.get(tx.responsible_id) : null) || 'Sin asignar';
      map.set(clientName, (map.get(clientName) ?? 0) + Math.abs(tx.amount ?? 0));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Filters */}
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
                    <p>Ingresos bancarios sin factura asociada. Dinero que ya entró pero aún no se ha facturado.</p>
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

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'current' | 'previous')}>
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="current" className="flex-1 sm:flex-initial gap-1.5">
              <Banknote className="h-4 w-4" />
              Anticipos {year}
            </TabsTrigger>
            <TabsTrigger value="previous" className="flex-1 sm:flex-initial gap-1.5">
              <History className="h-4 w-4" />
              Periodo anterior
            </TabsTrigger>
          </TabsList>

          {tab === 'previous' && (
            <p className="text-sm font-bold text-muted-foreground mt-2">{year - 1}</p>
          )}

          <TabsContent value="current" className="space-y-4 mt-4">
            {/* KPI */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    {data?.transactions.length ?? 0} transacción{(data?.transactions.length ?? 0) !== 1 ? 'es' : ''} • {displayYear}
                  </p>
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
                    <div className="space-y-1.5 max-h-32 overflow-y-auto">
                      {byClient.slice(0, 8).map(([name, amount]) => (
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

            <AdvancesTable
              transactions={data?.transactions ?? []}
              statementsMap={data?.statementsMap ?? new Map()}
              respMap={data?.respMap ?? new Map()}
              invoices={data?.invoices ?? []}
              isLoading={isLoading}
              showReconcile={false}
            />
          </TabsContent>

          <TabsContent value="previous" className="space-y-4 mt-4">
            {/* KPI */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Anticipos {year - 1}</CardTitle>
                <div className="p-2 rounded-lg bg-warning/10">
                  <History className="h-4 w-4 text-warning" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-warning">{formatCurrency(totalAdvances)}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {data?.transactions.length ?? 0} transacción{(data?.transactions.length ?? 0) !== 1 ? 'es' : ''} • {displayYear}
                </p>
              </CardContent>
            </Card>

            <AdvancesTable
              transactions={data?.transactions ?? []}
              statementsMap={data?.statementsMap ?? new Map()}
              respMap={data?.respMap ?? new Map()}
              invoices={data?.invoices ?? []}
              isLoading={isLoading}
              showReconcile={true}
            />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
