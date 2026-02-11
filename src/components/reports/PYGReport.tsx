import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MONTH_NAMES, type ReportGroup } from '@/types/transaction';
import { cn } from '@/lib/utils';

interface TransactionRow {
  date: string;
  amount: number | null;
  type: string | null;
  category_id: string | null;
  has_iva: boolean;
  iva_amount: number;
  has_retefuente: boolean;
  retefuente_amount: number;
  has_reteica: boolean | null;
  reteica_amount: number | null;
}

interface CategoryInfo {
  id: string;
  name: string;
  report_group: ReportGroup;
}

function formatCurrency(value: number): string {
  if (value === 0) return '$0';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
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
    queryKey: ['pyg-report-v2', userId, year],
    queryFn: async () => {
      if (!userId) return null;

      const [txRes, catRes] = await Promise.all([
        supabase
          .from('transactions')
          .select('date, amount, type, category_id, has_iva, iva_amount, has_retefuente, retefuente_amount, has_reteica, reteica_amount')
          .eq('user_id', userId)
          .is('deleted_at', null)
          .gte('date', `${year}-01-01`)
          .lte('date', `${year}-12-31`),
        supabase
          .from('categories')
          .select('id, name, report_group')
          .eq('user_id', userId),
      ]);

      if (txRes.error) throw txRes.error;

      const categories: CategoryInfo[] = (catRes.data || []) as CategoryInfo[];
      const catMap = new Map(categories.map(c => [c.id, c]));

      return { transactions: txRes.data as TransactionRow[], categories, catMap };
    },
    enabled: !!userId,
  });
}

const currentYear = new Date().getFullYear();
const availableYears = Array.from({ length: 5 }, (_, i) => currentYear - i);

type MonthlyArr = number[];

function buildMonthlyData(
  transactions: TransactionRow[],
  catMap: Map<string, CategoryInfo>
) {
  const groups: Record<ReportGroup, MonthlyArr> = {
    ingresos: new Array(12).fill(0),
    costos_operacionales: new Array(12).fill(0),
    gastos_operativos: new Array(12).fill(0),
    impuestos: new Array(12).fill(0),
    otros: new Array(12).fill(0),
  };

  // Category breakdown: catId -> monthly amounts
  const catBreakdown = new Map<string, MonthlyArr>();

  // Tax flags accumulator
  const taxFromFlags = new Array(12).fill(0);

  for (const tx of transactions) {
    const m = new Date(tx.date).getMonth();
    const absAmount = Math.abs(tx.amount ?? 0);

    // Determine report_group
    let rg: ReportGroup;
    const cat = tx.category_id ? catMap.get(tx.category_id) : null;
    if (cat) {
      rg = (cat.report_group as ReportGroup) || 'otros';
    } else {
      // Default based on type
      rg = tx.type === 'ingreso' ? 'ingresos' : tx.type === 'egreso' ? 'gastos_operativos' : 'otros';
    }

    groups[rg][m] += absAmount;

    // Category breakdown
    const catKey = cat ? cat.id : `__uncategorized_${rg}`;
    if (!catBreakdown.has(catKey)) {
      catBreakdown.set(catKey, new Array(12).fill(0));
    }
    catBreakdown.get(catKey)![m] += absAmount;

    // Accumulate tax flags (retefuente, reteica) - these add to impuestos row
    // but only if the transaction is NOT already in impuestos group
    if (rg !== 'impuestos') {
      if (tx.has_retefuente && tx.retefuente_amount > 0) {
        taxFromFlags[m] += tx.retefuente_amount;
      }
      if (tx.has_reteica && (tx.reteica_amount ?? 0) > 0) {
        taxFromFlags[m] += tx.reteica_amount!;
      }
    }
  }

  // Add tax flags to impuestos
  for (let i = 0; i < 12; i++) {
    groups.impuestos[i] += taxFromFlags[i];
  }

  return { groups, catBreakdown, taxFromFlags };
}

interface PYGRow {
  label: string;
  values: MonthlyArr;
  total: number;
  isBold?: boolean;
  isSubtotal?: boolean;
  isNegative?: boolean;
  isDetail?: boolean;
  previousValues?: MonthlyArr;
  previousTotal?: number;
}

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
    if (!currentData) return [];

    const cur = buildMonthlyData(currentData.transactions, currentData.catMap);
    const prev = previousData
      ? buildMonthlyData(previousData.transactions, previousData.catMap)
      : null;

    const sumArr = (arr: MonthlyArr) => arr.reduce((a, b) => a + b, 0);
    const subArr = (a: MonthlyArr, b: MonthlyArr) => a.map((v, i) => v - b[i]);

    const cIngresos = cur.groups.ingresos;
    const cCostos = cur.groups.costos_operacionales;
    const cUtilidadBruta = subArr(cIngresos, cCostos);
    const cGastos = cur.groups.gastos_operativos;
    const cEbitda = subArr(cUtilidadBruta, cGastos);
    const cImpuestos = cur.groups.impuestos;
    const cUtilidadNeta = subArr(cEbitda, cImpuestos);
    const cTotalEgresos = cCostos.map((v, i) => v + cGastos[i] + cImpuestos[i]);

    const pGroups = prev?.groups;

    const pIngresos = pGroups?.ingresos || new Array(12).fill(0);
    const pCostos = pGroups?.costos_operacionales || new Array(12).fill(0);
    const pUtilidadBruta = subArr(pIngresos, pCostos);
    const pGastos = pGroups?.gastos_operativos || new Array(12).fill(0);
    const pEbitda = subArr(pUtilidadBruta, pGastos);
    const pImpuestos = pGroups?.impuestos || new Array(12).fill(0);
    const pUtilidadNeta = subArr(pEbitda, pImpuestos);

    // Build category detail rows
    const catMap = currentData.catMap;
    const categories = currentData.categories;

    function getCatDetailRows(reportGroup: ReportGroup): PYGRow[] {
      const catsInGroup = categories.filter(c => (c.report_group as ReportGroup) === reportGroup);
      const detailRows: PYGRow[] = [];

      for (const cat of catsInGroup) {
        const vals = cur.catBreakdown.get(cat.id);
        if (!vals || vals.every(v => v === 0)) continue;
        const pVals = prev?.catBreakdown.get(cat.id) || new Array(12).fill(0);
        detailRows.push({
          label: cat.name,
          values: vals,
          total: sumArr(vals),
          isDetail: true,
          previousValues: pVals,
          previousTotal: sumArr(pVals),
        });
      }

      // Uncategorized
      const uncatKey = `__uncategorized_${reportGroup}`;
      const uncatVals = cur.catBreakdown.get(uncatKey);
      if (uncatVals && !uncatVals.every(v => v === 0)) {
        const pUncatVals = prev?.catBreakdown.get(uncatKey) || new Array(12).fill(0);
        detailRows.push({
          label: 'Sin categoría',
          values: uncatVals,
          total: sumArr(uncatVals),
          isDetail: true,
          previousValues: pUncatVals,
          previousTotal: sumArr(pUncatVals),
        });
      }

      return detailRows;
    }

    const result: PYGRow[] = [
      { label: 'Ingresos', values: cIngresos, total: sumArr(cIngresos), isBold: false, previousValues: pIngresos, previousTotal: sumArr(pIngresos) },
      ...getCatDetailRows('ingresos'),
      { label: 'Costos Operacionales', values: cCostos, total: sumArr(cCostos), isNegative: true, previousValues: pCostos, previousTotal: sumArr(pCostos) },
      ...getCatDetailRows('costos_operacionales'),
      { label: 'Utilidad Bruta', values: cUtilidadBruta, total: sumArr(cUtilidadBruta), isBold: true, isSubtotal: true, previousValues: pUtilidadBruta, previousTotal: sumArr(pUtilidadBruta) },
      { label: 'Gastos Operativos', values: cGastos, total: sumArr(cGastos), isNegative: true, previousValues: pGastos, previousTotal: sumArr(pGastos) },
      ...getCatDetailRows('gastos_operativos'),
      { label: 'EBITDA', values: cEbitda, total: sumArr(cEbitda), isBold: true, isSubtotal: true, previousValues: pEbitda, previousTotal: sumArr(pEbitda) },
      { label: 'Impuestos', values: cImpuestos, total: sumArr(cImpuestos), isNegative: true, previousValues: pImpuestos, previousTotal: sumArr(pImpuestos) },
      ...getCatDetailRows('impuestos'),
      { label: 'Utilidad Neta', values: cUtilidadNeta, total: sumArr(cUtilidadNeta), isBold: true, isSubtotal: true, previousValues: pUtilidadNeta, previousTotal: sumArr(pUtilidadNeta) },
      { label: 'Total Egresos', values: cTotalEgresos, total: sumArr(cTotalEgresos), isBold: false, isSubtotal: true, isNegative: true, previousValues: pCostos.map((v, i) => v + (pGastos[i] || 0) + (pImpuestos[i] || 0)), previousTotal: sumArr(pCostos) + sumArr(pGastos) + sumArr(pImpuestos) },
    ];

    return result;
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
        <div className="overflow-x-auto relative">
          <Table>
            <TableHeader className="sticky top-0 z-20">
              <TableRow className="bg-muted/80 backdrop-blur-sm">
                <TableHead className="sticky left-0 z-30 bg-muted/80 backdrop-blur-sm min-w-[180px] font-semibold">
                  Concepto
                </TableHead>
                {MONTH_NAMES.map((m) => (
                  <TableHead key={m} className="text-right font-semibold min-w-[110px]">
                    {m}
                  </TableHead>
                ))}
                <TableHead className="text-right font-semibold min-w-[130px] border-l border-border">
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
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={14} className="text-center py-12 text-muted-foreground">
                    No hay transacciones para el periodo seleccionado.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, idx) => (
                  <TableRow
                    key={`${row.label}-${idx}`}
                    className={cn(
                      row.isSubtotal && 'bg-muted/30 border-t-2 border-border',
                    )}
                  >
                    <TableCell
                      className={cn(
                        'sticky left-0 z-10 bg-card',
                        row.isSubtotal && 'bg-muted/30',
                        row.isBold ? 'font-bold text-foreground' : 'text-muted-foreground',
                        row.isNegative && !row.isSubtotal && !row.isDetail && 'pl-6',
                        row.isDetail && 'pl-10 text-xs',
                      )}
                    >
                      {row.isNegative && !row.isSubtotal && !row.isDetail ? `(-) ${row.label}` : row.label}
                    </TableCell>
                    {row.values.map((val, i) => (
                      <TableCell key={i} className={cn('text-right tabular-nums', row.isDetail && 'text-xs')}>
                        {compare && row.previousValues ? (
                          <div className="space-y-0.5">
                            <div className={cn(
                              row.isBold ? 'font-bold' : 'font-medium',
                              val < 0 ? 'text-destructive' : ''
                            )}>
                              {formatCurrency(val)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatCurrency(row.previousValues[i])}
                            </div>
                            <div className={cn(
                              'text-xs font-medium',
                              val > row.previousValues[i] ? 'text-success' : val < row.previousValues[i] ? 'text-destructive' : 'text-muted-foreground'
                            )}>
                              {formatVariation(val, row.previousValues[i])}
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
                    <TableCell className={cn('text-right tabular-nums border-l border-border', row.isDetail && 'text-xs')}>
                      {compare && row.previousTotal !== undefined ? (
                        <div className="space-y-0.5">
                          <div className={cn('font-bold', row.total < 0 ? 'text-destructive' : '')}>
                            {formatCurrency(row.total)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatCurrency(row.previousTotal)}
                          </div>
                          <div className={cn(
                            'text-xs font-medium',
                            row.total > row.previousTotal ? 'text-success' : row.total < row.previousTotal ? 'text-destructive' : 'text-muted-foreground'
                          )}>
                            {formatVariation(row.total, row.previousTotal)}
                          </div>
                        </div>
                      ) : (
                        <span className={cn('font-bold', row.total < 0 ? 'text-destructive' : '')}>
                          {formatCurrency(row.total)}
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
            * Clasificación basada en el campo "Grupo de reporte" de cada categoría. Editable desde Gestionar Categorías.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
