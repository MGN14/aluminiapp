import { Building2 } from 'lucide-react';
import { useFiscalConfig } from '@/hooks/useFiscalConfig';
import { useTaxEstimates } from '@/hooks/useTaxEstimates';
import { VENCIMIENTOS_ICA_BOGOTA_2026, PERIODOS_ICA } from '@/lib/dianCalendar2026';
import { MetricCard, fmtCop, fmtFecha } from './cardKit';

/**
 * 12º cuadro de la grilla fiscal (Nico 2026-09-17: "falta un banner, ¿cuál
 * agregamos?"): el ICA del bimestre que viene a pagar, con el mismo motor
 * que alimenta el calendario (lib/taxEstimates): ingresos × tarifa de la
 * ciudad − reteICA que ya te practicaron. Estimado, marcado ≈.
 */
export default function IcaPorPagarCard() {
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

  if (nit === null || (config?.responsable_ica ?? true) === false) return null;
  const vencimientos = VENCIMIENTOS_ICA_BOGOTA_2026[nit] ?? [];
  if (vencimientos.length === 0) return null;

  // El bimestre cuyo vencimiento viene (hasta 5 días después de vencido
  // sigue siendo "el que toca"); si ya pasaron todos, el último.
  const hoy = new Date();
  const corte = new Date(hoy.getTime() - 5 * 86400000).toISOString().slice(0, 10);
  let idx = vencimientos.findIndex((f) => f >= corte);
  if (idx < 0) idx = vencimientos.length - 1;

  const est = ready ? estimate(`ica-${idx}`) : null;
  const vence = new Date(vencimientos[idx] + 'T12:00:00');
  const periodo = PERIODOS_ICA[idx];

  return (
    <MetricCard
      icon={Building2}
      tileClassName="bg-pink-500/15 text-pink-600 dark:text-pink-400"
      title="ICA por Pagar"
      value={est ? `≈ ${fmtCop(est.monto)}` : '—'}
      subtitle={`Bimestre ${periodo} · vence ${fmtFecha(vence)}${est?.parcial ? ' · estimado hasta hoy' : ''}`}
      note={est ? est.detalle : 'Configurá la tarifa ICA de tu ciudad en Ajustes → Impuestos para estimarlo.'}
    />
  );
}
