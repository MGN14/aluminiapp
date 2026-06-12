/**
 * Cálculo de costo laboral mensual para PYME colombiana.
 *
 * Bases legales (resumen):
 * - Prestaciones sociales (provisión mensual sobre devengado + aux transporte):
 *   cesantías 8.33%, intereses sobre cesantías 1% (12% anual / 12),
 *   prima de servicios 8.33%. Vacaciones 4.17% SOLO sobre salario
 *   (el aux de transporte no es base de vacaciones).
 * - Seguridad social patronal (sobre IBC = salario, sin aux transporte):
 *   salud 8.5%, pensión 12%, ARL según clase de riesgo (I 0.522% … V 6.96%).
 * - Parafiscales (sobre salario): caja de compensación 4%, SENA 2%, ICBF 3%.
 * - Exoneración Art 114-1 ET (Ley 1607/2012): personas jurídicas contribuyentes
 *   de renta NO pagan salud patronal, SENA ni ICBF por empleados que devenguen
 *   menos de 10 SMMLV. La caja (4%) se paga siempre.
 *
 * Esto es una PROVISIÓN gerencial, no una liquidación de nómina electrónica.
 */

export interface PayrollRates {
  /** % cesantías sobre (salario + aux transporte) */
  cesantias: number;
  /** % intereses de cesantías sobre (salario + aux transporte) */
  interesesCesantias: number;
  /** % prima de servicios sobre (salario + aux transporte) */
  prima: number;
  /** % vacaciones sobre salario (sin aux transporte) */
  vacaciones: number;
  /** % salud patronal sobre salario (0 si exonerado Art 114-1) */
  salud: number;
  /** % pensión patronal sobre salario */
  pension: number;
  /** % ARL sobre salario — depende de la clase de riesgo (I a V) */
  arl: number;
  /** % caja de compensación sobre salario (se paga siempre) */
  caja: number;
  /** % SENA sobre salario (0 si exonerado Art 114-1) */
  sena: number;
  /** % ICBF sobre salario (0 si exonerado Art 114-1) */
  icbf: number;
  /** Exoneración Art 114-1 ET: anula salud + SENA + ICBF patronales */
  exoneradoArt114: boolean;
}

/** Clase de riesgo III (manufactura liviana) como default razonable para
 *  fábrica/comercializadora de aluminio. Editable en la UI. */
export const DEFAULT_PAYROLL_RATES: PayrollRates = {
  cesantias: 8.33,
  interesesCesantias: 1,
  prima: 8.33,
  vacaciones: 4.17,
  salud: 8.5,
  pension: 12,
  arl: 2.436,
  caja: 4,
  sena: 2,
  icbf: 3,
  exoneradoArt114: true,
};

export const ARL_CLASES = [
  { clase: 'I — Riesgo mínimo (oficinas)', rate: 0.522 },
  { clase: 'II — Riesgo bajo', rate: 1.044 },
  { clase: 'III — Riesgo medio (manufactura liviana)', rate: 2.436 },
  { clase: 'IV — Riesgo alto', rate: 4.35 },
  { clase: 'V — Riesgo máximo', rate: 6.96 },
] as const;

export interface PayrollBreakdown {
  cesantias: number;
  interesesCesantias: number;
  prima: number;
  vacaciones: number;
  /** Suma de las 4 anteriores */
  provisionPrestaciones: number;
  salud: number;
  pension: number;
  arl: number;
  /** salud + pensión + ARL (patronal) */
  seguridadSocial: number;
  caja: number;
  sena: number;
  icbf: number;
  /** caja + SENA + ICBF */
  parafiscales: number;
  /** devengado + aux transporte + provisión + seg. social + parafiscales */
  totalCostoLaboral: number;
  /** Estimado del pago PILA del mes: aportes patronales + 8% retenido al
   *  empleado (4% salud + 4% pensión) que el empleador consigna por planilla */
  pilaEstimado: number;
}

const r0 = (n: number) => Math.round(n);

export function computePayroll(
  salaryTotal: number,
  transportAllowance: number,
  rates: PayrollRates,
): PayrollBreakdown {
  const salary = Math.max(0, salaryTotal || 0);
  const transport = Math.max(0, transportAllowance || 0);
  const basePrestaciones = salary + transport;

  const cesantias = r0(basePrestaciones * rates.cesantias / 100);
  const interesesCesantias = r0(basePrestaciones * rates.interesesCesantias / 100);
  const prima = r0(basePrestaciones * rates.prima / 100);
  const vacaciones = r0(salary * rates.vacaciones / 100);
  const provisionPrestaciones = cesantias + interesesCesantias + prima + vacaciones;

  const salud = rates.exoneradoArt114 ? 0 : r0(salary * rates.salud / 100);
  const pension = r0(salary * rates.pension / 100);
  const arl = r0(salary * rates.arl / 100);
  const seguridadSocial = salud + pension + arl;

  const caja = r0(salary * rates.caja / 100);
  const sena = rates.exoneradoArt114 ? 0 : r0(salary * rates.sena / 100);
  const icbf = rates.exoneradoArt114 ? 0 : r0(salary * rates.icbf / 100);
  const parafiscales = caja + sena + icbf;

  const totalCostoLaboral = salary + transport + provisionPrestaciones + seguridadSocial + parafiscales;
  const pilaEstimado = seguridadSocial + parafiscales + r0(salary * 0.08);

  return {
    cesantias, interesesCesantias, prima, vacaciones, provisionPrestaciones,
    salud, pension, arl, seguridadSocial,
    caja, sena, icbf, parafiscales,
    totalCostoLaboral, pilaEstimado,
  };
}

/** Normaliza un jsonb `rates` venido de la DB con los defaults actuales. */
export function parseRates(raw: unknown): PayrollRates {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PAYROLL_RATES };
  const o = raw as Record<string, unknown>;
  const num = (k: keyof PayrollRates) =>
    typeof o[k] === 'number' && isFinite(o[k] as number) ? (o[k] as number) : DEFAULT_PAYROLL_RATES[k] as number;
  return {
    cesantias: num('cesantias'),
    interesesCesantias: num('interesesCesantias'),
    prima: num('prima'),
    vacaciones: num('vacaciones'),
    salud: num('salud'),
    pension: num('pension'),
    arl: num('arl'),
    caja: num('caja'),
    sena: num('sena'),
    icbf: num('icbf'),
    exoneradoArt114: typeof o.exoneradoArt114 === 'boolean' ? o.exoneradoArt114 : DEFAULT_PAYROLL_RATES.exoneradoArt114,
  };
}
