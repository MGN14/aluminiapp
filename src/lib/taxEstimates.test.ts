/**
 * Estimación de impuestos del calendario — con los números de Nico
 * (IVA cuatrimestral May-Ago 2026: ventas 172,6M de IVA, importación 82,8M
 * pagada en aduana el 26-jul, compras 1,55M).
 */
import { describe, it, expect } from 'vitest';
import { estimateIva, estimateRetefuente, estimateIca, estimateForEventId, periodMonths, type TaxInputs } from './taxEstimates';

const venta = (issue_date: string, base: number, extra: Partial<{ reteica: number; autoret: number }> = {}) => ({
  type: 'venta' as const, issue_date, subtotal_base: base, iva_amount: Math.round(base * 0.19),
  reteica_amount: extra.reteica ?? 0, autoretefuente_amount: extra.autoret ?? 0,
});
const compra = (issue_date: string, base: number) => ({
  type: 'compra' as const, issue_date, subtotal_base: base, iva_amount: Math.round(base * 0.19), reteica_amount: 0, autoretefuente_amount: 0,
});

const RATES = { icaRate: 0.00966, autoretefuenteRate: 0.0055, retefuenteCompraRate: 0.025, autorretenedor: true, agenteRetencion: true };

const NICO: TaxInputs = {
  year: 2026,
  ivaCuatrimestral: true,
  today: '2026-09-16',
  invoices: [
    // Ene-Abr reales de Nico (sin compras): solo generado → se paga, no arrastra
    venta('2026-02-10', 98_783_916), venta('2026-03-10', 166_287_256), venta('2026-04-10', 235_528_034),
    venta('2026-05-12', 311_728_571), venta('2026-06-09', 296_106_723),
    venta('2026-07-14', 225_640_756), venta('2026-08-20', 74_962_353, { reteica: 500_000, autoret: 412_000 }),
    compra('2026-07-20', 8_000_000), compra('2026-08-05', 155_000),
    venta('2026-09-07', 155_599_916),
  ],
  importIva: [{ fecha: '2026-07-26', montoCop: 82_794_000 }],
  retefuenteManual: [{ date: '2026-08-18', amount: -300_000 }],
  rates: RATES,
};

describe('IVA cuatrimestral', () => {
  it('May-Ago (índice 1) = generado − compras − IVA de importación, período cerrado', () => {
    const e = estimateIva(NICO, 1)!;
    const generado = [311_728_571, 296_106_723, 225_640_756, 74_962_353].reduce((s, b) => s + Math.round(b * 0.19), 0);
    const descontable = Math.round(8_000_000 * 0.19) + Math.round(155_000 * 0.19) + 82_794_000;
    expect(e.monto).toBe(generado - descontable);
    expect(e.parcial).toBe(false);
    expect(e.detalle).toContain('importación');
  });
  it('Sep-Dic (índice 2) es parcial: solo lo facturado hasta hoy', () => {
    const e = estimateIva(NICO, 2)!;
    expect(e.parcial).toBe(true);
    expect(e.monto).toBe(Math.round(155_599_916 * 0.19));
  });
  it('un período que aún no empieza no se estima', () => {
    expect(estimateIva({ ...NICO, today: '2026-04-01' }, 1)).toBeNull();
  });
  it('el saldo a favor de un período se arrastra al siguiente', () => {
    const inp: TaxInputs = {
      ...NICO, ivaCuatrimestral: false, today: '2026-05-10',
      invoices: [venta('2026-01-15', 100_000_000), compra('2026-02-10', 200_000_000), venta('2026-03-15', 100_000_000)],
      importIva: [], retefuenteManual: [],
    };
    // Ene-Feb: 19M − 38M = −19M a favor. Mar-Abr: 19M − 19M arrastre = 0.
    expect(estimateIva(inp, 0)!.monto).toBe(0);
    expect(estimateIva(inp, 0)!.detalle).toContain('queda saldo a favor');
    expect(estimateIva(inp, 1)!.monto).toBe(0);
    expect(estimateIva(inp, 1)!.detalle).toContain('saldo a favor');
  });
  it('bimestral usa pares de meses', () => {
    expect(periodMonths(2, 2)).toEqual([5, 6]);
    expect(periodMonths(4, 2)).toEqual([9, 10, 11, 12]);
    expect(periodMonths(1, 11)).toEqual([12]);
  });
});

describe('Retefuente mensual', () => {
  it('agosto = autorretención de las facturas + 2,5% de compras + sin factura', () => {
    const e = estimateRetefuente(NICO, 7)!;
    expect(e.monto).toBe(Math.round(412_000 + 155_000 * 0.025 + 300_000));
    expect(e.parcial).toBe(false);
  });
  it('si las facturas no traen autorretención, usa base × tasa', () => {
    const e = estimateRetefuente(NICO, 4)!; // mayo: solo ventas sin autoret
    expect(e.monto).toBe(Math.round(311_728_571 * 0.0055));
  });
  it('sin ser autorretenedor ni agente, no hay nada que estimar', () => {
    const inp = { ...NICO, rates: { ...RATES, autorretenedor: false, agenteRetencion: false }, retefuenteManual: [] };
    expect(estimateRetefuente(inp, 4)).toBeNull();
  });
});

describe('ICA bimestral', () => {
  it('Jul-Ago = base × 9,66‰ − reteICA practicada', () => {
    const e = estimateIca(NICO, 3)!;
    const base = 225_640_756 + 74_962_353;
    expect(e.monto).toBe(Math.round(base * 0.00966 - 500_000));
    expect(e.detalle).toContain('9,66‰');
  });
  it('sin tarifa configurada no se estima', () => {
    expect(estimateIca({ ...NICO, rates: { ...RATES, icaRate: 0 } }, 3)).toBeNull();
  });
});

describe('por id de evento', () => {
  it('mapea iva-/ret-/ica- y deja renta en null', () => {
    expect(estimateForEventId(NICO, 'iva-1')?.monto).toBe(estimateIva(NICO, 1)?.monto);
    expect(estimateForEventId(NICO, 'ret-7')?.monto).toBe(estimateRetefuente(NICO, 7)?.monto);
    expect(estimateForEventId(NICO, 'ica-3')?.monto).toBe(estimateIca(NICO, 3)?.monto);
    expect(estimateForEventId(NICO, 'renta-2025')).toBeNull();
  });
});

describe('liquidaciones de aduana cargadas como compra DIAN - PSE (contenedores previos al módulo)', () => {
  const conAduana: TaxInputs = {
    ...NICO,
    invoices: [
      ...NICO.invoices,
      { type: 'compra', counterparty_name: 'DIAN - PSE', issue_date: '2026-01-29', subtotal_base: 113_406_000, iva_amount: 94_957_000, reteica_amount: 0, autoretefuente_amount: 0 },
      { type: 'compra', counterparty_name: 'DIAN - PSE', issue_date: '2026-04-20', subtotal_base: 111_172_000, iva_amount: 91_000_000, reteica_amount: 0, autoretefuente_amount: 0 },
    ],
  };
  it('su IVA es descontable: Ene-Abr queda con saldo a favor', () => {
    const e = estimateIva(conAduana, 0)!;
    expect(e.monto).toBe(0);
    expect(e.detalle).toContain('queda saldo a favor');
  });
  it('el saldo a favor cubre May-Ago: se paga $0 (no $88M) y sobra un poco', () => {
    const e = estimateIva(conAduana, 1)!;
    expect(e.monto).toBe(0);
    expect(e.detalle).toContain('saldo a favor');
    // Ene-Abr: 185,96M de aduana − 95,1M generado = 90,85M a favor; May-Ago
    // neto 88,26M → queda ≈2,6M a favor para Sep-Dic.
    const sep = estimateIva(conAduana, 2)!;
    expect(sep.monto).toBeLessThan(Math.round(155_599_916 * 0.19));
  });
});
