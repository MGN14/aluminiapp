/**
 * Prestaciones sociales POR EMPLEADO (ley laboral colombiana).
 *
 * Fórmulas estándar (base 360 días):
 *   cesantías        = base × días trabajados del año / 360
 *   int. cesantías   = cesantías acumuladas × 12% × días / 360
 *   prima            = base × días del semestre / 360 (se paga 30 jun y 20 dic)
 *   vacaciones       = salario (SIN aux) × días / 720  → 15 días hábiles/año
 *   base             = salario + auxilio de transporte (si salario ≤ 2 SMMLV)
 *   dotación         = 3 entregas/año (30 abr, 31 ago, 20 dic) si salario ≤ 2 SMMLV
 */

export interface EmployeeRow {
  id: string;
  nombre: string;
  documento: string | null;
  cargo: string | null;
  salario_base: number;
  fecha_ingreso: string; // YYYY-MM-DD
  fecha_retiro: string | null;
  tipo_contrato: string;
  arl_clase: number;
  auxilio_transporte: boolean;
  activo: boolean;
  notas: string | null;
}

export interface EmployeeEventRow {
  id: string;
  employee_id: string;
  tipo: string;
  fecha: string;
  dias: number | null;
  monto: number | null;
  notas: string | null;
}

export interface LawParams {
  smmlv: number;
  auxTransporte: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(s: string): Date {
  return new Date(s + 'T12:00:00');
}

/** Días calendario entre dos fechas (inclusive el inicio, base real). */
function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / DAY_MS));
}

export const DOTACION_FECHAS = ['-04-30', '-08-31', '-12-20'] as const;

export interface EmployeePrestaciones {
  /** Base prestacional mensual = salario + aux (si aplica) */
  basePrestacional: number;
  tieneAuxTransporte: boolean;
  /** Antigüedad total en días (desde ingreso hasta hoy o retiro) */
  antiguedadDias: number;
  /** Días trabajados en el año actual */
  diasAnio: number;
  /** Días trabajados en el semestre actual */
  diasSemestre: number;
  cesantiasAcum: number;
  interesesCesantiasAcum: number;
  primaAcum: number;
  /** Provisión de vacaciones acumulada del año en $ */
  vacacionesProvisionAcum: number;
  /** Días de vacaciones ganados en toda la relación laboral */
  vacacionesDiasGanados: number;
  /** Días tomados (eventos tipo 'vacaciones') */
  vacacionesDiasTomados: number;
  vacacionesDiasPendientes: number;
  /** Dotación: ¿tiene derecho? (salario ≤ 2 SMMLV) */
  dotacionAplica: boolean;
  dotacionEntregasAnio: number;
  /** Entregas de dotación ya vencidas este año y no registradas */
  dotacionPendientes: string[]; // fechas ISO vencidas sin entrega
  /** ¿Prima del semestre anterior/en curso pagada? (evento prima_pagada en el semestre) */
  primaSemestrePagada: boolean;
}

export function computeEmployeePrestaciones(
  emp: EmployeeRow,
  events: EmployeeEventRow[],
  params: LawParams,
  hoy = new Date(),
): EmployeePrestaciones {
  const ingreso = parseDate(emp.fecha_ingreso);
  const fin = emp.fecha_retiro ? parseDate(emp.fecha_retiro) : hoy;
  const finEfectivo = fin < hoy ? fin : hoy;

  const tieneAuxTransporte = emp.auxilio_transporte && emp.salario_base <= 2 * params.smmlv;
  const basePrestacional = emp.salario_base + (tieneAuxTransporte ? params.auxTransporte : 0);

  const antiguedadDias = daysBetween(ingreso, finEfectivo);

  const inicioAnio = new Date(finEfectivo.getFullYear(), 0, 1, 12);
  const inicioAnioEfectivo = ingreso > inicioAnio ? ingreso : inicioAnio;
  const diasAnio = daysBetween(inicioAnioEfectivo, finEfectivo);

  const inicioSemestre = finEfectivo.getMonth() < 6
    ? new Date(finEfectivo.getFullYear(), 0, 1, 12)
    : new Date(finEfectivo.getFullYear(), 6, 1, 12);
  const inicioSemEfectivo = ingreso > inicioSemestre ? ingreso : inicioSemestre;
  const diasSemestre = daysBetween(inicioSemEfectivo, finEfectivo);

  const cesantiasAcum = basePrestacional * diasAnio / 360;
  const interesesCesantiasAcum = cesantiasAcum * 0.12 * diasAnio / 360;
  const primaAcum = basePrestacional * diasSemestre / 360;
  const vacacionesProvisionAcum = emp.salario_base * diasAnio / 720;

  const empEvents = events.filter(e => e.employee_id === emp.id);
  const vacacionesDiasTomados = empEvents
    .filter(e => e.tipo === 'vacaciones')
    .reduce((s, e) => s + (e.dias ?? 0), 0);
  const vacacionesDiasGanados = Math.floor(antiguedadDias / 360 * 15 * 10) / 10;
  const vacacionesDiasPendientes = Math.max(0, Math.round((vacacionesDiasGanados - vacacionesDiasTomados) * 10) / 10);

  const anio = finEfectivo.getFullYear();
  const dotacionAplica = emp.salario_base <= 2 * params.smmlv && emp.tipo_contrato !== 'prestacion_servicios';
  const entregasAnio = empEvents.filter(e => e.tipo === 'dotacion' && e.fecha.startsWith(String(anio)));
  const dotacionPendientes: string[] = [];
  if (dotacionAplica) {
    for (const suffix of DOTACION_FECHAS) {
      const fechaLimite = `${anio}${suffix}`;
      if (parseDate(fechaLimite) > finEfectivo) continue; // aún no vence
      // ¿Hay una entrega registrada a ±45 días de la fecha límite?
      const cubierta = entregasAnio.some(e =>
        Math.abs(parseDate(e.fecha).getTime() - parseDate(fechaLimite).getTime()) <= 45 * DAY_MS
      );
      if (!cubierta) dotacionPendientes.push(fechaLimite);
    }
  }

  // Prima del semestre EN CURSO ya pagada (anticipada) o del semestre que acaba
  // de vencer: buscamos evento prima_pagada dentro del semestre actual.
  const primaSemestrePagada = empEvents.some(e =>
    e.tipo === 'prima_pagada' && parseDate(e.fecha) >= inicioSemestre,
  );

  return {
    basePrestacional,
    tieneAuxTransporte,
    antiguedadDias,
    diasAnio,
    diasSemestre,
    cesantiasAcum,
    interesesCesantiasAcum,
    primaAcum,
    vacacionesProvisionAcum,
    vacacionesDiasGanados,
    vacacionesDiasTomados,
    vacacionesDiasPendientes,
    dotacionAplica,
    dotacionEntregasAnio: entregasAnio.length,
    dotacionPendientes,
    primaSemestrePagada,
  };
}

export const EVENT_TIPO_LABEL: Record<string, string> = {
  dotacion: 'Dotación entregada',
  vacaciones: 'Vacaciones tomadas',
  incapacidad: 'Incapacidad',
  licencia: 'Licencia',
  prima_pagada: 'Prima pagada',
  cesantias_consignadas: 'Cesantías consignadas',
  intereses_pagados: 'Intereses de cesantías pagados',
  aumento_salario: 'Aumento de salario',
  otro: 'Otro',
};

export const TIPO_CONTRATO_LABEL: Record<string, string> = {
  indefinido: 'Término indefinido',
  fijo: 'Término fijo',
  obra_labor: 'Obra o labor',
  aprendizaje: 'Aprendizaje (SENA)',
  prestacion_servicios: 'Prestación de servicios',
};
