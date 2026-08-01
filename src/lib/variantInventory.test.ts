import { describe, it, expect } from 'vitest';
import { computeVariantDesglose, type VariantMovLite } from './variantInventory';

const mov = (
  movement_type: string,
  quantity: number,
  source_type: string | null,
  created_at: string,
): VariantMovLite => ({ movement_type, quantity, source_type, created_at });

describe('computeVariantDesglose', () => {
  it('caso A059 del reporte 2026-08-01: conteo 142 − remisión 460 + contenedor 660 = 342', () => {
    // El stock guardado decía 660 (el clamp a 0 pisó el negativo −318 antes
    // de sumar el contenedor). El teórico del ledger es la verdad: 342.
    const d = computeVariantDesglose(
      { stock_inicial: 142, stock_inicial_date: '2026-07-01T00:00:00Z' },
      [
        mov('salida', 460, 'remision', '2026-07-10T00:00:00Z'),
        mov('entrada', 660, 'import', '2026-07-20T00:00:00Z'),
      ],
    );
    expect(d).toEqual({ ancla: 142, contenedor: 660, remisiones: 460, teorico: 342 });
  });

  it('ignora movimientos anteriores al ancla (el conteo ya los pisó)', () => {
    const d = computeVariantDesglose(
      { stock_inicial: 50, stock_inicial_date: '2026-07-15T00:00:00Z' },
      [
        mov('entrada', 100, 'import', '2026-07-01T00:00:00Z'), // pre-conteo
        mov('salida', 10, 'remision', '2026-07-20T00:00:00Z'),
      ],
    );
    expect(d).toEqual({ ancla: 50, contenedor: 0, remisiones: 10, teorico: 40 });
  });

  it('un ajuste manual posterior re-ancla y descarta lo previo', () => {
    const d = computeVariantDesglose(
      { stock_inicial: 10, stock_inicial_date: '2026-07-01T00:00:00Z' },
      [
        mov('entrada', 30, 'import', '2026-07-05T00:00:00Z'),
        mov('ajuste', 25, 'manual', '2026-07-10T00:00:00Z'), // stock ABSOLUTO
        mov('salida', 5, 'remision', '2026-07-12T00:00:00Z'),
      ],
    );
    expect(d).toEqual({ ancla: 25, contenedor: 0, remisiones: 5, teorico: 20 });
  });

  it('remisiones de compra restan del neto de remisiones', () => {
    const d = computeVariantDesglose(
      { stock_inicial: 0, stock_inicial_date: '2026-07-01T00:00:00Z' },
      [
        mov('salida', 20, 'remision', '2026-07-05T00:00:00Z'),
        mov('entrada', 8, 'remision', '2026-07-06T00:00:00Z'), // compra
      ],
    );
    expect(d).toEqual({ ancla: 0, contenedor: 0, remisiones: 12, teorico: -12 });
  });
});
