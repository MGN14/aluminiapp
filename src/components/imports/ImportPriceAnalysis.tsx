import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight, AlertCircle, LineChart } from 'lucide-react';
import { useReferenceCostHistory, type RefCostSeries } from '@/hooks/useReferenceCostHistory';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';

const fmtCop = (n: number | null | undefined) =>
  n === null || n === undefined ? '—'
    : new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground text-xs">—</span>;
  const Icon = pct > 0.5 ? TrendingUp : pct < -0.5 ? TrendingDown : Minus;
  const color = pct > 0.5 ? 'text-destructive' : pct < -0.5 ? 'text-success' : 'text-muted-foreground';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
      <Icon className="h-3.5 w-3.5" />
      {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
    </span>
  );
}

function SeriesRow({ s }: { s: RefCostSeries }) {
  const [open, setOpen] = useState(false);
  const multi = s.points.length > 1;
  return (
    <>
      <TableRow className={multi ? 'cursor-pointer hover:bg-muted/40' : ''} onClick={() => multi && setOpen(!open)}>
        <TableCell className="text-xs font-mono">
          <div className="flex items-center gap-1">
            {multi ? (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : <span className="w-3.5" />}
            {s.reference}
          </div>
          {s.descripcion && <div className="text-[10px] text-muted-foreground ml-4.5 truncate max-w-[200px]">{s.descripcion}</div>}
        </TableCell>
        <TableCell className="text-center text-xs">{s.points.length}</TableCell>
        <TableCell className="text-right text-xs font-mono">{fmtCop(s.first.landed_unit_cop)}</TableCell>
        <TableCell className="text-right text-xs font-mono font-semibold">{fmtCop(s.last.landed_unit_cop)}</TableCell>
        <TableCell className="text-right"><DeltaBadge pct={s.delta_total_pct} /></TableCell>
        <TableCell className="text-right text-xs text-muted-foreground">
          {s.last.fecha ? format(parseLocalDate(s.last.fecha), 'MMM yyyy', { locale: es }) : '—'}
        </TableCell>
      </TableRow>
      {open && multi && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/20 p-0">
            <div className="px-6 py-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] h-7">Fecha</TableHead>
                    <TableHead className="text-[10px] h-7">Proveedor</TableHead>
                    <TableHead className="text-[10px] h-7 text-right">SMM USD/t</TableHead>
                    <TableHead className="text-[10px] h-7 text-right">TRM</TableHead>
                    <TableHead className="text-[10px] h-7 text-right">Landed unit.</TableHead>
                    <TableHead className="text-[10px] h-7 text-right">Δ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.points.map((p, i) => (
                    <TableRow key={p.import_id + i}>
                      <TableCell className="text-[11px] py-1">{p.fecha ? format(parseLocalDate(p.fecha), 'dd MMM yyyy', { locale: es }) : '—'}</TableCell>
                      <TableCell className="text-[11px] py-1 truncate max-w-[140px]">{p.proveedor}</TableCell>
                      <TableCell className="text-[11px] py-1 text-right font-mono">{p.smm_usd_ton ? `$${p.smm_usd_ton.toLocaleString('en-US')}` : '—'}</TableCell>
                      <TableCell className="text-[11px] py-1 text-right font-mono">{p.trm > 0 ? `$${p.trm.toLocaleString('es-CO', { maximumFractionDigits: 0 })}` : '—'}</TableCell>
                      <TableCell className="text-[11px] py-1 text-right font-mono font-medium">{fmtCop(p.landed_unit_cop)}</TableCell>
                      <TableCell className="text-[11px] py-1 text-right"><DeltaBadge pct={p.delta_unit_pct} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function ImportPriceAnalysis() {
  const { data: series, isLoading } = useReferenceCostHistory();

  const kpis = useMemo(() => {
    const list = series ?? [];
    const withHistory = list.filter((s) => s.points.length > 1 && s.delta_total_pct !== null);
    const avgDelta = withHistory.length > 0
      ? withHistory.reduce((acc, s) => acc + (s.delta_total_pct ?? 0), 0) / withHistory.length
      : null;
    const sorted = [...withHistory].sort((a, b) => (b.delta_total_pct ?? 0) - (a.delta_total_pct ?? 0));
    return {
      refsTotal: list.length,
      refsConHistorial: withHistory.length,
      avgDelta,
      masSubio: sorted[0] ?? null,
      masBajo: sorted[sorted.length - 1] ?? null,
    };
  }, [series]);

  if (isLoading) {
    return <div className="text-center py-12 text-muted-foreground text-sm">Calculando histórico de costos…</div>;
  }

  if (!series || series.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="flex flex-col items-center gap-2">
            <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-muted-foreground text-sm max-w-sm">
              Todavía no hay referencias costeadas. Cargá el packing list y los costos de una importación
              (editá un pedido → "Costeo referencia a referencia") para ver acá la variación de precios.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground">Referencias costeadas</p>
            <p className="text-xl font-bold mt-1">{kpis.refsTotal}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{kpis.refsConHistorial} con 2+ desembarcos</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground">Variación promedio</p>
            <div className="mt-1"><span className="text-xl font-bold"><DeltaBadge pct={kpis.avgDelta} /></span></div>
            <p className="text-[10px] text-muted-foreground mt-0.5">costo unitario landed</p>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground">Más subió</p>
            <p className="text-sm font-bold font-mono mt-1 truncate">{kpis.masSubio?.reference ?? '—'}</p>
            {kpis.masSubio && <DeltaBadge pct={kpis.masSubio.delta_total_pct} />}
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground">Más bajó</p>
            <p className="text-sm font-bold font-mono mt-1 truncate">{kpis.masBajo?.reference ?? '—'}</p>
            {kpis.masBajo && <DeltaBadge pct={kpis.masBajo.delta_total_pct} />}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <LineChart className="h-4 w-4 text-primary" />
            Variación de costo por referencia
            <Badge variant="outline" className="text-[10px] ml-1">landed cost en COP</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/80">
                  <TableHead className="font-semibold text-xs">Referencia</TableHead>
                  <TableHead className="font-semibold text-xs text-center">Desembarcos</TableHead>
                  <TableHead className="font-semibold text-xs text-right">Primero</TableHead>
                  <TableHead className="font-semibold text-xs text-right">Último</TableHead>
                  <TableHead className="font-semibold text-xs text-right">Δ total</TableHead>
                  <TableHead className="font-semibold text-xs text-right">Última compra</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {series.map((s) => <SeriesRow key={s.reference} s={s} />)}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
