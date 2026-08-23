// Merma aprendida por familia — la señal que los conteos físicos ya guardaban.
//
// Cada cierre de inventario confirmado registra, referencia por referencia,
// la diferencia contado − teórico. Las diferencias NEGATIVAS acumuladas son
// la merma real del negocio (recortes, daños, salidas sin remisión). Este
// módulo la convierte en una tasa por familia que el motor de reorden usa
// para pedir de más donde históricamente se pierde material.
//
// Reglas conservadoras (el motor de reorden está auditado — no lo inflamos):
//   - Solo sesiones CONFIRMADAS (el borrador aún se está corrigiendo).
//   - Mínimo MIN_CONTEOS sesiones distintas con la familia presente: una
//     diferencia aislada puede ser un error de digitación, no una tasa.
//   - Solo cuentan las líneas con teórico > 0 (es_nueva no dice nada de merma).
//   - La tasa se CAPEA en MERMA_MAX: si una familia "pierde" más del 10%,
//     eso no es merma, es un problema operativo que un colchón no arregla —
//     se reporta aparte en `sospechosas` para mirarlo de frente.

import { refFamilyKey } from '@/lib/refFamily';

export interface CountLineInput {
  session_id: string;
  variant_reference: string;
  stock_teorico: number;
  diferencia: number;
}

export interface FamilyShrinkage {
  familia: string;
  /** Tasa de merma 0..MERMA_MAX (pérdida acumulada / teórico acumulado). */
  tasa: number;
  /** Tasa cruda sin capear (para diagnóstico). */
  tasaCruda: number;
  sesiones: number;
  unidadesPerdidas: number;
}

export interface ShrinkageResult {
  porFamilia: Map<string, FamilyShrinkage>;
  /** Familias con tasa cruda > MERMA_MAX: problema operativo, no colchón. */
  sospechosas: FamilyShrinkage[];
}

export const MIN_CONTEOS = 2;
export const MERMA_MAX = 0.10;

export function computeShrinkage(lines: CountLineInput[]): ShrinkageResult {
  const acc = new Map<string, { sesiones: Set<string>; perdidas: number; teorico: number }>();

  for (const l of lines) {
    const teorico = Number(l.stock_teorico) || 0;
    if (teorico <= 0) continue;
    const fam = refFamilyKey(l.variant_reference);
    if (!fam) continue;
    const a = acc.get(fam) ?? { sesiones: new Set<string>(), perdidas: 0, teorico: 0 };
    a.sesiones.add(l.session_id);
    a.teorico += teorico;
    const diff = Number(l.diferencia) || 0;
    if (diff < 0) a.perdidas += -diff;
    acc.set(fam, a);
  }

  const porFamilia = new Map<string, FamilyShrinkage>();
  const sospechosas: FamilyShrinkage[] = [];

  for (const [fam, a] of acc) {
    if (a.sesiones.size < MIN_CONTEOS || a.teorico <= 0 || a.perdidas <= 0) continue;
    const tasaCruda = a.perdidas / a.teorico;
    const row: FamilyShrinkage = {
      familia: fam,
      tasa: Math.min(MERMA_MAX, tasaCruda),
      tasaCruda,
      sesiones: a.sesiones.size,
      unidadesPerdidas: Math.round(a.perdidas),
    };
    porFamilia.set(fam, row);
    if (tasaCruda > MERMA_MAX) sospechosas.push(row);
  }

  sospechosas.sort((a, b) => b.tasaCruda - a.tasaCruda);
  return { porFamilia, sospechosas };
}
