import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MONTH_NAMES } from '@/types/transaction';
import { cn } from '@/lib/utils';

interface MonthlyData {
  month: number;
  ingresos: number;
  costos: number;
  gastos_operativos: number;
  impuestos: number;
}

function formatCurrency(value: number): string {
  if (value === 0) return '-';
  return new Intl.NumberFormat('es-CO', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function formatVariation(current: number, previous: number): string {
  if (previous === 0 && current === 0) return '-';
  if (previous === 0) return '+∞';
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function useYearData(userId: string | undefined, year: number) {
  return useQuery({
    queryKey: ['pyg-report', userId, year],
    queryFn: async () => {
      if (!userId) return [];

      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;

      const { data, error } = await supabase
        .from('transactions')
        .select('date, amount, type, operational_type')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .gte('date', startDate)
        .lte('date', endDate);

      if (error) throw error;

      const monthly: MonthlyData[] = Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        ingresos: 0,
        costos: 0,
        gastos_operativos: 0,
        impuestos: 0,
      }));

      for (const tx of data || []) {
        const m = new Date(tx.date).getMonth(); // 0-indexed
        const absAmount = Math.abs(tx.amount ?? 0);

        if (tx.type === 'ingreso') {
          monthly[m].ingresos += absAmount;
        } else if (tx.type === 'egreso' || tx.type === 'transferencia') {
          const opType = tx.operational_type;
          if (opType === 'costo' || opType === 'costo_operacional') {
            monthly[m].costos += absAmount;
          } else if (opType === 'gasto_operativo') {
            monthly[m].gastos_operativos += absAmount;
          } else if (opType === 'impuesto') {
            monthly[m].impuestos += absAmount;
          }
        }
      }

      return monthly;
    },
    enabled: !!userId,
  });
}

const currentYear = new Date().getFullYear();
const availableYears = Array.from({ length: 5 }, (_, i) => currentYear - i);

export default function PYGReport() {
  const { user } = useAuth();
  const [year, setYear] = useState(currentYear);
  const [compare, setCompare] = useState(false);

  const { data: currentData, isLoading: loadingCurrent } = useYearData(user?.id, year);
  const { data: previousData, isLoading: loadingPrevious } = useYearData(
    compare ? user?.id : undefined,
    year - 1
  );

  const rows = useMemo(() => {
    const cur = currentData || Array.from({ length: 12 }, (_, i) => ({
      month: i + 1, ingresos: 0, costos: 0, gastos_operativos: 0, impuestos: 0,
    }));
    const prev = previousData || Array.from({ length: 12 }, (_, i) => ({
      month: i + 1, ingresos: 0, costos: 0, gastos_operativos: 0, impuestos: 0,
    }));

    const compute = (data: MonthlyData[], field: keyof Omit<MonthlyData, 'month'>) =>
      data.map(d => d[field]);

    const sumArr = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    const subArr = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);

    const cIngresos = compute(cur, 'ingresos');
    const cCostos = compute(cur, 'costos');
    const cUtilidadBruta = subArr(cIngresos, cCostos);
    const cGastos = compute(cur, 'gastos_operativos');
    const cEbitda = subArr(cUtilidadBruta, cGastos);
    const cImpuestos = compute(cur, 'impuestos');
    const cUtilidadNeta = subArr(cEbitda, cImpuestos);

    const pIngresos = compute(prev, 'ingresos');
    const pCostos = compute(prev, 'costos');
    const pUtilidadBruta = subArr(pIngresos, pCostos);
    const pGastos = compute(prev, 'gastos_operativos');
    const pEbitda = subArr(pUtilidadBruta, pGastos);
    const pImpuestos = compute(prev, 'impuestos');
    const pUtilidadNeta = subArr(pEbitda, pImpuestos);

    return [
      { label: 'Ingresos', current: cIngresos, previous: pIngresos, totalCur: sumArr(cIngresos), totalPrev: sumArr(pIngresos), isBold: false, isSubtotal: false },
      { label: 'Costos Operacionales', current: cCostos, previous: pCostos, totalCur: sumArr(cCostos), totalPrev: sumArr(pCostos), isBold: false, isSubtotal: false, isNegative: true },
      { label: 'Utilidad Bruta', current: cUtilidadBruta, previous: pUtilidadBruta, totalCur: sumArr(cUtilidadBruta), totalPrev: sumArr(pUtilidadBruta), isBold: true, isSubtotal: true },
      { label: 'Gastos Operativos', current: cGastos, previous: pGastos, totalCur: sumArr(cGastos), totalPrev: sumArr(pGastos), isBold: false, isSubtotal: false, isNegative: true },
      { label: 'EBITDA', current: cEbitda, previous: pEbitda, totalCur: sumArr(cEbitda), totalPrev: sumArr(pEbitda), isBold: true, isSubtotal: true },
      { label: 'Impuestos', current: cImpuestos, previous: pImpuestos, totalCur: sumArr(cImpuestos), totalPrev: sumArr(pImpuestos), isBold: false, isSubtotal: false, isNegative: true },
      { label: 'Utilidad Neta', current: cUtilidadNeta, previous: pUtilidadNeta, totalCur: sumArr(cUtilidadNeta), totalPrev: sumArr(pUtilidadNeta), isBold: true, isSubtotal: true },
    ];
  }, [currentData, previousData]);

  const isLoading = loadingCurrent || (compare && loadingPrevious);

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <CardTitle className="text-lg">Estado de Resultados (PyG)</CardTitle>
          <div className="flex items-center gap-4">
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableYears.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch id="compare" checked={compare} onCheckedChange={setCompare} />
              <Label htmlFor="compare" className="text-sm text-muted-foreground whitespace-nowrap">
                vs {year - 1}
              </Label>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="sticky left-0 bg-muted/50 z-10 min-w-[160px] font-semibold">
                  Concepto
                </TableHead>
                {MONTH_NAMES.map((m) => (
                  <TableHead key={m} className="text-right font-semibold min-w-[100px]">
                    {m}
                  </TableHead>
                ))}
                <TableHead className="text-right font-semibold min-w-[120px] border-l border-border">
                  Total
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={14} className="text-center py-12 text-muted-foreground">
                    Cargando datos...
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow
                    key={row.label}
                    className={cn(
                      row.isSubtotal && 'bg-muted/30 border-t-2 border-border'
                    )}
                  >
                    <TableCell
                      className={cn(
                        'sticky left-0 z-10 bg-card',
                        row.isSubtotal && 'bg-muted/30',
                        row.isBold ? 'font-bold text-foreground' : 'text-muted-foreground',
                        row.isNegative && 'pl-8'
                      )}
                    >
                      {row.isNegative ? `(-) ${row.label}` : row.label}
                    </TableCell>
                    {row.current.map((val, i) => (
                      <TableCell key={i} className="text-right tabular-nums">
                        {compare ? (
                          <div className="space-y-0.5">
                            <div className={cn(
                              row.isBold ? 'font-bold' : 'font-medium',
                              val < 0 ? 'text-destructive' : ''
                            )}>
                              {formatCurrency(val)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatCurrency(row.previous[i])}
                            </div>
                            <div className={cn(
                              'text-xs font-medium',
                              val > row.previous[i] ? 'text-success' : val < row.previous[i] ? 'text-destructive' : 'text-muted-foreground'
                            )}>
                              {formatVariation(val, row.previous[i])}
                            </div>
                          </div>
                        ) : (
                          <span className={cn(
                            row.isBold ? 'font-bold' : '',
                            val < 0 ? 'text-destructive' : ''
                          )}>
                            {formatCurrency(val)}
                          </span>
                        )}
                      </TableCell>
                    ))}
                    <TableCell className="text-right tabular-nums border-l border-border">
                      {compare ? (
                        <div className="space-y-0.5">
                          <div className={cn(
                            'font-bold',
                            row.totalCur < 0 ? 'text-destructive' : ''
                          )}>
                            {formatCurrency(row.totalCur)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatCurrency(row.totalPrev)}
                          </div>
                          <div className={cn(
                            'text-xs font-medium',
                            row.totalCur > row.totalPrev ? 'text-success' : row.totalCur < row.totalPrev ? 'text-destructive' : 'text-muted-foreground'
                          )}>
                            {formatVariation(row.totalCur, row.totalPrev)}
                          </div>
                        </div>
                      ) : (
                        <span className={cn(
                          'font-bold',
                          row.totalCur < 0 ? 'text-destructive' : ''
                        )}>
                          {formatCurrency(row.totalCur)}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="px-6 py-3 border-t border-border">
          <p className="text-xs text-muted-foreground italic">
            * Los valores se calculan a partir de las transacciones registradas. La clasificación depende del tipo operativo asignado a cada transacción.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
