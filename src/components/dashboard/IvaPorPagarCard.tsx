import { Receipt } from 'lucide-react';
import { useFiscalConfig } from '@/hooks/useFiscalConfig';
import { useTaxEstimates } from '@/hooks/useTaxEstimates';
import {
  VENCIMIENTOS_IVA_2026,
  VENCIMIENTOS_IVA_CUATRIMESTRAL_2026,
  PERIODOS_IVA,
  PERIODOS_IVA_CUATRIMESTRAL,
} from '@/lib/dianCalendar2026';
import { MetricCard, fmtCop, fmtFecha } from './cardKit';

/**
 * "IVA por Pagar" de la grilla fiscal = el IVA del PERÍODO que toca declarar
 * (el de vencimiento más próximo), con el mismo motor que el calendario
 * (lib/taxEstimates: generado − descontable − arrastre de saldo a favor).
 *
 * Antes mostraba el "saldo vivo" acumulado del AÑO, que mezclaba el período
 * en curso con el que se declara — Nico 2026-09-17: "el IVA a pagar en este
 * cuatrimestre fue cercano a 0" y la tarjeta decía otra cosa.
 */
export default function IvaPorPagarCard() {
  const { config } = useFiscalConfig();
  const nit = config?.nit_ultimo_digito ?? null;
  const regimen = config?.regimen ?? 'comun';
  const ivaCuatrimestral = regimen === 'comun' && (config?.nivel_ingresos ?? 'mas_92k_uvt') === 'menos_92k_uvt';
  const { estimate, ready } = useTaxEstimates({
    year: 2026,
    ivaCuatrimestral,
    autorretenedor: config?.autorretenedor ?? false,
    agenteRetencion: config?.agente_retencion ?? false,
  });

  if (nit === null) {
    return (
      <MetricCard
        icon={Receipt}
        tone="muted"
        title="IVA por Pagar"
        value="—"
        subtitle="Configurá el último dígito de tu NIT"
        link={{ to: '/visita-dian', label: 'Configurar' }}
      />
    );
  }

  const vencimientos = (ivaCuatrimestral ? VENCIMIENTOS_IVA_CUATRIMESTRAL_2026 : VENCIMIENTOS_IVA_2026)[nit] ?? [];
  const periodos = ivaCuatrimestral ? PERIODOS_IVA_CUATRIMESTRAL : PERIODOS_IVA;

  // Período que toca: el de vencimiento más próximo (hasta 5 días después de
  // vencido sigue siendo "el que toca"); si ya pasaron todos, el último.
  const corte = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
  let idx = vencimientos.findIndex((f) => f >= corte);
  if (idx < 0) idx = vencimientos.length - 1;

  const est = ready ? estimate(`iva-${idx}`) : null;
  const enCurso = ready && idx + 1 < periodos.length ? estimate(`iva-${idx + 1}`) : null;
  const vence = vencimientos[idx] ? fmtFecha(new Date(vencimientos[idx] + 'T12:00:00')) : null;
  const aPagar = est?.monto ?? 0;
  const favor = est?.saldoAFavor ?? 0;
  const tone = !est ? 'muted' : aPagar > 0 ? 'alarm' : 'success';

  return (
    <MetricCard
      icon={Receipt}
      tone={tone}
      title="IVA por Pagar"
      value={est ? `≈ ${fmtCop(aPagar)}` : '—'}
      valueClassName={!est ? 'text-muted-foreground' : aPagar > 0 ? 'text-destructive' : 'text-success'}
      subtitle={
        <>
          {periodos[idx]}{vence ? ` · vence ${vence}` : ''}
          {est?.parcial ? ' · estimado hasta hoy' : ''}
          {favor > 0 && <span className="text-success font-semibold"> · queda saldo a favor ≈ {fmtCop(favor)}</span>}
        </>
      }
      note={
        est
          ? <>
              {est.detalle}
              {enCurso && <><br />{periodos[idx + 1]} va en ≈ {fmtCop(enCurso.monto)} hasta hoy.</>}
            </>
          : 'Sin facturas del período todavía.'
      }
    />
  );
}
