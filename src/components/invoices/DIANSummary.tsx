import { useMemo, useState, useEffect } from 'react';
import { Invoice } from '@/types/invoice';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, TrendingUp, TrendingDown, ShoppingCart, DollarSign } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend,
} from 'recharts';

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

const COLORS = {
  ventas: 'hsl(142, 71%, 45%)',
  compras: 'hsl(0, 84%, 60%)',
  iva: 'hsl(217, 91%, 60%)',
  reteica: 'hsl(280, 67%, 56%)',
  autorretefuente: 'hsl(32, 95%, 55%)',
};

const PIE_COLORS = [COLORS.ventas, COLORS.compras, COLORS.iva, COLORS.reteica, COLORS.autorretefuente];

interface Props {
  invoices: Invoice[];
}

interface MonthData {
  month: string;
  monthLabel: string;
  ventasBase: number;
  ventasIva: number;
  ventasReteica: number;
  ventasAutoretefuente: number;
  comprasBase: number;
  comprasIva: number;
  comprasRetefuente: number;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-lg text-xs space-y-1">
      <p className="font-semibold text-foreground">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium text-foreground">{formatCurrency(entry.value)}</span>
        </div>
      ))}
    </div>
  );
};

export default function DIANSummary({ invoices }: Props) {
  const [retefuenteCompraRate, setRetefuenteCompraRate] = useState(0);

  useEffect(() => {
    supabase.from('tax_settings').select('retefuente_compra_rate').limit(1).maybeSingle()
      .then(({ data }) => {
        if (data) setRetefuenteCompraRate(data.retefuente_compra_rate || 0);
      });
  }, []);

  const summaryByMonth = useMemo(() => {
    const map = new Map<string, MonthData>();
    for (const inv of invoices) {
      const d = parseISO(inv.issue_date);
      const key = format(d, 'yyyy-MM');
      const label = format(d, 'MMM yy', { locale: es });
      if (!map.has(key)) {
        map.set(key, {
          month: key, monthLabel: label.charAt(0).toUpperCase() + label.slice(1),
          ventasBase: 0, ventasIva: 0, ventasReteica: 0, ventasAutoretefuente: 0,
          comprasBase: 0, comprasIva: 0, comprasRetefuente: 0,
        });
      }
      const s = map.get(key)!;
      if (inv.type === 'venta') {
        s.ventasBase += inv.subtotal_base;
        s.ventasIva += inv.iva_amount;
        s.ventasReteica += inv.reteica_amount || 0;
        s.ventasAutoretefuente += inv.autoretefuente_amount || 0;
      } else {
        s.comprasBase += inv.subtotal_base;
        s.comprasIva += inv.iva_amount;
        s.comprasRetefuente += Math.round(inv.subtotal_base * retefuenteCompraRate);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [invoices, retefuenteCompraRate]);

  const totals = useMemo(() => {
    return summaryByMonth.reduce((acc, s) => ({
      ventas: acc.ventas + s.ventasBase,
      compras: acc.compras + s.comprasBase,
      ivaGenerado: acc.ivaGenerado + s.ventasIva,
      ivaDescontable: acc.ivaDescontable + s.comprasIva,
      reteica: acc.reteica + s.ventasReteica,
      autorretefuente: acc.autorretefuente + s.ventasAutoretefuente,
    }), { ventas: 0, compras: 0, ivaGenerado: 0, ivaDescontable: 0, reteica: 0, autorretefuente: 0 });
  }, [summaryByMonth]);

  const pieData = useMemo(() => [
    { name: 'IVA Generado', value: totals.ivaGenerado },
    { name: 'IVA Descontable', value: totals.ivaDescontable },
    { name: 'ReteICA', value: totals.reteica },
    { name: 'Autorretefuente', value: totals.autorretefuente },
  ].filter(d => d.value > 0), [totals]);

  if (invoices.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="font-medium">Sin datos para el resumen DIAN</p>
          <p className="text-sm mt-1">Confirma al menos una factura para ver el resumen fiscal.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Ventas</CardTitle>
            <TrendingUp className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-success">{formatCurrency(totals.ventas)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Compras</CardTitle>
            <ShoppingCart className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-destructive">{formatCurrency(totals.compras)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">IVA Neto</CardTitle>
            <DollarSign className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-primary">{formatCurrency(totals.ivaGenerado - totals.ivaDescontable)}</div>
            <p className="text-[10px] text-muted-foreground">Generado - Descontable</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Retenciones</CardTitle>
            <TrendingDown className="h-4 w-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-warning">{formatCurrency(totals.reteica + totals.autorretefuente)}</div>
            <p className="text-[10px] text-muted-foreground">ReteICA + Autorretefuente</p>
          </CardContent>
        </Card>
      </div>

      {/* Bar chart: Ventas vs Compras */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Base Gravable Facturada por Mes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summaryByMonth} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                <YAxis tickFormatter={(v) => `$${(v / 1e6).toFixed(0)}M`} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                <RechartsTooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="ventasBase" name="Ventas" fill={COLORS.ventas} radius={[4, 4, 0, 0]} />
                <Bar dataKey="comprasBase" name="Compras" fill={COLORS.compras} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Line chart: IVA + Retenciones */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">IVA y Retenciones por Mes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={summaryByMonth}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                  <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                  <YAxis tickFormatter={(v) => `$${(v / 1e6).toFixed(1)}M`} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                  <RechartsTooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="ventasIva" name="IVA Generado" stroke={COLORS.iva} strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="comprasIva" name="IVA Descontable" stroke={COLORS.compras} strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="ventasReteica" name="ReteICA" stroke={COLORS.reteica} strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="ventasAutoretefuente" name="Autorretefuente" stroke={COLORS.autorretefuente} strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Pie chart: Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Distribución de Obligaciones</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={{ strokeWidth: 1 }}
                  >
                    {pieData.map((_, index) => (
                      <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip formatter={(value: number) => formatCurrency(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
