/**
 * El rol de un tercero se DERIVA de lo que hizo y, desde 2026-11-11, se puede
 * corregir a mano (roles_manual manda). La ficha responde "qué es lo que más
 * compra" cruzando facturas y remisiones.
 */

import { describe, it, expect } from 'vitest';
import {
  derivarRoles, rankearReferencias, actividadPorMes, construirPerfil,
  normalizarRolesManual, resolverRoles, indexarResumen,
  type Tercero, type InvoiceLite, type RawTerceroData, type ResumenTercero,
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

describe('rol fijado a mano — manda sobre lo derivado (Nico 2026-11-11)', () => {
  it('normalizarRolesManual: solo roles válidos, sin repetidos, en orden canónico; vacío o basura = null', () => {
    expect(normalizarRolesManual(['proveedor', 'cliente', 'cliente'])).toEqual(['cliente', 'proveedor']);
    expect(normalizarRolesManual(['gerente', 'empleado'])).toEqual(['empleado']);
    expect(normalizarRolesManual([])).toBeNull();
    expect(normalizarRolesManual(null)).toBeNull();
    expect(normalizarRolesManual(undefined)).toBeNull();
    expect(normalizarRolesManual('cliente')).toBeNull();
  });

  it('sin nada fijado, el rol es el derivado y no se marca como manual', () => {
    const r = resolverRoles({ derivados: ['proveedor'], rolesManual: null });
    expect(r).toEqual({ roles: ['proveedor'], manual: false, derivados: ['proveedor'] });
    expect(resolverRoles({ derivados: ['proveedor'], rolesManual: [] }).manual).toBe(false);
  });

  it('lo fijado a mano REEMPLAZA a lo derivado, y lo derivado queda a la vista', () => {
    // Caso de la captura: sale "Proveedor" por una factura de compra y Nico lo cambia a Cliente.
    const r = resolverRoles({ derivados: ['proveedor'], rolesManual: ['cliente'] });
    expect(r.roles).toEqual(['cliente']);
    expect(r.manual).toBe(true);
    expect(r.derivados).toEqual(['proveedor']);
  });

  it('se puede fijar más de un rol y darle rol a un tercero sin actividad', () => {
    expect(resolverRoles({ derivados: [], rolesManual: ['proveedor', 'cliente'] }).roles).toEqual(['cliente', 'proveedor']);
  });

  it('la marca heredada cliente_manual SUMA cliente (no reemplaza) y solo si no hay roles_manual', () => {
    // Nicolás: empleado por actividad + "tratarlo como cliente en Ventas".
    const legado = resolverRoles({ derivados: ['empleado'], clienteManual: true });
    expect(legado.roles).toEqual(['cliente', 'empleado']);
    expect(legado.manual).toBe(true);
    // Ya era cliente por actividad: la marca no agrega nada.
    expect(resolverRoles({ derivados: ['cliente'], clienteManual: true }).manual).toBe(false);
    // roles_manual gana sobre la marca vieja.
    expect(resolverRoles({ derivados: ['empleado'], rolesManual: ['proveedor'], clienteManual: true }).roles).toEqual(['proveedor']);
  });

  it('derivarRoles con rolesManual devuelve lo fijado; vacío o null sigue en automático', () => {
    const conCompra = { ...SIN_ACTIVIDAD, facturasCompra: 2 };
    expect(derivarRoles({ ...conCompra, rolesManual: ['cliente'] })).toEqual(['cliente']);
    expect(derivarRoles({ ...conCompra, rolesManual: [] })).toEqual(['proveedor']);
    expect(derivarRoles({ ...conCompra, rolesManual: null })).toEqual(['proveedor']);
  });

  it('construirPerfil expone el rol efectivo, el derivado y si es manual', () => {
    const base: RawTerceroData = {
      tercero: { id: 'r1', name: 'Vidrimar', active: true, roles_manual: ['cliente'] } as Tercero,
      alias: [], movimientos: [], invoiceItems: [], remisiones: [], remisionItems: [],
      cotizaciones: 0, movimientosCajaMenor: 0, categoriasNombres: [],
      facturas: [{ id: 'f1', invoice_number: 'FC-1', type: 'compra', issue_date: '2026-06-01', total_amount: 200_000, balance_pending: 0, responsible_id: 'r1', counterparty_name: null, status: null }],
    };
    const p = construirPerfil(base);
    expect(p.roles).toEqual(['cliente']);
    expect(p.rolesDerivados).toEqual(['proveedor']);
    expect(p.rolManual).toBe(true);

    const auto = construirPerfil({ ...base, tercero: { ...base.tercero, roles_manual: null } });
    expect(auto.roles).toEqual(['proveedor']);
    expect(auto.rolManual).toBe(false);
  });
});

describe('resumen del listado — array plano que sobrevive el cache persistido', () => {
  it('ida y vuelta por JSON y el índice sigue funcionando (nada de Map en la query)', () => {
    const rows: ResumenTercero[] = [
      { id: 'a', movimientos: 3, facturas: 1, pendienteCobrar: 500, ultimaActividad: '2026-10-30', roles: ['cliente'] },
      { id: 'b', movimientos: 0, facturas: 0, pendienteCobrar: 0, ultimaActividad: null, roles: [] },
    ];
    const rehidratado = JSON.parse(JSON.stringify(rows)) as ResumenTercero[];
    const idx = indexarResumen(rehidratado);
    expect(idx.get('a')?.roles).toEqual(['cliente']);
    expect(idx.get('b')?.ultimaActividad).toBeNull();
    expect(indexarResumen(undefined).size).toBe(0);
  });
});
