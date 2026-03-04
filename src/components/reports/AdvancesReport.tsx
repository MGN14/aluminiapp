import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Banknote, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;
const availableYears = Array.from({ length: 5 }, (_, i) => currentYear - i);

export default function AdvancesReport() {
  const { user } = useAuth();
  const [year, setYear] = useState(currentYear);

  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const { data, isLoading } = useQuery({
    queryKey: ['advances-report', user?.id, year],
    queryFn: async () => {
      if (!user) return null;

      // Get income transactions without invoice_id
      const { data: transactions, error } = await supabase
        .from('transactions')
        .select('id, date, description, amount, owner, responsible_id, notes, statement_id')
        .eq('user_id', user.id)
        .eq('type', 'ingreso')
        .eq('category', 'venta')
        .is('invoice_id', null)
        .is('deleted_at', null)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false });

      if (error) throw error;

      // Filter: must have owner or responsible
      const filtered = (transactions || []).filter(
        t => t.owner || t.responsible_id
      );

      // Get statement names for bank account display
      const statementIds = [...new Set(filtered.map(t => t.statement_id))];
      let statementsMap = new Map<string, string>();
      if (statementIds.length > 0) {
        const { data: statements } = await supabase
          .from('bank_statements')
          .select('id, display_name, bank_name')
          .in('id', statementIds);
        if (statements) {
          statements.forEach(s => {
            statementsMap.set(s.id, s.display_name || s.bank_name);
          });
        }
      }

      // Get responsible names
      const respIds = [...new Set(filtered.filter(t => t.responsible_id).map(t => t.responsible_id!))];
      let respMap = new Map<string, string>();
      if (respIds.length > 0) {
        const { data: resps } = await supabase
          .from('responsibles')
          .select('id, name')
          .in('id', respIds);
        if (resps) {
          resps.forEach(r => respMap.set(r.id, r.name));
        }
      }

      return { transactions: filtered, statementsMap, respMap };
    },
    enabled: !!user,
  });

  const totalAdvances = useMemo(() => {
    if (!data?.transactions) return 0;
    return data.transactions.reduce((s, t) => s + Math.abs(t.amount ?? 0), 0);
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

        {/* KPI */}
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
            </p>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/80">
                    <TableHead className="font-semibold">Fecha</TableHead>
                    <TableHead className="font-semibold">Cliente</TableHead>
                    <TableHead className="font-semibold min-w-[250px]">Descripción</TableHead>
                    <TableHead className="font-semibold text-right">Monto</TableHead>
                    <TableHead className="font-semibold">Cuenta</TableHead>
                    <TableHead className="font-semibold">Observaciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                        Cargando datos...
                      </TableCell>
                    </TableRow>
                  ) : !data?.transactions.length ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12">
                        <div className="flex flex-col items-center gap-2">
                          <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
                          <p className="text-muted-foreground">Aún no hay suficiente información para mostrar rankings.</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.transactions.map((tx) => {
                      const clientName = tx.owner || (tx.responsible_id ? data.respMap.get(tx.responsible_id) : null) || 'Sin asignar';
                      const accountName = data.statementsMap.get(tx.statement_id) || '-';
                      // Clean notes from system markers
                      const cleanNotes = (tx.notes || '')
                        .replace(/\[.*?\]/g, '')
                        .trim() || '-';

                      return (
                        <TableRow key={tx.id}>
                          <TableCell className="text-sm whitespace-nowrap">
                            {format(new Date(tx.date), 'dd MMM yyyy', { locale: es })}
                          </TableCell>
                          <TableCell className="text-sm font-medium">{clientName}</TableCell>
                          <TableCell className="text-sm truncate max-w-[300px]">{tx.description}</TableCell>
                          <TableCell className="text-right font-bold text-sm text-success">
                            {formatCurrency(Math.abs(tx.amount ?? 0))}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{accountName}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{cleanNotes}</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
