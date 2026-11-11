import { describe, it, expect } from 'vitest';
import {
  esCategoriaVentas, clienteIdsDesdeEvidencia, idsUnicos, filtrarBeneficiariosVentas, aplicarRolesManuales,
} from './beneficiariosVentas';

const terceros = [
  { id: 'alumfer', name: 'ALUMFER DEL TOLIMA S.A.S.' },
  { id: 'castano', name: 'Vidrios y Aluminios Castaño sas' },
  { id: 'tigo', name: 'TIGO' },
  { id: 'yolanda', name: 'Yolanda' },
  { id: 'nicolas', name: 'Nicolas' },
  { id: 'otros', name: 'Otros' },
];

describe('esCategoriaVentas', () => {
  it('reconoce Ventas y variantes, no las demás', () => {
    expect(esCategoriaVentas('Ventas')).toBe(true);
    expect(esCategoriaVentas('Venta de contado')).toBe(true);
    expect(esCategoriaVentas('Servicios')).toBe(false);
    expect(esCategoriaVentas('Nómina')).toBe(false);
    expect(esCategoriaVentas(null)).toBe(false);
  });
});

describe('clienteIdsDesdeEvidencia — misma regla que derivarRoles', () => {
  it('junta facturas de venta, remisiones de venta y cotizaciones, sin nulos ni repetidos', () => {
    const ids = clienteIdsDesdeEvidencia({
      facturasVenta: [{ responsible_id: 'alumfer' }, { responsible_id: 'alumfer' }, { responsible_id: null }],
      remisionesVenta: [{ responsible_id: 'castano' }],
      cotizaciones: [{ responsible_id: 'nuevo' }],
    });
    expect(ids).toEqual(['alumfer', 'castano', 'nuevo']);
  });

  it('idsUnicos quita nulos y repetidos y ordena', () => {
    expect(idsUnicos([{ responsible_id: 'nicolas' }, { responsible_id: null }, { responsible_id: 'alumfer' }, { responsible_id: 'nicolas' }]))
      .toEqual(['alumfer', 'nicolas']);
  });
});

describe('filtrarBeneficiariosVentas — el caso de Nico', () => {
  // Evidencia (facturas) ∪ marcados a mano en la ficha (Nicolás).
  const clienteIds = ['alumfer', 'castano', 'nicolas'];

  it('deja clientes y a Nicolás (marcado a mano); saca a Tigo, Yolanda y "Otros" aunque alguna vez tuvieran Ventas', () => {
    const out = filtrarBeneficiariosVentas({ responsibles: terceros, clienteIds, seleccionadoId: null });
    expect(out.map((t) => t.id)).toEqual(['alumfer', 'castano', 'nicolas']);
  });

  it('el beneficiario ya grabado en la fila nunca desaparece, aunque no sea cliente', () => {
    const out = filtrarBeneficiariosVentas({ responsibles: terceros, clienteIds, seleccionadoId: 'yolanda' });
    expect(out.map((t) => t.id)).toEqual(['alumfer', 'castano', 'yolanda', 'nicolas']);
  });

  it('conserva el orden de entrada (las sugerencias ★ ya vienen ordenadas arriba)', () => {
    const ordenados = [terceros[4], terceros[2], terceros[0]]; // nicolas, tigo, alumfer
    const out = filtrarBeneficiariosVentas({ responsibles: ordenados, clienteIds, seleccionadoId: null });
    expect(out.map((t) => t.id)).toEqual(['nicolas', 'alumfer']);
  });

  it('sin clientes, solo queda el seleccionado (si hay)', () => {
    expect(filtrarBeneficiariosVentas({ responsibles: terceros, clienteIds: [], seleccionadoId: null })).toEqual([]);
    expect(filtrarBeneficiariosVentas({ responsibles: terceros, clienteIds: [], seleccionadoId: 'tigo' }).map((t) => t.id)).toEqual(['tigo']);
  });
});

describe('aplicarRolesManuales — lo fijado a mano manda sobre la evidencia', () => {
  const evidencia = ['alumfer', 'castano', 'vidrimar'];

  it('rol Cliente a mano entra sin facturas; rol a mano SIN Cliente sale aunque tenga facturas', () => {
    const r = aplicarRolesManuales(evidencia, [
      { id: 'nicolas', roles_manual: ['cliente', 'empleado'] },   // sin evidencia, entra
      { id: 'vidrimar', roles_manual: ['proveedor'] },            // con evidencia, sale
      { id: 'alumfer', roles_manual: ['cliente'] },               // ya estaba: sigue, marcado manual
    ]);
    expect(r.clienteIds).toEqual(['alumfer', 'castano', 'nicolas']);
    expect(r.manuales).toEqual(['alumfer', 'nicolas']);
    expect(r.excluidos).toEqual(['vidrimar']);
  });

  it('sin roles_manual manda la evidencia, más la marca heredada cliente_manual', () => {
    const r = aplicarRolesManuales(evidencia, [
      { id: 'nicolas', roles_manual: null, cliente_manual: true },
      { id: 'tigo', roles_manual: [], cliente_manual: false },
    ]);
    expect(r.clienteIds).toEqual(['alumfer', 'castano', 'nicolas', 'vidrimar']);
    expect(r.manuales).toEqual(['nicolas']);
    expect(r.excluidos).toEqual([]);
  });

  it('roles_manual gana sobre la marca vieja: proveedor a mano + cliente_manual heredado = fuera', () => {
    const r = aplicarRolesManuales([], [{ id: 'x', roles_manual: ['proveedor'], cliente_manual: true }]);
    expect(r.clienteIds).toEqual([]);
  });
});
