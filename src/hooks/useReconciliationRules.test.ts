import { describe, it, expect } from 'vitest';
import { firmaReglasActivas, matchesRule, type ReconciliationRule } from './useReconciliationRules';

const regla = (o: Partial<ReconciliationRule>): ReconciliationRule => ({
  id: 'r1', user_id: 'u1', name: 'Consignaciones', keyword: 'consignacion corresponsal cb',
  tx_type: 'ingreso', category_id: 'cat-ventas', auto_conciliate: true, active: true,
  match_count: 0, created_at: '2026-07-03T00:00:00Z',
  ...o,
});

describe('firmaReglasActivas — cuándo vale la pena volver a barrer', () => {
  const base = [regla({}), regla({ id: 'r2', keyword: 'spotify', tx_type: 'egreso', category_id: 'cat-serv', responsible_id: 'resp-otros' })];

  it('NO cambia con lo que el propio barrido mueve (match_count, last_matched_at)', () => {
    const despues = base.map((r) => ({ ...r, match_count: r.match_count + 19, last_matched_at: '2026-11-11T18:16:15Z' }));
    expect(firmaReglasActivas(despues)).toBe(firmaReglasActivas(base));
  });

  it('no depende del orden en que llegan las reglas', () => {
    expect(firmaReglasActivas([...base].reverse())).toBe(firmaReglasActivas(base));
  });

  it('cambia al crear, editar, apagar o cambiar el destino de una regla', () => {
    const f = firmaReglasActivas(base);
    expect(firmaReglasActivas([...base, regla({ id: 'r3', keyword: 'chatgpt', tx_type: 'egreso' })])).not.toBe(f);
    expect(firmaReglasActivas([regla({ keyword: 'consig nacional efectivo' }), base[1]])).not.toBe(f);
    expect(firmaReglasActivas([regla({ active: false }), base[1]])).not.toBe(f);
    expect(firmaReglasActivas([regla({ responsible_id: 'resp-x' }), base[1]])).not.toBe(f);
    expect(firmaReglasActivas([regla({ amount_min: 1000 }), base[1]])).not.toBe(f);
  });

  it('ignora reglas apagadas o que no aportan nada; sin reglas útiles empieza por "0:"', () => {
    const inutil = regla({ id: 'r9', category_id: undefined });
    expect(firmaReglasActivas([...base, inutil])).toBe(firmaReglasActivas(base));
    expect(firmaReglasActivas([inutil, regla({ id: 'r8', active: false })]).startsWith('0:')).toBe(true);
    expect(firmaReglasActivas([]).startsWith('0:')).toBe(true);
  });
});

describe('matchesRule — espejo TS de la función SQL', () => {
  const tx = { description: 'CONSIGNACIÓN  CORRESPONSAL CB', amount: 3_000_000, date: '2026-10-15' };

  it('normaliza tildes, mayúsculas y espacios y respeta el signo', () => {
    expect(matchesRule(regla({}), tx)).toBe(true);
    expect(matchesRule(regla({ tx_type: 'egreso' }), tx)).toBe(false);
    expect(matchesRule(regla({}), { ...tx, amount: -3_000_000 })).toBe(false);
  });

  it('respeta la banda de monto y las reglas apagadas', () => {
    expect(matchesRule(regla({ amount_min: 2_900_000, amount_max: 3_100_000 }), tx)).toBe(true);
    expect(matchesRule(regla({ amount_max: 1_000_000 }), tx)).toBe(false);
    expect(matchesRule(regla({ active: false }), tx)).toBe(false);
  });
});
