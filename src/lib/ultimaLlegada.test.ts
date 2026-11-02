import { describe, it, expect } from 'vitest';
import { ultimaLlegadaPorVariante } from './ultimaLlegada';

const HOY = '2026-10-31';

describe('ultimaLlegadaPorVariante — lo que YA llegó, por variante', () => {
  const lotes = [
    {
      importId: 'a', label: '2026-1', fechaEntrega: '2026-03-01',
      items: [
        { reference: 'LIV-40', cantidad: 500, color: 'Negro' },   // proforma → LIV-40-3
        { reference: 'GL4102', cantidad: 1000, color: 'Mate' },
      ],
    },
    {
      importId: 'b', label: '2026-2', fechaEntrega: '2026-07-15',
      items: [
        { reference: 'LIV-40-3', cantidad: 1200 },                 // packing con sufijo
        { reference: 'LIV-40-3', cantidad: 300 },                  // misma variante repetida: suma
      ],
    },
  ];

  it('manda el contenedor más reciente que trajo la variante, sumando sus líneas', () => {
    const out = ultimaLlegadaPorVariante({ todayIso: HOY, lotes, ventas: [] });
    const negro = out.find((u) => u.key === 'liv-40-3')!;
    expect(negro.pedido).toBe('2026-2');
    expect(negro.unidades).toBe(1500);
    expect(negro.fechaEntrega).toBe('2026-07-15');
    expect(negro.diasDesdeEntrega).toBe(108);
    // GL4102 solo vino en 2026-1 → ese es su último.
    const gl = out.find((u) => u.key === 'gl4102')!;
    expect(gl.pedido).toBe('2026-1');
    expect(gl.unidades).toBe(1000);
  });

  it('vendido desde la entrega: solo remisiones de esa variante con fecha ≥ entrega', () => {
    const out = ultimaLlegadaPorVariante({
      todayIso: HOY, lotes,
      ventas: [
        { reference: 'LIV-40-3', units: 600, date: '2026-08-01' },  // cuenta
        { reference: 'LIV-40-3', units: 400, date: '2026-07-10' },  // antes de la entrega: no
        { reference: 'liv-40-3', units: 150, date: '2026-10-20' },  // escrita distinto: cuenta
        { reference: 'GL4102', units: 200, date: '2026-05-01' },    // cuenta (lote 2026-1)
        { reference: 'GL4102', units: 50, date: '2026-02-01' },     // antes: no
        { reference: 'LIV-40-2', units: 99, date: '2026-09-01' },   // otra variante, no vino: ignorada
      ],
    });
    const negro = out.find((u) => u.key === 'liv-40-3')!;
    expect(negro.vendidas).toBe(750);
    expect(negro.pctVendido).toBe(50);
    const gl = out.find((u) => u.key === 'gl4102')!;
    expect(gl.vendidas).toBe(200);
    expect(gl.pctVendido).toBe(20);
    expect(out.find((u) => u.key === 'liv-40-2')).toBeUndefined();
  });

  it('el % vendido se acota a 100 (ventas de stock previo no lo disparan)', () => {
    const out = ultimaLlegadaPorVariante({
      todayIso: HOY,
      lotes: [{ importId: 'x', label: '2026-3', fechaEntrega: '2026-09-01', items: [{ reference: 'T077A', cantidad: 10 }] }],
      ventas: [{ reference: 'T077A', units: 25, date: '2026-09-15' }],
    });
    expect(out[0].vendidas).toBe(25);
    expect(out[0].pctVendido).toBe(100);
  });

  it('lotes sin fecha de entrega se ignoran', () => {
    const out = ultimaLlegadaPorVariante({
      todayIso: HOY,
      lotes: [{ importId: 'x', label: 'sin fecha', fechaEntrega: '', items: [{ reference: 'T077A', cantidad: 10 }] }],
      ventas: [],
    });
    expect(out).toEqual([]);
  });
});
