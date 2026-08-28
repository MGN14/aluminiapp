import { describe, it, expect } from 'vitest';
import { computeClosingBalance, type ClosingMovement } from './pettyCashClosing';

const mov = (date: string, amount: number, kind: string, cuenta = 'efectivo'): ClosingMovement =>
  ({ date, amount, kind, cuenta });

describe('computeClosingBalance', () => {
  it('CASO NICO (agosto 2026): con arrastre el saldo deja de dar negativo', () => {
    // La caja venía con plata de julio; agosto gastó más de lo que ingresó.
    const previos = [mov('2026-07-10', 5_000_000, 'ingreso_efectivo')];
    const agosto = [
      mov('2026-08-05', 3_881_200, 'ingreso_efectivo'),
      mov('2026-08-20', 6_168_462, 'gasto_efectivo'),
    ];
    const r = computeClosingBalance([...previos, ...agosto], agosto, '2026-08-01');

    expect(r.arrastreTotal).toBe(5_000_000);
    // Antes daba −2.287.262 (solo el neto del mes). Ahora: 5M + 3.88M − 6.17M
    expect(r.computedBalance).toBe(2_712_738);
    expect(r.computedBalance).toBeGreaterThan(0);
  });

  it('el arrastre cuenta los movimientos YA cerrados (la plata sigue en la caja)', () => {
    const all = [mov('2026-07-01', 900_000, 'ingreso_efectivo')];
    const r = computeClosingBalance(all, [], '2026-08-01');
    expect(r.arrastreTotal).toBe(900_000);
  });

  it('las diferencias de cierres previos suman al arrastre', () => {
    const all = [mov('2026-07-01', 1_000_000, 'ingreso_efectivo')];
    const r = computeClosingBalance(all, [], '2026-08-01', [
      { period_end: '2026-07-31', difference: 50_000 },   // sobró plata real
      { period_end: '2026-08-31', difference: 99_999 },   // posterior: no cuenta
    ]);
    expect(r.ajusteCierresPrevios).toBe(50_000);
    expect(r.arrastreTotal).toBe(1_050_000);
  });

  it('el retiro baja el saldo pero no es ingreso ni gasto del período', () => {
    const agosto = [mov('2026-08-30', 2_000_000, 'retiro_efectivo')];
    const r = computeClosingBalance([mov('2026-07-01', 3_000_000, 'ingreso_efectivo'), ...agosto], agosto, '2026-08-01');
    expect(r.computedBalance).toBe(1_000_000);
    expect(r.totalIngresos).toBe(0);
    expect(r.totalEgresos).toBe(2_000_000); // sale de la caja
  });

  it('el arrastre y el computado se llevan POR CUENTA', () => {
    const all = [
      mov('2026-07-01', 500_000, 'ingreso_efectivo', 'efectivo'),
      mov('2026-07-01', 200_000, 'ingreso_efectivo', 'nequi'),
    ];
    const agosto = [mov('2026-08-10', 100_000, 'gasto_efectivo', 'nequi')];
    const r = computeClosingBalance([...all, ...agosto], agosto, '2026-08-01');
    expect(r.arrastrePorCuenta).toEqual({ efectivo: 500_000, nequi: 200_000 });
    expect(r.computadoPorCuenta).toEqual({ efectivo: 500_000, nequi: 100_000 });
  });

  it('sin historial previo el arrastre es 0 (comportamiento viejo)', () => {
    const agosto = [mov('2026-08-05', 100_000, 'ingreso_efectivo'), mov('2026-08-06', 30_000, 'gasto_efectivo')];
    const r = computeClosingBalance(agosto, agosto, '2026-08-01');
    expect(r.arrastreTotal).toBe(0);
    expect(r.computedBalance).toBe(70_000);
  });
});
