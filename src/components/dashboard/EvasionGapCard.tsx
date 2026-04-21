import { Card, CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  TrendingUp,
  AlertTriangle,
  ShieldCheck,
  Banknote,
  Gavel,
} from 'lucide-react';
import {
  LEVEL_COPY,
  type EvasionGapResult,
  type EvasionLevel,
} from '@/lib/evasionGap';
import {
  calculatePenalties,
  type EvasionRiskLevel,
} from '@/lib/evasionPenalties';

interface Props {
  /** Resultado ya calculado de calculateEvasionGap (Dashboard lo calcula una sola
   *  vez y lo pasa). */
  evasion: EvasionGapResult;
  /** Meses del periodo evaluado. Default: 12. Se usa para computar el riesgo
   *  penal y la tira de alerta superior. */
  periodMonths?: number;
}

/**
 * Card unificado que combina:
 *   1. Tira de alerta superior (antes EvasionDisclaimer) — solo visible cuando
 *      el nivel es 'mid' o 'high'. Incluye headline, subhead y CTA al simulador.
 *   2. Desglose de la brecha (Real / DIAN / Sin facturar), chip de efectivo,
 *      barra de % no facturado y copy de nivel.
 *
 * Toda la card es un enlace a /visita-dian#rentabilidad. La "acción" dentro de
 * la tira superior es un span estilo botón — la navegación la maneja el Link
 * externo para evitar anidar interactivos.
 */

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

export default function EvasionGapCard({ evasion: result, periodMonths = 12 }: Props) {
  const tone = TONE_STYLES[result.level];
  const copy = LEVEL_COPY[result.level];
  const { Icon } = tone;

  const gapPctDisplay = (result.gapPct * 100).toFixed(1);
  const barPct = Math.min(100, result.gapPct * 100);

  // Tira de alerta — solo en mid/high. Copia alineada con el antiguo
  // EvasionDisclaimer (mismo razonamiento detrás de cada nivel).
  const showAlert = result.level !== 'low' && result.gap > 0;

  // riesgoPenal depende de la proyección anualizada — usamos calculatePenalties
  // con horizonte = 12 meses (año calendario) para consistencia con el resto.
  const penalties = showAlert
    ? calculatePenalties({
        gap: result.gap,
        cashPortion: result.cash,
        level: result.level as EvasionRiskLevel,
        periodMonths,
        horizonMonths: 12,
      })
    : null;

  const hasPenal = penalties?.riesgoPenal ?? false;
  const isHigh = result.level === 'high';
  const auditablePct =
    result.gap > 0 ? 1 - Math.min(1, result.cash / result.gap) : 0;

  const alertHeadline = hasPenal
    ? 'Tu brecha entró en zona penal'
    : isHigh
    ? 'Lo que ahorrás evadiendo no compensa el riesgo'
    : 'Tu brecha está empezando a ser visible';

  const alertSubhead = hasPenal
    ? `Con ${formatCOP(result.gap)} sin facturar este periodo, tu impuesto omitido anualizado pasa las 250 SMLMV. Deja de ser sanción administrativa (Art 648 ET) y entra en Art 434A del Código Penal.`
    : isHigh
    ? `Con ${formatCOP(result.gap)} sin facturar (${Math.round(auditablePct * 100)}% auditable por la DIAN), el costo esperado si te auditan supera el ahorro. Ver el desglose paso a paso.`
    : `Tenés ${formatCOP(result.gap)} sin facturar. Con factura electrónica obligatoria, la DIAN cruza ingresos automáticamente. Mejor revisarlo ahora.`;

  // Tonos de la tira de alerta (más crudos que los de la card base).
  const alertTone = hasPenal
    ? {
        bg: 'bg-red-50',
        border: 'border-red-400',
        iconBg: 'bg-red-100',
        iconColor: 'text-red-700',
        headline: 'text-red-900',
        subhead: 'text-red-800',
        button: 'bg-red-600 text-white',
      }
    : isHigh
    ? {
        bg: 'bg-red-50/70',
        border: 'border-red-300',
        iconBg: 'bg-red-100',
        iconColor: 'text-red-600',
        headline: 'text-foreground',
        subhead: 'text-muted-foreground',
        button: 'bg-red-600 text-white',
      }
    : {
        bg: 'bg-amber-50/70',
        border: 'border-amber-300',
        iconBg: 'bg-amber-100',
        iconColor: 'text-amber-700',
        headline: 'text-foreground',
        subhead: 'text-muted-foreground',
        button: 'bg-amber-600 text-white',
      };

  const AlertIcon = hasPenal ? Gavel : AlertTriangle;

  // Cuando hay alerta, el borde exterior toma el tono más crudo.
  const outerBorder = hasPenal ? 'border-red-400 border-2' : tone.borderAccent;

  return (
    <Link to="/visita-dian#rentabilidad" className="block group">
      <Card className={`overflow-hidden border ${outerBorder} hover:shadow-sm transition-all cursor-pointer`}>
        <CardContent className="p-0">
          {/* ═══ Tira de alerta (solo mid/high) ═══════════════════ */}
          {showAlert && (
            <div
              role="alert"
              className={`${alertTone.bg} border-b ${alertTone.border} p-4 md:p-5`}
            >
              <div className="flex items-start gap-3">
                <div className={`${alertTone.iconBg} p-2 rounded-lg shrink-0`}>
                  <AlertIcon className={`w-5 h-5 ${alertTone.iconColor}`} />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <h3 className={`text-sm md:text-base font-bold ${alertTone.headline}`}>
                    {alertHeadline}
                  </h3>
                  <p className={`text-xs md:text-sm leading-snug ${alertTone.subhead}`}>
                    {alertSubhead}
                  </p>
                  <div className="pt-1">
                    <span
                      className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium ${alertTone.button} group-hover:opacity-90 transition-opacity`}
                    >
                      Ver cuánto te cuesta realmente
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ Desglose de la brecha ════════════════════════════ */}
          <div className="p-4">
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
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
