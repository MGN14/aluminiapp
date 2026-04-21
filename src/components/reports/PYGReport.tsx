import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useModuleContext } from '@/hooks/useModuleContext';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MONTH_NAMES, type ReportGroup } from '@/types/transaction';
import { parseLocalDate } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';

interface TransactionRow {
  date: string;
  amount: number | null;
  type: string | null;
  category_id: string | null;
  responsible_id: string | null;
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

interface ResponsibleInfo {
  id: string;
  name: string;
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

function formatMarginPct(value: number, base: number): string | null {
  if (base === 0) return null;
  const pct = (value / base) * 100;
  return `${pct.toFixed(1)}%`;
}

function useYearData(userId: string | undefined, year: number) {
  return useQuery({
    queryKey: ['pyg-report-v3', userId, year],
    queryFn: async () => {
      if (!userId) return null;

      const [txRes, catRes, respRes] = await Promise.all([
        supabase
          .from('transactions')
          .select('date, amount, type, category_id, responsible_id, has_iva, iva_amount, has_retefuente, retefuente_amount, has_reteica, reteica_amount')
          .eq('user_id', userId)
          .is('deleted_at', null)
          .gte('date', `${year}-01-01`)
          .lte('date', `${year}-12-31`),
        supabase
          .from('categories')
          .select('id, name, report_group')
          .eq('user_id', userId),
        supabase
          .from('responsibles')
          .select('id, name')
          .eq('user_id', userId),
      ]);

      if (txRes.error) throw txRes.error;

      const categories: CategoryInfo[] = (catRes.data || []) as CategoryInfo[];
      const catMap = new Map(categories.map(c => [c.id, c]));
      const responsibles: ResponsibleInfo[] = (respRes.data || []) as ResponsibleInfo[];
      const respMap = new Map(responsibles.map(r => [r.id, r]));

      return { transactions: txRes.data as TransactionRow[], categories, catMap, responsibles, respMap };
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

  // catKey -> monthly amounts
  const catBreakdown = new Map<string, MonthlyArr>();
  // catKey -> (benefKey -> monthly amounts)
  const catBenefBreakdown = new Map<string, Map<string, MonthlyArr>>();

  const taxFromFlags = new Array(12).fill(0);

  for (const tx of transactions) {
    const m = parseLocalDate(tx.date).getMonth();
    const absAmount = Math.abs(tx.amount ?? 0);

    let rg: ReportGroup;
    const cat = tx.category_id ? catMap.get(tx.category_id) : null;
    if (cat) {
      rg = (cat.report_group as ReportGroup) || 'otros';
    } else {
      rg = tx.type === 'ingreso' ? 'ingresos' : tx.type === 'egreso' ? 'gastos_operativos' : 'otros';
    }

    groups[rg][m] += absAmount;

    const catKey = cat ? cat.id : `__uncategorized_${rg}`;
    if (!catBreakdown.has(catKey)) catBreakdown.set(catKey, new Array(12).fill(0));
    catBreakdown.get(catKey)![m] += absAmount;

    const benefKey = tx.responsible_id || '__no_resp';
    if (!catBenefBreakdown.has(catKey)) catBenefBreakdown.set(catKey, new Map());
    const benefMap = catBenefBreakdown.get(catKey)!;
    if (!benefMap.has(benefKey)) benefMap.set(benefKey, new Array(12).fill(0));
    benefMap.get(benefKey)![m] += absAmount;

    if (rg !== 'impuestos') {
      if (tx.has_retefuente && tx.retefuente_amount > 0) taxFromFlags[m] += tx.retefuente_amount;
      if (tx.has_reteica && (tx.reteica_amount ?? 0) > 0) taxFromFlags[m] += tx.reteica_amount!;
    }
  }

  for (let i = 0; i < 12; i++) {
    groups.impuestos[i] += taxFromFlags[i];
  }

  return { groups, catBreakdown, catBenefBreakdown, taxFromFlags };
}

interface PYGRow {
  key: string;
  label: string;
  values: MonthlyArr;
  total: number;
  isBold?: boolean;
  isSubtotal?: boolean;
  isNegative?: boolean;
  isDetail?: boolean;      // categoría row (level 2)
  isSubDetail?: boolean;   // beneficiario row (level 3)
  isNet?: boolean;         // Utilidad Neta — highlighted
  previousValues?: MonthlyArr;
  previousTotal?: number;
  marginPct?: number | null;
  catKey?: string;              // on detail rows, to toggle expansion
  hasBenefBreakdown?: boolean;  // show chevron
  parentCatKey?: string;        // on sub-detail rows, used to filter by expansion
}

export default function PYGReport() {
  const { user } = useAuth();
  const { isGerencial } = useModuleContext();
  const [year, setYear] = useState(currentYear);
  const [compare, setCompare] = useState(false);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  const { data: currentData, isLoading: loadingCurrent } = useYearData(user?.id, year);
  const { data: previousData, isLoading: loadingPrevious } = useYearData(
    compare ? user?.id : undefined,
    year - 1
  );

  const { data: cashMovements } = useQuery({
    queryKey: ['cash-movements-pyg', user?.id, year, isGerencial],
    queryFn: async () => {
      if (!user?.id || !isGerencial) return [];
      const { data } = await supabase
        .from('cash_movements')
        .select('date, type, amount')
        .eq('user_id', user.id)
        .gte('date', `${year}-01-01`)
        .lte('date', `${year}-12-31`);
      return data || [];
    },
    enabled: !!user?.id && isGerencial,
  });

  const allRows = useMemo<PYGRow[]>(() => {
    if (!currentData) return [];

    const cur = buildMonthlyData(currentData.transactions, currentData.catMap);
    const prev = previousData
      ? buildMonthlyData(previousData.transactions, previousData.catMap)
      : null;

    const sumArr = (arr: MonthlyArr) => arr.reduce((a, b) => a + b, 0);
    const subArr = (a: MonthlyArr, b: MonthlyArr) => a.map((v, i) => v - b[i]);

    const cIngresos = [...cur.groups.ingresos];
    const cCostos = [...cur.groups.costos_operacionales];
    // Serie mensual del efectivo no facturado (solo tracking, ya está sumado dentro de cIngresos)
    const cCashIncomeMonthly: MonthlyArr = new Array(12).fill(0) as MonthlyArr;

    if (isGerencial && cashMovements && cashMovements.length > 0) {
      for (const cm of cashMovements) {
        const m = parseLocalDate(cm.date).getMonth();
        const amount = Number(cm.amount) || 0;
        if (cm.type === 'ingreso') {
          cIngresos[m] += amount;
          cCashIncomeMonthly[m] += amount;
        } else if (cm.type === 'egreso') {
          cCostos[m] += amount;
        }
      }
    }

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
    const pTotalEgresos = pCostos.map((v, i) => v + pGastos[i] + pImpuestos[i]);

    const categories = currentData.categories;
    const respMap = currentData.respMap;
    const prevRespMap = previousData?.respMap;

    const ingresosTotal = sumArr(cIngresos);

    // For each category in a given report group, emit a detail row + its benef sub-rows.
    function getCatDetailRows(reportGroup: ReportGroup): PYGRow[] {
      const out: PYGRow[] = [];
      const catsInGroup = categories.filter(c => (c.report_group as ReportGroup) === reportGroup);

      const emitCatAndBenefs = (catKey: string, catLabel: string) => {
        const vals = cur.catBreakdown.get(catKey);
        if (!vals || vals.every(v => v === 0)) return;
        const pVals = prev?.catBreakdown.get(catKey) || new Array(12).fill(0);

        const benefMap = cur.catBenefBreakdown.get(catKey);
        const prevBenefMap = prev?.catBenefBreakdown.get(catKey);

        // Collect benefs with any current activity
        const benefEntries: Array<{ key: string; label: string; vals: MonthlyArr; pVals: MonthlyArr }> = [];
        if (benefMap) {
          for (const [benefKey, benefVals] of benefMap.entries()) {
            if (benefVals.every(v => v === 0)) continue;
            const label = benefKey === '__no_resp'
              ? 'Sin beneficiario'
              : (respMap.get(benefKey)?.name ?? prevRespMap?.get(benefKey)?.name ?? 'Beneficiario eliminado');
            const prevBenefVals = prevBenefMap?.get(benefKey) || new Array(12).fill(0);
            benefEntries.push({ key: benefKey, label, vals: benefVals, pVals: prevBenefVals });
          }
        }
        // Order: '__no_resp' last, rest by descending total
        benefEntries.sort((a, b) => {
          if (a.key === '__no_resp') return 1;
          if (b.key === '__no_resp') return -1;
          return sumArr(b.vals) - sumArr(a.vals);
        });

        const hasBenefBreakdown = benefEntries.length > 1 ||
          (benefEntries.length === 1 && benefEntries[0].key !== '__no_resp');

        out.push({
          key: `cat-${catKey}`,
          label: catLabel,
          values: vals,
          total: sumArr(vals),
          isDetail: true,
          previousValues: pVals,
          previousTotal: sumArr(pVals),
          catKey,
          hasBenefBreakdown,
        });

        for (const b of benefEntries) {
          out.push({
            key: `cat-${catKey}-benef-${b.key}`,
            label: b.label,
            values: b.vals,
            total: sumArr(b.vals),
            isSubDetail: true,
            previousValues: b.pVals,
            previousTotal: sumArr(b.pVals),
            parentCatKey: catKey,
          });
        }
      };

      for (const cat of catsInGroup) emitCatAndBenefs(cat.id, cat.name);
      emitCatAndBenefs(`__uncategorized_${reportGroup}`, 'Sin categoría');

      return out;
    }

    const cashIncomeTotal = sumArr(cCashIncomeMonthly);
    const cashIncomePct =
      sumArr(cIngresos) > 0 ? (cashIncomeTotal / sumArr(cIngresos)) * 100 : 0;

    const result: PYGRow[] = [
      {
        key: 'ingresos',
        label: 'Ingresos',
        values: cIngresos,
        total: sumArr(cIngresos),
        previousValues: pIngresos,
        previousTotal: sumArr(pIngresos),
      },
      // Sub-fila informativa: desagrega cuánto del Ingresos viene de efectivo
      // no facturado. NO suma al total (ya está incluida arriba). Solo se
      // muestra en modo gerencial y si efectivamente hay movimientos.
      ...(isGerencial && cashIncomeTotal > 0
        ? [
            {
              key: 'ingresos-sin-facturar',
              label: `• Sin facturar (efectivo) — ${cashIncomePct.toFixed(1)}%`,
              values: cCashIncomeMonthly,
              total: cashIncomeTotal,
              isDetail: true,
            } as PYGRow,
          ]
        : []),
      ...getCatDetailRows('ingresos'),
      // Total Egresos movido aquí: contraparte directa de Ingresos.
      {
        key: 'total-egresos',
        label: 'Total Egresos',
        values: cTotalEgresos,
        total: sumArr(cTotalEgresos),
        isNegative: true,
        isSubtotal: true,
        previousValues: pTotalEgresos,
        previousTotal: sumArr(pTotalEgresos),
      },
      {
        key: 'costos',
        label: 'Costos Operacionales',
        values: cCostos,
        total: sumArr(cCostos),
        isNegative: true,
        previousValues: pCostos,
        previousTotal: sumArr(pCostos),
      },
      ...getCatDetailRows('costos_operacionales'),
      {
        key: 'utilidad-bruta',
        label: 'Utilidad Bruta',
        values: cUtilidadBruta,
        total: sumArr(cUtilidadBruta),
        isBold: true,
        isSubtotal: true,
        previousValues: pUtilidadBruta,
        previousTotal: sumArr(pUtilidadBruta),
        marginPct: ingresosTotal > 0 ? (sumArr(cUtilidadBruta) / ingresosTotal) * 100 : null,
      },
      {
        key: 'gastos',
        label: 'Gastos Operativos',
        values: cGastos,
        total: sumArr(cGastos),
        isNegative: true,
        previousValues: pGastos,
        previousTotal: sumArr(pGastos),
      },
      ...getCatDetailRows('gastos_operativos'),
      {
        key: 'ebitda',
        label: 'EBITDA',
        values: cEbitda,
        total: sumArr(cEbitda),
        isBold: true,
        isSubtotal: true,
        previousValues: pEbitda,
        previousTotal: sumArr(pEbitda),
        marginPct: ingresosTotal > 0 ? (sumArr(cEbitda) / ingresosTotal) * 100 : null,
      },
      {
        key: 'impuestos',
        label: 'Impuestos',
        values: cImpuestos,
        total: sumArr(cImpuestos),
        isNegative: true,
        previousValues: pImpuestos,
        previousTotal: sumArr(pImpuestos),
      },
      ...getCatDetailRows('impuestos'),
      {
        key: 'utilidad-neta',
        label: 'Utilidad Neta',
        values: cUtilidadNeta,
        total: sumArr(cUtilidadNeta),
        isBold: true,
        isSubtotal: true,
        isNet: true,
        previousValues: pUtilidadNeta,
        previousTotal: sumArr(pUtilidadNeta),
        marginPct: ingresosTotal > 0 ? (sumArr(cUtilidadNeta) / ingresosTotal) * 100 : null,
      },
    ];

    return result;
  }, [currentData, previousData, cashMovements, isGerencial]);

  // Catálogo de categorías expandibles (las que tienen benef breakdown).
  const expandableCatKeys = useMemo(() => {
    return allRows.filter(r => r.isDetail && r.hasBenefBreakdown).map(r => r.catKey!);
  }, [allRows]);

  const allExpanded = expandableCatKeys.length > 0 && expandableCatKeys.every(k => expandedCats.has(k));

  const visibleRows = useMemo(() => {
    return allRows.filter(r => !r.parentCatKey || expandedCats.has(r.parentCatKey));
  }, [allRows, expandedCats]);

  const toggleExpand = (catKey: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(catKey)) next.delete(catKey);
      else next.add(catKey);
      return next;
    });
  };

  const toggleAll = () => {
    if (allExpanded) setExpandedCats(new Set());
    else setExpandedCats(new Set(expandableCatKeys));
  };

  const isLoading = loadingCurrent || (compare && loadingPrevious);

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <CardTitle className="text-lg">Estado de Resultados (PyG)</CardTitle>
          <div className="flex items-center gap-3 flex-wrap">
            {expandableCatKeys.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={toggleAll}
                className="gap-1 h-8 text-xs"
              >
                {allExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {allExpanded ? 'Colapsar todo' : 'Expandir todo'}
              </Button>
            )}
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-28 h-8">
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
                <TableHead className="sticky left-0 z-30 bg-muted/80 backdrop-blur-sm min-w-[220px] font-semibold">
                  Concepto
                </TableHead>
                {MONTH_NAMES.map((m) => (
                  <TableHead key={m} className="text-right font-semibold min-w-[110px]">
                    {m}
                  </TableHead>
                ))}
                <TableHead className="text-right font-semibold min-w-[140px] border-l border-border">
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
              ) : visibleRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={14} className="text-center py-12 text-muted-foreground">
                    No hay transacciones para el periodo seleccionado.
                  </TableCell>
                </TableRow>
              ) : (
                visibleRows.map((row) => {
                  const isExpanded = row.catKey ? expandedCats.has(row.catKey) : false;
                  const netBg = row.isNet
                    ? (row.total > 0 ? 'bg-success/10' : row.total < 0 ? 'bg-destructive/10' : 'bg-muted/40')
                    : '';
                  const stickyBg = row.isNet
                    ? (row.total > 0 ? 'bg-success/10' : row.total < 0 ? 'bg-destructive/10' : 'bg-muted/40')
                    : row.isSubtotal ? 'bg-muted/30' : 'bg-card';

                  return (
                    <TableRow
                      key={row.key}
                      className={cn(
                        row.isSubtotal && 'border-t-2 border-border',
                        netBg,
                        !row.isNet && row.isSubtotal && 'bg-muted/30',
                        row.isDetail && row.hasBenefBreakdown && 'cursor-pointer hover:bg-muted/20',
                      )}
                      onClick={row.isDetail && row.hasBenefBreakdown ? () => toggleExpand(row.catKey!) : undefined}
                    >
                      <TableCell
                        className={cn(
                          'sticky left-0 z-10',
                          stickyBg,
                          row.isBold ? 'font-bold text-foreground' : 'text-muted-foreground',
                          row.isNet && 'text-base',
                          row.isNegative && !row.isSubtotal && !row.isDetail && !row.isSubDetail && 'pl-6',
                          row.isDetail && 'pl-6 text-xs',
                          row.isSubDetail && 'pl-12 text-[11px] text-muted-foreground/80',
                        )}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {row.isDetail && row.hasBenefBreakdown && (
                            isExpanded
                              ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                              : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                          )}
                          {row.isDetail && !row.hasBenefBreakdown && <span className="inline-block w-3" />}
                          <span>
                            {row.isNegative && !row.isSubtotal && !row.isDetail && !row.isSubDetail
                              ? `(-) ${row.label}`
                              : row.label}
                          </span>
                        </span>
                      </TableCell>
                      {row.values.map((val, i) => (
                        <TableCell
                          key={i}
                          className={cn(
                            'text-right tabular-nums',
                            row.isDetail && 'text-xs',
                            row.isSubDetail && 'text-[11px] text-muted-foreground/80',
                            row.isNet && 'text-base',
                          )}
                        >
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
                      <TableCell className={cn(
                        'text-right tabular-nums border-l border-border',
                        row.isDetail && 'text-xs',
                        row.isSubDetail && 'text-[11px] text-muted-foreground/80',
                        row.isNet && 'text-base',
                      )}>
                        {compare && row.previousTotal !== undefined ? (
                          <div className="space-y-0.5">
                            <div className={cn('font-bold', row.total < 0 ? 'text-destructive' : '')}>
                              {formatCurrency(row.total)}
                            </div>
                            {row.marginPct !== null && row.marginPct !== undefined && (
                              <div className="text-[10px] font-semibold text-primary/80">
                                {row.marginPct.toFixed(1)}% margen
                              </div>
                            )}
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
                          <div className="space-y-0.5">
                            <span className={cn('font-bold', row.total < 0 ? 'text-destructive' : '')}>
                              {formatCurrency(row.total)}
                            </span>
                            {row.marginPct !== null && row.marginPct !== undefined && (
                              <div className="text-[10px] font-semibold text-primary/80">
                                {row.marginPct.toFixed(1)}% margen
                              </div>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        <div className="px-6 py-3 border-t border-border space-y-1">
          <p className="text-xs text-muted-foreground italic">
            * Clasificación basada en el campo "Grupo de reporte" de cada categoría. Editable desde Gestionar Categorías.
          </p>
          <p className="text-xs text-muted-foreground italic">
            * Clic en una categoría para desglosar por beneficiario. Transacciones sin responsable aparecen como "Sin beneficiario".
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
