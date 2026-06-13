import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { GitCompare, Upload, Trash2, Info, AlertTriangle } from 'lucide-react';
import { useExternalTrialBalance } from '@/hooks/useExternalTrialBalance';
import { useFinancialActuals } from '@/hooks/useFinancialActuals';
import TrialBalanceImport from './TrialBalanceImport';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';
import { MONTH_NAMES } from '@/types/transaction';

const fmt = (v: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Math.round(v));

/**
 * Comparativo del Estado de Resultados: el PYG de Siigo (importado del balance
 * de prueba clases 4-7) vs el PYG derivado de la app, alineado al mismo
 * período (enero → mes de corte del archivo de Siigo).
 */
export default function PnlCompare() {
  const { data, isLoading, importBalance, clearBalance } = useExternalTrialBalance();
  const [showImport, setShowImport] = useState(false);

  // Período de corte tomado del snapshot del PYG de Siigo (ej. "a Mayo" → 5).
  // Si el usuario no cargó la fecha de corte, NO asumimos diciembre: dejamos
  // la columna App sin alinear y avisamos (comparar año completo vs parcial
  // sería engañoso).
  const snap = data?.pnlSnapshotDate ? parseLocalDate(data.pnlSnapshotDate) : null;
  const year = snap ? snap.getFullYear() : new Date().getFullYear();
  const monthCut = snap ? snap.getMonth() + 1 : null; // null = sin fecha de corte

  const actuals = useFinancialActuals(year);

  // App acumulado enero → mes de corte (mismo período que Siigo).
  const app = useMemo(() => {
    const a = actuals.data;
    if (!a || monthCut === null) return null;
    const sum = (arr: number[]) => arr.slice(0, monthCut).reduce((s, v) => s + v, 0);
    const ingresos = sum(a.byGroup.ingresos);
    const costos = sum(a.byGroup.costos_operacionales);
    const gastos = sum(a.byGroup.gastos_operativos);
    const impuestos = sum(a.byGroup.impuestos);
    return { ingresos, costos, gastos, impuestos, utilidad: ingresos - costos - gastos - impuestos };
  }, [actuals.data, monthCut]);

  if (isLoading) return null;

  if (!data?.hasPnl) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-6 text-center space-y-2">
          <GitCompare className="h-7 w-7 text-muted-foreground/50 mx-auto" />
          <p className="text-sm font-medium">Comparar con el Estado de Resultados de Siigo</p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Importá el Estado de resultado integral de Siigo (mismo archivo: código de cuenta + saldo) y lo ponemos lado a lado con el PYG de la app, alineado al mismo período.
          </p>
          <Button size="sm" onClick={() => setShowImport(true)} className="gap-1.5 mt-1">
            <Upload className="h-3.5 w-3.5" /> Importar Estado de Resultados de Siigo
          </Button>
        </CardContent>
        <TrialBalanceImport open={showImport} onOpenChange={setShowImport}
          onConfirm={(rows, s) => importBalance.mutate({ rows, snapshotDate: s })} />
      </Card>
    );
  }

  const s = data.pnl;
  const a = app;

  const Row = ({ label, sv, av, bold, noFlag, note }: { label: string; sv: number; av: number; bold?: boolean; noFlag?: boolean; note?: string }) => {
    const diff = av - sv;
    const rel = sv !== 0 ? Math.abs(diff) / Math.abs(sv) : (av !== 0 ? 1 : 0);
    const material = Math.abs(diff) >= 100_000 && rel > 0.05;
    const color = noFlag || !material ? 'text-muted-foreground' : 'text-destructive';
    return (
      <TableRow className={bold ? 'bg-muted/40 font-semibold' : ''}>
        <TableCell className="text-sm py-2">{label}{note && <span className="block text-[10px] text-muted-foreground font-normal">{note}</span>}</TableCell>
        <TableCell className="text-sm text-right font-mono py-2">{fmt(sv)}</TableCell>
        <TableCell className="text-sm text-right font-mono py-2">{a ? fmt(av) : '—'}</TableCell>
        <TableCell className={`text-sm text-right font-mono py-2 ${color}`}>{a ? `${diff >= 0 ? '' : '−'}${fmt(Math.abs(diff))}` : '—'}</TableCell>
      </TableRow>
    );
  };

  // Análisis automático.
  const siigoSinCosto = s.costos_venta < s.ingresos * 0.02; // costo de ventas ~0
  const appTieneCosto = (a?.costos ?? 0) > 0;
  const margenSiigo = s.ingresos > 0 ? (s.utilidad / s.ingresos) * 100 : null;
  const margenApp = a && a.ingresos > 0 ? (a.utilidad / a.ingresos) * 100 : null;

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-primary" /> Estado de Resultados: Siigo vs App
          </CardTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {monthCut !== null
              ? <>Período {MONTH_NAMES[0]}–{MONTH_NAMES[monthCut - 1]} {year}{data.pnlSnapshotDate && ` · Siigo al ${format(parseLocalDate(data.pnlSnapshotDate), 'dd MMM', { locale: es })}`}</>
              : 'Sin fecha de corte — reimportá indicando la fecha para alinear el período'}
          </p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowImport(true)}><Upload className="h-3.5 w-3.5" /> Reimportar</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground hover:text-destructive" onClick={() => { if (window.confirm('¿Borrar el Estado de Resultados de Siigo cargado? (no afecta el Balance)')) clearBalance.mutate('pnl'); }}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60">
                <TableHead className="text-xs">Concepto</TableHead>
                <TableHead className="text-xs text-right">Siigo</TableHead>
                <TableHead className="text-xs text-right">App</TableHead>
                <TableHead className="text-xs text-right">Diferencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <Row label="Ingresos (neto de devoluciones)" sv={s.ingresos} av={a?.ingresos ?? 0} />
              <Row label="Costo de ventas" sv={s.costos_venta} av={a?.costos ?? 0}
                noFlag note={siigoSinCosto ? 'Siigo no está costeando ventas' : undefined} />
              <Row label="Gastos operativos" sv={s.gastos} av={a?.gastos ?? 0} />
              <Row label="Impuestos" sv={s.impuestos} av={a?.impuestos ?? 0} noFlag />
              <Row label="Utilidad / resultado" sv={s.utilidad} av={a?.utilidad ?? 0} bold noFlag />
            </TableBody>
          </Table>
        </div>

        {/* Análisis */}
        <div className="p-3 space-y-2 border-t">
          {siigoSinCosto && (
            <p className="text-[11px] text-amber-700 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2 flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span><strong>Siigo no está costeando las ventas</strong> (costo de ventas ≈ $0). Por eso su utilidad de {fmt(s.utilidad)} está inflada: no le resta el costo del aluminio que vendiste. {appTieneCosto ? `La app sí estima un costo de ${fmt(a!.costos)} → su utilidad de ${fmt(a!.utilidad)} es más cercana a la real.` : 'Cargá el costo de tu inventario para ver la utilidad real.'}</span>
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-md border border-border/60 px-2.5 py-1.5">
              <p className="text-muted-foreground">Margen Siigo</p>
              <p className="font-mono font-semibold">{margenSiigo === null ? '—' : `${margenSiigo.toFixed(1)}%`}</p>
            </div>
            <div className="rounded-md border border-border/60 px-2.5 py-1.5">
              <p className="text-muted-foreground">Margen App</p>
              <p className="font-mono font-semibold">{margenApp === null ? '—' : `${margenApp.toFixed(1)}%`}</p>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Siigo es contabilidad por causación (devengado); la app calcula por caja (lo que entró/salió del banco). Algunas diferencias son por esa metodología, no por error. La app no liquida impuestos de renta, por eso ahí no la marca.
          </p>
        </div>
      </CardContent>
      <TrialBalanceImport open={showImport} onOpenChange={setShowImport}
        onConfirm={(rows, sd) => importBalance.mutate({ rows, snapshotDate: sd })} />
    </Card>
  );
}
