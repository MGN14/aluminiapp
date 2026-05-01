// ── Calendario DIAN 2026 ────────────────────────────────────────
// Basado en el Decreto 2229 de 2023 (calendario tributario Colombia)
// Fechas por último dígito del NIT
// VERIFICAR con tu contador ante cambios normativos.

export const VENCIMIENTOS_IVA_2026: Record<number, string[]> = {
  // Bimestral: 6 períodos
  0: ['2026-03-10','2026-05-12','2026-07-09','2026-09-09','2026-11-10','2027-01-12'],
  1: ['2026-03-11','2026-05-13','2026-07-10','2026-09-10','2026-11-11','2027-01-13'],
  2: ['2026-03-12','2026-05-14','2026-07-13','2026-09-11','2026-11-12','2027-01-14'],
  3: ['2026-03-13','2026-05-15','2026-07-14','2026-09-14','2026-11-13','2027-01-15'],
  4: ['2026-03-16','2026-05-18','2026-07-15','2026-09-15','2026-11-16','2027-01-16'],
  5: ['2026-03-17','2026-05-19','2026-07-16','2026-09-16','2026-11-17','2027-01-19'],
  6: ['2026-03-18','2026-05-20','2026-07-17','2026-09-17','2026-11-18','2027-01-20'],
  7: ['2026-03-19','2026-05-21','2026-07-20','2026-09-18','2026-11-19','2027-01-21'],
  8: ['2026-03-20','2026-05-22','2026-07-21','2026-09-21','2026-11-20','2027-01-22'],
  9: ['2026-03-23','2026-05-25','2026-07-22','2026-09-22','2026-11-23','2027-01-23'],
};

export const PERIODOS_IVA = ['Ene-Feb', 'Mar-Abr', 'May-Jun', 'Jul-Ago', 'Sep-Oct', 'Nov-Dic'];

// IVA Cuatrimestral 2026 — aplica a régimen común con ingresos < 92.000 UVT del año anterior.
// 3 períodos: Ene-Abr (vence mayo), May-Ago (vence sep), Sep-Dic (vence ene 2027).
// Fechas tomadas de VENCIMIENTOS_IVA_2026 en los índices 1, 3, 5 — son los mismos vencimientos DIAN.
export const VENCIMIENTOS_IVA_CUATRIMESTRAL_2026: Record<number, string[]> = Object.fromEntries(
  Object.entries(VENCIMIENTOS_IVA_2026).map(([digit, dates]) => [
    digit,
    [dates[1], dates[3], dates[5]],
  ]),
) as Record<number, string[]>;

export const PERIODOS_IVA_CUATRIMESTRAL = ['Ene-Abr', 'May-Ago', 'Sep-Dic'];

export const VENCIMIENTOS_RETEFUENTE_2026: Record<number, string[]> = {
  0: ['2026-02-10','2026-03-10','2026-04-09','2026-05-12','2026-06-09','2026-07-09','2026-08-11','2026-09-09','2026-10-08','2026-11-10','2026-12-09','2027-01-12'],
  1: ['2026-02-11','2026-03-11','2026-04-10','2026-05-13','2026-06-10','2026-07-10','2026-08-12','2026-09-10','2026-10-09','2026-11-11','2026-12-10','2027-01-13'],
  2: ['2026-02-12','2026-03-12','2026-04-13','2026-05-14','2026-06-11','2026-07-13','2026-08-13','2026-09-11','2026-10-13','2026-11-12','2026-12-11','2027-01-14'],
  3: ['2026-02-13','2026-03-13','2026-04-14','2026-05-15','2026-06-12','2026-07-14','2026-08-14','2026-09-14','2026-10-14','2026-11-13','2026-12-14','2027-01-15'],
  4: ['2026-02-16','2026-03-16','2026-04-15','2026-05-18','2026-06-15','2026-07-15','2026-08-17','2026-09-15','2026-10-15','2026-11-16','2026-12-15','2027-01-16'],
  5: ['2026-02-17','2026-03-17','2026-04-16','2026-05-19','2026-06-16','2026-07-16','2026-08-18','2026-09-16','2026-10-16','2026-11-17','2026-12-16','2027-01-19'],
  6: ['2026-02-18','2026-03-18','2026-04-17','2026-05-20','2026-06-17','2026-07-17','2026-08-19','2026-09-17','2026-10-19','2026-11-18','2026-12-17','2027-01-20'],
  7: ['2026-02-19','2026-03-19','2026-04-20','2026-05-21','2026-06-18','2026-07-20','2026-08-20','2026-09-18','2026-10-20','2026-11-19','2026-12-18','2027-01-21'],
  8: ['2026-02-20','2026-03-20','2026-04-21','2026-05-22','2026-06-19','2026-07-21','2026-08-21','2026-09-21','2026-10-21','2026-11-20','2026-12-21','2027-01-22'],
  9: ['2026-02-23','2026-03-23','2026-04-22','2026-05-25','2026-06-22','2026-07-22','2026-08-24','2026-09-22','2026-10-22','2026-11-23','2026-12-22','2027-01-23'],
};

export const MESES_RETEFUENTE = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// Renta 2026 — Personas jurídicas (año gravable 2025) — abril 2026 según último dígito
export const VENCIMIENTOS_RENTA_JURIDICA_2026: Record<number, string> = {
  0: '2026-04-14', 1: '2026-04-15', 2: '2026-04-16',
  3: '2026-04-17', 4: '2026-04-20', 5: '2026-04-21',
  6: '2026-04-22', 7: '2026-04-23', 8: '2026-04-24',
  9: '2026-04-27',
};

// Renta 2026 — Personas naturales (año gravable 2025) — agosto/sep/oct 2026
// Usamos últimos 2 dígitos del NIT, pero simplificamos a 1 dígito promediando.
// Fechas orientativas agosto 2026.
export const VENCIMIENTOS_RENTA_NATURAL_2026: Record<number, string> = {
  0: '2026-08-11', 1: '2026-08-12', 2: '2026-08-13',
  3: '2026-08-14', 4: '2026-08-17', 5: '2026-08-18',
  6: '2026-08-19', 7: '2026-08-20', 8: '2026-08-21',
  9: '2026-08-24',
};

// ICA Bogotá bimestral 2026 (Secretaría de Hacienda). Aproximado por último dígito.
// Referencia: calendario 2026 — ajustar si tu municipio difiere.
export const VENCIMIENTOS_ICA_BOGOTA_2026: Record<number, string[]> = {
  0: ['2026-03-19','2026-05-21','2026-07-23','2026-09-17','2026-11-19','2027-01-21'],
  1: ['2026-03-19','2026-05-21','2026-07-23','2026-09-17','2026-11-19','2027-01-21'],
  2: ['2026-03-19','2026-05-21','2026-07-23','2026-09-17','2026-11-19','2027-01-21'],
  3: ['2026-03-20','2026-05-22','2026-07-24','2026-09-18','2026-11-20','2027-01-22'],
  4: ['2026-03-20','2026-05-22','2026-07-24','2026-09-18','2026-11-20','2027-01-22'],
  5: ['2026-03-20','2026-05-22','2026-07-24','2026-09-18','2026-11-20','2027-01-22'],
  6: ['2026-03-23','2026-05-25','2026-07-27','2026-09-21','2026-11-23','2027-01-25'],
  7: ['2026-03-23','2026-05-25','2026-07-27','2026-09-21','2026-11-23','2027-01-25'],
  8: ['2026-03-24','2026-05-26','2026-07-28','2026-09-22','2026-11-24','2027-01-26'],
  9: ['2026-03-24','2026-05-26','2026-07-28','2026-09-22','2026-11-24','2027-01-26'],
};

export const PERIODOS_ICA = ['Ene-Feb','Mar-Abr','May-Jun','Jul-Ago','Sep-Oct','Nov-Dic'];

export type ObligacionTipo =
  | 'iva'
  | 'retefuente'
  | 'renta'
  | 'ica'
  | 'arriendo'
  | 'nomina'
  | 'pila'
  | 'servicios'
  | 'parafiscales'
  | 'cesantias'
  | 'credito'
  | 'otro';

export interface CalendarEvent {
  id: string;
  tipo: ObligacionTipo;
  descripcion: string;
  fecha: Date;
  periodo: string;
  monto?: number | null;
  origen: 'dian' | 'ica' | 'negocio' | 'credito';
  // For negocio events: ID of the business_obligation row (needed to toggle `completadas`).
  obligationId?: string;
  // For credito events: link de regreso al crédito.
  creditId?: string;
}

export const TIPO_COLOR: Record<ObligacionTipo, string> = {
  iva: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-300',
  retefuente: 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-950/40 dark:text-orange-300',
  renta: 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-950/40 dark:text-purple-300',
  ica: 'bg-pink-100 text-pink-700 border-pink-300 dark:bg-pink-950/40 dark:text-pink-300',
  arriendo: 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300',
  nomina: 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300',
  pila: 'bg-teal-100 text-teal-700 border-teal-300 dark:bg-teal-950/40 dark:text-teal-300',
  servicios: 'bg-sky-100 text-sky-700 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300',
  parafiscales: 'bg-indigo-100 text-indigo-700 border-indigo-300 dark:bg-indigo-950/40 dark:text-indigo-300',
  cesantias: 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300',
  credito: 'bg-cyan-100 text-cyan-700 border-cyan-300 dark:bg-cyan-950/40 dark:text-cyan-300',
  otro: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300',
};

export const TIPO_LABEL: Record<ObligacionTipo, string> = {
  iva: 'IVA',
  retefuente: 'Retefuente',
  renta: 'Renta',
  ica: 'ICA',
  arriendo: 'Arriendo',
  nomina: 'Nómina',
  pila: 'PILA',
  servicios: 'Servicios',
  parafiscales: 'Parafiscales',
  cesantias: 'Cesantías',
  credito: 'Crédito',
  otro: 'Otro',
};

export const TIPO_ORIGEN: Record<ObligacionTipo, 'dian' | 'ica' | 'negocio' | 'credito'> = {
  iva: 'dian',
  retefuente: 'dian',
  renta: 'dian',
  ica: 'ica',
  arriendo: 'negocio',
  nomina: 'negocio',
  pila: 'negocio',
  servicios: 'negocio',
  parafiscales: 'negocio',
  cesantias: 'negocio',
  credito: 'credito',
  otro: 'negocio',
};
