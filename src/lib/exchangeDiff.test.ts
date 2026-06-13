import { describe, it, expect } from 'vitest';
import { computeExchangeDiff } from './exchangeDiff';

describe('computeExchangeDiff', () => {
  it('pérdida realizada cuando el dólar subió entre causación y pago', () => {
    const r = computeExchangeDiff({
      trmCausacion: 4000,
      payments: [{ amount_usd: 1000, trm: 4200 }],
      saldoUsd: 0,
      trmHoy: 4300,
    });
    // 1000 × (4200 − 4000) = +200.000 (pérdida)
    expect(r.realizada).toBe(200_000);
    expect(r.noRealizada).toBe(0);
    expect(r.total).toBe(200_000);
  });

  it('ganancia cuando el dólar bajó', () => {
    const r = computeExchangeDiff({
      trmCausacion: 4000,
      payments: [{ amount_usd: 1000, trm: 3800 }],
      saldoUsd: 0, trmHoy: 0,
    });
    expect(r.total).toBe(-200_000); // ganancia
  });

  it('diferencia no realizada sobre el saldo a TRM de hoy', () => {
    const r = computeExchangeDiff({
      trmCausacion: 4000,
      payments: [{ amount_usd: 1000, trm: 4000 }],
      saldoUsd: 2000,
      trmHoy: 4250,
    });
    expect(r.realizada).toBe(0);               // pagó a la misma TRM
    expect(r.noRealizada).toBe(500_000);       // 2000 × (4250 − 4000)
    expect(r.total).toBe(500_000);
  });

  it('combina realizada + no realizada', () => {
    const r = computeExchangeDiff({
      trmCausacion: 4000,
      payments: [{ amount_usd: 1000, trm: 4100 }, { amount_usd: 500, trm: 4200 }],
      saldoUsd: 1000,
      trmHoy: 4300,
    });
    // realizada = 1000×100 + 500×200 = 200.000 ; no realizada = 1000×300 = 300.000
    expect(r.realizada).toBe(200_000);
    expect(r.noRealizada).toBe(300_000);
    expect(r.total).toBe(500_000);
  });

  it('sin trm_causacion usa la TRM del primer abono como referencia', () => {
    const r = computeExchangeDiff({
      trmCausacion: null,
      payments: [{ amount_usd: 1000, trm: 4000 }, { amount_usd: 1000, trm: 4200 }],
      saldoUsd: 0, trmHoy: 0,
    });
    expect(r.trmReferencia).toBe(4000);
    // primer abono 1000×0 + segundo 1000×200 = 200.000
    expect(r.realizada).toBe(200_000);
  });

  it('TRM promedio ponderada de los abonos', () => {
    const r = computeExchangeDiff({
      trmCausacion: 4000,
      payments: [{ amount_usd: 1000, trm: 4000 }, { amount_usd: 3000, trm: 4400 }],
      saldoUsd: 0, trmHoy: 0,
    });
    // (1000×4000 + 3000×4400) / 4000 = 4300
    expect(r.trmPromedioPagos).toBe(4300);
  });

  it('sin abonos ni causación → todo 0, sin referencia', () => {
    const r = computeExchangeDiff({ trmCausacion: null, payments: [], saldoUsd: 5000, trmHoy: 4200 });
    expect(r.trmReferencia).toBeNull();
    expect(r.total).toBe(0);
  });

  it('trmHoy null → no realizada en 0 (no revalúa el saldo)', () => {
    const r = computeExchangeDiff({
      trmCausacion: 4000,
      payments: [{ amount_usd: 1000, trm: 4100 }],
      saldoUsd: 2000, trmHoy: null,
    });
    expect(r.realizada).toBe(100_000);
    expect(r.noRealizada).toBe(0);
    expect(r.total).toBe(100_000);
  });

  it('saldo negativo (sobre-pago) → no realizada en 0', () => {
    const r = computeExchangeDiff({
      trmCausacion: 4000,
      payments: [{ amount_usd: 1000, trm: 4000 }],
      saldoUsd: -500, trmHoy: 4300,
    });
    expect(r.noRealizada).toBe(0);
  });

  it('fallback toma el abono más ANTIGUO por fecha, no el orden de llegada', () => {
    const r = computeExchangeDiff({
      trmCausacion: null,
      payments: [
        { amount_usd: 1000, trm: 4200, fecha: '2026-03-10' },
        { amount_usd: 1000, trm: 4000, fecha: '2026-01-05' }, // más antiguo
      ],
      saldoUsd: 0, trmHoy: 0,
    });
    expect(r.trmReferencia).toBe(4000); // el de enero, no el primero del array
    expect(r.realizada).toBe(200_000);  // 1000×0 (ene) + 1000×200 (mar)
  });

  it('ignora abonos con TRM o monto inválidos', () => {
    const r = computeExchangeDiff({
      trmCausacion: 4000,
      payments: [{ amount_usd: 1000, trm: 4200 }, { amount_usd: 0, trm: 4500 }, { amount_usd: 500, trm: 0 }],
      saldoUsd: 0, trmHoy: 0,
    });
    expect(r.realizada).toBe(200_000); // solo el primer abono cuenta
  });
});
