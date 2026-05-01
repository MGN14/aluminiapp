// Flujo de caja por módulo.
//
// **DIAN**: extractos bancarios (transactions) + facturas confirmadas (panel
//           informativo de CxC/CxP, NO se suman al flujo para evitar doble
//           conteo — un factura cobrada por banco ya aparece como ingreso
//           en transactions).
// **Gerencial**: lo mismo + movimientos en efectivo (cash_movements).
//
// El bug previo: pulsaba `cash_movements` siempre, así que en DIAN se filtraba
// data del módulo gerencial. Ahora `cash_movements` solo se carga si
// `isGerencial`.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useModuleContext } from '@/hooks/useModuleContext';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Loader2, TrendingUp, TrendingDown, Wallet, Info, FileText, Receipt } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const INK = '#1d1d1f';
const INK2 = '#6e6e73';
const INK3 = '#a1a1a6';
const BRAND = 'oklch(0.43 0.14 155)';
const BRAND_BRIGHT = 'oklch(0.60 0.14 155)';
const SUCCESS = 'oklch(0.55 0.16 150)';
const DANGER = 'oklch(0.58 0.21 25)';

import { MONTH_LABELS as MONTH_NAMES } from '@/lib/constants';

function formatCurrency(v: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(v));
}

function formatCurrencyShort(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

interface FlowRow {
  date: string;
  type: string;        // 'ingreso' | 'egreso'
  amount: number;
  source: 'extracto' | 'efectivo';
}

interface MonthAgg {
  ym: string;             // '2026-04'
  label: string;          // 'Abr 2026'
  monthIdx: number;       // 0..11
  year: number;
  ingresos: number;
  egresos: number;
  neto: number;
  saldoInicial: number;
  saldoFinal: number;
}

// Trae transactions (extractos bancarios) — siempre, ambos módulos.
// Solo nos importan las que tienen type='ingreso' o 'egreso' y un amount > 0.
function useBankFlow(userId: string | undefined, year: number) {
  return useQuery({
    queryKey: ['cash-flow-bank', userId, year],
    queryFn: async () => {
      if (!userId) return [] as FlowRow[];
      // Pedimos hasta el final del año actual y todo lo previo, para arrancar
      // con saldo inicial acumulado.
      const { data, error } = await supabase
        .from('transactions')
        .select('date, type, amount')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .lte('date', `${year}-12-31`)
        .in('type', ['ingreso', 'egreso']);
      if (error) throw error;
      return (data ?? [])
        .filter(r => r.amount != null && Number(r.amount) !== 0)
        .map((r): FlowRow => ({
          date: r.date,
          type: r.type as string,
          // En transactions, amount puede venir negativo para egresos según
          // import; absolutizamos y confiamos en `type` para el signo.
          amount: Math.abs(Number(r.amount)),
          source: 'extracto',
        }));
    },
    enabled: !!userId,
  });
}

// Trae cash_movements — SOLO en gerencial. En DIAN devolvemos array vacío
// sin pegarle a la base (esto es lo que arregla el leak).
function useCashFlow(userId: string | undefined, year: number, isGerencial: boolean) {
  return useQuery({
    queryKey: ['cash-flow-cash', userId, year, isGerencial],
    queryFn: async () => {
      if (!userId || !isGerencial) return [] as FlowRow[];
      const { data, error } = await supabase
        .from('cash_movements')
        .select('date, type, amount')
        .eq('user_id', userId)
        .lte('date', `${year}-12-31`);
      if (error) throw error;
      return (data ?? []).map((r): FlowRow => ({
        date: r.date,
        type: r.type as string,
        amount: Number(r.amount),
        source: 'efectivo',
      }));
    },
    enabled: !!userId,
  });
}

// Facturas del año — panel informativo (CxC y CxP).
// No se suman al flujo de caja para evitar doble conteo: una factura cobrada
// por banco ya aparece en transactions como ingreso.
interface InvoiceSummary {
  type: 'venta' | 'compra';
  total: number;
}

function useInvoiceSummary(userId: string | undefined, year: number) {
  return useQuery({
    queryKey: ['cash-flow-invoices', userId, year],
    queryFn: async () => {
      if (!userId) return [] as InvoiceSummary[];
      const { data, error } = await supabase
        .from('invoices')
        .select('type, total_amount, issue_date, status')
        .eq('user_id', userId)
        .eq('status', 'confirmed')
        .gte('issue_date', `${year}-01-01`)
        .lte('issue_date', `${year}-12-31`);
      if (error) throw error;
      const byType = new Map<string, number>();
      for (const inv of (data ?? [])) {
        const t = inv.type as string;
        if (t !== 'venta' && t !== 'compra') continue;
        byType.set(t, (byType.get(t) ?? 0) + Number(inv.total_amount));
      }
      return Array.from(byType.entries()).map(([type, total]) => ({
        type: type as 'venta' | 'compra',
        total,
      }));
    },
    enabled: !!userId,
  });
}

export default function CashFlowReport() {
  const { user } = useAuth();
  const { isGerencial, isDian } = useModuleContext();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  const { data: bankRows, isLoading: loadingBank } = useBankFlow(user?.id, year);
  const { data: cashRows, isLoading: loadingCash } = useCashFlow(user?.id, year, isGerencial);
  const { data: invoiceSummary, isLoading: loadingInvoices } = useInvoiceSummary(user?.id, year);

  const isLoading = loadingBank || loadingCash || loadingInvoices;

  const allRows: FlowRow[] = useMemo(() => {
    const rows = [...(bankRows ?? [])];
    if (isGerencial) rows.push(...(cashRows ?? []));
    return rows;
  }, [bankRows, cashRows, isGerencial]);

  // Agrupa por (year, month) y suma todo lo previo como saldo inicial.
  const aggregates = useMemo<{ months: MonthAgg[]; saldoArranqueAnio: number }>(() => {
    let saldoArranqueAnio = 0;
    const monthMap = new Map<number, { ingresos: number; egresos: number }>();

    for (const r of allRows) {
      const d = new Date(r.date + 'T00:00:00');
      const ry = d.getFullYear();
      const rm = d.getMonth();
      const sign = r.type === 'ingreso' ? 1 : -1;
      const amt = r.amount * sign;

      if (ry < year) {
        saldoArranqueAnio += amt;
      } else if (ry === year) {
        const cur = monthMap.get(rm) ?? { ingresos: 0, egresos: 0 };
        if (r.type === 'ingreso') cur.ingresos += r.amount;
        else cur.egresos += r.amount;
        monthMap.set(rm, cur);
      }
    }

    let saldoCorriente = saldoArranqueAnio;
    const months: MonthAgg[] = [];
    for (let m = 0; m < 12; m++) {
      const agg = monthMap.get(m) ?? { ingresos: 0, egresos: 0 };
      const neto = agg.ingresos - agg.egresos;
      const saldoInicial = saldoCorriente;
      const saldoFinal = saldoInicial + neto;
      months.push({
        ym: `${year}-${String(m + 1).padStart(2, '0')}`,
        label: `${MONTH_NAMES[m].slice(0, 3)} ${String(year).slice(2)}`,
        monthIdx: m,
        year,
        ingresos: agg.ingresos,
        egresos: agg.egresos,
        neto,
        saldoInicial,
        saldoFinal,
      });
      saldoCorriente = saldoFinal;
    }
    return { months, saldoArranqueAnio };
  }, [allRows, year]);

  // Totales del año
  const totals = useMemo(() => {
    return aggregates.months.reduce(
      (acc, m) => ({
        ingresos: acc.ingresos + m.ingresos,
        egresos: acc.egresos + m.egresos,
        neto: acc.neto + m.neto,
      }),
      { ingresos: 0, egresos: 0, neto: 0 },
    );
  }, [aggregates.months]);

  const saldoActual = aggregates.months.length > 0
    ? aggregates.months[aggregates.months.length - 1].saldoFinal
    : aggregates.saldoArranqueAnio;

  const chartData = aggregates.months.map((m) => ({
    name: m.label,
    saldo: m.saldoFinal,
    ingresos: m.ingresos,
    egresos: m.egresos,
  }));

  const yearOptions = [currentYear, currentYear - 1, currentYear - 2];
  const hasData = allRows.length > 0;

  // Facturas: ventas (CxC potencial) y compras (CxP potencial).
  const ventasFact = invoiceSummary?.find(s => s.type === 'venta')?.total ?? 0;
  const comprasFact = invoiceSummary?.find(s => s.type === 'compra')?.total ?? 0;

  // Texto informativo según módulo
  const sourceNote = isGerencial
    ? 'Incluye extractos bancarios + facturas + movimientos en efectivo.'
    : 'Incluye extractos bancarios y facturas confirmadas (vista DIAN).';

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
        <Loader2 style={{ width: 24, height: 24, color: INK3 }} className="animate-spin" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Year selector + module note */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: INK2, fontWeight: 500 }}>Año:</span>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger style={{ height: 36, width: 110, fontSize: 13 }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11.5,
          color: INK3,
          background: 'rgba(0,0,0,0.03)',
          padding: '6px 10px',
          borderRadius: 8,
        }}>
          <Info style={{ width: 13, height: 13 }} />
          {sourceNote}
        </div>
      </div>

      {!hasData ? (
        <Card className="border-0 shadow-sm">
          <CardContent style={{ padding: 40, textAlign: 'center' }}>
            <Wallet style={{ width: 36, height: 36, color: INK3, margin: '0 auto 12px' }} />
            <p style={{ fontSize: 14, color: INK2, margin: 0 }}>
              Aún no hay movimientos para {year}.
            </p>
            <p style={{ fontSize: 12.5, color: INK3, margin: '6px 0 0 0' }}>
              {isDian
                ? 'Subí extractos bancarios o facturas para ver el flujo de caja aquí.'
                : 'Subí extractos, facturas o registrá movimientos en efectivo.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI cards de flujo de caja */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
            <KpiCard
              label="Saldo actual"
              value={saldoActual}
              icon={Wallet}
              tone={saldoActual >= 0 ? 'brand' : 'danger'}
              hint={saldoActual >= 0 ? 'Caja disponible' : 'Caja en negativo'}
            />
            <KpiCard
              label={`Ingresos ${year}`}
              value={totals.ingresos}
              icon={TrendingUp}
              tone="success"
              hint="Entradas de caja"
            />
            <KpiCard
              label={`Egresos ${year}`}
              value={totals.egresos}
              icon={TrendingDown}
              tone="danger"
              hint="Salidas de caja"
            />
            <KpiCard
              label={`Flujo neto ${year}`}
              value={totals.neto}
              icon={totals.neto >= 0 ? TrendingUp : TrendingDown}
              tone={totals.neto >= 0 ? 'success' : 'danger'}
              hint={totals.neto >= 0 ? 'Generaste caja' : 'Consumiste caja'}
            />
          </div>

          {/* Panel informativo de facturas (no se suma — referencia) */}
          {(ventasFact > 0 || comprasFact > 0) && (
            <Card className="border-0 shadow-sm" style={{ background: 'rgba(0,0,0,0.02)' }}>
              <CardContent style={{ padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <FileText style={{ width: 14, height: 14, color: INK2 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: INK, letterSpacing: '-0.1px' }}>
                    Facturación del año {year}
                  </span>
                  <span style={{ fontSize: 10.5, color: INK3 }}>
                    · referencia, no se suma al flujo (evita doble conteo)
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Receipt style={{ width: 16, height: 16, color: SUCCESS }} />
                    <div>
                      <p style={{ fontSize: 10.5, color: INK3, margin: 0, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>
                        Facturas de venta
                      </p>
                      <p style={{ fontSize: 14, fontWeight: 600, color: INK, margin: '2px 0 0 0', fontVariantNumeric: 'tabular-nums' }}>
                        {formatCurrency(ventasFact)}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Receipt style={{ width: 16, height: 16, color: DANGER }} />
                    <div>
                      <p style={{ fontSize: 10.5, color: INK3, margin: 0, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>
                        Facturas de compra
                      </p>
                      <p style={{ fontSize: 14, fontWeight: 600, color: INK, margin: '2px 0 0 0', fontVariantNumeric: 'tabular-nums' }}>
                        {formatCurrency(comprasFact)}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Chart */}
          <Card className="border-0 shadow-sm">
            <CardContent style={{ padding: 20 }}>
              <div style={{ marginBottom: 12 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: INK, margin: 0, letterSpacing: '-0.2px' }}>
                  Saldo acumulado mes a mes
                </h3>
                <p style={{ fontSize: 11.5, color: INK3, margin: '2px 0 0 0' }}>
                  Cómo evolucionó la caja a lo largo de {year}.
                </p>
              </div>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="cashFlowGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={BRAND_BRIGHT} stopOpacity={0.5} />
                        <stop offset="100%" stopColor={BRAND} stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(0,0,0,0.05)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: INK3 }}
                      axisLine={{ stroke: 'rgba(0,0,0,0.08)' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: INK3 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => formatCurrencyShort(v)}
                      width={64}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#fff',
                        border: '1px solid rgba(0,0,0,0.08)',
                        borderRadius: 10,
                        fontSize: 12,
                        boxShadow: '0 4px 14px rgba(0,0,0,0.06)',
                      }}
                      formatter={(value: number, _name: string, props: { dataKey?: string }) => {
                        const labelMap: Record<string, string> = {
                          saldo: 'Saldo',
                          ingresos: 'Ingresos',
                          egresos: 'Egresos',
                        };
                        const k = props.dataKey ?? '';
                        return [formatCurrency(value), labelMap[k] ?? k];
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="saldo"
                      stroke={BRAND}
                      strokeWidth={2.5}
                      fill="url(#cashFlowGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Monthly table */}
          <Card className="border-0 shadow-sm">
            <CardContent style={{ padding: 20 }}>
              <div style={{ marginBottom: 12 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: INK, margin: 0, letterSpacing: '-0.2px' }}>
                  Detalle mensual
                </h3>
                <p style={{ fontSize: 11.5, color: INK3, margin: '2px 0 0 0' }}>
                  Cada mes parte del saldo final del anterior.
                </p>
              </div>
              <div style={{ overflow: 'auto' }}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mes</TableHead>
                      <TableHead style={{ textAlign: 'right' }}>Saldo inicial</TableHead>
                      <TableHead style={{ textAlign: 'right' }}>Ingresos</TableHead>
                      <TableHead style={{ textAlign: 'right' }}>Egresos</TableHead>
                      <TableHead style={{ textAlign: 'right' }}>Flujo neto</TableHead>
                      <TableHead style={{ textAlign: 'right' }}>Saldo final</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aggregates.months
                      .filter((m) => {
                        const today = new Date();
                        const isPastOrCurrent =
                          m.year < today.getFullYear() ||
                          (m.year === today.getFullYear() && m.monthIdx <= today.getMonth());
                        return isPastOrCurrent || m.ingresos > 0 || m.egresos > 0;
                      })
                      .map((m) => (
                        <TableRow key={m.ym}>
                          <TableCell style={{ fontWeight: 500 }}>{MONTH_NAMES[m.monthIdx]}</TableCell>
                          <TableCell style={{ textAlign: 'right', color: INK2, fontVariantNumeric: 'tabular-nums' }}>
                            {formatCurrency(m.saldoInicial)}
                          </TableCell>
                          <TableCell style={{ textAlign: 'right', color: m.ingresos > 0 ? SUCCESS : INK3, fontVariantNumeric: 'tabular-nums' }}>
                            {m.ingresos > 0 ? `+${formatCurrency(m.ingresos)}` : '—'}
                          </TableCell>
                          <TableCell style={{ textAlign: 'right', color: m.egresos > 0 ? DANGER : INK3, fontVariantNumeric: 'tabular-nums' }}>
                            {m.egresos > 0 ? `−${formatCurrency(m.egresos)}` : '—'}
                          </TableCell>
                          <TableCell style={{
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                            fontWeight: 500,
                            color: m.neto === 0 ? INK3 : m.neto > 0 ? SUCCESS : DANGER,
                          }}>
                            {m.neto === 0 ? '—' : `${m.neto > 0 ? '+' : ''}${formatCurrency(m.neto)}`}
                          </TableCell>
                          <TableCell style={{
                            textAlign: 'right',
                            fontVariantNumeric: 'tabular-nums',
                            fontWeight: 600,
                            color: m.saldoFinal >= 0 ? INK : DANGER,
                          }}>
                            {formatCurrency(m.saldoFinal)}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------- KpiCard ----------

interface KpiCardProps {
  label: string;
  value: number;
  icon: React.ComponentType<{ style?: React.CSSProperties }>;
  tone: 'brand' | 'success' | 'danger';
  hint: string;
}

function KpiCard({ label, value, icon: Icon, tone, hint }: KpiCardProps) {
  const colorMap = {
    brand: { fg: BRAND, bg: 'oklch(0.43 0.14 155 / 0.10)' },
    success: { fg: SUCCESS, bg: 'oklch(0.55 0.16 150 / 0.10)' },
    danger: { fg: DANGER, bg: 'oklch(0.58 0.21 25 / 0.10)' },
  } as const;
  const c = colorMap[tone];

  return (
    <Card className="border-0 shadow-sm">
      <CardContent style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: c.bg,
          color: c.fg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Icon style={{ width: 20, height: 20 }} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: INK3,
            margin: 0,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {label}
          </p>
          <p style={{
            fontSize: 18,
            fontWeight: 700,
            color: c.fg,
            margin: '2px 0 0 0',
            letterSpacing: '-0.4px',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {formatCurrencyShort(value)}
          </p>
          <p style={{ fontSize: 10.5, color: INK3, margin: '1px 0 0 0' }}>{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}
