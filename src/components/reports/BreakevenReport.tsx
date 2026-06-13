import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Target, Info, Gauge, ShieldCheck, TrendingDown } from 'lucide-react';
import { useBreakeven } from '@/hooks/useBreakeven';
import { usePermissions } from '@/hooks/usePermissions';

const fmt = (v: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Math.round(v));
const now = new Date();
const YEARS = Array.from({ length: 4 }, (_, i) => now.getFullYear() - 2 + i);

export default function BreakevenReport() {
  const [year, setYear] = useState(now.getFullYear());
  const { data, isLoading, setBehavior } = useBreakeven(year);
  const { canEdit } = usePermissions();
  const editable = canEdit('punto_equilibrio');

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center"><Target className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Punto de equilibrio</h1>
            <p className="text-sm text-muted-foreground">Cuánto tenés que vender para no perder, y cuánto te deja cada peso vendido.</p>
          </div>
        </div>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>{YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {isLoading || !data ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Calculando…</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="border-0 shadow-sm"><CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Gauge className="h-3 w-3" /> Margen de contribución</p>
              <p className="text-lg font-bold tabular-nums mt-1">{fmt(data.result.margenContribucion)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{data.result.ratioContribucionPct !== null ? `${data.result.ratioContribucionPct.toFixed(1)}% de las ventas` : '—'}</p>
            </CardContent></Card>
            <Card className="border-0 shadow-sm"><CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Target className="h-3 w-3" /> Punto de equilibrio</p>
              <p className="text-lg font-bold tabular-nums mt-1 text-primary">{data.result.puntoEquilibrio !== null ? fmt(data.result.puntoEquilibrio) : '—'}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">ventas acumuladas para no perder</p>
            </CardContent></Card>
            <Card className="border-0 shadow-sm"><CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Margen de seguridad</p>
              <p className={cn('text-lg font-bold tabular-nums mt-1', (data.result.margenSeguridadPct ?? 0) >= 0 ? 'text-success' : 'text-destructive')}>
                {data.result.margenSeguridadPct !== null ? `${data.result.margenSeguridadPct.toFixed(1)}%` : '—'}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">colchón antes de pérdida</p>
            </CardContent></Card>
            <Card className="border-0 shadow-sm"><CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3 w-3" /> Punto eq. mensual</p>
              <p className="text-lg font-bold tabular-nums mt-1">{data.result.puntoEquilibrio !== null ? fmt(data.result.puntoEquilibrio / data.monthsWithData) : '—'}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">promedio sobre {data.monthsWithData} mes(es) con datos</p>
            </CardContent></Card>
          </div>

          {/* Resumen ventas / CV / CF */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Cómo se arma (año {year})</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableBody>
                  <TableRow><TableCell className="text-sm py-2">Ventas</TableCell><TableCell className="text-sm text-right font-mono py-2">{fmt(data.ventas)}</TableCell></TableRow>
                  <TableRow><TableCell className="text-sm py-2">− Costos variables</TableCell><TableCell className="text-sm text-right font-mono py-2 text-muted-foreground">{fmt(data.costosVariables)}</TableCell></TableRow>
                  <TableRow className="bg-muted/30 font-semibold"><TableCell className="text-sm py-2">= Margen de contribución</TableCell><TableCell className="text-sm text-right font-mono py-2">{fmt(data.result.margenContribucion)}</TableCell></TableRow>
                  <TableRow><TableCell className="text-sm py-2">− Costos fijos</TableCell><TableCell className="text-sm text-right font-mono py-2 text-muted-foreground">{fmt(data.costosFijos)}</TableCell></TableRow>
                  <TableRow className="bg-muted/40 font-bold"><TableCell className="text-sm py-2">= Utilidad</TableCell><TableCell className={cn('text-sm text-right font-mono py-2', data.result.utilidad >= 0 ? 'text-success' : 'text-destructive')}>{fmt(data.result.utilidad)}</TableCell></TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {data.ventas === 0 ? (
            <p className="text-[11px] text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-2 flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Aún no hay ventas registradas en {year}. El punto de equilibrio aparece cuando haya ingresos para calcular el margen de contribución.
            </p>
          ) : data.result.puntoEquilibrio === null && (
            <p className="text-[11px] text-destructive bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2 flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              No hay punto de equilibrio: los costos variables se comen toda la venta (margen de contribución ≤ 0). Revisá la clasificación abajo o tus precios/costos.
            </p>
          )}

          {/* Clasificación fijo/variable */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                Clasificá tus costos
                {(() => {
                  const sinConfirmar = data.categories.filter((c) => c.isInferred && !c.id.startsWith('__')).length;
                  return sinConfirmar > 0
                    ? <span className="text-[10px] font-semibold text-amber-600 border border-amber-500/40 rounded px-1.5 py-0.5">{sinConfirmar} sin confirmar</span>
                    : null;
                })()}
              </CardTitle>
              <p className="text-[11px] text-muted-foreground">Variable = sube con las ventas (mercancía, comisiones, fletes). Fijo = lo pagás vendas o no (arriendo, nómina admin). Las marcadas <em>auto</em> usan un default — confirmalas para un punto de equilibrio confiable.</p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/60">
                      <TableHead className="text-xs">Categoría</TableHead>
                      <TableHead className="text-xs text-right">Total año</TableHead>
                      <TableHead className="text-xs w-32">Comportamiento</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.categories.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm py-2">{c.name}</TableCell>
                        <TableCell className="text-sm text-right font-mono py-2">{fmt(c.total)}</TableCell>
                        <TableCell className="py-1">
                          {c.id.startsWith('__') ? (
                            <span className="text-[11px] text-muted-foreground">{c.behavior} (auto)</span>
                          ) : (
                            <Select value={c.behavior} disabled={!editable}
                              onValueChange={(v) => setBehavior.mutate({ categoryId: c.id, behavior: v as 'fijo' | 'variable' })}>
                              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="variable" className="text-xs">Variable</SelectItem>
                                <SelectItem value="fijo" className="text-xs">Fijo</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                          {c.isInferred && !c.id.startsWith('__') && <span className="block text-[9px] text-amber-600">auto — confirmá</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Es vista gerencial (base caja, mismo criterio que el Estado de Resultados). El punto de equilibrio es del año; el mensual es el promedio para no perder. Ajustá la clasificación fijo/variable para afinar el cálculo.
          </p>
        </>
      )}
    </div>
  );
}
