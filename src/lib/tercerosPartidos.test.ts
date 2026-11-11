import { describe, it, expect } from 'vitest';
import { detectarTercerosPartidos, esTerceroProvisional, llavePar } from './tercerosPartidos';

const POLY = { id: 'e2f4', name: 'Polyacril', nit: null };
const PROV = { id: '9a2d', name: 'Cliente NIT 901317432', nit: '901317432' };

describe('esTerceroProvisional', () => {
  it('reconoce la ficha que crea la sincronización cuando no llega el nombre', () => {
    expect(esTerceroProvisional('Cliente NIT 901317432')).toBe(true);
    expect(esTerceroProvisional('proveedor nit 800123456')).toBe(true);
    expect(esTerceroProvisional('Polyacril')).toBe(false);
    expect(esTerceroProvisional('Cliente Nitro SAS')).toBe(false);
    expect(esTerceroProvisional(null)).toBe(false);
  });
});

describe('detectarTercerosPartidos — el caso Polyacril', () => {
  const base = {
    terceros: [POLY, PROV, { id: 'x', name: 'Distrialum', nit: '800190383' }],
    aliases: [
      { responsible_id: 'e2f4', alias: 'Polyacril' },
      { responsible_id: 'e2f4', alias: 'POLYACRIL COMMERCE S.A.S' },
      { responsible_id: '9a2d', alias: 'Cliente NIT 901317432' },
    ],
    facturas: [
      { responsible_id: 'e2f4', counterparty_name: 'POLYACRIL COMMERCE S.A.S' },   // FV-2-282, bien asignada
      { responsible_id: '9a2d', counterparty_name: 'POLYACRIL COMMERCE S.A.S' },   // FV-2-321, cayó en el provisional
      { responsible_id: 'x', counterparty_name: 'DISTRIALUM S.A.S' },
    ],
    actividad: new Map([['e2f4', 30], ['9a2d', 2], ['x', 10]]),
  };

  it('detecta que el provisional y Polyacril son el mismo, conserva a Polyacril y lo marca como seguro', () => {
    const pares = detectarTercerosPartidos(base);
    expect(pares).toHaveLength(1);
    expect(pares[0]).toMatchObject({ motivo: 'facturas', seguro: true });
    expect(pares[0].conservar.id).toBe('e2f4');
    expect(pares[0].absorber.id).toBe('9a2d');
    expect(pares[0].detalle).toContain('POLYACRIL COMMERCE S.A.S');
    expect(pares[0].detalle).toContain('un alias de «Polyacril»');
  });

  it('una factura bien asignada (a nombre de un alias del mismo tercero) no genera nada', () => {
    const pares = detectarTercerosPartidos({ ...base, facturas: base.facturas.filter((f) => f.responsible_id !== '9a2d') });
    expect(pares).toEqual([]);
  });

  it('entre dos fichas con nombre real la evidencia de facturas es solo "posible"', () => {
    const pares = detectarTercerosPartidos({
      terceros: [{ id: 'a', name: 'Alumfer del Tolima', nit: null }, { id: 'b', name: 'Cristian Vasquez', nit: null }],
      aliases: [],
      facturas: [{ responsible_id: 'b', counterparty_name: 'ALUMFER DEL TOLIMA S.A.S.' }],
    });
    expect(pares).toHaveLength(1);
    expect(pares[0].seguro).toBe(false);
  });
});

describe('detectarTercerosPartidos — otras evidencias', () => {
  it('mismo nombre salvo mayúsculas (Electricos gongora / Electricos Gongora): seguro, conserva el más usado', () => {
    const pares = detectarTercerosPartidos({
      terceros: [{ id: '1', name: 'Electricos gongora', nit: null }, { id: '2', name: 'Electricos Gongora', nit: null }],
      aliases: [], facturas: [], actividad: new Map([['1', 1], ['2', 7]]),
    });
    expect(pares).toHaveLength(1);
    expect(pares[0]).toMatchObject({ motivo: 'nombre', seguro: true });
    expect(pares[0].conservar.id).toBe('2');
  });

  it('mismo NIT con nombres distintos: seguro', () => {
    const pares = detectarTercerosPartidos({
      terceros: [{ id: '1', name: 'La Bodega', nit: '900.123.456-7' }, { id: '2', name: 'Inversiones LB', nit: '9001234567' }],
      aliases: [], facturas: [],
    });
    expect(pares[0]).toMatchObject({ motivo: 'nit', seguro: true });
  });

  it('nombres parecidos van como "posible" y después de los seguros', () => {
    const pares = detectarTercerosPartidos({
      terceros: [
        { id: '1', name: 'Pablo Molano', nit: null }, { id: '2', name: 'Pablo Molano Guzman', nit: null },
        { id: '3', name: 'Electricos gongora', nit: null }, { id: '4', name: 'Electricos Gongora', nit: null },
        { id: '5', name: 'Ferreteria el maestro', nit: null }, { id: '6', name: 'Ferreteria Gualisas', nit: null },
      ],
      aliases: [], facturas: [],
    });
    expect(pares.map((p) => p.motivo)).toEqual(['nombre', 'parecido']);
    expect(pares[1].seguro).toBe(false);
    expect([pares[1].conservar.name, pares[1].absorber.name].sort()).toEqual(['Pablo Molano', 'Pablo Molano Guzman']);
  });

  it('un par aparece una sola vez aunque coincida por varias evidencias (gana la más dura)', () => {
    const pares = detectarTercerosPartidos({
      terceros: [{ id: '1', name: 'Cliente NIT 900111222', nit: '900111222' }, { id: '2', name: 'Vidrimar', nit: '900111222' }],
      aliases: [{ responsible_id: '2', alias: 'VIDRIMAR S.A.S' }],
      facturas: [{ responsible_id: '1', counterparty_name: 'Vidrimar SAS' }],
    });
    expect(pares).toHaveLength(1);
    expect(pares[0].motivo).toBe('facturas');
    expect(pares[0].conservar.name).toBe('Vidrimar');
  });

  it('llavePar no depende del orden', () => {
    expect(llavePar('b', 'a')).toBe(llavePar('a', 'b'));
  });
});
