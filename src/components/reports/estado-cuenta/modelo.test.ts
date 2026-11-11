import { describe, it, expect } from 'vitest';
import {
  construirFila, aplicarFiltros, aplicarFiltrosSinEstado, ordenarFilas, siguienteOrden, totalesDe,
  contarFiltrosActivos, FILTROS_DEFAULT, formatCompacto, iniciales, type FilaEstado,
} from './modelo';
import type { ClientReceivable } from '@/lib/clientReceivables';
import type { AgingBuckets } from '@/lib/agingBuckets';

const cliente = (o: Partial<ClientReceivable>): ClientReceivable => ({
  client_id: 'c', client_name: 'Cliente', facturado_venta: 0, cxc_inicial: 0, cobrado_banco: 0,
  cobrado_efectivo: 0, saldo_siigo: 0, anticipos_total: 0, retenciones_total: 0, saldo_neto: 0,
  invoices_pendientes: [], invoices_pagadas: [], ...o,
});
const tramos = (o: Partial<AgingBuckets>): AgingBuckets => ({ corriente: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0, ...o });

const filas: FilaEstado[] = [
  construirFila({
    client: cliente({ client_id: 'bodega', client_name: 'La Bodega', facturado_venta: 500, cobrado_banco: 100, saldo_neto: 400 }),
    nit: '900123', despachado: 650,
    aging: { buckets: tramos({ d1_30: 100, d90_plus: 300, total: 400 }), oldest_overdue_days: 120 },
    promesa: { amount: 200, due_date: '2026-11-20' },
  }),
  construirFila({
    client: cliente({ client_id: 'jh', client_name: 'Aluminios JH', facturado_venta: 300, cobrado_banco: 280, retenciones_total: 5, saldo_neto: 15 }),
    nit: null, despachado: 300,
    aging: { buckets: tramos({ corriente: 15, total: 15 }), oldest_overdue_days: 0 },
  }),
  construirFila({
    client: cliente({ client_id: 'castano', client_name: 'Vidrios y Aluminios Castaño', facturado_venta: 100, anticipos_total: 150, saldo_neto: -50 }),
    nit: '800999', despachado: 0,
  }),
  construirFila({
    client: cliente({ client_id: 'poly', client_name: 'Polyácril', facturado_venta: 200, cobrado_banco: 200, saldo_neto: 0 }),
    nit: '901317432', despachado: 200,
  }),
];

describe('construirFila — solo presenta lo que ya calculó el motor', () => {
  it('facturado − cobrado = saldo, con retenciones y anticipos', () => {
    for (const r of filas) expect(r.facturado - r.cobrado).toBe(r.client.saldo_neto);
  });

  it('estado, % cobrado, sin facturar y mora', () => {
    const [bodega, jh, castano] = filas;
    expect([bodega.estado, jh.estado, castano.estado, filas[3].estado]).toEqual(['cxc', 'cxc', 'anticipos', 'aldia']);
    expect(bodega.pctCobrado).toBeCloseTo(0.2);
    expect(castano.pctCobrado).toBe(1);                // cobró más de lo facturado: se topa en 100 %
    expect(bodega.sinFacturar).toBe(150);
    expect(jh.sinFacturar).toBe(0);
    expect(bodega.mora).toBe(120);
    expect(castano.mora).toBe(0);
  });
});

describe('filtros de la tabla', () => {
  it('por estado', () => {
    expect(aplicarFiltros(filas, { ...FILTROS_DEFAULT, estado: 'cxc' }).map((r) => r.client.client_id)).toEqual(['bodega', 'jh']);
    expect(aplicarFiltros(filas, { ...FILTROS_DEFAULT, estado: 'anticipos' }).map((r) => r.client.client_id)).toEqual(['castano']);
  });

  it('por mora: vencida, y por tramo (+90)', () => {
    expect(aplicarFiltros(filas, { ...FILTROS_DEFAULT, mora: 'vencida' }).map((r) => r.client.client_id)).toEqual(['bodega']);
    expect(aplicarFiltros(filas, { ...FILTROS_DEFAULT, mora: 'd90_plus' }).map((r) => r.client.client_id)).toEqual(['bodega']);
    expect(aplicarFiltros(filas, { ...FILTROS_DEFAULT, mora: 'corriente' }).map((r) => r.client.client_id)).toEqual(['jh']);
  });

  it('búsqueda sin tildes ni mayúsculas, y por NIT con 3+ dígitos', () => {
    expect(aplicarFiltros(filas, { ...FILTROS_DEFAULT, q: 'polyacril' }).map((r) => r.client.client_id)).toEqual(['poly']);
    expect(aplicarFiltros(filas, { ...FILTROS_DEFAULT, q: 'CASTANO' }).map((r) => r.client.client_id)).toEqual(['castano']);
    expect(aplicarFiltros(filas, { ...FILTROS_DEFAULT, q: '901.317' }).map((r) => r.client.client_id)).toEqual(['poly']);
  });

  it('saldo mínimo en valor absoluto (incluye anticipos grandes)', () => {
    expect(aplicarFiltros(filas, { ...FILTROS_DEFAULT, saldoMin: 50 }).map((r) => r.client.client_id)).toEqual(['bodega', 'castano']);
  });

  it('sin facturar, sin NIT y con promesa', () => {
    expect(aplicarFiltros(filas, { ...FILTROS_DEFAULT, soloSinFacturar: true }).map((r) => r.client.client_id)).toEqual(['bodega']);
    expect(aplicarFiltros(filas, { ...FILTROS_DEFAULT, soloSinNit: true }).map((r) => r.client.client_id)).toEqual(['jh']);
    expect(aplicarFiltros(filas, { ...FILTROS_DEFAULT, soloConPromesa: true }).map((r) => r.client.client_id)).toEqual(['bodega']);
  });

  it('los conteos por estado ignoran el filtro de estado pero respetan los demás', () => {
    const f = { ...FILTROS_DEFAULT, estado: 'anticipos' as const, soloSinNit: true };
    expect(aplicarFiltrosSinEstado(filas, f).map((r) => r.client.client_id)).toEqual(['jh']);
  });

  it('contarFiltrosActivos no cuenta el estado', () => {
    expect(contarFiltrosActivos(FILTROS_DEFAULT)).toBe(0);
    expect(contarFiltrosActivos({ ...FILTROS_DEFAULT, estado: 'cxc' })).toBe(0);
    expect(contarFiltrosActivos({ ...FILTROS_DEFAULT, q: 'x', mora: 'vencida', soloSinNit: true })).toBe(3);
  });
});

describe('orden', () => {
  it('sin orden: el de siempre (saldo absoluto desc; anticipos más grandes primero)', () => {
    expect(ordenarFilas(filas, null, 'todos').map((r) => r.client.client_id)).toEqual(['bodega', 'castano', 'jh', 'poly']);
  });

  it('por columna, con desempate por nombre', () => {
    expect(ordenarFilas(filas, { key: 'mora', dir: 'desc' }, 'todos')[0].client.client_id).toBe('bodega');
    expect(ordenarFilas(filas, { key: 'cliente', dir: 'asc' }, 'todos').map((r) => r.client.client_id)).toEqual(['jh', 'bodega', 'poly', 'castano']);
    expect(ordenarFilas(filas, { key: 'saldo', dir: 'asc' }, 'todos')[0].client.client_id).toBe('castano');
  });

  it('el clic en el encabezado rota: natural → inverso → sin orden', () => {
    expect(siguienteOrden(null, 'saldo')).toEqual({ key: 'saldo', dir: 'desc' });
    expect(siguienteOrden({ key: 'saldo', dir: 'desc' }, 'saldo')).toEqual({ key: 'saldo', dir: 'asc' });
    expect(siguienteOrden({ key: 'saldo', dir: 'asc' }, 'saldo')).toBeNull();
    expect(siguienteOrden(null, 'cliente')).toEqual({ key: 'cliente', dir: 'asc' });
  });
});

describe('totales de lo que se ve', () => {
  it('separa lo que te deben de lo que está a favor', () => {
    const t = totalesDe(filas);
    expect(t).toMatchObject({ clientes: 4, teDeben: 415, aFavor: 50, neto: 365, despachado: 1150 });
    expect(t.facturado - t.cobrado).toBe(t.neto);
  });
});

describe('formato', () => {
  it('compacto', () => {
    expect(formatCompacto(924_225_969)).toBe('$924,2 M');
    expect(formatCompacto(1_250_000_000)).toBe('$1,3 mil M');
    expect(formatCompacto(850_000)).toBe('$850 mil');
    expect(formatCompacto(9_500)).toBe('$9.500');
    expect(formatCompacto(-52_771_400)).toBe('-$52,8 M');
  });

  it('iniciales sin siglas ni conectores', () => {
    expect(iniciales('Vidrios y Aluminios Castaño sas')).toBe('VA');
    expect(iniciales('ALUMFER DEL TOLIMA S.A.S.')).toBe('AT');
    expect(iniciales('Polyacril')).toBe('P');
    // Números y signos no son iniciales: «Ventanería La 80» → V, no V8.
    expect(iniciales('Ventanería La 80')).toBe('V');
    expect(iniciales('Ñandú & Cía')).toBe('ÑC');
  });
});
