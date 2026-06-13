import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { Link } from 'react-router-dom';
import { Scale, Info, ArrowRight, TrendingUp, Gauge, Wallet, Landmark } from 'lucide-react';
import { useBalanceSheet } from '@/hooks/useBalanceSheet';
import { semaforoRazonCorriente, semaforoEndeudamiento, type Semaforo } from '@/lib/balanceSheet';
import TrialBalanceCompare from '@/components/reports/TrialBalanceCompare';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Math.round(v));

const DOT: Record<Semaforo, string> = { green: 'bg-success', yellow: 'bg-amber-500', red: 'bg-destructive' };

function RatioCard({ icon: Icon, label, value, hint, semaforo }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string; hint: string; semaforo?: Semaforo;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">{label}</p>
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          {semaforo && <span className={`h-2 w-2 rounded-full ${DOT[semaforo]}`} />}
          <p className="text-lg font-bold tabular-nums leading-none">{value}</p>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">{hint}</p>
      </CardContent>
    </Card>
  );
}

function Section({ title, lines, total, totalLabel, sources }: {
  title: string; lines: { key: string; label: string; value: number }[]; total: number; totalLabel: string; sources: Record<string, string>;
}) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{title}</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.key}>
                <TableCell className="text-sm py-2">
                  {l.label}
                  {sources[l.key] && <span className="block text-[10px] text-muted-foreground">{sources[l.key]}</span>}
                </TableCell>
                <TableCell className="text-sm text-right font-mono py-2">{fmt(l.value)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-bold">
              <TableCell className="text-sm py-2">{totalLabel}</TableCell>
              <TableCell className="text-sm text-right font-mono py-2">{fmt(total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function BalanceSheetReport() {
  const { data, isLoading } = useBalanceSheet();

  if (isLoading) return <div className="text-center py-12 text-muted-foreground text-sm">Armando el balance…</div>;
  if (!data) return null;

  if (!data.isConfigured) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Scale className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Para armar el Balance General necesitás cargar tu <strong>Estado financiero inicial</strong> (saldos al día
            que arrancaste con AluminIA). Andá a Ajustes → Estado financiero inicial.
          </p>
          <Link to="/settings" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline mt-3">
            Ir a Ajustes <ArrowRight className="h-3 w-3" />
          </Link>
        </CardContent>
      </Card>
    );
  }

  const r = data.ratios;
  const descuadreSignificativo = data.total_activos > 0 && Math.abs(data.descuadre) / data.total_activos > 0.02;

  return (
    <div className="space-y-5">
      {/* Encabezado */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
          <Scale className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Balance General</h2>
          <p className="text-xs text-muted-foreground">
            A hoy {data.fechaInicio && `· desde ${format(parseLocalDate(data.fechaInicio), 'dd MMM yyyy', { locale: es })}`} · derivado de tu operación
          </p>
        </div>
      </div>

      {/* Ratios */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <RatioCard icon={Gauge} label="Razón corriente" value={r.razon_corriente !== null ? `${r.razon_corriente.toFixed(2)}×` : '—'}
          hint="Activo corriente / Pasivo corriente (deuda de créditos excluida)" semaforo={semaforoRazonCorriente(r.razon_corriente)} />
        <RatioCard icon={Wallet} label="Capital de trabajo" value={fmt(r.capital_trabajo)} hint="Lo que te queda tras cubrir el corto plazo" />
        <RatioCard icon={Landmark} label="Endeudamiento" value={r.endeudamiento_pct !== null ? `${r.endeudamiento_pct.toFixed(0)}%` : '—'}
          hint="Pasivo / Activo" semaforo={semaforoEndeudamiento(r.endeudamiento_pct)} />
        <RatioCard icon={TrendingUp} label="Prueba ácida" value={r.prueba_acida !== null ? `${r.prueba_acida.toFixed(2)}×` : '—'}
          hint="Liquidez sin contar inventario" />
      </div>

      {/* Activos / Pasivos */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Activos" lines={data.activos.filter((l) => l.value !== 0)} total={data.total_activos} totalLabel="Total activos" sources={data.sources} />
        <div className="space-y-4">
          <Section title="Pasivos" lines={data.pasivos.filter((l) => l.value !== 0)} total={data.total_pasivos} totalLabel="Total pasivos" sources={data.sources} />
          <Card className="border-primary/20">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Patrimonio</p>
                <p className="text-[11px] text-muted-foreground">Activos − Pasivos = cuánto vale tu empresa</p>
              </div>
              <p className="text-xl font-bold text-primary tabular-nums">{fmt(data.patrimonio)}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Comparativo contra el balance contable de Siigo */}
      <TrialBalanceCompare appSheet={data} />

      {/* Validación de cuadre */}
      <Card className={descuadreSignificativo ? 'border-amber-500/40 bg-amber-500/5' : 'border-success/30 bg-success/5'}>
        <CardContent className="p-4">
          <div className="flex items-start gap-2">
            <Info className={`h-4 w-4 mt-0.5 shrink-0 ${descuadreSignificativo ? 'text-amber-600' : 'text-success'}`} />
            <div className="text-xs space-y-1">
              <p className="font-medium text-foreground">
                Validación: patrimonio esperado {fmt(data.patrimonio_esperado)} (inicial + resultado acumulado)
                {' '}vs calculado {fmt(data.patrimonio)}.
              </p>
              <p className="text-muted-foreground leading-snug">
                {descuadreSignificativo
                  ? `Hay ${fmt(Math.abs(data.descuadre))} de diferencia (${((Math.abs(data.descuadre) / (data.total_activos || 1)) * 100).toFixed(1)}% de los activos). En un balance derivado esto es normal: refleja ventas/compras a crédito (cartera que aún no es caja), activos fijos no registrados o saldos sin clasificar. No es un error — es una guía de qué te falta cargar. El balance es gerencial, no reemplaza la contabilidad oficial.`
                  : 'El balance cuadra dentro de un margen razonable. Es un balance gerencial derivado de tu operación, no reemplaza la contabilidad oficial firmada.'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
