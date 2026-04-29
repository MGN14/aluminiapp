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

      const [txRes, catRes, respRes, pcRes] = await Promise.all([
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
        supabase
          .from('petty_cash_movements')
          .select('date, amount, category_id, responsible_id')
          .eq('user_id', userId)
          .gte('date', `${year}-01-01`)
          .lte('date', `${year}-12-31`),
      ]);

      if (txRes.error) throw txRes.error;

      const categories: CategoryInfo[] = (catRes.data || []) as CategoryInfo[];
      const catMap = new Map(categories.map(c => [c.id, c]));
      const responsibles: ResponsibleInfo[] = (respRes.data || []) as ResponsibleInfo[];
      const respMap = new Map(responsibles.map(r => [r.id, r]));

      // Inyectamos petty_cash_movements como transacciones virtuales tipo egreso
      // para que la logica de PYG las procese como gastos junto al resto.
      const pettyAsTx: TransactionRow[] = ((pcRes.data ?? []) as Array<{
        date: string;
        amount: number | null;
        category_id: string | null;
        responsible_id: string | null;
      }>).map((m) => ({
        date: m.date,
        amount: -Math.abs(Number(m.amount) || 0),
        type: 'egreso',
        category_id: m.category_id,
        responsible_id: m.responsible_id,
        has_iva: false,
        iva_amount: 0,
        has_retefuente: false,
        retefuente_amount: 0,
        has_reteica: false,
        reteica_amount: 0,
      }));

      const allTransactions = [...(txRes.data as TransactionRow[]), ...pettyAsTx];

      return { transactions: allTransactions, categories, catMap, responsibles, respMap };
    },
    enabled: !!userId,
  });
}

interface FiscalExposure {
  totalNoDeducible: number;
  impactoRentaEstimado: number;
  countNoDeducible: number;
  topNoDeducibleCats: Array<{ name: string; total: number }>;
}

function useFiscalExposure(userId: string | undefined, year: number) {
  return useQuery<FiscalExposure>({
    queryKey: ['pyg-fiscal-exposure', userId, year],
    enabled: !!userId,
    queryFn: async () => {
      const empty: FiscalExposure = {
        totalNoDeducible: 0,
        impactoRentaEstimado: 0,
        countNoDeducible: 0,
        topNoDeducibleCats: [],
      };
      if (!userId) return empty;

      const [pcRes, catRes] = await Promise.all([
        supabase
          .from('petty_cash_movements')
          .select('amount, category_id')
          .eq('user_id', userId)
          .gte('date', `${year}-01-01`)
          .lte('date', `${year}-12-31`),
        supabase
          .from('categories')
          .select('id, name, is_tax_deductible')
          .eq('user_id', userId),
      ]);

      const catMap = new Map<string, { name: string; deductible: boolean }>();
      for (const c of (catRes.data ?? []) as Array<{ id: string; name: string; is_tax_deductible: boolean }>) {
        catMap.set(c.id, { name: c.name, deductible: !!c.is_tax_deductible });
      }

      const totals = new Map<string, { name: string; total: number }>();
      let totalNoDeducible = 0;
      let countNoDeducible = 0;

      for (const m of (pcRes.data ?? []) as Array<{ amount: number | null; category_id: string | null }>) {
        const cat = m.category_id ? catMap.get(m.category_id) : null;
        const isDeducible = cat?.deductible ?? false;
        if (isDeducible) continue;
        const amt = Number(m.amount) || 0;
        totalNoDeducible += amt;
        countNoDeducible += 1;
        const key = m.category_id ?? '__sin__';
        const name = cat?.name ?? 'Sin categoría';
        const cur = totals.get(key) ?? { name, total: 0 };
        cur.total += amt;
        totals.set(key, cur);
      }

      const topNoDeducibleCats = Array.from(totals.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      // Estimación de impacto si se rechazan en revisión: tarifa renta 33%
      // (sociedades) — referencial, ignora descuentos y reglas especiales.
      const impactoRentaEstimado = totalNoDeducible * 0.33;

      return { totalNoDeducible, impactoRentaEstimado, countNoDeducible, topNoDeducibleCats };
    },
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
  const { data: fiscalExposure } = useFiscalExposure(user?.id, year);

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

  // Facturas de venta emitidas en el año → "DIAN mensual" para la fila Sin facturar.
  // Solo se carga en modo gerencial.
  const { data: salesInvoicesPyg } = useQuery({
    queryKey: ['sales-invoices-pyg', user?.id, year, isGerencial],
    queryFn: async () => {
      if (!user?.id || !isGerencial) return [];
      const { data } = await supabase
        .from('invoices')
        .select('issue_date, total_amount')
        .eq('user_id', user.id)
        .eq('type', 'venta')
        .eq('status', 'confirmed')
        .gte('issue_date', `${year}-01-01`)
        .lte('issue_date', `${year}-12-31`);
      return (data || []) as Array<{ issue_date: string; total_amount: number }>;
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

    // Serie mensual del efectivo para poder trackearlo separado (ya sumado
    // dentro de cIngresos pero útil para la fila "Sin facturar").
    const cCashIncomeMonthly: MonthlyArr = new Array(12).fill(0) as MonthlyArr;
    // DIAN mensual: facturas de venta emitidas en cada mes.
    const cInvoicedMonthly: MonthlyArr = new Array(12).fill(0) as MonthlyArr;

    if (isGerencial) {
      if (cashMovements && cashMovements.length > 0) {
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

      if (salesInvoicesPyg && salesInvoicesPyg.length > 0) {
        for (const inv of salesInvoicesPyg) {
          const m = parseLocalDate(inv.issue_date).getMonth();
          cInvoicedMonthly[m] += Number(inv.total_amount) || 0;
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

    // Fila "Sin facturar" por mes = max(0, Real_mes − DIAN_mes).
    //   Real_mes = extracto_mes + efectivo_mes = cIngresos[m]
    //   DIAN_mes = facturas emitidas en el mes = cInvoicedMonthly[m]
    // Nota: no incluye anticipos de periodos anteriores (son saldo histórico,
    // no flujo del año; se muestran en el card del Dashboard y en Visita DIAN).
    const cGapMonthly: MonthlyArr = cIngresos.map((real, i) =>
      Math.max(0, real - cInvoicedMonthly[i])
    );
    const gapTotal = sumArr(cGapMonthly);
    const ingresosTotalReal = sumArr(cIngresos);
    const gapPct =
      ingresosTotalReal > 0 ? (gapTotal / ingresosTotalReal) * 100 : 0;

    const result: PYGRow[] = [
      {
        key: 'ingresos',
        label: 'Ingresos',
        values: cIngresos,
        total: sumArr(cIngresos),
        previousValues: pIngresos,
        previousTotal: sumArr(pIngresos),
      },
      // Sub-fila informativa: desagrega cuánto del total NO está facturado
      // (pendientes bancarios + efectivo). NO suma al total (ya está incluido
      // arriba). Solo se muestra en modo gerencial cuando hay brecha real.
      ...(isGerencial && gapTotal > 0
        ? [
            {
              key: 'ingresos-sin-facturar',
              label: `• Sin facturar — ${gapPct.toFixed(1)}%`,
              values: cGapMonthly,
              total: gapTotal,
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
  }, [currentData, previousData, cashMovements, salesInvoicesPyg, isGerencial]);

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
    <div className="space-y-6">
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
              <TableRow className="bg-muted">
                <TableHead className="sticky left-0 z-30 bg-muted min-w-[220px] font-semibold">
                  Concepto
                </TableHead>
                {MONTH_NAMES.map((m) => (
                  <TableHead key={m} className="text-right font-semibold min-w-[110px] bg-muted">
                    {m}
                  </TableHead>
                ))}
                <TableHead className="sticky right-0 z-30 bg-muted text-right font-semibold min-w-[140px] border-l border-border">
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
                  // IMPORTANTE: los backgrounds de las celdas sticky tienen que
                  // ser 100% opacos. Si usamos alpha (bg-*/10, bg-*/30) las cells
                  // de los meses que scrollean por debajo se ven a través y el
                  // texto se superpone. Por eso acá todos son colores sólidos
                  // (bg-green-50, bg-red-50, bg-muted, bg-card → todos sin /N).
                  const stickyBg = row.isNet
                    ? (row.total > 0
                        ? 'bg-green-50 dark:bg-green-950'
                        : row.total < 0
                          ? 'bg-red-50 dark:bg-red-950'
                          : 'bg-muted')
                    : row.isSubtotal ? 'bg-muted' : 'bg-card';

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
                        'sticky right-0 z-10 text-right tabular-nums border-l border-border',
                        stickyBg,
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
          <p className="text-xs text-muted-foreground italic">
            * Incluye gastos de Caja Menor (efectivo y cuentas de cobro) ingresados en el año.
          </p>
        </div>
      </CardContent>
    </Card>

    {fiscalExposure && fiscalExposure.totalNoDeducible > 0 && (
      <Card className="border-amber-200 bg-amber-50/40 dark:bg-amber-950/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-amber-900 dark:text-amber-100">
            Exposición fiscal estimada — gastos no deducibles
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg bg-white/60 dark:bg-black/20 p-3 border border-amber-100 dark:border-amber-900">
              <p className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300">Total NO deducible {year}</p>
              <p className="text-xl font-bold text-amber-900 dark:text-amber-100 mt-1">
                {formatCurrency(fiscalExposure.totalNoDeducible)}
              </p>
              <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                {fiscalExposure.countNoDeducible} movimientos en Caja Menor
              </p>
            </div>
            <div className="rounded-lg bg-white/60 dark:bg-black/20 p-3 border border-amber-100 dark:border-amber-900">
              <p className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300">Impacto estimado en renta (33%)</p>
              <p className="text-xl font-bold text-amber-900 dark:text-amber-100 mt-1">
                {formatCurrency(fiscalExposure.impactoRentaEstimado)}
              </p>
              <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                Si la DIAN rechaza estos gastos en revisión
              </p>
            </div>
          </div>

          {fiscalExposure.topNoDeducibleCats.length > 0 && (
            <div className="rounded-lg bg-white/60 dark:bg-black/20 p-3 border border-amber-100 dark:border-amber-900">
              <p className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300 mb-2">Top categorías no deducibles</p>
              <div className="space-y-1">
                {fiscalExposure.topNoDeducibleCats.map((c) => (
                  <div key={c.name} className="flex items-center justify-between text-sm text-amber-900 dark:text-amber-100">
                    <span>{c.name}</span>
                    <span className="tabular-nums font-medium">{formatCurrency(c.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-amber-700 dark:text-amber-300 italic leading-relaxed">
            Estimación referencial al 33% (tarifa renta sociedades). Cada caso fiscal es distinto — consultá con tu contador.
            Editá la deducibilidad de cada categoría desde Ajustes → Categorías cuando esté disponible, o en SQL.
          </p>
        </CardContent>
      </Card>
    )}
    </div>
  );
}
