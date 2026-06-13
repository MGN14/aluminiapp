import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Coins, Package, Users, AlertCircle, TrendingUp, Info } from 'lucide-react';
import { useProfitability } from '@/hooks/useProfitability';
import type { ProfitRow } from '@/lib/profitability';

const fmt = (v: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Math.round(v));
const now = new Date();
const YEARS = Array.from({ length: 4 }, (_, i) => now.getFullYear() - 2 + i);

function marginColor(pct: number | null): string {
  if (pct === null) return 'text-muted-foreground';
  if (pct >= 20) return 'text-success';
  if (pct >= 8) return 'text-amber-600';
  return 'text-destructive';
}

function RankTable({ rows, icon: Icon, title, labelHeader }: {
  rows: ProfitRow[]; icon: React.ComponentType<{ className?: string }>; title: string; labelHeader: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, 10);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2"><Icon className="h-4 w-4 text-primary" />{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60">
                <TableHead className="text-xs">{labelHeader}</TableHead>
                <TableHead className="text-xs text-right">Ingreso</TableHead>
                <TableHead className="text-xs text-right">Costo</TableHead>
                <TableHead className="text-xs text-right">Margen</TableHead>
                <TableHead className="text-xs text-right">Margen %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="text-sm py-2">
                    <span className="truncate block max-w-[220px]">{r.label}</span>
                    {!r.costoCompleto && (
                      <span className="text-[10px] text-amber-600 flex items-center gap-1"><AlertCircle className="h-3 w-3" />falta costo de alguna referencia</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-right font-mono py-2">{fmt(r.ingreso)}</TableCell>
                  <TableCell className="text-sm text-right font-mono py-2 text-muted-foreground">{fmt(r.costo)}</TableCell>
                  <TableCell className={cn('text-sm text-right font-mono font-semibold py-2', r.margen >= 0 ? '' : 'text-destructive')}>{fmt(r.margen)}</TableCell>
                  <TableCell className={cn('text-sm text-right font-mono font-semibold py-2', marginColor(r.margenPct))}>
                    {r.margenPct === null ? '—' : `${r.margenPct.toFixed(1)}%`}
                    {r.margenPct !== null && r.margenPct < -100 && (
                      <span className="block text-[9px] text-destructive" title="El costo supera al doble del ingreso. Revisá el cost_per_unit de esta referencia en Inventarios.">⚠ revisá el costo</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {rows.length > 10 && (
          <button onClick={() => setShowAll(!showAll)} className="text-xs text-primary hover:underline w-full py-2 border-t">
            {showAll ? 'Ver menos' : `Ver los ${rows.length}`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

export default function ProfitabilityReport() {
  const [year, setYear] = useState(now.getFullYear());
  const { data, isLoading } = useProfitability(year);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center"><Coins className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Rentabilidad</h1>
            <p className="text-sm text-muted-foreground">Margen real por producto y por cliente — no solo quién factura más, sino quién deja más plata.</p>
          </div>
        </div>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>{YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {isLoading || !data ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Calculando márgenes…</div>
      ) : data.byReference.length === 0 && data.byClient.length === 0 ? (
        <Card><CardContent className="py-12 text-center">
          <Package className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            No hay facturas de venta con detalle de líneas en {year}. La rentabilidad se calcula de las líneas de factura (referencia + cantidad) que llegan de Siigo o del PDF, cruzadas con el costo del inventario.
          </p>
        </CardContent></Card>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="border-0 shadow-sm"><CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground">Ingreso (base)</p>
              <p className="text-lg font-bold tabular-nums mt-1">{fmt(data.totals.ingreso)}</p>
            </CardContent></Card>
            <Card className="border-0 shadow-sm"><CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground">Costo</p>
              <p className="text-lg font-bold tabular-nums mt-1 text-muted-foreground">{fmt(data.totals.costo)}</p>
            </CardContent></Card>
            <Card className="border-0 shadow-sm"><CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground">Margen bruto</p>
              <p className={cn('text-lg font-bold tabular-nums mt-1', data.totals.margen >= 0 ? 'text-success' : 'text-destructive')}>{fmt(data.totals.margen)}</p>
            </CardContent></Card>
            <Card className="border-0 shadow-sm"><CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">Margen % <TrendingUp className="h-3 w-3" /></p>
              <p className={cn('text-lg font-bold tabular-nums mt-1', marginColor(data.totals.margenPct))}>
                {data.totals.margenPct === null ? '—' : `${data.totals.margenPct.toFixed(1)}%`}
              </p>
            </CardContent></Card>
          </div>

          {data.totals.refsSinCosto > 0 && (
            <p className="text-[11px] text-amber-600 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2 flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {data.totals.refsSinCosto} referencia(s) vendida(s) no tienen costo cargado en inventario, así que su margen no se calcula (no se asume costo 0). Cargá su costo en Inventarios o traelo de Siigo para un margen completo.
            </p>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            <RankTable key={`ref-${year}`} rows={data.byReference} icon={Package} title="Por referencia" labelHeader="Referencia" />
            <RankTable key={`cli-${year}`} rows={data.byClient} icon={Users} title="Por cliente" labelHeader="Cliente" />
          </div>

          <div className="text-[11px] text-muted-foreground space-y-1">
            <p className="flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Ingreso = base gravable (sin IVA). Costo = cantidad vendida × costo unitario del inventario. Es <strong>margen bruto</strong>, antes de gastos operativos. Asume que la unidad de venta y la de costo son la misma (ej. ambas por unidad o ambas por kg); si vendés en una unidad y costeás en otra, el margen de esa referencia no es exacto.
            </p>
            <p>Semáforo del margen %: <span className="text-success font-medium">verde ≥20%</span>, <span className="text-amber-600 font-medium">ámbar ≥8%</span>, <span className="text-destructive font-medium">rojo &lt;8%</span> — umbrales orientativos de margen bruto, ajustá tu propio criterio.</p>
          </div>
        </>
      )}
    </div>
  );
}
