import { describe, it, expect } from 'vitest';
import {
  estimateLeadTime,
  estimateDisponibilidad,
  projectQuiebres,
  computeReorderSuggestion,
  DEFAULT_ETAPAS,
  SAFETY_DIAS,
} from './reorderSuggestion';

const HOY = '2026-07-08';

describe('estimateLeadTime', () => {
  it('sin datos usa defaults y lo marca', () => {
    const lt = estimateLeadTime([]);
    expect(lt.produccion).toEqual({ dias: DEFAULT_ETAPAS.produccion, fuente: 'default', n: 0 });
    expect(lt.tieneDefaults).toBe(true);
    expect(lt.totalDias).toBe(DEFAULT_ETAPAS.produccion + DEFAULT_ETAPAS.transito + DEFAULT_ETAPAS.nacionalizacion);
  });

  it('mide etapas de pedidos a medio ciclo (sin exigir ciclo completo)', () => {
    const lt = estimateLeadTime([
      // Pedido en tránsito: aporta producción (30d) pero no tránsito
      { estado: 'transito', fecha_anticipo: '2026-05-01', fecha_embarque: '2026-05-31', fecha_estimada_llegada: '2026-07-10', fecha_arribo_real: null },
      // Pedido en aduana: aporta producción (40d) y tránsito (35d)
      { estado: 'aduana', fecha_anticipo: '2026-03-01', fecha_embarque: '2026-04-10', fecha_estimada_llegada: null, fecha_arribo_real: '2026-05-15' },
    ]);
    expect(lt.produccion).toEqual({ dias: 35, fuente: 'medido', n: 2 }); // (30+40)/2
    expect(lt.transito).toEqual({ dias: 35, fuente: 'medido', n: 1 });
    expect(lt.nacionalizacion.fuente).toBe('default'); // ninguno entregado aún
    expect(lt.totalDias).toBe(35 + 35 + DEFAULT_ETAPAS.nacionalizacion);
  });

  it('la etapa medida reemplaza al default cuando entra el dato (auto-corrección)', () => {
    const base = { estado: 'entregado', fecha_anticipo: null, fecha_embarque: null, fecha_estimada_llegada: null };
    const lt = estimateLeadTime([
      { ...base, fecha_arribo_real: '2026-06-01', fecha_entregado: '2026-06-08' },
    ]);
    expect(lt.nacionalizacion).toEqual({ dias: 7, fuente: 'medido', n: 1 });
  });

  it('ignora cancelados y duraciones basura', () => {
    const lt = estimateLeadTime([
      { estado: 'cancelado', fecha_anticipo: '2026-01-01', fecha_embarque: '2026-02-01', fecha_estimada_llegada: null, fecha_arribo_real: null },
      { estado: 'transito', fecha_anticipo: '2020-01-01', fecha_embarque: '2026-02-01', fecha_estimada_llegada: null, fecha_arribo_real: null }, // >365d
    ]);
    expect(lt.produccion.fuente).toBe('default');
  });
});

describe('estimateDisponibilidad', () => {
  const lt = estimateLeadTime([]); // defaults: 35/40/10

  it('arribado a puerto → hoy en puerto + nacionalización', () => {
    const r = { estado: 'aduana', fecha_anticipo: null, fecha_embarque: null, fecha_estimada_llegada: null, fecha_arribo_real: '2026-07-08' };
    expect(estimateDisponibilidad(r, lt, HOY)).toBe('2026-07-18');
  });

  it('con ETA futura → ETA + nacionalización', () => {
    const r = { estado: 'transito', fecha_anticipo: null, fecha_embarque: null, fecha_estimada_llegada: '2026-08-01', fecha_arribo_real: null };
    expect(estimateDisponibilidad(r, lt, HOY)).toBe('2026-08-11');
  });

  it('ETA vencida sin arribo → cuenta desde hoy', () => {
    const r = { estado: 'transito', fecha_anticipo: null, fecha_embarque: null, fecha_estimada_llegada: '2026-07-01', fecha_arribo_real: null };
    expect(estimateDisponibilidad(r, lt, HOY)).toBe('2026-07-18');
  });
});

describe('projectQuiebres', () => {
  it('proyecta quiebre lineal sin llegadas', () => {
    const [q] = projectQuiebres({
      todayIso: HOY,
      stock: [{ productId: 'p1', reference: '744-100', stockPhysical: 90 }],
      salidas: [{ productId: 'p1', quantity: 270 }], // 3/día en 90 días
      ventanaDias: 90,
      transito: [],
    });
    expect(q.consumoDiario).toBe(3);
    expect(q.diasCobertura).toBe(30);
    expect(q.fechaQuiebre).toBe('2026-08-07');
  });

  it('una llegada en tránsito antes del agote extiende la cobertura', () => {
    const [q] = projectQuiebres({
      todayIso: HOY,
      stock: [{ productId: 'p1', reference: '744-100', stockPhysical: 90 }],
      salidas: [{ productId: 'p1', quantity: 270 }], // 3/día → agota 2026-08-07
      ventanaDias: 90,
      transito: [{ reference: '744-100', cantidad: 300, fechaDisponible: '2026-08-01' }],
    });
    // Al 01-08 quedan 90 − 24×3 = 18 + 300 = 318 → 106 días más
    expect(q.fechaQuiebre).toBe('2026-11-15');
  });

  it('referencia sin consumo no aparece (no dispara alarma)', () => {
    const out = projectQuiebres({
      todayIso: HOY,
      stock: [{ productId: 'p1', reference: 'X', stockPhysical: 10 }],
      salidas: [],
      transito: [],
    });
    expect(out).toEqual([]);
  });
});

describe('computeReorderSuggestion', () => {
  // Helper: ref con consumo 3/día y stock para N días de cobertura.
  const ref = (id: string, name: string, diasCobertura: number) => ({
    stock: { productId: id, reference: name, stockPhysical: diasCobertura * 3 },
    salida: { productId: id, quantity: 270 }, // 3/día en ventana de 90
  });

  it('el quiebre GRUPAL (3ª referencia) define la fecha, no el primero', () => {
    const a = ref('p1', 'A', 100); // quiebra 2026-10-16
    const b = ref('p2', 'B', 120); // quiebra 2026-11-05
    const c = ref('p3', 'C', 150); // quiebra 2026-12-05 ← 3ª = grupal
    const d = ref('p4', 'D', 300);
    const sug = computeReorderSuggestion({
      todayIso: HOY,
      imports: [],
      stock: [a.stock, b.stock, c.stock, d.stock],
      salidas: [a.salida, b.salida, c.salida, d.salida],
      transito: [],
    });
    expect(sug.fechaQuiebreGrupal).toBe('2026-12-05');
    expect(sug.refsGrupal.map((q) => q.reference)).toEqual(['A', 'B', 'C']);
    // Lead time default 85 + colchón 15 = 100 días antes del grupal.
    expect(sug.fechaLimite).toBe('2026-08-27');
    expect(sug.diasParaDecidir).toBe(50);
    // A y B quiebran antes del grupal → alertas puntuales, no disparadores.
    expect(sug.alertas.map((q) => q.reference)).toEqual(['A', 'B']);
    expect(sug.safetyDias).toBe(SAFETY_DIAS);
    expect(sug.llegadaSiPidoHoy).toBe('2026-10-01'); // hoy + 85
  });

  it('menos de 3 referencias quebrando = alerta puntual, SIN fecha de pedido', () => {
    const a = ref('p1', 'LIV-40-5', 60);
    const b = ref('p2', 'B', 500);
    const c = ref('p3', 'C', 500);
    const sug = computeReorderSuggestion({
      todayIso: HOY,
      imports: [],
      stock: [a.stock, b.stock, c.stock],
      salidas: [a.salida, b.salida, c.salida],
      transito: [],
    });
    expect(sug.fechaLimite).toBeNull();
    expect(sug.motivoSinFecha).toBeNull(); // no es falta de datos: no hay urgencia
    expect(sug.alertas.map((q) => q.reference)).toEqual(['LIV-40-5']);
  });

  it('una referencia marginal no entra al criterio (80% del consumo manda)', () => {
    const sug = computeReorderSuggestion({
      todayIso: HOY,
      imports: [],
      stock: [
        { productId: 'p1', reference: 'G1', stockPhysical: 3000 }, // 30/día → 100d
        { productId: 'p2', reference: 'G2', stockPhysical: 3300 }, // 30/día → 110d
        { productId: 'p3', reference: 'G3', stockPhysical: 3600 }, // 30/día → 120d
        { productId: 'p4', reference: 'MARGINAL', stockPhysical: 1 }, // quiebra ya, consumo ínfimo
      ],
      salidas: [
        { productId: 'p1', quantity: 2700 },
        { productId: 'p2', quantity: 2700 },
        { productId: 'p3', quantity: 2700 },
        { productId: 'p4', quantity: 1 },
      ],
      transito: [],
    });
    // MARGINAL queda fuera de las críticas: ni en refsGrupal ni definiendo fecha.
    expect(sug.refsGrupal.map((q) => q.reference)).toEqual(['G1', 'G2', 'G3']);
    expect(sug.alertas.map((q) => q.reference)).not.toContain('MARGINAL');
  });

  it('lo que viene en tránsito empuja el quiebre grupal', () => {
    const a = ref('p1', 'A', 50);
    const b = ref('p2', 'B', 60);
    const c = ref('p3', 'C', 70); // 3ª: quiebra 2026-09-16 sin tránsito
    const sinTransito = computeReorderSuggestion({
      todayIso: HOY, imports: [],
      stock: [a.stock, b.stock, c.stock],
      salidas: [a.salida, b.salida, c.salida],
      transito: [],
    });
    const conTransito = computeReorderSuggestion({
      todayIso: HOY, imports: [],
      stock: [a.stock, b.stock, c.stock],
      salidas: [a.salida, b.salida, c.salida],
      // Llega reposición de C antes de su quiebre → el grupal cambia de fecha.
      transito: [{ reference: 'C', cantidad: 600, fechaDisponible: '2026-09-01' }],
    });
    expect(conTransito.fechaQuiebreGrupal! > sinTransito.fechaQuiebreGrupal!).toBe(true);
  });

  it('sin consumo registrado → sin fecha con motivo', () => {
    const sug = computeReorderSuggestion({
      todayIso: HOY,
      imports: [],
      stock: [{ productId: 'p1', reference: 'A', stockPhysical: 100 }],
      salidas: [],
      transito: [],
    });
    expect(sug.fechaLimite).toBeNull();
    expect(sug.motivoSinFecha).toBe('sin_consumo');
  });
});
