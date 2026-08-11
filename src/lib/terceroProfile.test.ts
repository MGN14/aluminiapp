/**
 * El rol de un tercero se DERIVA de lo que hizo (nada que digitar), y la
 * ficha responde "qué es lo que más compra" cruzando facturas y remisiones.
 */

import { describe, it, expect } from 'vitest';
import {
  derivarRoles, rankearReferencias, actividadPorMes, construirPerfil,
  type Tercero, type InvoiceLite, type RawTerceroData,
} from './terceroProfile';

const SIN_ACTIVIDAD = {
  nombre: 'X', facturasVenta: 0, facturasCompra: 0, remisionesVenta: 0,
  remisionesCompra: 0, cotizaciones: 0, movimientosCajaMenor: 0, categoriasNombres: [] as string[],
};

describe('derivarRoles', () => {
  it('con facturas de venta es cliente', () => {
    expect(derivarRoles({ ...SIN_ACTIVIDAD, facturasVenta: 3 })).toEqual(['cliente']);
  });

  it('con facturas de compra es proveedor', () => {
    expect(derivarRoles({ ...SIN_ACTIVIDAD, facturasCompra: 2 })).toEqual(['proveedor']);
  });

  it('puede ser cliente Y proveedor a la vez', () => {
    const r = derivarRoles({ ...SIN_ACTIVIDAD, facturasVenta: 1, facturasCompra: 1 });
    expect(r).toContain('cliente');
    expect(r).toContain('proveedor');
  });

  it('solo con cotizaciones ya cuenta como cliente (todavía no compró)', () => {
    expect(derivarRoles({ ...SIN_ACTIVIDAD, cotizaciones: 2 })).toEqual(['cliente']);
  });

  it('con movimientos de caja menor es empleado', () => {
    expect(derivarRoles({ ...SIN_ACTIVIDAD, movimientosCajaMenor: 4 })).toEqual(['empleado']);
  });

  it('con categoría Nómina es empleado (aunque no pase por caja menor)', () => {
    expect(derivarRoles({ ...SIN_ACTIVIDAD, categoriasNombres: ['Nómina'] })).toEqual(['empleado']);
  });

  it('la DIAN es entidad, no proveedor', () => {
    expect(derivarRoles({ ...SIN_ACTIVIDAD, nombre: 'DIAN', categoriasNombres: ['Impuestos'] }))
      .toEqual(['entidad']);
  });

  it('un banco que además factura queda como proveedor + entidad', () => {
    const r = derivarRoles({ ...SIN_ACTIVIDAD, nombre: 'Bancolombia', facturasCompra: 1 });
    expect(r).toContain('proveedor');
    expect(r).toContain('entidad');
  });

  it('un tercero sin actividad (el seguro recién creado) no tiene rol todavía', () => {
    expect(derivarRoles({ ...SIN_ACTIVIDAD, nombre: 'Seguros del Estado' })).toEqual([]);
  });
});

describe('rankearReferencias — "qué es lo que más compra"', () => {
  it('suma facturas y remisiones, y ordena por importe', () => {
    const r = rankearReferencias(
      [
        { invoice_id: 'f1', reference: 'LIV-40', description: 'Liviano 40', quantity: 10, line_total: 500_000 },
        { invoice_id: 'f2', reference: 'LIV-40', description: null, quantity: 5, line_total: 250_000 },
        { invoice_id: 'f1', reference: 'GL4102', description: 'Ángulo', quantity: 100, line_total: 300_000 },
      ],
      [{ remision_id: 'r1', reference: 'LIV-40', units: 3, total_cost: 150_000 }],
    );
    expect(r[0]).toMatchObject({ reference: 'LIV-40', unidades: 18, importe: 900_000, documentos: 3 });
    expect(r[0].descripcion).toBe('Liviano 40');
    expect(r[1].reference).toBe('GL4102');
  });

  it('agrupa referencias escritas distinto (mayúsculas/espacios)', () => {
    const r = rankearReferencias(
      [{ invoice_id: 'f1', reference: 'liv 40', description: null, quantity: 2, line_total: 100 }],
      [{ remision_id: 'r1', reference: 'LIV 40', units: 3, total_cost: 150 }],
    );
    expect(r).toHaveLength(1);
    expect(r[0].unidades).toBe(5);
  });

  it('ignora líneas sin referencia', () => {
    expect(rankearReferencias(
      [{ invoice_id: 'f1', reference: null, description: 'suelto', quantity: 1, line_total: 10 }], [],
    )).toHaveLength(0);
  });
});

describe('actividadPorMes', () => {
  it('agrupa ventas, compras y banco por mes en orden cronológico', () => {
    const fv: InvoiceLite[] = [
      { id: 'a', invoice_number: '1', type: 'venta', issue_date: '2026-07-05', total_amount: 100, balance_pending: 0, responsible_id: 'r', counterparty_name: null, status: null },
      { id: 'b', invoice_number: '2', type: 'venta', issue_date: '2026-06-20', total_amount: 50, balance_pending: 0, responsible_id: 'r', counterparty_name: null, status: null },
    ];
    const m = actividadPorMes(fv, [], [
      { id: 't', date: '2026-07-10', description: null, amount: -30, type: 'egreso', category_id: null, responsible_id: 'r' },
    ]);
    expect(m.map((x) => x.mes)).toEqual(['2026-06', '2026-07']);
    expect(m[1]).toMatchObject({ ventas: 100, banco: -30 });
  });
});

describe('construirPerfil', () => {
  const tercero = { id: 'r1', name: 'Seguros del Estado', active: true } as Tercero;
  const vacio: RawTerceroData = {
    tercero, alias: [], movimientos: [], facturas: [], invoiceItems: [],
    remisiones: [], remisionItems: [], cotizaciones: 0, movimientosCajaMenor: 0,
    categoriasNombres: [],
  };

  it('el caso del seguro: un solo movimiento bancario, sin facturas, no rompe', () => {
    const p = construirPerfil({
      ...vacio,
      movimientos: [{ id: 't1', date: '2026-08-05', description: 'PAGO PYME PROTEGIDO', amount: -163_122, type: 'egreso', category_id: 'c-otros', responsible_id: 'r1' }],
      categoriasNombres: ['Otros'],
    });
    expect(p.roles).toEqual([]);
    expect(p.netoBancario).toBe(-163_122);
    expect(p.totalVentas).toBe(0);
    expect(p.topReferencias).toHaveLength(0);
    expect(p.ultimaActividad).toBe('2026-08-05');
    expect(p.totalDocumentos).toBe(0);
  });

  it('un tercero sin absolutamente nada no explota', () => {
    const p = construirPerfil(vacio);
    expect(p.ultimaActividad).toBeNull();
    expect(p.porMes).toHaveLength(0);
  });

  it('cliente con cartera: separa facturado de pendiente y ordena por fecha desc', () => {
    const p = construirPerfil({
      ...vacio,
      facturas: [
        { id: 'f1', invoice_number: 'FV-1', type: 'venta', issue_date: '2026-05-01', total_amount: 1_000_000, balance_pending: 400_000, responsible_id: 'r1', counterparty_name: null, status: null },
        { id: 'f2', invoice_number: 'FV-2', type: 'venta', issue_date: '2026-07-01', total_amount: 500_000, balance_pending: 0, responsible_id: 'r1', counterparty_name: null, status: null },
        { id: 'f3', invoice_number: 'FC-1', type: 'compra', issue_date: '2026-06-01', total_amount: 200_000, balance_pending: 200_000, responsible_id: 'r1', counterparty_name: null, status: null },
      ],
    });
    expect(p.totalVentas).toBe(1_500_000);
    expect(p.pendienteCobrar).toBe(400_000);
    expect(p.totalCompras).toBe(200_000);
    expect(p.pendientePagar).toBe(200_000);
    expect(p.roles).toEqual(['cliente', 'proveedor']);
    expect(p.facturasVenta[0].invoice_number).toBe('FV-2'); // más reciente primero
  });
});
