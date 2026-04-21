import { Card, CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import { ArrowRight, TrendingUp, AlertTriangle, ShieldCheck, Banknote } from 'lucide-react';
import {
  calculateEvasionGap,
  LEVEL_COPY,
  type EvasionLevel,
} from '@/lib/evasionGap';

interface Props {
  /** Total de ingresos por extracto bancario en el periodo */
  bankIncome: number;
  /** Anticipos de clientes arrastrados de periodos anteriores (no conciliados) */
  previousPeriodAdvances: number;
  /** Ingresos en efectivo del periodo */
  cashIncome: number;
  /** Total facturado a la DIAN en el periodo (invoices type='venta') */
  invoicedAmount: number;
}

const TONE_STYLES: Record<EvasionLevel, {
  iconColor: string;
  bgAccent: string;
  borderAccent: string;
  barColor: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = {
  low: {
    iconColor: 'text-emerald-600',
    bgAccent: 'bg-emerald-50',
    borderAccent: 'border-emerald-200',
    barColor: '#10b981',
    Icon: ShieldCheck,
  },
  mid: {
    iconColor: 'text-amber-600',
    bgAccent: 'bg-amber-50',
    borderAccent: 'border-amber-200',
    barColor: '#f59e0b',
    Icon: TrendingUp,
  },
  high: {
    iconColor: 'text-red-600',
    bgAccent: 'bg-red-50',
    borderAccent: 'border-red-300',
    barColor: '#ef4444',
    Icon: AlertTriangle,
  },
};

function formatCOP(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);
}

export default function EvasionGapCard({
  bankIncome,
  previousPeriodAdvances,
  cashIncome,
  invoicedAmount,
}: Props) {
  const result = calculateEvasionGap({
    bankIncome,
    previousPeriodAdvances,
    cashIncome,
    invoicedAmount,
  });
  const tone = TONE_STYLES[result.level];
  const copy = LEVEL_COPY[result.level];
  const { Icon } = tone;

  const gapPctDisplay = (result.gapPct * 100).toFixed(1);
  const barPct = Math.min(100, result.gapPct * 100);

  return (
    <Link to="/visita-dian#rentabilidad" className="block group">
      <Card className={`overflow-hidden border ${tone.borderAccent} hover:shadow-sm transition-all cursor-pointer`}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className={`${tone.bgAccent} p-1.5 rounded-md`}>
                <Icon className={`w-4 h-4 ${tone.iconColor}`} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Brecha DIAN vs Real</h3>
                <p className="text-xs text-muted-foreground">{copy.title}</p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
          </div>

          {/* Números principales */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Real</p>
              <p className="text-sm font-semibold text-foreground tabular-nums">{formatCOP(result.real)}</p>
              <div className="mt-1 space-y-0.5 text-[10px] text-muted-foreground leading-tight">
                <p>Extracto: <span className="tabular-nums">{formatCOP(result.bankIncome)}</span></p>
                {result.previousPeriodAdvances > 0 && (
                  <p>Ant. prev.: <span className="tabular-nums">{formatCOP(result.previousPeriodAdvances)}</span></p>
                )}
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">DIAN</p>
              <p className="text-sm font-semibold text-foreground tabular-nums">{formatCOP(result.dian)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Facturas emitidas</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Sin facturar</p>
              <p className="text-sm font-semibold tabular-nums" style={{ color: tone.barColor }}>
                {formatCOP(result.gap)}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Real − DIAN</p>
            </div>
          </div>

          {/* Efectivo resaltado (chip aparte porque es la fuente más riesgosa) */}
          {result.cash > 0 && (
            <div className={`flex items-center gap-2 rounded-md ${tone.bgAccent} px-2 py-1.5 mb-3`}>
              <Banknote className={`w-3.5 h-3.5 ${tone.iconColor}`} />
              <p className="text-[11px] leading-tight">
                <span className="font-medium text-foreground">Efectivo recibido: </span>
                <span className="tabular-nums font-semibold" style={{ color: tone.barColor }}>
                  {formatCOP(result.cash)}
                </span>
                <span className="text-muted-foreground"> · nunca pasó por banco</span>
              </p>
            </div>
          )}

          {/* Barra de % */}
          <div className="space-y-1">
            <div className="flex justify-between items-center text-[10px] text-muted-foreground">
              <span>% no facturado</span>
              <span className="font-semibold tabular-nums" style={{ color: tone.barColor }}>
                {gapPctDisplay}%
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${barPct}%`,
                  background: tone.barColor,
                }}
              />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground mt-2 leading-snug">{copy.subtitle}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
