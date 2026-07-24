import { describe, it, expect } from 'vitest';
import { computeContainerSellThrough, type ContainerInput, type VentaInput } from './containerSellThrough';

const HOY = '2026-07-24';

describe('computeContainerSellThrough', () => {
  it('mide días reales de agote por familia y pondera el contenedor', () => {
    const containers: ContainerInput[] = [{
      id: 'c1', label: '2026-1', entrega: '2026-06-01',
      familias: [
        { famKey: 'liv-40', label: 'LIV-40-5', qty: 100 },
        { famKey: 'ang-25', label: 'ANG-25-5', qty: 50 },
      ],
    }];
    const ventas: VentaInput[] = [
      { famKey: 'liv-40', date: '2026-06-11', qty: 60 },
      { famKey: 'liv-40', date: '2026-06-21', qty: 40 }, // agota a los 20 días
      { famKey: 'ang-25', date: '2026-07-01', qty: 25 }, // 50% en 30 días
    ];
    const [r] = computeContainerSellThrough(containers, ventas, HOY);
    const liv = r.familias.find(f => f.famKey === 'liv-40')!;
    expect(liv.diasAgote).toBe(20);
    expect(liv.pctVendido).toBe(100);
    const ang = r.familias.find(f => f.famKey === 'ang-25')!;
    expect(ang.diasAgote).toBeNull();
    // ritmo = 25/53 días desde entrega → proyección ≈ 106d
    expect(ang.diasProyectados).toBe(Math.ceil(50 / (25 / 53)));
    expect(r.pctVendido).toBe(Math.round((125 / 150) * 100));
    expect(r.agotado).toBe(false);
  });

  it('FIFO: la venta llena primero el contenedor más viejo y no se duplica', () => {
    const containers: ContainerInput[] = [
      { id: 'c1', label: 'viejo', entrega: '2026-05-01', familias: [{ famKey: 'liv-40', label: 'LIV-40-5', qty: 30 }] },
      { id: 'c2', label: 'nuevo', entrega: '2026-07-01', familias: [{ famKey: 'liv-40', label: 'LIV-40-5', qty: 100 }] },
    ];
    const ventas: VentaInput[] = [
      { famKey: 'liv-40', date: '2026-07-10', qty: 50 }, // 30 al viejo (lo agota), 20 al nuevo
    ];
    const res = computeContainerSellThrough(containers, ventas, HOY);
    const nuevo = res.find(r => r.id === 'c2')!;
    const viejo = res.find(r => r.id === 'c1')!;
    expect(viejo.familias[0].vendidas).toBe(30);
    expect(viejo.familias[0].diasAgote).toBe(70);
    expect(nuevo.familias[0].vendidas).toBe(20);
    expect(res[0].id).toBe('c2'); // más reciente primero
  });

  it('ventas anteriores a la entrega no cuentan; sin ventas = sinVentas', () => {
    const containers: ContainerInput[] = [{
      id: 'c1', label: '2026-2', entrega: '2026-07-23',
      familias: [{ famKey: 'liv-40', label: 'LIV-40-5', qty: 80 }],
    }];
    const ventas: VentaInput[] = [{ famKey: 'liv-40', date: '2026-07-01', qty: 999 }];
    const [r] = computeContainerSellThrough(containers, ventas, HOY);
    expect(r.familias[0].vendidas).toBe(0);
    expect(r.familias[0].sinVentas).toBe(true);
    expect(r.diasPonderados).toBeNull();
  });
});
