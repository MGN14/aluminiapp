import { describe, it, expect } from 'vitest';
import {
  firmaReglasActivas, matchesRule, reglaEspecificidad, ordenarReglasComoLaBase, resolverRegla,
  type ReconciliationRule,
} from './useReconciliationRules';

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

// ── El contrato app = base ──────────────────────────────────────────────────
// Estos casos describen lo que hace la función SQL apply_reconciliation_rules_to_tx.
// Si alguno cambia acá, hay que cambiar la función (y al revés).
describe('criterio único de reglas — la app decide igual que la base', () => {
  const generica = regla({ id: 'gen', keyword: 'transferencia', category_id: 'cat-otros', created_at: '2026-01-01T00:00:00Z' });
  const especifica = regla({
    id: 'esp', keyword: 'transferencia', category_id: 'cat-nomina', responsible_id: 'resp-yolanda',
    amount_min: 990_000, amount_max: 1_010_000, created_at: '2026-09-01T00:00:00Z',
  });
  const ingreso = { description: 'TRANSFERENCIA CTA SUC VIRTUAL', amount: 1_000_000, date: '2026-10-15' };

  it('especificidad: mismos puntos que reconciliation_rule_specificity', () => {
    expect(reglaEspecificidad(generica)).toBe(15);     // keyword 10 + categoría 5
    expect(reglaEspecificidad(especifica)).toBe(26);   // + beneficiario 5 + min 3 + max 3
    expect(reglaEspecificidad(regla({ keyword: undefined, category_id: 'c', day_min: 1, day_max: 5 }))).toBe(9);
  });

  it('orden de la base: la más específica primero; a igual puntaje, la más VIEJA', () => {
    const vieja = regla({ id: 'vieja', created_at: '2026-01-01T00:00:00Z' });
    const nueva = regla({ id: 'nueva', created_at: '2026-06-01T00:00:00Z' });
    expect(ordenarReglasComoLaBase([nueva, generica, especifica, vieja]).map((r) => r.id))
      .toEqual(['esp', 'gen', 'vieja', 'nueva']);
  });

  it('gana la regla más específica aunque se haya creado después (antes ganaba la más reciente por casualidad)', () => {
    const r = resolverRegla([generica, especifica], ingreso);
    expect(r?.rule.id).toBe('esp');
    expect(r?.update).toEqual({ category_id: 'cat-nomina', responsible_id: 'resp-yolanda' });
  });

  it('solo llena lo vacío: si ya tiene categoría, la regla aporta el beneficiario y no pisa', () => {
    const r = resolverRegla([especifica], { ...ingreso, category_id: 'cat-manual' });
    expect(r?.update).toEqual({ responsible_id: 'resp-yolanda' });
  });

  it('el caso de las consignaciones: la regla coincide pero no aporta nada → NO es match', () => {
    const consignaciones = regla({ id: 'cons', keyword: 'consignacion corresponsal cb', category_id: 'cat-ventas' });
    const fila = { description: 'CONSIGNACION CORRESPONSAL CB', amount: 3_000_000, date: '2026-10-15', category_id: 'cat-ventas', responsible_id: null };
    expect(resolverRegla([consignaciones], fila)).toBeNull();
    // …y sin categoría sí aporta:
    expect(resolverRegla([consignaciones], { ...fila, category_id: null })?.update).toEqual({ category_id: 'cat-ventas' });
  });

  it('si la primera que coincide no aporta, NO se pasa a la siguiente (no mezclar reglas)', () => {
    const soloCategoria = regla({ id: 'a', keyword: 'transferencia cta suc virtual', category_id: 'cat-ventas', amount_min: 1, amount_max: 9_999_999 });
    const conBeneficiario = regla({ id: 'b', keyword: 'transferencia', category_id: 'cat-otros', responsible_id: 'resp-x' });
    expect(reglaEspecificidad(soloCategoria)).toBeGreaterThan(reglaEspecificidad(conBeneficiario));
    expect(resolverRegla([conBeneficiario, soloCategoria], { ...ingreso, category_id: 'cat-ventas' })).toBeNull();
  });

  it('un movimiento ya completo (categoría y beneficiario) no se toca', () => {
    expect(resolverRegla([especifica], { ...ingreso, category_id: 'c', responsible_id: 'r' })).toBeNull();
  });

  it('la naturaleza también cuenta como aporte', () => {
    const traspaso = regla({ id: 't', keyword: 'pago autom tc visa', tx_type: 'egreso', category_id: undefined, movement_nature: 'traspaso' });
    const fila = { description: 'PAGO AUTOM TC VISA', amount: -1_355_667, date: '2026-09-20', category_id: 'cat-otros', responsible_id: null, movement_nature: null };
    expect(resolverRegla([traspaso], fila)?.update).toEqual({ movement_nature: 'traspaso' });
    expect(resolverRegla([traspaso], { ...fila, movement_nature: 'traspaso' })).toBeNull();
  });

  it('el día del mes se lee de la fecha, sin correrse por zona horaria', () => {
    const delDiaUno = regla({ day_min: 1, day_max: 1 });
    expect(matchesRule(delDiaUno, { description: 'consignacion corresponsal cb', amount: 100, date: '2026-10-01' })).toBe(true);
    expect(matchesRule(delDiaUno, { description: 'consignacion corresponsal cb', amount: 100, date: '2026-09-30' })).toBe(false);
  });
});
