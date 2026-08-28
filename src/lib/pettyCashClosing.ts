/**
 * Cálculo del saldo esperado al cerrar caja menor.
 *
 * El cierre computaba solo (ingresos − egresos) DEL PERÍODO e ignoraba la
 * plata que ya había en la caja el primer día. Con eso, cualquier mes que
 * gastara más de lo que ingresó daba un "debería haber" NEGATIVO —imposible
 * en una caja física— y marcaba un sobrante falso por todo el saldo previo.
 * Caso real (Nico, cerrando agosto 2026): computado −$2.287.262 y "sobran
 * $3.287.262" cuando en la caja había exactamente lo que tenía que haber.
 *
 * La cuenta correcta es la de cualquier arqueo:
 *
 *     con lo que arrancó  +  lo que entró  −  lo que salió
 *
 * El arrastre incluye los movimientos ya cerrados (esa plata sigue en la
 * caja) y las diferencias de cierres anteriores: un sobrante pasado es plata
 * real que existe aunque ningún movimiento la explique.
 */

import { signoCaja } from '@/hooks/usePettyCashMovements';

export interface ClosingMovement {
  date: string;
  amount: number;
  kind: string | null;
  cuenta: string;
}

export interface PriorClosing {
  period_end: string;
  difference: number;
}

export interface ClosingBalance {
  /** Saldo con el que arrancó el período, por cuenta. */
  arrastrePorCuenta: Record<string, number>;
  /** Arrastre total (incluye el ajuste por diferencias de cierres previos). */
  arrastreTotal: number;
  /** Suma de las diferencias de los cierres anteriores al período. */
  ajusteCierresPrevios: number;
  totalIngresos: number;
  totalEgresos: number;
  /** Saldo esperado por cuenta = arrastre de esa cuenta + su movimiento. */
  computadoPorCuenta: Record<string, number>;
  /** Saldo esperado total = arrastre + ingresos − egresos. */
  computedBalance: number;
}

export function computeClosingBalance(
  /** TODOS los movimientos conocidos (cerrados incluidos), no solo los del período. */
  allRows: ClosingMovement[],
  /** Movimientos que entran en este cierre. */
  periodRows: ClosingMovement[],
  periodStart: string,
  priorClosings: PriorClosing[] = [],
): ClosingBalance {
  const arrastrePorCuenta: Record<string, number> = {};
  for (const r of allRows) {
    if (r.date >= periodStart) continue;
    arrastrePorCuenta[r.cuenta] = (arrastrePorCuenta[r.cuenta] ?? 0) + signoCaja(r.kind) * r.amount;
  }

  const ajusteCierresPrevios = priorClosings
    .filter((c) => c.period_end < periodStart)
    .reduce((s, c) => s + (Number(c.difference) || 0), 0);

  const arrastreTotal =
    Object.values(arrastrePorCuenta).reduce((s, v) => s + v, 0) + ajusteCierresPrevios;

  let totalIngresos = 0;
  let totalEgresos = 0;
  const computadoPorCuenta: Record<string, number> = { ...arrastrePorCuenta };
  for (const r of periodRows) {
    if (r.kind === 'ingreso_efectivo') totalIngresos += r.amount;
    else totalEgresos += r.amount;
    computadoPorCuenta[r.cuenta] = (computadoPorCuenta[r.cuenta] ?? 0) + signoCaja(r.kind) * r.amount;
  }

  return {
    arrastrePorCuenta,
    arrastreTotal,
    ajusteCierresPrevios,
    totalIngresos,
    totalEgresos,
    computadoPorCuenta,
    computedBalance: arrastreTotal + totalIngresos - totalEgresos,
  };
}
