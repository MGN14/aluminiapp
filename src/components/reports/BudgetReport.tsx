import { Fragment, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Target, ChevronDown, ChevronRight, Info } from 'lucide-react';
import { useBudget } from '@/hooks/useBudget';
import { usePermissions } from '@/hooks/usePermissions';
import { MONTH_NAMES, type ReportGroup } from '@/types/transaction';

const GROUP_LABEL: Record<ReportGroup, string> = {
  ingresos: 'Ingresos',
  costos_operacionales: 'Costos operacionales',
  gastos_operativos: 'Gastos operativos',
  impuestos: 'Impuestos',
  otros: 'Otros',
};
// En ingresos, real > plan es BUENO; en costos/gastos/impuestos, real > plan es MALO.
const MORE_IS_BETTER: Record<ReportGroup, boolean> = {
  ingresos: true, costos_operacionales: false, gastos_operativos: false, impuestos: false, otros: false,
};

const fmt = (v: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Math.round(v));
const fmtShort = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v)}`;
};

const now = new Date();
const YEARS = Array.from({ length: 4 }, (_, i) => now.getFullYear() - 2 + i);

function VarianceCell({ planned, actual, moreIsBetter }: { planned: number; actual: number; moreIsBetter: boolean }) {
  if (planned <= 0) return <span className="text-muted-foreground text-xs">—</span>;
  const pct = ((actual - planned) / planned) * 100;
  const good = moreIsBetter ? pct >= 0 : pct <= 0;
  const color = Math.abs(pct) < 0.5 ? 'text-muted-foreground' : good ? 'text-success' : 'text-destructive';
  return <span className={`text-xs font-medium ${color}`}>{pct > 0 ? '+' : ''}{pct.toFixed(1)}%</span>;
}

export default function BudgetReport() {
  const [year, setYear] = useState(now.getFullYear());
  const [showMonthly, setShowMonthly] = useState(false);
  const { comparison, isLoading, hasBudget, plannedMap, setBudget, setBudgetGroupYear } = useBudget(year);
  const { canEdit } = usePermissions();
  const editable = canEdit('presupuesto');

  const editableGroups: ReportGroup[] = ['ingresos', 'costos_operacionales', 'gastos_operativos', 'impuestos'];

  // ¿El grupo tiene una distribución mensual NO uniforme cargada a mano?
  // Si sí, avisamos antes de que el "plan anual" la aplaste a partes iguales.
  const hasCustomMonthly = (g: ReportGroup) => {
    const vals = Array.from({ length: 12 }, (_, i) => plannedMap.get(`${g}|${i + 1}`) ?? 0);
    const nonZero = vals.filter((v) => v > 0);
    if (nonZero.length === 0) return false;
    return nonZero.some((v) => Math.abs(v - nonZero[0]) > 1);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
            <Target className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Presupuesto vs Real</h2>
            <p className="text-xs text-muted-foreground">Fijá tu meta por rubro y mirá el desvío contra lo que pasó de verdad.</p>
          </div>
        </div>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>{YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {isLoading || !comparison ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Calculando…</div>
      ) : (
        <>
          {/* Resultado planeado vs real */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Card className="border-0 shadow-sm"><CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground">Resultado planeado {year}</p>
              <p className="text-lg font-bold tabular-nums mt-1">{fmt(comparison.resultPlannedTotal)}</p>
            </CardContent></Card>
            <Card className="border-0 shadow-sm"><CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground">Resultado real {year}</p>
              <p className={`text-lg font-bold tabular-nums mt-1 ${comparison.resultActualTotal >= 0 ? 'text-success' : 'text-destructive'}`}>{fmt(comparison.resultActualTotal)}</p>
            </CardContent></Card>
            <Card className="border-0 shadow-sm"><CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground">Desvío</p>
              <div className="mt-1"><VarianceCell planned={comparison.resultPlannedTotal} actual={comparison.resultActualTotal} moreIsBetter /></div>
            </CardContent></Card>
          </div>

          {!hasBudget && (
            <p className="text-xs text-amber-600 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2 flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Todavía no fijaste presupuesto para {year}. Escribí el monto anual de cada rubro abajo (se reparte en 12 meses) o abrí el detalle mensual para cargar mes a mes.
            </p>
          )}

          {/* Vista anual editable */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Plan anual por rubro</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/60">
                    <TableHead className="text-xs">Rubro</TableHead>
                    <TableHead className="text-xs text-right">Plan anual</TableHead>
                    <TableHead className="text-xs text-right">Real anual</TableHead>
                    <TableHead className="text-xs text-right">Desvío</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparison.groups.filter((g) => editableGroups.includes(g.group)).map((g) => (
                    <TableRow key={g.group}>
                      <TableCell className="text-sm py-2">{GROUP_LABEL[g.group]}</TableCell>
                      <TableCell className="py-1">
                        <Input
                          type="number" min={0}
                          defaultValue={g.plannedTotal || ''}
                          key={`${g.group}-${g.plannedTotal}`}
                          placeholder="0"
                          disabled={!editable}
                          className="h-8 text-xs font-mono w-32 text-right ml-auto"
                          onBlur={(e) => {
                            // Vacío con valor previo → 0 (permite borrar la meta).
                            const raw = e.target.value;
                            const v = raw === '' ? 0 : (Number(raw) || 0);
                            if (Math.round(v) === Math.round(g.plannedTotal)) return;
                            if (hasCustomMonthly(g.group) && !window.confirm(
                              'Tenés un detalle mensual cargado a mano para este rubro. Escribir el plan anual lo reemplaza por 12 cuotas iguales. ¿Continuar?',
                            )) { e.target.value = String(g.plannedTotal || ''); return; }
                            setBudgetGroupYear.mutate({ group: g.group, annualAmount: v });
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-sm text-right font-mono py-2">{fmt(g.actualTotal)}</TableCell>
                      <TableCell className="text-right py-2"><VarianceCell planned={g.plannedTotal} actual={g.actualTotal} moreIsBetter={MORE_IS_BETTER[g.group]} /></TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/40 font-bold">
                    <TableCell className="text-sm py-2">Resultado</TableCell>
                    <TableCell className="text-sm text-right font-mono py-2">{fmt(comparison.resultPlannedTotal)}</TableCell>
                    <TableCell className="text-sm text-right font-mono py-2">{fmt(comparison.resultActualTotal)}</TableCell>
                    <TableCell className="text-right py-2"><VarianceCell planned={comparison.resultPlannedTotal} actual={comparison.resultActualTotal} moreIsBetter /></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Detalle mensual */}
          <Card>
            <CardHeader className="pb-2">
              <button type="button" onClick={() => setShowMonthly(!showMonthly)} className="flex items-center gap-1.5 text-sm font-medium hover:text-primary">
                {showMonthly ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Detalle mensual (plan editable mes a mes)
              </button>
            </CardHeader>
            {showMonthly && (
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/60">
                      <TableHead className="text-[11px] sticky left-0 bg-muted/60">Rubro</TableHead>
                      {MONTH_NAMES.map((m) => <TableHead key={m} className="text-[11px] text-right">{m}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comparison.groups.filter((g) => editableGroups.includes(g.group)).map((g) => (
                      <Fragment key={g.group}>
                        <TableRow>
                          <TableCell className="text-[11px] py-1 sticky left-0 bg-background font-medium">{GROUP_LABEL[g.group]}<span className="block text-[9px] text-muted-foreground">plan</span></TableCell>
                          {Array.from({ length: 12 }).map((_, mi) => (
                            <TableCell key={mi} className="p-0.5">
                              <Input
                                type="number" min={0}
                                defaultValue={plannedMap.get(`${g.group}|${mi + 1}`) || ''}
                                key={`${g.group}-${mi}-${plannedMap.get(`${g.group}|${mi + 1}`) ?? 0}`}
                                disabled={!editable}
                                className="h-7 text-[10px] font-mono w-[68px] text-right"
                                onBlur={(e) => {
                                  const raw = e.target.value;
                                  const v = raw === '' ? 0 : (Number(raw) || 0);
                                  const prev = plannedMap.get(`${g.group}|${mi + 1}`) ?? 0;
                                  if (Math.round(v) !== Math.round(prev)) setBudget.mutate({ group: g.group, month: mi + 1, amount: v });
                                }}
                              />
                            </TableCell>
                          ))}
                        </TableRow>
                        <TableRow className="bg-muted/20">
                          <TableCell className="text-[10px] py-1 sticky left-0 bg-muted/20 text-muted-foreground">real</TableCell>
                          {g.actual.map((v, mi) => <TableCell key={mi} className="text-[10px] text-right font-mono py-1 text-muted-foreground">{v > 0 ? fmtShort(v) : '—'}</TableCell>)}
                        </TableRow>
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
