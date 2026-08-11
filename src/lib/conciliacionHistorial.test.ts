import { describe, it, expect } from 'vitest';
import {
  indexarHistorial, sugerirBeneficiario, sugerirCategoria,
  alertaCategoriaInusual, alertaMontoInusual, sugerirReglas,
  agruparPorDescripcion, detectarAlertasAuditoria,
  type TxHistorial,
} from './conciliacionHistorial';
import type { ReconciliationRule } from '@/hooks/useReconciliationRules';

const tx = (p: Partial<TxHistorial>): TxHistorial => ({
  description: 'Transferencia Cta Suc Virtual', amount: -1_000_000,
  date: '2026-07-15', category_id: null, responsible_id: null, ...p,
});

const NOMINA = 'cat-nomina';
const SERVICIOS = 'cat-servicios';
const OTROS = 'cat-otros';
const ROCIO = 'resp-rocio';
const CAMILO = 'resp-camilo';

// Caso real de Nico: Rocío recibe exactamente $1.250.000 por Nómina, 7 veces.
const pagosRocio = Array.from({ length: 7 }, (_, i) =>
  tx({ amount: -1_250_000, category_id: NOMINA, responsible_id: ROCIO, date: `2026-0${(i % 6) + 1}-28` }));
const pagosCamilo = Array.from({ length: 5 }, () =>
  tx({ amount: -2_500_000, category_id: NOMINA, responsible_id: CAMILO }));

describe('sugerirBeneficiario — categoría + monto', () => {
  const h = indexarHistorial([...pagosRocio, ...pagosCamilo]);

  it('con Nómina y $1.250.000, Rocío va primera con su evidencia', () => {
    const s = sugerirBeneficiario(h, NOMINA, -1_250_000);
    expect(s[0].responsibleId).toBe(ROCIO);
    expect(s[0].veces).toBe(7);
    expect(s[0].calzaMonto).toBe(true);
    expect(s[0].evidenciaMonto).toContain('siempre');
  });

  it('con Nómina y $2.500.000, Camilo pasa adelante aunque tenga menos pagos', () => {
    const s = sugerirBeneficiario(h, NOMINA, -2_500_000);
    expect(s[0].responsibleId).toBe(CAMILO);
    expect(s[0].calzaMonto).toBe(true);
    expect(s[1].responsibleId).toBe(ROCIO);
    expect(s[1].calzaMonto).toBe(false);
  });

  it('sin categoría no sugiere nada', () => {
    expect(sugerirBeneficiario(h, null, -1_250_000)).toHaveLength(0);
  });
});

describe('sugerirCategoria — por descripción', () => {
  it('Spotify fue Servicios 6 de 7 → sugiere Servicios', () => {
    const h = indexarHistorial([
      ...Array.from({ length: 6 }, () => tx({ description: 'COMPRA INTL SPOTIFY', category_id: SERVICIOS, responsible_id: CAMILO })),
      tx({ description: 'COMPRA INTL SPOTIFY', category_id: OTROS, responsible_id: CAMILO }),
    ]);
    const s = sugerirCategoria(h, 'Compra Intl SPOTIFY'); // case-insensitive
    expect(s).toMatchObject({ categoryId: SERVICIOS, veces: 6, total: 7 });
  });

  it('con historial repartido (60/40 no llega al 60%) no sugiere', () => {
    const h = indexarHistorial([
      ...Array.from({ length: 3 }, () => tx({ category_id: SERVICIOS, responsible_id: CAMILO })),
      ...Array.from({ length: 3 }, () => tx({ category_id: NOMINA, responsible_id: ROCIO })),
    ]);
    expect(sugerirCategoria(h, 'Transferencia Cta Suc Virtual')).toBeNull();
  });
});

describe('alertaCategoriaInusual — avisa sin bloquear', () => {
  const h = indexarHistorial([
    ...Array.from({ length: 6 }, () => tx({ description: 'COMPRA INTL SPOTIFY', category_id: SERVICIOS, responsible_id: CAMILO })),
    tx({ description: 'COMPRA INTL SPOTIFY', category_id: OTROS, responsible_id: CAMILO }),
  ]);

  it('elegir Otros cuando 6/7 fue Servicios dispara la alerta', () => {
    const a = alertaCategoriaInusual(h, 'COMPRA INTL SPOTIFY', OTROS);
    expect(a).toMatchObject({ dominanteId: SERVICIOS, veces: 6, total: 7 });
  });

  it('elegir la dominante no alerta', () => {
    expect(alertaCategoriaInusual(h, 'COMPRA INTL SPOTIFY', SERVICIOS)).toBeNull();
  });

  it('con menos de 4 casos no alerta (poco historial no es patrón)', () => {
    const chico = indexarHistorial([
      tx({ description: 'X', category_id: SERVICIOS, responsible_id: CAMILO }),
      tx({ description: 'X', category_id: SERVICIOS, responsible_id: CAMILO }),
      tx({ description: 'X', category_id: SERVICIOS, responsible_id: CAMILO }),
    ]);
    expect(alertaCategoriaInusual(chico, 'X', OTROS)).toBeNull();
  });
});

describe('alertaMontoInusual', () => {
  const h = indexarHistorial(pagosRocio);

  it('$9.160.500 en Nómina a Rocío (siempre $1.250.000) alerta', () => {
    const a = alertaMontoInusual(h, NOMINA, ROCIO, -9_160_500);
    expect(a).not.toBeNull();
    expect(a!.n).toBe(7);
  });

  it('un monto dentro del rango (±30%) no alerta', () => {
    expect(alertaMontoInusual(h, NOMINA, ROCIO, -1_300_000)).toBeNull();
  });
});

describe('sugerirReglas — cierra el ciclo', () => {
  const nombres = {
    categoria: (id: string) => (id === NOMINA ? 'Nómina' : id === SERVICIOS ? 'Servicios' : 'Otros'),
    responsable: (id: string) => (id === ROCIO ? 'Rocío Gaitán' : 'Camilo'),
  };

  it('descripción consistente (Spotify → Servicios·Camilo 5/5) → regla por keyword', () => {
    const h = indexarHistorial(Array.from({ length: 5 }, () =>
      tx({ description: 'COMPRA INTL SPOTIFY', category_id: SERVICIOS, responsible_id: CAMILO, amount: -30_000 })));
    const s = sugerirReglas(h, [], nombres);
    expect(s).toHaveLength(1);
    expect(s[0].regla).toMatchObject({
      keyword: 'compra intl spotify', category_id: SERVICIOS, responsible_id: CAMILO, tx_type: 'egreso',
    });
    expect(s[0].regla.amount_min).toBeUndefined();
  });

  it('descripción ambigua pero monto estable → regla keyword + banda de monto', () => {
    // Transferencias genéricas: Rocío siempre $1.250.000, Camilo $2.500.000.
    const h = indexarHistorial([...pagosRocio, ...pagosCamilo]);
    const s = sugerirReglas(h, [], nombres);
    const deRocio = s.find((x) => x.regla.responsible_id === ROCIO)!;
    expect(deRocio).toBeDefined();
    expect(deRocio.regla.keyword).toBe('transferencia cta suc virtual');
    expect(deRocio.regla.amount_min!).toBeLessThanOrEqual(1_250_000);
    expect(deRocio.regla.amount_max!).toBeGreaterThanOrEqual(1_250_000);
    // La banda de Rocío NO cubre el monto de Camilo.
    expect(deRocio.regla.amount_max!).toBeLessThan(2_500_000);
  });

  it('NO propone banda si otro beneficiario cae dentro con la misma descripción', () => {
    const h = indexarHistorial([
      ...pagosRocio,
      // Camilo recibió una vez el mismo monto por el mismo canal → ambiguo.
      tx({ amount: -1_250_000, category_id: NOMINA, responsible_id: CAMILO }),
    ]);
    const s = sugerirReglas(h, [], nombres);
    expect(s.find((x) => x.regla.responsible_id === ROCIO && x.regla.amount_min != null)).toBeUndefined();
  });

  it('no re-sugiere lo ya cubierto por una regla activa', () => {
    const h = indexarHistorial(Array.from({ length: 5 }, () =>
      tx({ description: 'COMPRA INTL SPOTIFY', category_id: SERVICIOS, responsible_id: CAMILO, amount: -30_000 })));
    const existente = {
      id: 'r1', user_id: 'u', name: 'spotify', keyword: 'COMPRA INTL SPOTIFY',
      tx_type: 'egreso', category_id: SERVICIOS, auto_conciliate: true, active: true,
      match_count: 0, created_at: '',
    } as ReconciliationRule;
    expect(sugerirReglas(h, [existente], nombres)).toHaveLength(0);
  });

  it('historial inconsistente (57/43) no genera regla', () => {
    const h = indexarHistorial([
      ...Array.from({ length: 4 }, () => tx({ description: 'COMIS SWIFT', category_id: SERVICIOS, responsible_id: CAMILO, amount: -200_000 })),
      ...Array.from({ length: 3 }, () => tx({ description: 'COMIS SWIFT', category_id: OTROS, responsible_id: CAMILO, amount: -210_000 })),
    ]);
    const porKeyword = sugerirReglas(h, [], nombres).filter((s) => s.regla.amount_min == null);
    expect(porKeyword).toHaveLength(0);
  });
});

describe('auditoría — agrupar y detectar inconsistencias', () => {
  const compensar = [
    ...Array.from({ length: 4 }, (_, i) =>
      tx({ id: `c${i}`, description: 'PAGO PSE COMPENSAR-OI', category_id: NOMINA, responsible_id: ROCIO, amount: -800_000 })),
    tx({ id: 'c-err', description: 'PAGO PSE COMPENSAR-OI', category_id: OTROS, responsible_id: ROCIO, amount: -800_000 }),
  ];
  // Transferencias genuinamente mixtas: sin dominante ≥75% → NO alertan.
  const transferencias = [
    ...Array.from({ length: 3 }, (_, i) => tx({ id: `t${i}`, category_id: NOMINA, responsible_id: ROCIO })),
    ...Array.from({ length: 3 }, (_, i) => tx({ id: `u${i}`, category_id: SERVICIOS, responsible_id: CAMILO })),
  ];
  const grupos = agruparPorDescripcion(indexarHistorial([...compensar, ...transferencias]));

  it('agrupa por descripción normalizada con conteos y rango de monto', () => {
    const g = grupos.find((x) => x.desc === 'pago pse compensar-oi')!;
    expect(g.txs).toHaveLength(5);
    expect(g.categorias.get(NOMINA)).toBe(4);
    expect(g.montoMin).toBe(800_000);
  });

  it('detecta el desviado de Compensar (Nómina 4 de 5) con sus ids', () => {
    const alertas = detectarAlertasAuditoria(grupos);
    const a = alertas.find((x) => x.grupo.desc === 'pago pse compensar-oi' && x.campo === 'categoria')!;
    expect(a.dominanteId).toBe(NOMINA);
    expect(a.outliers.map((t) => t.id)).toEqual(['c-err']);
  });

  it('las descripciones mixtas sin dominante NO alertan (van al listado)', () => {
    const alertas = detectarAlertasAuditoria(grupos);
    expect(alertas.find((x) => x.grupo.desc === 'transferencia cta suc virtual')).toBeUndefined();
  });

  it('unánime (100%) no alerta: no hay nada que corregir', () => {
    const unanime = agruparPorDescripcion(indexarHistorial(
      Array.from({ length: 6 }, (_, i) => tx({ id: `x${i}`, category_id: NOMINA, responsible_id: ROCIO }))));
    expect(detectarAlertasAuditoria(unanime)).toHaveLength(0);
  });
});

describe('signo: ingresos y egresos son mundos separados', () => {
  // Caso real de Nico (2026-08-08): a Ferromendez le paga ~$950.000 de
  // gastos Y le vende $20.000.000. La venta NO es rara solo porque no se
  // parezca a los pagos.
  const FERRO = 'resp-ferro';
  const VENTAS = 'cat-ventas';
  const pagos = Array.from({ length: 5 }, (_, i) =>
    tx({ id: `p${i}`, amount: -950_000, category_id: OTROS, responsible_id: FERRO }));
  const ventas = Array.from({ length: 4 }, (_, i) =>
    tx({ id: `v${i}`, amount: 18_000_000, category_id: VENTAS, responsible_id: FERRO }));
  const h = indexarHistorial([...pagos, ...ventas]);

  it('una venta de 20M NO alerta contra el histórico de pagos de 950k', () => {
    expect(alertaMontoInusual(h, OTROS, FERRO, 20_000_000)).toBeNull();
  });

  it('una venta de 20M tampoco alerta contra sus ventas de 18M (está en rango)', () => {
    expect(alertaMontoInusual(h, VENTAS, FERRO, 20_000_000)).toBeNull();
  });

  it('un PAGO de 20M sí alerta: contra pagos de 950k está fuerísima de rango', () => {
    const a = alertaMontoInusual(h, OTROS, FERRO, -20_000_000);
    expect(a).not.toBeNull();
    expect(a!.n).toBe(5);
  });

  it('sugerirBeneficiario compara contra el histórico del mismo signo', () => {
    // Con un INGRESO de 18M, Ferromendez calza (sus ventas), no por sus pagos.
    const s = sugerirBeneficiario(h, VENTAS, 18_000_000);
    expect(s[0]?.responsibleId).toBe(FERRO);
    expect(s[0]?.calzaMonto).toBe(true);
  });
});
