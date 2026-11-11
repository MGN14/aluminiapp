import { describe, it, expect } from 'vitest';
import {
  esCategoriaVentas, clienteIdsDesdeEvidencia, idsUnicos, filtrarBeneficiariosVentas,
} from './beneficiariosVentas';

const terceros = [
  { id: 'alumfer', name: 'ALUMFER DEL TOLIMA S.A.S.' },
  { id: 'castano', name: 'Vidrios y Aluminios Castaño sas' },
  { id: 'tigo', name: 'TIGO' },
  { id: 'yolanda', name: 'Yolanda' },
  { id: 'nicolas', name: 'Nicolas' },
  { id: 'nuevo', name: 'Cliente nuevo sin factura' },
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
});

describe('idsUnicos — los ya usados en Ventas', () => {
  it('quita nulos y repetidos y ordena', () => {
    expect(idsUnicos([{ responsible_id: 'nicolas' }, { responsible_id: null }, { responsible_id: 'alumfer' }, { responsible_id: 'nicolas' }]))
      .toEqual(['alumfer', 'nicolas']);
  });
});

describe('filtrarBeneficiariosVentas — el caso de Nico', () => {
  const clienteIds = ['alumfer', 'castano'];              // tienen facturas de venta
  const usadosEnVentas = ['nicolas', 'alumfer'];          // historial: cobraron ventas

  it('deja clientes y a Nicolás; saca a Tigo y Yolanda y al que nunca vendió', () => {
    const out = filtrarBeneficiariosVentas({ responsibles: terceros, clienteIds, usadosEnVentas, seleccionadoId: null });
    expect(out.map((t) => t.id)).toEqual(['alumfer', 'castano', 'nicolas']);
  });

  it('el beneficiario ya grabado en la fila nunca desaparece, aunque no sea cliente', () => {
    const out = filtrarBeneficiariosVentas({ responsibles: terceros, clienteIds, usadosEnVentas, seleccionadoId: 'yolanda' });
    expect(out.map((t) => t.id)).toEqual(['alumfer', 'castano', 'yolanda', 'nicolas']);
  });

  it('conserva el orden de entrada (las sugerencias ★ ya vienen ordenadas arriba)', () => {
    const ordenados = [terceros[4], terceros[2], terceros[0]]; // nicolas, tigo, alumfer
    const out = filtrarBeneficiariosVentas({ responsibles: ordenados, clienteIds, usadosEnVentas, seleccionadoId: null });
    expect(out.map((t) => t.id)).toEqual(['nicolas', 'alumfer']);
  });

  it('sin evidencia ni historial, solo queda el seleccionado (si hay)', () => {
    expect(filtrarBeneficiariosVentas({ responsibles: terceros, clienteIds: [], usadosEnVentas: [], seleccionadoId: null })).toEqual([]);
    expect(filtrarBeneficiariosVentas({ responsibles: terceros, clienteIds: [], usadosEnVentas: [], seleccionadoId: 'tigo' }).map((t) => t.id)).toEqual(['tigo']);
  });
});
