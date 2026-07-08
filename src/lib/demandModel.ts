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
 * 2. ESTACIONALIDAD (montada, se activa sola): se acumula la serie mensual
 *    de salidas. Mientras haya <12 meses de historia el índice es 1 (neutro)
 *    y la UI muestra "esperando historia (N/12 meses)". Al cumplir 12, el
 *    índice del mes objetivo = promedio de ese mes calendario ÷ promedio
 *    mensual general, y empieza a ajustar el sugerido automáticamente.
 */

// Meses de historia necesarios para activar el índice estacional.
export const ESTACIONALIDAD_MESES_MIN = 12;
// Suavizado del índice estacional: se acota para que un solo mes atípico
// no dispare/hunda el sugerido (0.6x a 1.8x).
const INDICE_MIN = 0.6;
const INDICE_MAX = 1.8;

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
  /** Índice del próximo mes; 1 mientras no haya historia suficiente. */
  indiceEstacional: number;
  estacionalidadActiva: boolean;
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
      if (huboDiaSeco) huboQuiebre = huboQuiebre || vioVentaDespuesDeSeco;
    } else {
      huboDiaSeco = true;
    }
    if (mov) {
      salidasVentana += mov.salidas;
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

  // ── Serie mensual + estacionalidad ──
  const serieMensual = [...porMes.entries()]
    .map(([mes, salidas]) => ({ mes, salidas }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  const mesesDeHistoria = primerMovimiento
    ? Math.max(1, Math.round(
        (new Date(todayIso).getTime() - new Date(primerMovimiento).getTime()) / (30.44 * 86_400_000),
      ))
    : 0;
  const estacionalidadActiva = mesesDeHistoria >= ESTACIONALIDAD_MESES_MIN && serieMensual.length >= 6;

  let indiceEstacional = 1;
  if (estacionalidadActiva) {
    const mesObjetivo = addDaysIso(todayIso, 30).slice(5, 7); // mes calendario del próximo mes
    const delMes = serieMensual.filter((s) => s.mes.slice(5, 7) === mesObjetivo).map((s) => s.salidas);
    const todas = serieMensual.map((s) => s.salidas);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    if (delMes.length > 0 && avg(todas) > 0) {
      indiceEstacional = Math.min(INDICE_MAX, Math.max(INDICE_MIN, avg(delMes) / avg(todas)));
    }
  }

  return {
    consumoDiario,
    consumoDiarioSimple,
    salidasVentana,
    diasConStock,
    ventanaDias,
    huboQuiebre,
    serieMensual,
    mesesDeHistoria,
    indiceEstacional,
    estacionalidadActiva,
  };
}
