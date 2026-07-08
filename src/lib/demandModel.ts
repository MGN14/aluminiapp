/**
 * Modelo de demanda por familia de referencias — las herramientas para que
 * el análisis de cobertura mejore solo a medida que entra historia:
 *
 * 1. CONSUMO CENSURADO (idea de Nico, generalizada): medir la demanda solo
 *    sobre los días en que HABÍA stock. Se reconstruye el stock día a día
 *    hacia atrás desde el stock físico actual usando los movimientos
 *    (entradas y salidas). Si una referencia vendió 500 unds en 21 días y
 *    después estuvo agotada 69, su demanda real es 500/21 ≈ 23,8/día — no
 *    500/90 = 5,6. El sugerido crece solo cuando hay quiebres repetidos,
 *    sin escalones arbitrarios.
 *
 * 2. TENDENCIA DE CORTO PLAZO (planteo de Nico: escasez, mercado saturado,
 *    regulación nueva, demoras en puerto — cambios DENTRO del año): tasa
 *    censurada de los últimos 30 días vs la de la ventana completa. Activa
 *    desde la primera semana de datos; acotada para no sobre-reaccionar.
 *
 * 3. ESTACIONALIDAD ANUAL (activa desde el primer dato, madura a los 12
 *    meses): índice del mes objetivo = promedio de ese mes calendario ÷
 *    promedio mensual general, PONDERADO por madurez (meses/12). Con 3
 *    meses de historia aplica el 25% de la señal; con 12+, el 100%. El
 *    disclaimer de "a medias" vive en la UI — decisión de Nico: el dato
 *    sirve desde el primer momento si se lee sabiendo que le falta tiempo.
 */

// Meses de historia para considerar MADURA la estacionalidad anual.
export const ESTACIONALIDAD_MESES_MADURA = 12;
// Cotas del índice estacional crudo (un mes atípico no dispara el sugerido).
const ESTACIONAL_MIN = 0.6;
const ESTACIONAL_MAX = 1.8;
// Cotas de la tendencia de corto plazo (30d vs ventana).
const TENDENCIA_MIN = 0.5;
const TENDENCIA_MAX = 2.0;
// Cota del factor combinado (tendencia × estacionalidad).
const FACTOR_MIN = 0.5;
const FACTOR_MAX = 2.2;
// Días de la sub-ventana de tendencia y mínimo de días con stock para medirla.
const TENDENCIA_DIAS = 30;
const TENDENCIA_MIN_DIAS_CON_STOCK = 7;

export interface DemandMovement {
  tipo: 'entrada' | 'salida';
  quantity: number;
  /** ISO YYYY-MM-DD */
  date: string;
}

export interface FamilyDemand {
  /** Consumo diario CENSURADO: salidas ÷ días con stock (el que usa el motor). */
  consumoDiario: number;
  /** Consumo ingenuo (salidas ÷ ventana) — para mostrar la diferencia. */
  consumoDiarioSimple: number;
  salidasVentana: number;
  /** Días de la ventana en que la familia tuvo stock > 0. */
  diasConStock: number;
  ventanaDias: number;
  /** true si hubo días sin stock con ventas antes y después (censura real). */
  huboQuiebre: boolean;
  /** Serie mensual de salidas (toda la historia consultada), 'YYYY-MM'. */
  serieMensual: { mes: string; salidas: number }[];
  mesesDeHistoria: number;
  /** Tendencia de corto plazo: tasa censurada 30d ÷ tasa de la ventana.
   *  >1 = acelerando (escasez, demanda caliente); <1 = frenando. */
  indiceTendencia: number;
  /** Índice estacional del mes objetivo, YA ponderado por madurez
   *  (señal × meses/12). 1 = neutro o sin muestra del mes. */
  indiceEstacional: number;
  /** true si hay muestra del mes calendario objetivo en la historia. */
  estacionalidadActiva: boolean;
  /** true con 12+ meses de historia (señal al 100%). */
  estacionalidadMadura: boolean;
  /** Factor combinado que ajusta el sugerido: tendencia × estacional, acotado. */
  factorDemanda: number;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Demanda de UNA familia a partir de sus movimientos y su stock actual.
 * `movimientos` puede traer más historia que la ventana (sirve para la serie
 * mensual); el consumo censurado se mide solo dentro de `ventanaDias`.
 */
export function computeFamilyDemand(params: {
  todayIso: string;
  ventanaDias: number;
  stockActual: number;
  movimientos: DemandMovement[];
}): FamilyDemand {
  const { todayIso, ventanaDias, movimientos } = params;
  const desdeVentana = addDaysIso(todayIso, -ventanaDias);

  // Neto por día (salidas positivas, entradas negativas) para reconstruir
  // el stock hacia atrás: stock(d-1) = stock(d) + salidas(d) − entradas(d).
  const netoPorDia = new Map<string, { salidas: number; entradas: number }>();
  const porMes = new Map<string, number>();
  let primerMovimiento: string | null = null;

  for (const m of movimientos) {
    const qty = Math.abs(Number(m.quantity ?? 0));
    if (qty <= 0 || !m.date) continue;
    const day = m.date.slice(0, 10);
    const acc = netoPorDia.get(day) ?? { salidas: 0, entradas: 0 };
    if (m.tipo === 'salida') acc.salidas += qty;
    else acc.entradas += qty;
    netoPorDia.set(day, acc);
    if (m.tipo === 'salida') {
      const mes = day.slice(0, 7);
      porMes.set(mes, (porMes.get(mes) ?? 0) + qty);
    }
    if (primerMovimiento === null || day < primerMovimiento) primerMovimiento = day;
  }

  // ── Reconstrucción del stock, día a día hacia atrás ──
  let stock = Math.max(0, Number(params.stockActual ?? 0));
  let diasConStock = 0;
  let salidasVentana = 0;
  // Sub-ventana de tendencia: los últimos TENDENCIA_DIAS.
  let diasConStock30 = 0;
  let salidas30 = 0;
  let vioVentaDespuesDeSeco = false;
  let huboDiaSeco = false;
  let huboQuiebre = false;

  for (let i = 0; i < ventanaDias; i++) {
    const day = addDaysIso(todayIso, -i);
    if (day < desdeVentana) break;
    const mov = netoPorDia.get(day);
    // El stock "del día" es el de apertura: el de cierre + lo que salió − lo que entró.
    if (stock > 0.001) {
      diasConStock++;
      if (i < TENDENCIA_DIAS) diasConStock30++;
      if (huboDiaSeco) huboQuiebre = huboQuiebre || vioVentaDespuesDeSeco;
    } else {
      huboDiaSeco = true;
    }
    if (mov) {
      salidasVentana += mov.salidas;
      if (i < TENDENCIA_DIAS) salidas30 += mov.salidas;
      if (mov.salidas > 0) vioVentaDespuesDeSeco = true;
      stock = Math.max(0, stock + mov.salidas - mov.entradas);
    }
  }

  const consumoDiarioSimple = salidasVentana / ventanaDias;
  // Censurado: si vendió, al menos 1 día tuvo stock (defensa contra datos
  // imperfectos donde la reconstrucción da 0 días).
  const consumoDiario = salidasVentana > 0
    ? salidasVentana / Math.max(diasConStock, 1)
    : 0;

  // ── Tendencia de corto plazo: tasa 30d vs tasa de la ventana ──
  // Solo si en los últimos 30 días hubo stock suficiente para "leer" demanda
  // (una ref agotada 30 días no dice nada de tendencia → neutro).
  let indiceTendencia = 1;
  if (consumoDiario > 0 && diasConStock30 >= TENDENCIA_MIN_DIAS_CON_STOCK) {
    const tasa30 = salidas30 / diasConStock30;
    indiceTendencia = Math.min(TENDENCIA_MAX, Math.max(TENDENCIA_MIN, tasa30 / consumoDiario));
  }

  // ── Serie mensual + estacionalidad ──
  const serieMensual = [...porMes.entries()]
    .map(([mes, salidas]) => ({ mes, salidas }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  const mesesDeHistoria = primerMovimiento
    ? Math.max(1, Math.round(
        (new Date(todayIso).getTime() - new Date(primerMovimiento).getTime()) / (30.44 * 86_400_000),
      ))
    : 0;
  const estacionalidadMadura = mesesDeHistoria >= ESTACIONALIDAD_MESES_MADURA;

  // Activa desde el PRIMER dato del mes calendario objetivo (decisión de
  // Nico: vale desde ya, leída con pinzas). La señal se pondera por madurez:
  // índice aplicado = 1 + (crudo − 1) × min(meses/12, 1) — con 3 meses pesa
  // 25%, con 12+ el 100%. El disclaimer "a medias" vive en la UI.
  let indiceEstacional = 1;
  let estacionalidadActiva = false;
  {
    const mesObjetivo = addDaysIso(todayIso, 30).slice(5, 7); // mes calendario del próximo mes
    const delMes = serieMensual.filter((s) => s.mes.slice(5, 7) === mesObjetivo).map((s) => s.salidas);
    const todas = serieMensual.map((s) => s.salidas);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    if (delMes.length > 0 && todas.length >= 2 && avg(todas) > 0) {
      estacionalidadActiva = true;
      const crudo = Math.min(ESTACIONAL_MAX, Math.max(ESTACIONAL_MIN, avg(delMes) / avg(todas)));
      const madurez = Math.min(1, mesesDeHistoria / ESTACIONALIDAD_MESES_MADURA);
      indiceEstacional = 1 + (crudo - 1) * madurez;
    }
  }

  const factorDemanda = Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, indiceTendencia * indiceEstacional));

  return {
    consumoDiario,
    consumoDiarioSimple,
    salidasVentana,
    diasConStock,
    ventanaDias,
    huboQuiebre,
    serieMensual,
    mesesDeHistoria,
    indiceTendencia,
    indiceEstacional,
    estacionalidadActiva,
    estacionalidadMadura,
    factorDemanda,
  };
}
