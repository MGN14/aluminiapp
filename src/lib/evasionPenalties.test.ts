import { describe, it, expect } from 'vitest';
import { calculatePenalties, DIAN_RATES, CASH_RISKS } from './evasionPenalties';

describe('calculatePenalties', () => {
  it('sin gap devuelve todo en 0', () => {
    const r = calculatePenalties({ gap: 0, level: 'high' });
    expect(r.gapProyectado).toBe(0);
    expect(r.cashProyectado).toBe(0);
    expect(r.auditableProyectado).toBe(0);
    expect(r.impuestoOmitidoTotal).toBe(0);
    expect(r.impuestoAuditable).toBe(0);
    expect(r.sancion).toBe(0);
    expect(r.intereses).toBe(0);
    expect(r.costoAuditoria).toBe(0);
    expect(r.costoEsperado).toBe(0);
    expect(r.ahorroEvadir).toBe(0);
    expect(r.valorEsperadoEvadir).toBe(0);
    expect(r.riesgoPenal).toBe(false);
  });

  it('proyecta gap y cash linealmente al horizonte', () => {
    const r = calculatePenalties({
      gap: 100_000_000,
      cashPortion: 30_000_000,
      level: 'mid',
      periodMonths: 12,
      horizonMonths: 24,
    });
    expect(r.gapProyectado).toBe(200_000_000);
    expect(r.cashProyectado).toBe(60_000_000);
    expect(r.auditableProyectado).toBe(140_000_000);
  });

  it('sin cashPortion, todo es auditable', () => {
    const r = calculatePenalties({
      gap: 100_000_000,
      level: 'high',
      periodMonths: 12,
      horizonMonths: 12,
    });
    expect(r.cashProyectado).toBe(0);
    expect(r.auditableProyectado).toBe(100_000_000);
    expect(r.impuestoAuditable).toBeCloseTo(100_000_000 * (DIAN_RATES.iva + DIAN_RATES.renta), 0);
  });

  it('si todo el gap es cash, no hay impuesto auditable ni sanción', () => {
    // Todo efectivo: la DIAN por cruce estándar no ve nada.
    const r = calculatePenalties({
      gap: 50_000_000,
      cashPortion: 50_000_000,
      level: 'high',
      periodMonths: 12,
      horizonMonths: 12,
    });
    expect(r.auditableProyectado).toBe(0);
    expect(r.impuestoAuditable).toBe(0);
    expect(r.sancion).toBe(0);
    expect(r.intereses).toBe(0);
    expect(r.costoAuditoria).toBe(0);
    expect(r.costoEsperado).toBe(0);
    // Pero sí hay ahorro tributario total (lo que no pagó).
    expect(r.impuestoOmitidoTotal).toBeCloseTo(
      50_000_000 * (DIAN_RATES.iva + DIAN_RATES.renta),
      0,
    );
    expect(r.ahorroEvadir).toBe(r.impuestoOmitidoTotal);
    expect(r.valorEsperadoEvadir).toBe(r.ahorroEvadir);
  });

  it('cash + auditable: sanción solo sobre auditable, ahorro sobre total', () => {
    const r = calculatePenalties({
      gap: 100_000_000,
      cashPortion: 40_000_000,
      level: 'high',
      periodMonths: 12,
      horizonMonths: 12,
    });
    const taxRate = DIAN_RATES.iva + DIAN_RATES.renta;
    expect(r.impuestoAuditable).toBeCloseTo(60_000_000 * taxRate, 0);
    expect(r.sancion).toBeCloseTo(r.impuestoAuditable * DIAN_RATES.sancionInexactitud, 0);
    // Ahorro se mide sobre total, no sobre auditable
    expect(r.impuestoOmitidoTotal).toBeCloseTo(100_000_000 * taxRate, 0);
    expect(r.ahorroEvadir).toBeGreaterThan(r.impuestoAuditable);
  });

  it('cashPortion > gap se clampa a gap', () => {
    const r = calculatePenalties({
      gap: 50_000_000,
      cashPortion: 80_000_000,
      level: 'mid',
      periodMonths: 12,
      horizonMonths: 12,
    });
    expect(r.cashProyectado).toBe(50_000_000);
    expect(r.auditableProyectado).toBe(0);
  });

  it('cashPortion negativo colapsa a 0', () => {
    const r = calculatePenalties({
      gap: 50_000_000,
      cashPortion: -10_000,
      level: 'mid',
    });
    expect(r.cashProyectado).toBe(0);
    expect(r.auditableProyectado).toBe(50_000_000 * 2); // horizon 24 / period 12
  });

  it('impuesto omitido total = IVA + renta sobre gap total proyectado', () => {
    const r = calculatePenalties({
      gap: 100_000_000,
      cashPortion: 30_000_000,
      level: 'mid',
      periodMonths: 12,
      horizonMonths: 12,
    });
    expect(r.ivaOmitidoTotal).toBeCloseTo(100_000_000 * DIAN_RATES.iva, 0);
    expect(r.rentaOmitidaTotal).toBeCloseTo(100_000_000 * DIAN_RATES.renta, 0);
    expect(r.impuestoOmitidoTotal).toBeCloseTo(
      r.ivaOmitidoTotal + r.rentaOmitidaTotal,
      0,
    );
  });

  it('sanción = 100% del impuesto auditable (no del total)', () => {
    const r = calculatePenalties({
      gap: 50_000_000,
      cashPortion: 10_000_000,
      level: 'high',
      periodMonths: 12,
      horizonMonths: 12,
    });
    expect(r.sancion).toBeCloseTo(r.impuestoAuditable * DIAN_RATES.sancionInexactitud, 0);
    expect(r.sancion).toBeLessThan(r.impuestoOmitidoTotal);
  });

  it('costo auditoria = impuesto auditable + sanción + intereses', () => {
    const r = calculatePenalties({
      gap: 100_000_000,
      level: 'high',
      periodMonths: 12,
      horizonMonths: 24,
    });
    expect(r.costoAuditoria).toBeCloseTo(
      r.impuestoAuditable + r.sancion + r.intereses,
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

  it('override de probabilidad pisa el default y se clampa a [0,1]', () => {
    const a = calculatePenalties({ gap: 100, level: 'high', probAuditoriaOverride: 0.1 });
    expect(a.probAuditoria).toBe(0.1);
    const b = calculatePenalties({ gap: 100, level: 'low', probAuditoriaOverride: -5 });
    expect(b.probAuditoria).toBe(0);
    const c = calculatePenalties({ gap: 100, level: 'low', probAuditoriaOverride: 5 });
    expect(c.probAuditoria).toBe(1);
  });

  it('valor esperado evadir = ahorro total − costo esperado', () => {
    const r = calculatePenalties({
      gap: 100_000_000,
      cashPortion: 20_000_000,
      level: 'mid',
      periodMonths: 12,
      horizonMonths: 24,
    });
    expect(r.valorEsperadoEvadir).toBeCloseTo(r.ahorroEvadir - r.costoEsperado, 0);
  });

  it('nivel high sin cash: formalizar gana (VE negativo)', () => {
    const r = calculatePenalties({
      gap: 100_000_000,
      level: 'high',
      periodMonths: 12,
      horizonMonths: 24,
    });
    expect(r.valorEsperadoEvadir).toBeLessThan(0);
  });

  it('nivel high con mucho cash: evadir aparenta ganar (VE positivo)', () => {
    // Si casi todo es efectivo, no hay costo auditoría, y el ahorro completo
    // queda como "ganancia" aparente. La UI lo presenta con los riesgos del
    // efectivo para matizar.
    const r = calculatePenalties({
      gap: 100_000_000,
      cashPortion: 95_000_000,
      level: 'high',
      periodMonths: 12,
      horizonMonths: 24,
    });
    expect(r.valorEsperadoEvadir).toBeGreaterThan(0);
  });

  it('riesgo penal usa el total anualizado (no solo auditable)', () => {
    // 10 mil millones en efectivo todo el año: aunque sea "invisible" por
    // cruces estándar, el umbral penal se mide sobre el total porque con
    // evidencia la DIAN puede extenderse.
    const r = calculatePenalties({
      gap: 10_000_000_000,
      cashPortion: 10_000_000_000,
      level: 'high',
      periodMonths: 12,
      horizonMonths: 12,
    });
    expect(r.riesgoPenal).toBe(true);
  });

  it('SMB pequeña no entra en riesgo penal', () => {
    const r = calculatePenalties({
      gap: 50_000_000,
      cashPortion: 10_000_000,
      level: 'high',
      periodMonths: 12,
      horizonMonths: 24,
    });
    expect(r.riesgoPenal).toBe(false);
  });

  it('flag cashSobreUIAF se activa a partir del umbral UIAF', () => {
    const a = calculatePenalties({ gap: 100_000_000, cashPortion: 5_000_000, level: 'low' });
    expect(a.cashSobreUIAF).toBe(false);
    const b = calculatePenalties({ gap: 100_000_000, cashPortion: 15_000_000, level: 'low' });
    expect(b.cashSobreUIAF).toBe(true);
  });

  it('caso real del usuario: 562M extracto + 300M anticipos + 15M efectivo, 488M facturado', () => {
    // gap = 877M − 488M = 389M. cashPortion = 15M.
    const r = calculatePenalties({
      gap: 389_000_000,
      cashPortion: 15_000_000,
      level: 'high',
      periodMonths: 12,
      horizonMonths: 24,
    });
    expect(r.gapProyectado).toBe(778_000_000);
    expect(r.cashProyectado).toBe(30_000_000);
    expect(r.auditableProyectado).toBe(748_000_000);
    // Muy poco cash vs gap ⇒ VE sigue negativo (formalizar gana)
    expect(r.valorEsperadoEvadir).toBeLessThan(0);
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
    expect(r.ivaOmitidoTotal).toBeCloseTo(5_000_000, 0);
    expect(r.rentaOmitidaTotal).toBeCloseTo(10_000_000, 0);
  });

  it('inputs negativos colapsan a 0', () => {
    const r = calculatePenalties({ gap: -500, level: 'high' });
    expect(r.gapProyectado).toBe(0);
    expect(r.impuestoOmitidoTotal).toBe(0);
  });
});

describe('CASH_RISKS', () => {
  it('lista los enemigos principales del efectivo', () => {
    expect(CASH_RISKS.length).toBeGreaterThanOrEqual(5);
    // Cada riesgo tiene título y detalle
    for (const risk of CASH_RISKS) {
      expect(risk.title.length).toBeGreaterThan(0);
      expect(risk.detail.length).toBeGreaterThan(0);
    }
  });
});
