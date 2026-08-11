/**
 * Fases 4+5 del motor de ventas: sugerir el CLIENTE dueño de un pago cuando
 * ninguna factura calza sola — cartera, combos de facturas, montos
 * habituales y tiempos de pago. Probabilidad con evidencia, nunca regla.
 */

import { describe, it, expect } from 'vitest';
import {
  buscarCombo, diasPagoTipicos, sugerirClienteParaPago,
  type DatosVentasProbable, type FacturaAbierta,
} from './ventasProbable';

const JH = 'resp-jh';
const SOTO = 'resp-soto';

const fv = (p: Partial<FacturaAbierta>): FacturaAbierta => ({
  id: p.invoice_number ?? 'f', invoice_number: 'FV-1', responsible_id: JH,
  issue_date: '2026-07-01', balance_pending: 1_000_000, ...p,
});

const base: DatosVentasProbable = {
  clientes: [{ id: JH, name: 'Aluminios JH' }, { id: SOTO, name: 'Vidrios Soto' }],
  aliases: [],
  facturasAbiertas: [],
  cobros: [],
  emisiones: [],
};

describe('buscarCombo — fase 5', () => {
  const facturas = [
    fv({ invoice_number: 'FV-10', issue_date: '2026-06-01', balance_pending: 3_000_000 }),
    fv({ invoice_number: 'FV-12', issue_date: '2026-06-20', balance_pending: 2_000_000 }),
    fv({ invoice_number: 'FV-15', issue_date: '2026-07-10', balance_pending: 4_500_000 }),
  ];

  it('encuentra el prefijo FIFO: las dos más viejas suman el pago', () => {
    const c = buscarCombo(facturas, 5_000_000)!;
    expect(c.facturas.map((f) => f.invoice_number)).toEqual(['FV-10', 'FV-12']);
  });

  it('encuentra pares no consecutivos', () => {
    const c = buscarCombo(facturas, 7_500_000)!;
    expect(c.facturas.map((f) => f.invoice_number).sort()).toEqual(['FV-10', 'FV-15']);
  });

  it('tolera ±1% (retenciones chicas)', () => {
    expect(buscarCombo(facturas, 4_980_000)).not.toBeNull();
  });

  it('sin combinación posible devuelve null', () => {
    expect(buscarCombo(facturas, 1_234_567)).toBeNull();
  });

  it('una sola factura no es combo (eso ya lo maneja el motor por factura)', () => {
    expect(buscarCombo([facturas[0]], 3_000_000)).toBeNull();
  });
});

describe('diasPagoTipicos', () => {
  it('mediana de los días factura→pago del cliente', () => {
    const emisiones = [
      { id: 'a', issue_date: '2026-05-01', responsible_id: JH },
      { id: 'b', issue_date: '2026-06-01', responsible_id: JH },
      { id: 'c', issue_date: '2026-07-01', responsible_id: JH },
    ];
    const cobros = [
      { responsible_id: JH, invoice_id: 'a', amount: 1, date: '2026-05-16' },  // 15 días
      { responsible_id: JH, invoice_id: 'b', amount: 1, date: '2026-06-21' },  // 20 días
      { responsible_id: JH, invoice_id: 'c', amount: 1, date: '2026-07-31' },  // 30 días
    ];
    expect(diasPagoTipicos(cobros, emisiones, JH)).toBe(20);
  });

  it('con menos de 3 pagos no opina', () => {
    expect(diasPagoTipicos([], [], JH)).toBeNull();
  });
});

describe('sugerirClienteParaPago — fase 4', () => {
  it('combo exacto + deuda: sugiere al cliente con la evidencia de las facturas', () => {
    const datos: DatosVentasProbable = {
      ...base,
      facturasAbiertas: [
        fv({ invoice_number: 'FV-10', issue_date: '2026-06-01', balance_pending: 3_000_000 }),
        fv({ invoice_number: 'FV-12', issue_date: '2026-06-20', balance_pending: 2_000_000 }),
        fv({ invoice_number: 'FV-99', responsible_id: SOTO, balance_pending: 9_000_000 }),
      ],
    };
    const s = sugerirClienteParaPago(datos, { amount: 5_000_000, date: '2026-08-01', description: 'TRANSFERENCIA CTA SUC VIRTUAL' })!;
    expect(s.responsibleId).toBe(JH);
    expect(s.combo!.facturas.map((f) => f.invoice_number)).toEqual(['FV-10', 'FV-12']);
    expect(s.confianza).toBeGreaterThanOrEqual(45);
  });

  it('alias aprendido (fase 3) en la descripción empuja al cliente correcto', () => {
    const datos: DatosVentasProbable = {
      ...base,
      aliases: [{ responsible_id: SOTO, alias: 'vidrios soto' }],
      facturasAbiertas: [
        fv({ invoice_number: 'FV-50', responsible_id: SOTO, balance_pending: 8_000_000 }),
      ],
    };
    const s = sugerirClienteParaPago(datos, { amount: 3_000_000, date: '2026-08-01', description: 'PAGO PSE VIDRIOS SOTO' })!;
    expect(s.responsibleId).toBe(SOTO);
    expect(s.abonoA?.invoice_number).toBe('FV-50');
    expect(s.señales.join(' ')).toContain('nombre');
  });

  it('pagar EXACTO el saldo total del cliente es señal fuerte', () => {
    const datos: DatosVentasProbable = {
      ...base,
      facturasAbiertas: [
        fv({ invoice_number: 'FV-1', balance_pending: 2_400_000 }),
        fv({ invoice_number: 'FV-2', issue_date: '2026-07-15', balance_pending: 1_600_000 }),
      ],
      cobros: [{ responsible_id: JH, invoice_id: null, amount: 4_000_000, date: '2026-06-01' }],
    };
    const s = sugerirClienteParaPago(datos, { amount: 4_000_000, date: '2026-08-01', description: 'CONSIGNACION' })!;
    expect(s.responsibleId).toBe(JH);
    expect(s.señales.join(' ')).toContain('EXACTO');
  });

  it('tiempos de pago: la ventana histórica del cliente suma señal', () => {
    const datos: DatosVentasProbable = {
      ...base,
      emisiones: [
        { id: 'h1', issue_date: '2026-04-01', responsible_id: JH },
        { id: 'h2', issue_date: '2026-05-01', responsible_id: JH },
        { id: 'h3', issue_date: '2026-06-01', responsible_id: JH },
      ],
      // Paga siempre a ~30 días, y $2.000.000 es un monto que ya pagó antes
      // (las señales débiles SE COMBINAN para cruzar el piso de 45 —
      // ninguna sola alcanza, que es la gracia del diseño probabilístico).
      cobros: [
        { responsible_id: JH, invoice_id: 'h1', amount: 2_000_000, date: '2026-05-01' },
        { responsible_id: JH, invoice_id: 'h2', amount: 1_000_000, date: '2026-05-31' },
        { responsible_id: JH, invoice_id: 'h3', amount: 1_000_000, date: '2026-07-01' },
      ],
      // Factura abierta emitida el 05/07: a 30 días "vence" ~04/08.
      facturasAbiertas: [fv({ invoice_number: 'FV-77', issue_date: '2026-07-05', balance_pending: 6_000_000 })],
    };
    const s = sugerirClienteParaPago(datos, { amount: 2_000_000, date: '2026-08-03', description: 'TRANSFERENCIA' })!;
    expect(s.responsibleId).toBe(JH);
    expect(s.señales.join(' ')).toContain('~30 días');
  });

  it('sin evidencia suficiente (solo "debe plata") no sugiere — piso 45', () => {
    const datos: DatosVentasProbable = {
      ...base,
      facturasAbiertas: [fv({ balance_pending: 9_000_000 })],
    };
    expect(sugerirClienteParaPago(datos, { amount: 1_111_111, date: '2026-08-01', description: 'TRANSFERENCIA' })).toBeNull();
  });

  it('la confianza NUNCA pasa de 95: siempre verifica el humano', () => {
    const datos: DatosVentasProbable = {
      ...base,
      aliases: [{ responsible_id: JH, alias: 'aluminios jh' }],
      facturasAbiertas: [
        fv({ invoice_number: 'FV-1', issue_date: '2026-06-01', balance_pending: 3_000_000 }),
        fv({ invoice_number: 'FV-2', issue_date: '2026-06-15', balance_pending: 2_000_000 }),
      ],
      cobros: [{ responsible_id: JH, invoice_id: null, amount: 5_000_000, date: '2026-05-01' }],
    };
    const s = sugerirClienteParaPago(datos, { amount: 5_000_000, date: '2026-08-01', description: 'PAGO ALUMINIOS JH' })!;
    expect(s.confianza).toBeLessThanOrEqual(95);
  });
});

describe('datos planos: sobreviven al cache persistente', () => {
  it('diasPagoTipicos acepta el array plano de emisiones (sin Maps)', () => {
    const emisiones = [
      { id: 'a', issue_date: '2026-05-01', responsible_id: JH },
      { id: 'b', issue_date: '2026-06-01', responsible_id: JH },
      { id: 'c', issue_date: '2026-07-01', responsible_id: JH },
    ];
    const cobros = [
      { responsible_id: JH, invoice_id: 'a', amount: 1, date: '2026-05-16' },
      { responsible_id: JH, invoice_id: 'b', amount: 1, date: '2026-06-21' },
      { responsible_id: JH, invoice_id: 'c', amount: 1, date: '2026-07-31' },
    ];
    expect(diasPagoTipicos(cobros, emisiones, JH)).toBe(20);
  });

  it('sugerirClienteParaPago no explota si emisiones viene vacío o ausente', () => {
    const datos = {
      ...base,
      facturasAbiertas: [fv({ invoice_number: 'FV-1', balance_pending: 4_000_000 })],
      emisiones: undefined as unknown as typeof base.emisiones,
    };
    expect(() => sugerirClienteParaPago(datos, { amount: 4_000_000, date: '2026-08-01', description: 'X' })).not.toThrow();
  });
});

// GUARDARRAÍL: react-query persiste el cache como JSON. Un Map/Set en la
// data de una query NO sobrevive la rehidratación y rompe la app al
// recargar ("t.get is not a function" — pasó dos veces: 2026-08-06 con el
// historial de conciliación y 2026-08-08 con este módulo).
describe('los datos cacheados deben sobrevivir un round-trip JSON', () => {
  it('DatosVentasProbable sigue funcionando después de serializar', () => {
    const datos: DatosVentasProbable = {
      ...base,
      facturasAbiertas: [
        fv({ invoice_number: 'FV-10', issue_date: '2026-06-01', balance_pending: 3_000_000 }),
        fv({ invoice_number: 'FV-12', issue_date: '2026-06-20', balance_pending: 2_000_000 }),
      ],
      emisiones: [{ id: 'h1', issue_date: '2026-04-01', responsible_id: JH }],
      cobros: [{ responsible_id: JH, invoice_id: 'h1', amount: 5_000_000, date: '2026-05-01' }],
    };
    const rehidratado: DatosVentasProbable = JSON.parse(JSON.stringify(datos));
    const pago = { amount: 5_000_000, date: '2026-08-01', description: 'TRANSFERENCIA' };
    expect(sugerirClienteParaPago(rehidratado, pago)).toEqual(sugerirClienteParaPago(datos, pago));
  });
});
