import { describe, it, expect } from 'vitest';
import {
  estimateLeadTime,
  estimateDisponibilidad,
  projectQuiebres,
  computeReorderSuggestion,
  suggestOrderQty,
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

  it('matchKey (familia): el packing list base cruza con la -5 del inventario', () => {
    // Inventario Siigo: LIV-40-5. Packing list: LIV-40 en dos colores.
    const [q] = projectQuiebres({
      todayIso: HOY,
      stock: [{ productId: 'liv-40', reference: 'LIV-40-5', stockPhysical: 90, matchKey: 'liv-40' }],
      salidas: [{ productId: 'liv-40', quantity: 270 }], // 3/día → agota 2026-08-07
      ventanaDias: 90,
      transito: [
        { reference: 'LIV-40', cantidad: 100, fechaDisponible: '2026-08-01', matchKey: 'liv-40' }, // Mate
        { reference: 'LIV-40', cantidad: 200, fechaDisponible: '2026-08-01', matchKey: 'liv-40' }, // Negro
      ],
    });
    // Ambos colores reponen la MISMA familia: 18 + 300 = 318 → 106 días más.
    expect(q.reference).toBe('LIV-40-5');
    expect(q.fechaQuiebre).toBe('2026-11-15');
  });

  it('referencia sin consumo APARECE marcada pero no dispara alarma', () => {
    // Contrato nuevo (2026-07-04): antes se ocultaban y "Cobertura mostraba
    // 15 de 126 referencias". Ahora se listan con sinConsumo=true, sin fecha
    // de quiebre (nunca alarman) y con consumo 0 (sugerido siempre 0).
    const out = projectQuiebres({
      todayIso: HOY,
      stock: [{ productId: 'p1', reference: 'X', stockPhysical: 10 }],
      salidas: [],
      transito: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      reference: 'X',
      sinConsumo: true,
      consumoDiario: 0,
      stock: 10,
      fechaQuiebre: null,
      diasCobertura: null,
    });
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
    // A y B quiebran antes del grupal → alertas (secas hasta que llegue el
    // pedido); sin tránsito no hay huecos ni faltantes (todo alcanzable).
    expect(sug.alertas.map((q) => q.reference)).toEqual(['A', 'B']);
    expect(sug.faltantes).toEqual([]);
    expect(sug.huecos).toEqual([]);
    expect(sug.safetyDias).toBe(SAFETY_DIAS);
    expect(sug.llegadaSiPidoHoy).toBe('2026-10-01'); // hoy + 85
  });

  it('sin quiebre a la vista: la fecha SIEMPRE existe (teórica, lejana y sin urgencia)', () => {
    const a = ref('p1', 'LIV-40-5', 60);  // quiebra pronto → alerta puntual
    const b = ref('p2', 'B', 500);        // más allá del horizonte de 400d
    const c = ref('p3', 'C', 500);
    const sug = computeReorderSuggestion({
      todayIso: HOY,
      imports: [],
      stock: [a.stock, b.stock, c.stock],
      salidas: [a.salida, b.salida, c.salida],
      transito: [],
    });
    // Antes: sin fecha ("no me sirve ese card sin una fecha concreta" — Nico).
    // Ahora: grupal teórico al día 500 → límite = 500 − 100 = día 400.
    expect(sug.fechaQuiebreGrupal).toBe('2027-11-20');
    expect(sug.fechaLimite).toBe('2027-08-12');
    expect(sug.diasParaDecidir).toBe(400);
    expect(sug.motivoSinFecha).toBeNull();
    // El quiebre temprano (día 60 < llegada al 85) es FALTANTE REAL: ni un
    // pedido montado hoy lo alcanza — no dispara el pedido, se reporta aparte.
    expect(sug.faltantes.map((q) => q.reference)).toEqual(['LIV-40-5']);
  });

  it('con menos referencias críticas que el umbral, manda la última que quiebre', () => {
    const a = ref('p1', 'A', 100);
    const b = ref('p2', 'B', 140); // solo 2 críticos → grupal = la 2ª
    const sug = computeReorderSuggestion({
      todayIso: HOY,
      imports: [],
      stock: [a.stock, b.stock],
      salidas: [a.salida, b.salida],
      transito: [],
    });
    expect(sug.refsGrupal.map((q) => q.reference)).toEqual(['A', 'B']);
    expect(sug.fechaQuiebreGrupal).toBe('2026-11-25'); // hoy + 140
    expect(sug.fechaLimite).toBe('2026-08-17');        // − 100
  });

  it('TODA referencia con consumo cuenta para el umbral (el filtro del 80% escondía quiebres)', () => {
    // Bug real de Nico: varias refs en 0d de cobertura pero, por ser
    // consumidoras chicas, el filtro del 80% las excluía y el grupal se iba
    // a 2037. Ahora la protección contra marginales es SOLO el umbral de 3.
    const sug = computeReorderSuggestion({
      todayIso: HOY,
      imports: [],
      stock: [
        { productId: 'p1', reference: 'G1', stockPhysical: 3000 },  // 30/día → 100d
        { productId: 'p2', reference: 'G2', stockPhysical: 3300 },  // 30/día → 110d
        { productId: 'p3', reference: 'G3', stockPhysical: 3600 },  // 30/día → 120d
        { productId: 'p4', reference: 'CHICA', stockPhysical: 1 },  // ~0.01/día → ~90d
      ],
      salidas: [
        { productId: 'p1', quantity: 2700 },
        { productId: 'p2', quantity: 2700 },
        { productId: 'p3', quantity: 2700 },
        { productId: 'p4', quantity: 1 },
      ],
      transito: [],
    });
    // El grupal es la 3ª fecha más temprana entre TODAS: CHICA(90) G1(100) G2(110).
    expect(sug.refsGrupal.map((q) => q.reference)).toEqual(['CHICA', 'G1', 'G2']);
    expect(sug.fechaQuiebreGrupal).toBe('2026-10-26'); // hoy + 110
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

  it('porReferencia expone TODAS las refs con consumo y su enTransito', () => {
    const sug = computeReorderSuggestion({
      todayIso: HOY,
      imports: [],
      stock: [
        { productId: 'f1', reference: 'LIV-40-5', stockPhysical: 90, matchKey: 'liv-40' },
        { productId: 'f2', reference: 'T077A-5', stockPhysical: 500, matchKey: 't077a' },
      ],
      salidas: [
        { productId: 'f1', quantity: 270 },
        { productId: 'f2', quantity: 90 },
      ],
      transito: [{ reference: 'LIV-40', cantidad: 300, fechaDisponible: '2026-08-01', matchKey: 'liv-40' }],
    });
    expect(sug.porReferencia).toHaveLength(2);
    const liv = sug.porReferencia.find((q) => q.reference === 'LIV-40-5')!;
    expect(liv.enTransito).toBe(300);
    expect(sug.porReferencia.find((q) => q.reference === 'T077A-5')!.enTransito).toBe(0);
  });

  it('suggestOrderQty: consumo × horizonte − (stock + tránsito), nunca negativo', () => {
    const q = { reference: 'X', consumoDiario: 3, stock: 90, enTransito: 300, fechaQuiebre: null, diasCobertura: null };
    // 3 × 145 = 435 objetivo − 390 disponible = 45
    expect(suggestOrderQty(q, 145)).toBe(45);
    // Sobre-stockeada → 0, no negativo
    expect(suggestOrderQty({ ...q, stock: 5000 }, 145)).toBe(0);
    // Redondeo hacia arriba
    expect(suggestOrderQty({ ...q, consumoDiario: 3.1, stock: 0, enTransito: 0 }, 100)).toBe(310);
  });

  // ── El ancla: solo quiebres alcanzables por un pedido nuevo (brief Cowork) ──

  it('la fecha límite NUNCA sale en el pasado (escenario "5 de mayo")', () => {
    // Réplica del bug real: refs que (aun con todo el pipeline sumado) se
    // agotan ANTES de que llegue un pedido montado hoy (día 85). Anclar ahí
    // daba "montá el 5 de mayo" estando en julio. Ahora: límite = HOY y esas
    // refs se reportan como faltante real.
    const a = ref('p1', 'MN1103', 20);   // agote día 20 — inalcanzable
    const b = ref('p2', 'ALN343', 25);   // agote día 25 — inalcanzable
    const c = ref('p3', 'DIA09', 27);    // agote día 27 — inalcanzable
    const sug = computeReorderSuggestion({
      todayIso: HOY, imports: [],
      stock: [a.stock, b.stock, c.stock],
      salidas: [a.salida, b.salida, c.salida],
      transito: [],
    });
    expect(sug.fechaLimite).toBe(HOY); // nunca en el pasado
    expect(sug.diasParaDecidir).toBe(0);
    expect(sug.faltantes.map((q) => q.reference)).toEqual(['MN1103', 'ALN343', 'DIA09']);
  });

  it('con quiebres inalcanzables Y alcanzables, la fecha se ancla en los alcanzables', () => {
    const a = ref('p1', 'CORTA', 30);    // inalcanzable (< día 85) → faltante
    const b = ref('p2', 'B', 150);       // alcanzables →
    const c = ref('p3', 'C', 160);       //   el grupal (3ª = min(3, pool)) sale
    const d = ref('p4', 'D', 170);       //   de estas tres
    const sug = computeReorderSuggestion({
      todayIso: HOY, imports: [],
      stock: [a.stock, b.stock, c.stock, d.stock],
      salidas: [a.salida, b.salida, c.salida, d.salida],
      transito: [],
    });
    // Grupal = 3ª alcanzable (D, día 170) → límite = 170 − 100 = día 70 (futuro).
    expect(sug.refsGrupal.map((q) => q.reference)).toEqual(['B', 'C', 'D']);
    expect(sug.fechaQuiebreGrupal).toBe('2026-12-25');
    expect(sug.fechaLimite).toBe('2026-09-16');
    expect(sug.faltantes.map((q) => q.reference)).toEqual(['CORTA']);
    // La faltante NO arrastra la fecha al pasado.
    expect(sug.fechaLimite >= HOY).toBe(true);
  });

  it('el pipeline (producción+aduana+tránsito) empuja los quiebres y la fecha sale futura', () => {
    // 1 contenedor "en aduana" (llega día 10) + 2 "en producción" (día 85):
    // cubren los quiebres cercanos → el agote final queda lejos y la fecha
    // de montar pedido es futura, no "05-may".
    const a = ref('p1', 'A', 5);
    const b = ref('p2', 'B', 8);
    const c = ref('p3', 'C', 12);
    const sinPipeline = computeReorderSuggestion({
      todayIso: HOY, imports: [],
      stock: [a.stock, b.stock, c.stock],
      salidas: [a.salida, b.salida, c.salida],
      transito: [],
    });
    const conPipeline = computeReorderSuggestion({
      todayIso: HOY, imports: [],
      stock: [a.stock, b.stock, c.stock],
      salidas: [a.salida, b.salida, c.salida],
      transito: [
        { reference: 'A', cantidad: 600, fechaDisponible: '2026-07-18' }, // aduana: hoy+nac
        { reference: 'B', cantidad: 600, fechaDisponible: '2026-10-01' }, // producción
        { reference: 'C', cantidad: 600, fechaDisponible: '2026-10-01' }, // producción
      ],
    });
    // Sin pipeline: todo inalcanzable → montá HOY.
    expect(sinPipeline.fechaLimite).toBe(HOY);
    expect(sinPipeline.faltantes).toHaveLength(3);
    // Con pipeline: los agotes finales se van a ~200d → fecha futura real.
    expect(conPipeline.fechaLimite! > HOY).toBe(true);
    expect(conPipeline.faltantes).toHaveLength(0);
    // B y C quedan en 0 unos días antes de que llegue su contenedor de
    // producción (agote ~día 8-12, llegada día 85) → ...
    expect(conPipeline.alertas.length).toBeGreaterThan(0);
  });

  it('3 refs MARGINALES quebrando temprano NO adelantan el contenedor (masa de consumo)', () => {
    // Caso real (jul 2026): DIA09, BLJY009-2 y ART-090 quebraban el 8-oct
    // (alcanzable) y la card decía "montá HOY" recién comprometidos 3
    // contenedores. Son ~1.5% del consumo — el contenedor lo dispara el
    // GRUESO (≥20% acumulado), no un conteo de 3.
    const stock = [
      // 3 marginales: 0.5/día, quiebran al día 95 (alcanzable: llegada día 85)
      { productId: 'c1', reference: 'DIA09', stockPhysical: 47.5 },
      { productId: 'c2', reference: 'BLJY009-2', stockPhysical: 47.5 },
      { productId: 'c3', reference: 'ART-090', stockPhysical: 47.5 },
      // El grueso: 5 refs de 20/día con 250 días de cobertura
      { productId: 'g1', reference: 'G1', stockPhysical: 5000 },
      { productId: 'g2', reference: 'G2', stockPhysical: 5000 },
      { productId: 'g3', reference: 'G3', stockPhysical: 5000 },
      { productId: 'g4', reference: 'G4', stockPhysical: 5000 },
      { productId: 'g5', reference: 'G5', stockPhysical: 5000 },
    ];
    const salidas = [
      { productId: 'c1', quantity: 45 }, { productId: 'c2', quantity: 45 }, { productId: 'c3', quantity: 45 },
      { productId: 'g1', quantity: 1800 }, { productId: 'g2', quantity: 1800 }, { productId: 'g3', quantity: 1800 },
      { productId: 'g4', quantity: 1800 }, { productId: 'g5', quantity: 1800 },
    ];
    const sug = computeReorderSuggestion({ todayIso: HOY, imports: [], stock, salidas, transito: [] });
    // El grupal se ancla en el grueso (día 250), NO en las 3 marginales (día 95).
    expect(sug.fechaQuiebreGrupal).toBe('2027-03-15'); // hoy + 250
    expect(sug.fechaLimite).toBe('2026-12-05');        // − 100 → FUTURA, no "hoy"
    expect(sug.diasParaDecidir).toBe(150);
    // Las 3 marginales son ALERTA: quiebran antes del pedido grupal.
    expect(sug.alertas.map((q) => q.reference)).toEqual(['DIA09', 'BLJY009-2', 'ART-090']);
    expect(sug.faltantes).toEqual([]);
  });

  it('si el GRUESO quiebra temprano, sí dispara aunque sean pocas refs', () => {
    // Contra-caso: una ref del 30% del consumo quebrando pronto (día 100,
    // alcanzable) + relleno → el corte llega apenas se junta el 20% con al
    // menos 3 refs. La masa manda en ambos sentidos.
    const stock = [
      { productId: 'big', reference: 'GRANDE', stockPhysical: 3000 },   // 30/d → 100d
      { productId: 'm1', reference: 'M1', stockPhysical: 1050 },        // 10/d → 105d
      { productId: 'm2', reference: 'M2', stockPhysical: 1100 },        // 10/d → 110d
      { productId: 'm3', reference: 'M3', stockPhysical: 15000 },       // 50/d → 300d
    ];
    const salidas = [
      { productId: 'big', quantity: 2700 },
      { productId: 'm1', quantity: 900 }, { productId: 'm2', quantity: 900 },
      { productId: 'm3', quantity: 4500 },
    ];
    const sug = computeReorderSuggestion({ todayIso: HOY, imports: [], stock, salidas, transito: [] });
    // GRANDE(30%) ya pasa el 20% en la 1ª, pero el mínimo de 3 refs aguanta
    // hasta M2 (día 110): grupal = día 110, no día 300.
    expect(sug.refsGrupal.map((q) => q.reference)).toEqual(['GRANDE', 'M1', 'M2']);
    expect(sug.fechaQuiebreGrupal).toBe('2026-10-26'); // hoy + 110
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
