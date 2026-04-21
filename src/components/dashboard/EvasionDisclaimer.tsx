import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Gavel, ArrowRight } from 'lucide-react';
import type { EvasionGapResult } from '@/lib/evasionGap';
import {
  calculatePenalties,
  DIAN_RATES,
  type EvasionRiskLevel,
} from '@/lib/evasionPenalties';

interface Props {
  /** Resultado de calculateEvasionGap del periodo activo */
  evasion: EvasionGapResult;
  /** Meses del periodo evaluado (default: 12 = año) */
  periodMonths?: number;
}

function formatCOP(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

/**
 * GAP 4 — Banner de advertencia en Dashboard.
 *
 * Solo se renderiza si el nivel es 'mid' o 'high' (para 'low' sería ruido
 * innecesario). La idea es empujar al usuario al simulador de Visita DIAN
 * antes de que escale la brecha.
 *
 * La copy es intencionalmente más directa que la del EvasionGapCard: mientras
 * el card muestra los números de la brecha, el disclaimer pone el foco en
 * consecuencias (multa, cárcel) para motivar el click al simulador.
 */
export default function EvasionDisclaimer({ evasion, periodMonths = 12 }: Props) {
  // El banner no aparece si no hay brecha relevante.
  if (evasion.level === 'low' || evasion.gap <= 0) return null;

  const penalties = calculatePenalties({
    gap: evasion.gap,
    level: evasion.level as EvasionRiskLevel,
    periodMonths,
    horizonMonths: 24,
  });

  const isHigh = evasion.level === 'high';
  const hasPenal = penalties.riesgoPenal;

  // Copy ajustada al nivel: a mayor riesgo, más crudo.
  const headline = hasPenal
    ? 'Tu brecha entró en zona penal'
    : isHigh
    ? 'Lo que ahorrás evadiendo no compensa el riesgo'
    : 'Tu brecha está empezando a ser visible';

  const subhead = hasPenal
    ? `Con ${formatCOP(evasion.gap)} sin facturar este periodo, tu impuesto omitido anualizado pasa las 250 SMLMV. Eso deja de ser sanción administrativa (Art 648 ET) y entra en Art 434A del Código Penal.`
    : isHigh
    ? `Con ${formatCOP(evasion.gap)} sin facturar, la DIAN puede aplicarte sanción del ${Math.round(DIAN_RATES.sancionInexactitud * 100)}% más intereses. Costo auditoría proyectado: ${formatCOP(penalties.costoAuditoria)}.`
    : `Tenés ${formatCOP(evasion.gap)} sin facturar. Con factura electrónica obligatoria, la DIAN cruza ingresos automáticamente. Mejor revisarlo ahora.`;

  const toneClasses = hasPenal
    ? {
        border: 'border-red-500 border-2',
        bg: 'bg-red-50',
        iconBg: 'bg-red-100',
        iconColor: 'text-red-700',
        headline: 'text-red-900',
        subhead: 'text-red-800',
        button: 'bg-red-600 hover:bg-red-700 text-white',
      }
    : isHigh
    ? {
        border: 'border-red-300',
        bg: 'bg-red-50/70',
        iconBg: 'bg-red-100',
        iconColor: 'text-red-600',
        headline: 'text-foreground',
        subhead: 'text-muted-foreground',
        button: 'bg-red-600 hover:bg-red-700 text-white',
      }
    : {
        border: 'border-amber-300',
        bg: 'bg-amber-50/70',
        iconBg: 'bg-amber-100',
        iconColor: 'text-amber-700',
        headline: 'text-foreground',
        subhead: 'text-muted-foreground',
        button: 'bg-amber-600 hover:bg-amber-700 text-white',
      };

  const Icon = hasPenal ? Gavel : AlertTriangle;

  return (
    <div
      role="alert"
      className={`rounded-xl border ${toneClasses.border} ${toneClasses.bg} p-4 md:p-5`}
    >
      <div className="flex items-start gap-3">
        <div className={`${toneClasses.iconBg} p-2 rounded-lg shrink-0`}>
          <Icon className={`w-5 h-5 ${toneClasses.iconColor}`} />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <h3 className={`text-sm md:text-base font-bold ${toneClasses.headline}`}>
            {headline}
          </h3>
          <p className={`text-xs md:text-sm leading-snug ${toneClasses.subhead}`}>
            {subhead}
          </p>
          <div className="pt-1">
            <Link to="/visita-dian#rentabilidad">
              <Button size="sm" className={`gap-2 ${toneClasses.button}`}>
                Ver cuánto te cuesta realmente
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
