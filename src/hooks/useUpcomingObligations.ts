import { useMemo } from 'react';
import { useFiscalConfig } from '@/hooks/useFiscalConfig';
import { useBusinessObligations } from '@/hooks/useBusinessObligations';
import {
  VENCIMIENTOS_IVA_2026,
  VENCIMIENTOS_IVA_CUATRIMESTRAL_2026,
  VENCIMIENTOS_RETEFUENTE_2026,
  VENCIMIENTOS_RENTA_JURIDICA_2026,
  VENCIMIENTOS_RENTA_NATURAL_2026,
  VENCIMIENTOS_ICA_BOGOTA_2026,
  PERIODOS_IVA,
  PERIODOS_IVA_CUATRIMESTRAL,
  MESES_RETEFUENTE,
  PERIODOS_ICA,
  CalendarEvent,
} from '@/lib/dianCalendar2026';

export function diasRestantes(fecha: Date): number {
  return Math.ceil((fecha.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export interface UseUpcomingObligationsResult {
  events: CalendarEvent[];
  urgentes: CalendarEvent[];
  nitDigit: number | null;
  loading: boolean;
}

/**
 * Construye los eventos de calendario (DIAN + ICA + obligaciones del negocio)
 * según la configuración fiscal del usuario. Compartido entre Dashboard y VisitaDIAN.
 */
export function useUpcomingObligations(urgentWindowDays = 15): UseUpcomingObligationsResult {
  const { config } = useFiscalConfig();
  const { obligations, isLoading: obligationsLoading } = useBusinessObligations();

  const nitDigit = config?.nit_ultimo_digito ?? null;
  const effectiveRentaType = config?.persona_type === 'natural' ? 'natural' : (config?.renta_type ?? 'juridica');

  const responsableIva = config?.responsable_iva ?? true;
  const agenteRetencion = config?.agente_retencion ?? false;
  const autorretenedor = config?.autorretenedor ?? false;
  const responsableIca = config?.responsable_ica ?? true;
  const regimen = config?.regimen ?? 'comun';
  const nivelIngresos = config?.nivel_ingresos ?? 'mas_92k_uvt';
  const ivaCuatrimestral = regimen === 'comun' && nivelIngresos === 'menos_92k_uvt';

  const events: CalendarEvent[] = useMemo(() => {
    const list: CalendarEvent[] = [];
    if (nitDigit !== null) {
      if (responsableIva && regimen !== 'simple') {
        if (ivaCuatrimestral) {
          VENCIMIENTOS_IVA_CUATRIMESTRAL_2026[nitDigit]?.forEach((fecha, i) => {
            list.push({
              id: `iva-${i}`,
              tipo: 'iva',
              descripcion: `IVA Cuatrimestral — ${PERIODOS_IVA_CUATRIMESTRAL[i]}`,
              fecha: new Date(fecha + 'T12:00:00'),
              periodo: PERIODOS_IVA_CUATRIMESTRAL[i],
              origen: 'dian',
            });
          });
        } else {
          VENCIMIENTOS_IVA_2026[nitDigit]?.forEach((fecha, i) => {
            list.push({
              id: `iva-${i}`,
              tipo: 'iva',
              descripcion: `IVA Bimestral — ${PERIODOS_IVA[i]}`,
              fecha: new Date(fecha + 'T12:00:00'),
              periodo: PERIODOS_IVA[i],
              origen: 'dian',
            });
          });
        }
      }
      if (agenteRetencion || autorretenedor) {
        VENCIMIENTOS_RETEFUENTE_2026[nitDigit]?.forEach((fecha, i) => {
          list.push({
            id: `ret-${i}`,
            tipo: 'retefuente',
            descripcion: `Retención en la Fuente — ${MESES_RETEFUENTE[i]}`,
            fecha: new Date(fecha + 'T12:00:00'),
            periodo: MESES_RETEFUENTE[i],
            origen: 'dian',
          });
        });
      }
      const rentaMap = effectiveRentaType === 'natural'
        ? VENCIMIENTOS_RENTA_NATURAL_2026
        : VENCIMIENTOS_RENTA_JURIDICA_2026;
      const rentaFecha = rentaMap[nitDigit];
      if (rentaFecha) {
        list.push({
          id: 'renta-2025',
          tipo: 'renta',
          descripcion: `Declaración de Renta ${effectiveRentaType === 'natural' ? 'Persona Natural' : 'Persona Jurídica'} — Año gravable 2025`,
          fecha: new Date(rentaFecha + 'T12:00:00'),
          periodo: '2025',
          origen: 'dian',
        });
      }
      if (responsableIca) {
        VENCIMIENTOS_ICA_BOGOTA_2026[nitDigit]?.forEach((fecha, i) => {
          list.push({
            id: `ica-${i}`,
            tipo: 'ica',
            descripcion: `ICA Bogotá — ${PERIODOS_ICA[i]}`,
            fecha: new Date(fecha + 'T12:00:00'),
            periodo: PERIODOS_ICA[i],
            origen: 'ica',
          });
        });
      }
    }

    const base = new Date();
    base.setDate(1);
    for (const ob of obligations) {
      if (!ob.activa) continue;
      for (let offset = -1; offset <= 12; offset++) {
        const y = base.getFullYear();
        const m = base.getMonth() + offset;
        const d = new Date(y, m, 1);
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        const day = Math.min(ob.dia_mes, lastDay);
        const fecha = new Date(d.getFullYear(), d.getMonth(), day, 12, 0, 0);
        list.push({
          id: `ob-${ob.id}-${d.getFullYear()}-${d.getMonth()}`,
          tipo: ob.tipo,
          descripcion: ob.nombre,
          fecha,
          periodo: d.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }),
          monto: ob.monto_estimado,
          origen: 'negocio',
          obligationId: ob.id,
        });
      }
    }

    return list;
  }, [nitDigit, effectiveRentaType, obligations, responsableIva, agenteRetencion, autorretenedor, responsableIca, regimen, ivaCuatrimestral]);

  const urgentes = useMemo(() => {
    return events
      .filter(ev => {
        const d = diasRestantes(ev.fecha);
        return d >= 0 && d <= urgentWindowDays;
      })
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  }, [events, urgentWindowDays]);

  return { events, urgentes, nitDigit, loading: obligationsLoading };
}
