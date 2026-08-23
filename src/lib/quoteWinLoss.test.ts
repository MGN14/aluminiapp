import { describe, it, expect } from 'vitest';
import { computeWinLoss, type WinLossQuote } from './quoteWinLoss';

const q = (over: Partial<WinLossQuote>): WinLossQuote => ({
  id: Math.random().toString(36),
  status: 'accepted',
  total: 5_000_000,
  profit_pct: 30,
  responsible_id: 'r1',
  responsible_name: 'Aluminios JH',
  sent_at: '2026-08-01T10:00:00Z',
  accepted_at: '2026-08-05T10:00:00Z',
  rejected_at: null,
  systems: ['5020'],
  ...over,
});

describe('computeWinLoss', () => {
  it('solo cuenta decididas — draft/sent/expired afuera', () => {
    const r = computeWinLoss([
      q({}), q({ status: 'rejected', accepted_at: null, rejected_at: '2026-08-06T10:00:00Z' }),
      q({ status: 'draft' }), q({ status: 'sent' }), q({ status: 'expired' }),
    ]);
    expect(r.decided).toBe(2);
    expect(r.won).toBe(1);
    expect(r.winRate).toBe(50);
  });

  it('no reporta buckets con n < 3', () => {
    const r = computeWinLoss([q({}), q({ status: 'rejected' })]);
    expect(r.byMargin).toHaveLength(0);
    expect(r.byClient).toHaveLength(0);
  });

  it('bucketiza margen y separa plantilla (profit_pct=0)', () => {
    const rows = [
      ...Array.from({ length: 3 }, () => q({ profit_pct: 0 })),
      ...Array.from({ length: 4 }, () => q({ profit_pct: 25 })),
    ];
    const r = computeWinLoss(rows);
    const keys = r.byMargin.map((b) => b.key);
    expect(keys).toContain('plantilla');
    expect(keys).toContain('20-35');
  });

  it('insight cuando el contraste de margen es >= 20 puntos con n >= 3', () => {
    const rows = [
      // margen bajo: 3 ganadas
      ...Array.from({ length: 3 }, () => q({ profit_pct: 15 })),
      // margen alto: 3 perdidas
      ...Array.from({ length: 3 }, () => q({ status: 'rejected', profit_pct: 40, accepted_at: null, rejected_at: '2026-08-06T10:00:00Z' })),
    ];
    const r = computeWinLoss(rows);
    expect(r.insight).toBeTruthy();
    expect(r.insight).toContain('margen < 20%');
  });

  it('tiempo de respuesta promedio con n >= 3', () => {
    const rows = Array.from({ length: 3 }, () => q({}));
    expect(computeWinLoss(rows).avgResponseDays).toBe(4);
  });

  it('agrupa sistemas sin duplicar por ítem repetido', () => {
    const rows = Array.from({ length: 3 }, () => q({ systems: ['5020', '5020', '744'] }));
    const r = computeWinLoss(rows);
    const s5020 = r.bySystem.find((b) => b.key === '5020');
    expect(s5020?.total).toBe(3);
  });
});
