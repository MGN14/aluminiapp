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
  emisionPorFactura: new Map(),
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
    const emision = new Map([
      ['a', { issue_date: '2026-05-01', responsible_id: JH }],
      ['b', { issue_date: '2026-06-01', responsible_id: JH }],
      ['c', { issue_date: '2026-07-01', responsible_id: JH }],
    ]);
    const cobros = [
      { responsible_id: JH, invoice_id: 'a', amount: 1, date: '2026-05-16' },  // 15 días
      { responsible_id: JH, invoice_id: 'b', amount: 1, date: '2026-06-21' },  // 20 días
      { responsible_id: JH, invoice_id: 'c', amount: 1, date: '2026-07-31' },  // 30 días
    ];
    expect(diasPagoTipicos(cobros, emision, JH)).toBe(20);
  });

  it('con menos de 3 pagos no opina', () => {
    expect(diasPagoTipicos([], new Map(), JH)).toBeNull();
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
    const emision = new Map([
      ['h1', { issue_date: '2026-04-01', responsible_id: JH }],
      ['h2', { issue_date: '2026-05-01', responsible_id: JH }],
      ['h3', { issue_date: '2026-06-01', responsible_id: JH }],
    ]);
    const datos: DatosVentasProbable = {
      ...base,
      emisionPorFactura: emision,
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
