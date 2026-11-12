import { describe, it, expect } from 'vitest';
import {
  construirRecordatorios, diasEntre, fechaCorta, filtrarPospuestos, posponer,
  type SenalesApp,
} from './recordatoriosApp';

/** Todo al día: ninguna regla dispara. */
function base(over: Partial<SenalesApp> = {}): SenalesApp {
  return {
    hoy: '2026-11-12',
    siigo: { estado: 'connected' },
    ultimaVenta: '2026-11-10',
    ultimaCompra: '2026-11-09',
    extractos: [{ bank_name: 'Bancolombia', period_start: '2026-10-01', period_end: '2026-10-31' }],
    extractosSilenciados: [],
    ultimoConteo: '2026-11-01',
    movimientosDesdeConteo: 20,
    cajaSinCerrar: { movimientos: 3, masViejo: '2026-11-03' },
    ...over,
  };
}

const ids = (s: SenalesApp) => construirRecordatorios(s).map((r) => r.id);

describe('fechas', () => {
  it('cuenta días sin zona horaria', () => {
    expect(diasEntre('2026-10-31', '2026-11-12')).toBe(12);
    expect(diasEntre('2026-11-12', '2026-11-12')).toBe(0);
  });
  it('fecha corta con año solo si no es el de hoy', () => {
    expect(fechaCorta('2026-06-25', '2026-11-12')).toBe('25 jun');
    expect(fechaCorta('2025-12-01', '2026-11-12')).toBe('1 dic 2025');
  });
});

describe('construirRecordatorios', () => {
  it('todo al día → nada', () => {
    expect(construirRecordatorios(base())).toEqual([]);
  });

  it('caso real 2026-11-12: Siigo en error, inventario, extractos y caja', () => {
    const recs = construirRecordatorios(base({
      siigo: { estado: 'error' },
      ultimaVenta: '2026-10-27',
      extractos: [
        { bank_name: 'Bancolombia', period_start: '2026-10-01', period_end: '2026-10-31' },
        { bank_name: 'Tarjeta de crédito Bancolombia', period_start: '2026-05-26', period_end: '2026-06-25' },
        { bank_name: 'Davivienda', period_start: '2026-05-01', period_end: '2026-05-31' },
      ],
      ultimoConteo: '2026-08-25',
      movimientosDesdeConteo: 508,
      cajaSinCerrar: { movimientos: 45, masViejo: '2026-09-01' },
    }));
    expect(recs.map((r) => r.id)).toEqual(['siigo', 'extractos', 'inventario', 'caja-menor']);

    const siigo = recs.find((r) => r.id === 'siigo')!;
    expect(siigo.nivel).toBe('alarm');
    expect(siigo.titulo).toBe('Siigo desconectado');
    expect(siigo.detalle).toContain('27 oct');
    expect(siigo.detalle).toContain('reintenta sola');
    expect(siigo.accion).toBe('Reintentar');
    expect(siigo.ruta).toBe('/settings#siigo');
    expect(siigo.modulo).toBe('admin');

    const ext = recs.find((r) => r.id === 'extractos')!;
    expect(ext.titulo).toBe('Extractos atrasados (2 cuentas)');
    expect(ext.detalle).toContain('Tarjeta de crédito va hasta el 25 jun');
    expect(ext.detalle).toContain('Davivienda va hasta el 31 may');

    const inv = recs.find((r) => r.id === 'inventario')!;
    expect(inv.titulo).toBe('Inventario sin contar desde el 25 ago');
    expect(inv.detalle).toContain('508 movimientos');
    expect(inv.nivel).toBe('alarm');
    expect(inv.ruta).toBe('/inventarios?tab=conteo');

    const caja = recs.find((r) => r.id === 'caja-menor')!;
    expect(caja.nivel).toBe('warn');
    expect(caja.detalle).toContain('45 movimientos sin cierre desde el 1 sep');
  });

  it('con Siigo caído no repite el aviso de ventas', () => {
    expect(ids(base({ siigo: { estado: 'error' }, ultimaVenta: '2026-09-01' }))).toEqual(['siigo']);
  });

  it('Siigo con error de clave pide revisarla (no reintentar)', () => {
    const r = construirRecordatorios(base({ siigo: { estado: 'error', errorDeClave: true }, ultimaVenta: '2026-10-27' }))[0];
    expect(r.titulo).toBe('Siigo rechaza la clave');
    expect(r.accion).toBe('Revisar clave');
    expect(r.detalle).toContain('usuario y la access key');
  });

  it('ventas quietas: con Siigo conectado no pide "traer" (ya está todo); sin Siigo pide subirlas', () => {
    const conSiigo = construirRecordatorios(base({ ultimaVenta: '2026-10-27' }))[0];
    expect(conSiigo.id).toBe('facturas-venta');
    expect(conSiigo.nivel).toBe('warn');
    expect(conSiigo.accion).toBe('Ver facturas');
    expect(conSiigo.detalle).toBe('La última que hay en Siigo es del 27 oct (hace 16 días). Si facturaste después, revisá que esté emitida en Siigo.');
    const sinSiigo = construirRecordatorios(base({ siigo: null, ultimaVenta: '2026-10-01' }))[0];
    expect(sinSiigo.accion).toBe('Subir facturas');
    expect(sinSiigo.nivel).toBe('alarm'); // 42 días
  });

  it('sin historia no regaña: nunca facturó, nunca contó, nunca subió extractos', () => {
    expect(ids(base({
      ultimaVenta: null, ultimaCompra: null, extractos: [], ultimoConteo: null,
      cajaSinCerrar: { movimientos: 0, masViejo: null },
    }))).toEqual([]);
  });

  it('inventario: pocos movimientos recientes no alcanzan; muchos días sí', () => {
    expect(ids(base({ ultimoConteo: '2026-10-05', movimientosDesdeConteo: 30 }))).toEqual([]);
    expect(ids(base({ ultimoConteo: '2026-10-05', movimientosDesdeConteo: 60 }))).toEqual(['inventario']);
    expect(ids(base({ ultimoConteo: '2026-09-05', movimientosDesdeConteo: 5 }))).toEqual(['inventario']);
    expect(ids(base({ ultimoConteo: '2026-01-05', movimientosDesdeConteo: 0 }))).toEqual([]);
  });

  it('extractos: falta el mes que cerró, pero con gracia los primeros días', () => {
    const extractos = [{ bank_name: 'Bancolombia', period_start: '2026-09-01', period_end: '2026-09-30' }];
    expect(ids(base({ hoy: '2026-11-05', extractos }))).toEqual([]);
    const r = construirRecordatorios(base({ extractos }))[0];
    expect(r.id).toBe('extractos');
    expect(r.titulo).toBe('Falta subir el extracto del mes');
    expect(r.detalle).toContain('Falta octubre: lo último cargado es del 30 sep');
  });

  it('extractos: respeta las cuentas silenciadas en Conciliación', () => {
    const extractos = [
      { bank_name: 'Bancolombia', period_start: '2026-10-01', period_end: '2026-10-31' },
      { bank_name: 'Davivienda', period_start: '2026-05-01', period_end: '2026-05-31' },
    ];
    expect(ids(base({ extractos }))).toEqual(['extractos']);
    expect(ids(base({ extractos, extractosSilenciados: ['Davivienda'] }))).toEqual([]);
  });

  it('extractos: huecos recientes sí, viejos no', () => {
    const reciente = [
      { bank_name: 'Bancolombia', period_start: '2026-09-01', period_end: '2026-09-20' },
      { bank_name: 'Bancolombia', period_start: '2026-10-01', period_end: '2026-10-31' },
    ];
    expect(construirRecordatorios(base({ extractos: reciente }))[0]?.detalle).toContain('10 días sin cargar');
    const viejo = [
      { bank_name: 'Bancolombia', period_start: '2026-01-01', period_end: '2026-01-20' },
      { bank_name: 'Bancolombia', period_start: '2026-02-01', period_end: '2026-10-31' },
    ];
    expect(ids(base({ extractos: viejo }))).toEqual([]);
  });

  it('caja menor y compras con sus umbrales', () => {
    expect(ids(base({ cajaSinCerrar: { movimientos: 4, masViejo: '2026-10-20' } }))).toEqual([]);
    expect(ids(base({ cajaSinCerrar: { movimientos: 4, masViejo: '2026-10-01' } }))).toEqual(['caja-menor']);
    expect(ids(base({ ultimaCompra: '2026-10-15' }))).toEqual(['facturas-compra']);
  });

  it('ordena: alarmas primero y, dentro del nivel, lo más atrasado', () => {
    const recs = construirRecordatorios(base({
      ultimaVenta: '2026-11-01',                                   // warn, 11 días
      cajaSinCerrar: { movimientos: 4, masViejo: '2026-09-20' },   // warn, 53 días
      ultimoConteo: '2026-07-01', movimientosDesdeConteo: 10,     // alarm, 134 días
    }));
    expect(recs.map((r) => r.id)).toEqual(['inventario', 'caja-menor', 'facturas-venta']);
  });

  it('el resultado sobrevive JSON (cache persistido)', () => {
    const recs = construirRecordatorios(base({ siigo: { estado: 'error' } }));
    expect(JSON.parse(JSON.stringify(recs))).toEqual(recs);
  });
});

describe('posponer', () => {
  it('esconde 7 días y vuelve a aparecer', () => {
    const recs = construirRecordatorios(base({ ultimaCompra: '2026-10-01' }));
    const p = posponer({}, 'facturas-compra', '2026-11-12');
    expect(p['facturas-compra']).toBe('2026-11-19');
    expect(filtrarPospuestos(recs, p, '2026-11-12')).toEqual([]);
    expect(filtrarPospuestos(recs, p, '2026-11-19')).toHaveLength(1);
  });
  it('limpia los vencidos al guardar uno nuevo', () => {
    const p = posponer({ viejo: '2026-11-01', vigente: '2026-11-20' }, 'nuevo', '2026-11-12');
    expect(Object.keys(p).sort()).toEqual(['nuevo', 'vigente']);
  });
});
