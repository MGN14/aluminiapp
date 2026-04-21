import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  AlertTriangle,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Gavel,
  MessageCircle,
  Calculator,
  Scale,
} from 'lucide-react';
import { useNico } from '@/hooks/useNicoContext';
import type { EvasionGapResult } from '@/lib/evasionGap';
import {
  calculatePenalties,
  DIAN_RATES,
  type EvasionRiskLevel,
} from '@/lib/evasionPenalties';

interface Props {
  /** Resultado de calculateEvasionGap para el periodo actual */
  evasion: EvasionGapResult;
  /** Meses efectivos del periodo sobre el que se midió el gap. Default 12. */
  periodMonths?: number;
}

function formatCOP(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function formatPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

/**
 * Simulador "¿Vale la pena evadir?" (GAP 3).
 *
 * Inputs vienen del mismo calculateEvasionGap que usa el Dashboard. El slider
 * deja al usuario mover la probabilidad subjetiva de auditoría para ver cómo
 * cambia el valor esperado. La tesis del producto es que con factura
 * electrónica obligatoria y cruces DIAN, la probabilidad real hoy es ≥ 25%,
 * punto en el que formalizar sale claramente mejor.
 *
 * Si no hay brecha, muestra un estado "felicitaciones".
 */
export default function RentabilidadFormalizacion({
  evasion,
  periodMonths = 12,
}: Props) {
  const { openNico, setPageContext } = useNico();

  // Probabilidad default por nivel. Usuario puede ajustarla con slider.
  const defaultProb = DIAN_RATES.probAuditoria24m[evasion.level as EvasionRiskLevel];
  const [probPct, setProbPct] = useState<number>(Math.round(defaultProb * 100));

  const penalties = useMemo(
    () =>
      calculatePenalties({
        gap: evasion.gap,
        level: evasion.level as EvasionRiskLevel,
        periodMonths,
        horizonMonths: 24,
        probAuditoriaOverride: probPct / 100,
      }),
    [evasion.gap, evasion.level, periodMonths, probPct],
  );

  // Punto de indiferencia: prob a la que ahorro == costo esperado.
  // ahorro = impuestoOmitido.  costo esperado = costoAuditoria × p.
  // ⇒ p_break = impuestoOmitido / costoAuditoria.
  const probBreakeven = useMemo(() => {
    if (penalties.costoAuditoria <= 0) return 0;
    return Math.min(1, penalties.impuestoOmitido / penalties.costoAuditoria);
  }, [penalties]);

  const handleAskNico = () => {
    setPageContext({ page: 'visita-dian-rentabilidad' });
    openNico();
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('nico-prefill', {
          detail: {
            message:
              '¿Me conviene formalizar el 100% de mis ingresos? Mostrame los números concretos para mi caso.',
          },
        }),
      );
    }, 300);
  };

  // Si no hay gap, celebración.
  if (evasion.gap <= 0) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/60">
        <CardContent className="p-6 flex items-start gap-4">
          <div className="bg-emerald-100 p-2 rounded-lg shrink-0">
            <ShieldCheck className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">¿Vale la pena evadir?</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Tu facturación cubre tus ingresos reales. No hay brecha que simular. Seguí así.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const evasionWins = penalties.valorEsperadoEvadir > 0;

  return (
    <Card className="overflow-hidden border-2 border-border">
      <CardContent className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="bg-amber-100 p-2 rounded-lg shrink-0">
            <Scale className="w-6 h-6 text-amber-700" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-foreground">¿Vale la pena evadir?</h2>
              <Badge variant="outline" className="text-[10px]">
                Proyección 24 meses
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Si seguís el ritmo actual, tu brecha proyectada es{' '}
              <span className="font-semibold text-foreground tabular-nums">
                {formatCOP(penalties.gapProyectado)}
              </span>
              . Esto es lo que pasaría si la DIAN te audita.
            </p>
          </div>
        </div>

        {/* Dos escenarios lado a lado */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Escenario A: Evadir */}
          <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-600" />
              <h3 className="font-semibold text-sm text-foreground">Si seguís evadiendo</h3>
            </div>

            <div className="space-y-1.5">
              <Row
                label="Ahorro aparente (IVA + renta)"
                value={formatCOP(penalties.ahorroEvadir)}
                tone="neutral"
                hint="Impuestos que no pagás si no facturás"
              />
              <Row
                label="Si te auditan: sanción"
                value={formatCOP(penalties.sancion)}
                tone="bad"
                hint="100% del impuesto omitido (Art 648 ET)"
              />
              <Row
                label="Si te auditan: intereses"
                value={formatCOP(penalties.intereses)}
                tone="bad"
                hint={`~${formatPct(DIAN_RATES.interesMoratoriosAnual)} anual`}
              />
              <div className="border-t border-red-200 pt-1.5">
                <Row
                  label="Costo total auditoría"
                  value={formatCOP(penalties.costoAuditoria)}
                  tone="bad"
                  bold
                />
              </div>
            </div>

            <div className="rounded-md bg-white/70 border border-red-100 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Probabilidad auditoría (ajustable)
                </span>
                <span className="font-semibold tabular-nums text-red-700">{probPct}%</span>
              </div>
              <Slider
                value={[probPct]}
                min={0}
                max={100}
                step={1}
                onValueChange={([v]) => setProbPct(v)}
                aria-label="Probabilidad estimada de auditoría"
              />
              <p className="text-[10px] text-muted-foreground leading-tight">
                Con factura electrónica obligatoria y cruces DIAN, una brecha sostenida
                supera el{' '}
                <button
                  type="button"
                  onClick={() => setProbPct(Math.round(probBreakeven * 100))}
                  className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                  title={`Punto de indiferencia: ${formatPct(probBreakeven)}`}
                >
                  {formatPct(probBreakeven)} de riesgo
                </button>{' '}
                con facilidad.
              </p>
            </div>

            <div
              className={`rounded-md p-3 ${
                evasionWins
                  ? 'bg-amber-100 border border-amber-200'
                  : 'bg-red-100 border border-red-300'
              }`}
            >
              <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
                Valor neto esperado
              </p>
              <p
                className={`text-lg font-bold tabular-nums ${
                  evasionWins ? 'text-amber-700' : 'text-red-700'
                }`}
              >
                {evasionWins ? '+' : ''}
                {formatCOP(penalties.valorEsperadoEvadir)}
              </p>
              <p className="text-[11px] text-muted-foreground leading-snug mt-1">
                {evasionWins
                  ? 'Solo positivo si asumís que la DIAN no cruza nada. Hoy cruza todo.'
                  : 'Estadísticamente, evadir te sale más caro que pagar.'}
              </p>
            </div>
          </div>

          {/* Escenario B: Formalizar */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <h3 className="font-semibold text-sm text-foreground">Si formalizás el 100%</h3>
            </div>

            <div className="space-y-1.5">
              <Row
                label="Pagás IVA + renta (como cualquier empresa)"
                value={formatCOP(penalties.impuestoOmitido)}
                tone="neutral"
                hint="Lo que hoy no estás pagando"
              />
              <Row label="Sanción" value="—" tone="good" bold />
              <Row label="Intereses moratorios" value="—" tone="good" bold />
              <Row label="Riesgo penal" value="—" tone="good" bold />
            </div>

            <ul className="text-xs text-muted-foreground space-y-1.5 pt-1">
              <li className="flex items-start gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                <span>Podés <strong className="text-foreground">acceder a crédito</strong> con estados financieros reales.</span>
              </li>
              <li className="flex items-start gap-2">
                <Calculator className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                <span><strong className="text-foreground">Deducís costos y gastos</strong> reales: bajás la base de renta.</span>
              </li>
              <li className="flex items-start gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                <span>Si la DIAN toca la puerta, <strong className="text-foreground">no tenés nada que esconder</strong>.</span>
              </li>
            </ul>

            <div className="rounded-md bg-emerald-100 border border-emerald-200 p-3">
              <p className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
                Costo real de formalizarte
              </p>
              <p className="text-lg font-bold tabular-nums text-emerald-700">
                {formatCOP(penalties.impuestoOmitido)}
              </p>
              <p className="text-[11px] text-muted-foreground leading-snug mt-1">
                Fijo y predecible. Sin sorpresas de la DIAN.
              </p>
            </div>
          </div>
        </div>

        {/* Banner penal (si aplica) */}
        {penalties.riesgoPenal && (
          <div className="rounded-lg border-2 border-red-400 bg-red-50 p-4 flex items-start gap-3">
            <Gavel className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-bold text-red-900">
                Atención: superás el umbral penal
              </p>
              <p className="text-xs text-red-800 leading-snug">
                Tu impuesto omitido anualizado supera las <strong>250 SMLMV</strong>. Eso
                deja de ser sanción administrativa y entra en{' '}
                <strong>Art 434A Código Penal</strong>: fraude fiscal, 48–108 meses de
                prisión. Esto no es un riesgo a correr.
              </p>
            </div>
          </div>
        )}

        {/* Conclusión + CTA */}
        <div className="flex flex-col md:flex-row md:items-center gap-3 pt-2 border-t border-border">
          <div className="flex items-start gap-2 flex-1">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Las tasas son aproximaciones educativas (IVA {formatPct(DIAN_RATES.iva)},
              renta {formatPct(DIAN_RATES.renta)}, sanción{' '}
              {formatPct(DIAN_RATES.sancionInexactitud)} sobre impuesto omitido, intereses{' '}
              {formatPct(DIAN_RATES.interesMoratoriosAnual)} E.A.). Validá con tu contador.
            </p>
          </div>
          <Button onClick={handleAskNico} variant="default" size="sm" className="gap-2 shrink-0">
            <MessageCircle className="w-4 h-4" />
            Preguntar a Nico
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  tone,
  bold,
  hint,
}: {
  label: string;
  value: string;
  tone: 'good' | 'bad' | 'neutral';
  bold?: boolean;
  hint?: string;
}) {
  const valueClass =
    tone === 'bad'
      ? 'text-red-700'
      : tone === 'good'
      ? 'text-emerald-700'
      : 'text-foreground';
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <div className="min-w-0 flex-1">
        <span className="text-muted-foreground">{label}</span>
        {hint && (
          <span className="block text-[10px] text-muted-foreground/70 leading-tight">
            {hint}
          </span>
        )}
      </div>
      <span className={`tabular-nums shrink-0 ${bold ? 'font-bold text-sm' : 'font-medium'} ${valueClass}`}>
        {value}
      </span>
    </div>
  );
}
