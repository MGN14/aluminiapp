import { describe, it, expect } from 'vitest';
import { calculatePenalties, DIAN_RATES } from './evasionPenalties';

describe('calculatePenalties', () => {
  it('sin gap devuelve todo en 0', () => {
    const r = calculatePenalties({ gap: 0, level: 'high' });
    expect(r.gapProyectado).toBe(0);
    expect(r.impuestoOmitido).toBe(0);
    expect(r.sancion).toBe(0);
    expect(r.intereses).toBe(0);
    expect(r.costoAuditoria).toBe(0);
    expect(r.costoEsperado).toBe(0);
    expect(r.ahorroEvadir).toBe(0);
    expect(r.valorEsperadoEvadir).toBe(0);
    expect(r.riesgoPenal).toBe(false);
  });

  it('proyecta gap linealmente al horizonte', () => {
    // gap de 100M en 12 meses → a 24 meses debería ser 200M
    const r = calculatePenalties({
      gap: 100_000_000,
      level: 'mid',
      periodMonths: 12,
      horizonMonths: 24,
    });
    expect(r.gapProyectado).toBe(200_000_000);
  });

  it('impuesto omitido = IVA + renta sobre gap proyectado', () => {
    const r = calculatePenalties({
      gap: 100_000_000,
      level: 'mid',
      periodMonths: 12,
      horizonMonths: 12, // para no proyectar
    });
    expect(r.ivaOmitido).toBeCloseTo(100_000_000 * DIAN_RATES.iva, 0);
    expect(r.rentaOmitida).toBeCloseTo(100_000_000 * DIAN_RATES.renta, 0);
    expect(r.impuestoOmitido).toBeCloseTo(
      r.ivaOmitido + r.rentaOmitida,
      0,
    );
  });

  it('sanción por inexactitud = 100% del impuesto omitido', () => {
    const r = calculatePenalties({
      gap: 50_000_000,
      level: 'high',
      periodMonths: 12,
      horizonMonths: 12,
    });
    expect(r.sancion).toBeCloseTo(r.impuestoOmitido * DIAN_RATES.sancionInexactitud, 0);
  });

  it('costo auditoria = impuesto + sanción + intereses', () => {
    const r = calculatePenalties({
      gap: 100_000_000,
      level: 'high',
      periodMonths: 12,
      horizonMonths: 24,
    });
    expect(r.costoAuditoria).toBeCloseTo(
      r.impuestoOmitido + r.sancion + r.intereses,
      0,
    );
  });

  it('probabilidad depende del nivel de riesgo', () => {
    const baseInput = { gap: 100_000_000, periodMonths: 12, horizonMonths: 24 };
    const low = calculatePenalties({ ...baseInput, level: 'low' });
    const mid = calculatePenalties({ ...baseInput, level: 'mid' });
    const high = calculatePenalties({ ...baseInput, level: 'high' });
    expect(low.probAuditoria).toBe(DIAN_RATES.probAuditoria24m.low);
    expect(mid.probAuditoria).toBe(DIAN_RATES.probAuditoria24m.mid);
    expect(high.probAuditoria).toBe(DIAN_RATES.probAuditoria24m.high);
    expect(low.probAuditoria).toBeLessThan(mid.probAuditoria);
    expect(mid.probAuditoria).toBeLessThan(high.probAuditoria);
  });

  it('override de probabilidad pisa el default del nivel', () => {
    const r = calculatePenalties({
      gap: 100_000_000,
      level: 'high',
      probAuditoriaOverride: 0.1,
    });
    expect(r.probAuditoria).toBe(0.1);
  });

  it('override se clampea a [0,1]', () => {
    const a = calculatePenalties({ gap: 100, level: 'low', probAuditoriaOverride: -5 });
    expect(a.probAuditoria).toBe(0);
    const b = calculatePenalties({ gap: 100, level: 'low', probAuditoriaOverride: 5 });
    expect(b.probAuditoria).toBe(1);
  });

  it('valor esperado evadir = ahorro − costo esperado', () => {
    const r = calculatePenalties({
      gap: 100_000_000,
      level: 'mid',
      periodMonths: 12,
      horizonMonths: 24,
    });
    expect(r.valorEsperadoEvadir).toBeCloseTo(r.ahorroEvadir - r.costoEsperado, 0);
  });

  it('a nivel high, formalizar sale mejor en valor esperado', () => {
    // Con probabilidad 50% en high y costoAuditoria > 2× ahorro, el VE es negativo.
    const r = calculatePenalties({
      gap: 100_000_000,
      level: 'high',
      periodMonths: 12,
      horizonMonths: 24,
    });
    // costo esperado > ahorro ⇒ VE negativo ⇒ formalizar es mejor
    expect(r.valorEsperadoEvadir).toBeLessThan(0);
  });

  it('riesgo penal cuando impuesto anualizado supera 250 SMLMV', () => {
    // Gap anual grande que hace impuesto omitido > umbral penal
    const r = calculatePenalties({
      gap: 10_000_000_000, // 10 mil millones en 12 meses
      level: 'high',
      periodMonths: 12,
      horizonMonths: 12,
    });
    expect(r.riesgoPenal).toBe(true);
  });

  it('no hay riesgo penal para SMB pequeña', () => {
    const r = calculatePenalties({
      gap: 50_000_000,
      level: 'high',
      periodMonths: 12,
      horizonMonths: 24,
    });
    expect(r.riesgoPenal).toBe(false);
  });

  it('caso real del usuario (389M gap en 12 meses, high)', () => {
    const r = calculatePenalties({
      gap: 389_000_000,
      level: 'high',
      periodMonths: 12,
      horizonMonths: 24,
    });
    // Gap a 24m: 778M
    expect(r.gapProyectado).toBe(778_000_000);
    // Impuesto omitido: 778M × 0.54 = 420.12M
    expect(r.impuestoOmitido).toBeCloseTo(778_000_000 * 0.54, 0);
    // VE < 0: formalizar gana
    expect(r.valorEsperadoEvadir).toBeLessThan(0);
  });

  it('inputs negativos colapsan a 0', () => {
    const r = calculatePenalties({ gap: -500, level: 'high' });
    expect(r.gapProyectado).toBe(0);
    expect(r.impuestoOmitido).toBe(0);
  });

  it('acepta tasas IVA y renta customizadas', () => {
    const r = calculatePenalties({
      gap: 100_000_000,
      level: 'mid',
      periodMonths: 12,
      horizonMonths: 12,
      ivaRate: 0.05,
      rentaRate: 0.1,
    });
    expect(r.ivaOmitido).toBeCloseTo(5_000_000, 0);
    expect(r.rentaOmitida).toBeCloseTo(10_000_000, 0);
  });
});
