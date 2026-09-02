import { describe, it, expect } from 'vitest';
import { findLikelyDuplicateClients, nameSimilarity } from './duplicateClients';

describe('findLikelyDuplicateClients — detector de terceros duplicados', () => {
  it('caso real La 11: nombre de remisión vs razón social facturada (con letras corridas)', () => {
    const pairs = findLikelyDuplicateClients([
      { client_id: 'a', client_name: 'ALUMINIOS Y AMORTIGUADORES LA 11' },
      { client_id: 'b', client_name: 'Aluminios Armotiguadores y Respuestos la 11' },
      { client_id: 'c', client_name: 'Todoalum' },
    ]);
    expect(pairs).toHaveLength(1);
    expect([pairs[0].a.client_id, pairs[0].b.client_id].sort()).toEqual(['a', 'b']);
  });

  it('NO marca clientes distintos del mismo gremio', () => {
    const pairs = findLikelyDuplicateClients([
      { client_id: 'a', client_name: 'Aluminios JH' },
      { client_id: 'b', client_name: 'Aluminios Ferromendez SAS' },
      { client_id: 'c', client_name: 'Vidrios y Aluminios Castaño sas' },
      { client_id: 'd', client_name: 'Ingealuminios de Colombia' },
    ]);
    expect(pairs).toHaveLength(0);
  });

  it('NO marca pares con nombre normalizado idéntico (esos los funde el motor solo)', () => {
    const pairs = findLikelyDuplicateClients([
      { client_id: 'a', client_name: 'La Bodega del Aluminio SAS' },
      { client_id: 'b', client_name: 'LA BODEGA DEL ALUMINIO S.A.S' },
    ]);
    expect(pairs).toHaveLength(0);
  });

  it('exige al menos un token fuerte: coincidir solo en "la 11" no basta', () => {
    expect(nameSimilarity('Ferretería la 11', 'Cacharrería la 11')).toBe(0);
  });

  it('typo de una letra en nombre largo sí matchea', () => {
    expect(nameSimilarity('Polyacril Commerce', 'Polyacril Comerce')).toBeGreaterThanOrEqual(0.8);
  });
});
