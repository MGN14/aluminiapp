import { describe, it, expect } from 'vitest';
import { computeShrinkage, MERMA_MAX } from './shrinkageRate';

const line = (session: string, ref: string, teorico: number, contado: number) => ({
  session_id: session,
  variant_reference: ref,
  stock_teorico: teorico,
  diferencia: contado - teorico,
});

describe('computeShrinkage', () => {
  it('exige >= 2 sesiones distintas', () => {
    const r = computeShrinkage([line('s1', 'GL4102-3', 100, 95)]);
    expect(r.porFamilia.size).toBe(0);
  });

  it('acumula pérdidas por familia (variantes suman juntas)', () => {
    const r = computeShrinkage([
      line('s1', 'GL4102-0', 100, 97),
      line('s1', 'GL4102-3', 100, 98),
      line('s2', 'GL4102-0', 100, 96),
    ]);
    const fam = Array.from(r.porFamilia.values())[0];
    expect(fam.sesiones).toBe(2);
    expect(fam.unidadesPerdidas).toBe(9);
    expect(fam.tasa).toBeCloseTo(9 / 300, 5);
  });

  it('los sobrantes NO compensan la merma (solo diffs negativas)', () => {
    const r = computeShrinkage([
      line('s1', 'ALN173B', 100, 90),
      line('s2', 'ALN173B', 100, 120),
    ]);
    const fam = Array.from(r.porFamilia.values())[0];
    expect(fam.unidadesPerdidas).toBe(10);
  });

  it('capea en MERMA_MAX y reporta la familia como sospechosa', () => {
    const r = computeShrinkage([
      line('s1', 'T099', 100, 50),
      line('s2', 'T099', 100, 60),
    ]);
    const fam = Array.from(r.porFamilia.values())[0];
    expect(fam.tasa).toBe(MERMA_MAX);
    expect(fam.tasaCruda).toBeCloseTo(0.45, 5);
    expect(r.sospechosas).toHaveLength(1);
  });

  it('teorico 0 o referencias nuevas no cuentan', () => {
    const r = computeShrinkage([
      line('s1', 'NUEVA-1', 0, 50),
      line('s2', 'NUEVA-1', 0, 40),
    ]);
    expect(r.porFamilia.size).toBe(0);
  });

  it('sin pérdidas → familia ausente (no ensuciar el mapa con ceros)', () => {
    const r = computeShrinkage([
      line('s1', 'PC635', 100, 100),
      line('s2', 'PC635', 100, 102),
    ]);
    expect(r.porFamilia.size).toBe(0);
  });
});
