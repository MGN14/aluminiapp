import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  AlertTriangle,
  ShieldCheck,
  Gavel,
  MessageCircle,
  Scale,
  Banknote,
  Building2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useNico } from '@/hooks/useNicoContext';
import type { EvasionGapResult } from '@/lib/evasionGap';
import {
  calculatePenalties,
  DIAN_RATES,
  CASH_RISKS,
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

function formatPct(n: number, decimals = 0): string {
  return `${(n * 100).toFixed(decimals)}%`;
}

/**
 * Simulador "¿Vale la pena evadir?" (GAP 3) — versión transparente.
 *
 * El objetivo es que el usuario entienda de dónde sale cada número, no que
 * confíe en una caja negra. Por eso cada línea de cálculo es visible y hay
 * una sección "Enemigos del efectivo" que matiza el caso cuando el VE aparece
 * positivo gracias al cash (porque el efectivo parece gratis pero no lo es).
 */
export default function RentabilidadFormalizacion({
  evasion,
  periodMonths = 12,
}: Props) {
  const { openNico, setPageContext } = useNico();

  const defaultProb = DIAN_RATES.probAuditoria24m[evasion.level as EvasionRiskLevel];
  const [probPct, setProbPct] = useState<number>(Math.round(defaultProb * 100));
  const [showRisks, setShowRisks] = useState(true);

  // Horizonte = año calendario completo (Jan 1 → Dec 31 del año actual).
  // El periodo medido es de Jan 1 a hoy; escalamos al ritmo actual hasta Dec 31.
  const horizonMonths = 12;

  const penalties = useMemo(
    () =>
      calculatePenalties({
        gap: evasion.gap,
        cashPortion: evasion.cash,
        level: evasion.level as EvasionRiskLevel,
        periodMonths,
        horizonMonths,
        probAuditoriaOverride: probPct / 100,
      }),
    [evasion.gap, evasion.cash, evasion.level, periodMonths, horizonMonths, probPct],
  );

  // Punto de indiferencia: prob a la que ahorro == costo esperado.
  //   p* = impuestoOmitidoTotal / costoAuditoria.
  // Si es > 100%, evadir siempre sale mejor en valor esperado (todo es cash).
  const probBreakeven = useMemo(() => {
    if (penalties.costoAuditoria <= 0) return Infinity;
    return penalties.ahorroEvadir / penalties.costoAuditoria;
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

  // Sin gap: celebración.
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
  const cashShare =
    penalties.gapProyectado > 0
      ? penalties.cashProyectado / penalties.gapProyectado
      : 0;
  const taxRate = DIAN_RATES.iva + DIAN_RATES.renta;

  return (
    <Card className="overflow-hidden border-2 border-border">
      <CardContent className="p-6 space-y-6">
        {/* ══ Header ══════════════════════════════════════════════ */}
        <div className="flex items-start gap-3">
          <div className="bg-amber-100 p-2 rounded-lg shrink-0">
            <Scale className="w-6 h-6 text-amber-700" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-foreground">¿Vale la pena evadir?</h2>
              <Badge variant="outline" className="text-[10px]">
                Proyección al 31-Dic-{new Date().getFullYear()}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Simulador transparente: cada número tiene su fórmula. Ajustá el slider de
              probabilidad de auditoría para ver cómo cambia el balance.
            </p>
          </div>
        </div>

        {/* ══ Desglose del gap: cash vs auditable ════════════════ */}
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs uppercase tracking-wide font-semibold text-muted-foreground">
              Tu brecha proyectada al 31-Dic
            </p>
            <p className="text-xl font-bold tabular-nums text-foreground">
              {formatCOP(penalties.gapProyectado)}
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            = gap actual ({formatCOP(evasion.gap)}) × (12 meses / {periodMonths}{' '}
            {periodMonths === 1 ? 'mes' : 'meses'} transcurridos del año).
          </p>

          {/* Barra de composición */}
          <div className="space-y-2 pt-2">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="bg-amber-400"
                style={{ width: `${cashShare * 100}%` }}
                title={`Efectivo: ${formatPct(cashShare, 1)}`}
              />
              <div
                className="bg-red-500 flex-1"
                title={`Auditable: ${formatPct(1 - cashShare, 1)}`}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              <div className="flex items-start gap-2">
                <Banknote className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold text-foreground">
                    {formatCOP(penalties.cashProyectado)}
                  </span>{' '}
                  <span className="text-muted-foreground">en efectivo</span>
                  <br />
                  <span className="text-[10px] text-muted-foreground italic">
                    DIAN no puede cruzar directo (pero ver enemigos ↓)
                  </span>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Building2 className="w-3.5 h-3.5 text-red-600 mt-0.5 shrink-0" />
                <div>
                  <span className="font-semibold text-foreground">
                    {formatCOP(penalties.auditableProyectado)}
                  </span>{' '}
                  <span className="text-muted-foreground">auditable</span>
                  <br />
                  <span className="text-[10px] text-muted-foreground italic">
                    Bank + anticipos − facturado. La DIAN lo cruza.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ══ Dos escenarios ═════════════════════════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ┌── EVADIR ──────────────────────────────────────────── */}
          <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 space-y-4">
            <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
              <span className="bg-red-200 w-5 h-5 rounded-full flex items-center justify-center text-red-900 text-[10px] font-bold">A</span>
              Si seguís evadiendo
            </h3>

            {/* Ahorro tributario */}
            <div className="bg-white/70 rounded-md border border-red-100 p-3 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                1. Lo que "ahorrás" (sobre gap total)
              </p>
              <FormulaRow
                label={`IVA ${formatPct(DIAN_RATES.iva)} × ${formatCOP(penalties.gapProyectado)}`}
                value={formatCOP(penalties.ivaOmitidoTotal)}
              />
              <FormulaRow
                label={`Renta ${formatPct(DIAN_RATES.renta)} × ${formatCOP(penalties.gapProyectado)}`}
                value={formatCOP(penalties.rentaOmitidaTotal)}
              />
              <div className="border-t border-red-100 pt-1.5">
                <FormulaRow
                  label="Ahorro tributario total"
                  value={formatCOP(penalties.impuestoOmitidoTotal)}
                  bold
                  tone="bad"
                />
              </div>
            </div>

            {/* Costo si auditan */}
            <div className="bg-white/70 rounded-md border border-red-100 p-3 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                2. Si te auditan — solo sobre la parte auditable
              </p>
              {penalties.auditableProyectado > 0 ? (
                <>
                  <FormulaRow
                    label={`Impuesto ${formatPct(taxRate)} × ${formatCOP(penalties.auditableProyectado)}`}
                    value={formatCOP(penalties.impuestoAuditable)}
                  />
                  <FormulaRow
                    label={`Sanción ${formatPct(DIAN_RATES.sancionInexactitud)} (Art 648 ET)`}
                    value={formatCOP(penalties.sancion)}
                  />
                  <FormulaRow
                    label={`Intereses mora ${formatPct(DIAN_RATES.interesMoratoriosAnual)} E.A.`}
                    value={formatCOP(penalties.intereses)}
                  />
                  <div className="border-t border-red-100 pt-1.5">
                    <FormulaRow
                      label="Costo total auditoría"
                      value={formatCOP(penalties.costoAuditoria)}
                      bold
                      tone="bad"
                    />
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Tu gap proyectado es 100% efectivo. Por cruce estándar, la DIAN no
                  puede tasar nada → costo auditoría = $0. Ver "enemigos del efectivo" más abajo.
                </p>
              )}
            </div>

            {/* Slider prob */}
            <div className="bg-white/70 rounded-md border border-red-100 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-muted-foreground">
                  3. Probabilidad auditoría (ajustable)
                </span>
                <span className="font-bold tabular-nums text-red-700 text-sm">
                  {probPct}%
                </span>
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
                {probBreakeven === Infinity ? (
                  <>
                    Como la parte auditable es $0, no hay punto de indiferencia: la DIAN
                    no puede tasar por cruces estándar.
                  </>
                ) : (
                  <>
                    Punto de indiferencia:{' '}
                    <button
                      type="button"
                      onClick={() =>
                        setProbPct(Math.min(100, Math.round(probBreakeven * 100)))
                      }
                      className="underline decoration-dotted underline-offset-2 hover:text-foreground font-semibold"
                      title={`A ${formatPct(probBreakeven)} de riesgo, ahorro = costo esperado`}
                    >
                      {formatPct(probBreakeven)}
                    </button>
                    . Con factura electrónica obligatoria, la DIAN detecta brechas
                    estructurales fácil.
                  </>
                )}
              </p>
            </div>

            {/* Valor esperado */}
            <div className="bg-white/70 rounded-md border border-red-100 p-3 space-y-2">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                4. Balance esperado
              </p>
              <FormulaRow
                label="Ahorro tributario total"
                value={`+ ${formatCOP(penalties.ahorroEvadir)}`}
                tone="neutral"
              />
              <FormulaRow
                label={`Costo auditoría × ${probPct}%`}
                value={`− ${formatCOP(penalties.costoEsperado)}`}
                tone="neutral"
              />
              <div className="border-t border-red-100 pt-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-bold text-foreground">Valor neto esperado</span>
                  <span
                    className={`text-lg font-bold tabular-nums ${
                      evasionWins ? 'text-amber-700' : 'text-red-700'
                    }`}
                  >
                    {evasionWins ? '+' : ''}
                    {formatCOP(penalties.valorEsperadoEvadir)}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug pt-1">
                {evasionWins
                  ? `Aparenta positivo porque ${formatPct(cashShare)} del gap es efectivo, que la DIAN no puede cruzar. Pero ojo: tiene enemigos ↓`
                  : 'El costo esperado de auditoría supera el ahorro. Formalizar gana estadísticamente.'}
              </p>
            </div>

            {/* ── ENEMIGOS DEL EFECTIVO ── */}
            {penalties.cashProyectado > 0 && (
              <div className="rounded-md border-2 border-amber-300 bg-amber-50 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowRisks(s => !s)}
                  className="w-full flex items-center justify-between gap-2 p-3 hover:bg-amber-100/50 transition-colors"
                  aria-expanded={showRisks}
                >
                  <div className="flex items-center gap-2 text-left">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                    <p className="text-xs font-bold text-amber-900">
                      Ojo: el efectivo también tiene enemigos
                    </p>
                  </div>
                  {showRisks ? (
                    <ChevronUp className="w-4 h-4 text-amber-700 shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-amber-700 shrink-0" />
                  )}
                </button>

                {showRisks && (
                  <div className="px-3 pb-3 space-y-2">
                    <p className="text-[11px] text-amber-900/80 leading-snug">
                      El cálculo de arriba asume que la DIAN no ve el efectivo por cruces
                      estándar. Es cierto, pero por rutas indirectas sí aparece:
                    </p>
                    <ul className="space-y-2">
                      {CASH_RISKS.map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-[11px] leading-snug">
                          <span className="w-4 h-4 rounded-full bg-amber-200 text-amber-900 text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                            {i + 1}
                          </span>
                          <div>
                            <span className="font-semibold text-amber-900">{r.title}.</span>{' '}
                            <span className="text-amber-900/80">{r.detail}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {penalties.cashSobreUIAF && (
                      <div className="mt-2 bg-amber-100 border border-amber-300 rounded p-2 text-[11px] text-amber-900">
                        <strong>Atención:</strong> tu efectivo supera{' '}
                        {formatCOP(DIAN_RATES.uiafReporteCOP)} (umbral UIAF). Cualquier
                        consignación bancaria activa reporte automático a la Unidad de
                        Información y Análisis Financiero.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          {/* └── /EVADIR ─────────────────────────────────────────── */}

          {/* ┌── FORMALIZAR ─────────────────────────────────────── */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 space-y-4">
            <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
              <span className="bg-emerald-200 w-5 h-5 rounded-full flex items-center justify-center text-emerald-900 text-[10px] font-bold">B</span>
              Si formalizás el 100%
            </h3>

            <div className="bg-white/70 rounded-md border border-emerald-100 p-3 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                Lo que pagás
              </p>
              <FormulaRow
                label={`IVA ${formatPct(DIAN_RATES.iva)} sobre todo el gap`}
                value={formatCOP(penalties.ivaOmitidoTotal)}
              />
              <FormulaRow
                label={`Renta ${formatPct(DIAN_RATES.renta)} sobre todo el gap`}
                value={formatCOP(penalties.rentaOmitidaTotal)}
              />
              <div className="border-t border-emerald-100 pt-1.5">
                <FormulaRow
                  label="Costo total formalizarte"
                  value={formatCOP(penalties.impuestoOmitidoTotal)}
                  bold
                  tone="good"
                />
              </div>
            </div>

            <div className="bg-white/70 rounded-md border border-emerald-100 p-3 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                Lo que NO pagás
              </p>
              <FormulaRow label="Sanción por inexactitud" value="—" tone="good" />
              <FormulaRow label="Intereses moratorios" value="—" tone="good" />
              <FormulaRow label="Riesgo auditoría" value="—" tone="good" />
              <FormulaRow label="Riesgo penal" value="—" tone="good" />
            </div>

            <div className="bg-emerald-100/60 rounded-md border border-emerald-200 p-3 space-y-2">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                Beneficios intangibles
              </p>
              <ul className="text-[11px] text-emerald-900/90 space-y-1.5">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 mt-0.5 shrink-0">✓</span>
                  <span><strong>Acceso a crédito bancario</strong> con estados reales</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 mt-0.5 shrink-0">✓</span>
                  <span><strong>Deducís costos y gastos</strong> reales: bajás la base de renta</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 mt-0.5 shrink-0">✓</span>
                  <span><strong>Vendés a corporativos</strong> que exigen factura</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-600 mt-0.5 shrink-0">✓</span>
                  <span>Si la DIAN toca la puerta, <strong>no tenés nada que esconder</strong></span>
                </li>
              </ul>
            </div>
          </div>
          {/* └── /FORMALIZAR ─────────────────────────────────────── */}
        </div>

        {/* ══ Banner penal (si aplica) ═══════════════════════════ */}
        {penalties.riesgoPenal && (
          <div className="rounded-lg border-2 border-red-400 bg-red-50 p-4 flex items-start gap-3">
            <Gavel className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-bold text-red-900">
                Atención: superás el umbral penal
              </p>
              <p className="text-xs text-red-800 leading-snug">
                Impuesto omitido anualizado:{' '}
                <strong className="tabular-nums">
                  {formatCOP(penalties.impuestoAnualizado)}
                </strong>
                , que supera las <strong>250 SMLMV</strong>{' '}
                ({formatCOP(DIAN_RATES.umbralPenalAnualCOP)}). Deja de ser sanción
                administrativa y entra en <strong>Art 434A Código Penal</strong>: fraude
                fiscal, 48–108 meses de prisión. Esto aplica aunque el gap sea efectivo:
                con evidencia, la DIAN extiende el tasado.
              </p>
            </div>
          </div>
        )}

        {/* ══ Footer / CTA ═══════════════════════════════════════ */}
        <div className="flex flex-col md:flex-row md:items-start gap-3 pt-2 border-t border-border">
          <div className="flex items-start gap-2 flex-1">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Tasas educativas, aproximadas: IVA {formatPct(DIAN_RATES.iva)}, renta{' '}
              {formatPct(DIAN_RATES.renta)}, sanción{' '}
              {formatPct(DIAN_RATES.sancionInexactitud)} del impuesto omitido (Art 648 ET),
              intereses {formatPct(DIAN_RATES.interesMoratoriosAnual)} E.A. (Art 635 ET),
              umbral penal 250 SMLMV (Art 434A CP), umbral UIAF{' '}
              {formatCOP(DIAN_RATES.uiafReporteCOP)}. Validá con tu contador antes de
              tomar decisiones.
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

/** Fila con label a la izquierda + valor tabular a la derecha. */
function FormulaRow({
  label,
  value,
  bold,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  bold?: boolean;
  tone?: 'good' | 'bad' | 'neutral';
}) {
  const valueClass =
    tone === 'bad'
      ? 'text-red-700'
      : tone === 'good'
      ? 'text-emerald-700'
      : 'text-foreground';
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted-foreground leading-tight flex-1 min-w-0 truncate">
        {label}
      </span>
      <span
        className={`tabular-nums shrink-0 ${
          bold ? 'font-bold text-sm' : 'font-medium'
        } ${valueClass}`}
      >
        {value}
      </span>
    </div>
  );
}
