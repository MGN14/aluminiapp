import { describe, it, expect } from 'vitest';
import { clientNameMatches, nameTokens } from './nameMatch';

describe('nameTokens', () => {
  it('normaliza tildes, caja y puntuación y bota stopwords', () => {
    expect(nameTokens('Vidrios y Aluminios Castaño S.A.S')).toEqual(['vidrios', 'aluminios', 'castano']);
    expect(nameTokens('LA BODEGA DEL ALUMINIO S.A.S')).toEqual(['bodega', 'aluminio']);
  });
});

describe('clientNameMatches', () => {
  it('caso REM-40 ↔ FV-2-299 (reporte 2026-08-01): typos de Siigo y orden distinto', () => {
    expect(
      clientNameMatches(
        'ALUMINIOS Y AMORTIGUADORES LA 11',
        'Aluminios Armotiguadores y Respuestos la 11',
      ),
    ).toBe(true);
  });

  it('acepta palabras extra en la factura', () => {
    expect(clientNameMatches('La Bodega', 'LA BODEGA DEL ALUMINIO S.A.S')).toBe(true);
    expect(clientNameMatches('Vidrios y Aluminios Castaño', 'Vidrios y Aluminios Castaño sas')).toBe(true);
  });

  it('NO cruza clientes distintos aunque compartan un rubro', () => {
    expect(clientNameMatches('Vidrios Soto', 'Vidrios y Aluminios Castaño sas')).toBe(false);
    expect(clientNameMatches('Ferromendez', 'RONAL EDILSSON OROZCO RAMIREZ')).toBe(false);
  });

  it('tokens cortos exigen match exacto (sin typo)', () => {
    expect(clientNameMatches('Ariel', 'Ariel Gomez')).toBe(true);
    expect(clientNameMatches('Abel', 'Adel Comercial')).toBe(false);
  });
});
