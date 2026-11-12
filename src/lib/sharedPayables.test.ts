import { describe, it, expect } from 'vitest';
import { computePayables } from '../../supabase/functions/_shared/payables';

// Db de mentira: guarda los filtros eq/in/is y devuelve las filas que cumplen.
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let range: [number, number] | null = null;
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return q; },
        is: (col: string, val: unknown) => { filters.push((r) => (r[col] ?? null) === val); return q; },
        in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return q; },
        or: (expr: string) => {
          if (expr === 'void_type.is.null,void_type.eq.partial') {
            filters.push((r) => r.void_type == null || r.void_type === 'partial');
          }
          return q;
        },
        gte: (col: string, val: string) => { filters.push((r) => String(r[col]) >= val); return q; },
        lte: (col: string, val: string) => { filters.push((r) => String(r[col]) <= val); return q; },
        order: () => q,
        range: (a: number, b: number) => { range = [a, b]; return q; },
        then: (ok: (v: { data: Row[]; error: null }) => unknown) => {
          let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          if (range) rows = rows.slice(range[0], range[1] + 1);
          return Promise.resolve({ data: rows, error: null }).then(ok);
        },
      };
      return q;
    },
  };
}

const U = 'u1';
const factura = (id: string, extra: Row = {}): Row => ({
  id, user_id: U, type: 'compra', counterparty_name: 'ALI TRADING', issue_date: '2026-07-01',
  due_date: null, dias_credito: 30, total_amount: 1_000_000, reteica_amount: 0, autoretefuente_amount: 0,
  void_type: null, ...extra,
});

describe('computePayables (fuente única de CxP)', () => {
  const hoy = new Date('2026-11-12T12:00:00');

  it('resta pagos del banco, cruces manuales y retenciones', async () => {
    const db = fakeDb({
      invoices: [factura('f1', { reteica_amount: 10_000 })],
      transactions: [{ user_id: U, invoice_id: 'f1', amount: -600_000, deleted_at: null }],
      invoice_transaction_matches: [{ invoice_id: 'f1', matched_amount: 100_000 }],
    });
    const [p] = await computePayables(db, U, { today: hoy });
    expect(p.paid).toBe(700_000);
    expect(p.retenciones).toBe(10_000);
    expect(p.saldo).toBe(290_000);
  });

  it('una factura pagada completa queda en cero, no en negativo', async () => {
    const db = fakeDb({
      invoices: [factura('f1')],
      transactions: [{ user_id: U, invoice_id: 'f1', amount: -1_200_000, deleted_at: null }],
      invoice_transaction_matches: [],
    });
    const [p] = await computePayables(db, U, { today: hoy });
    expect(p.saldo).toBe(0);
  });

  it('ignora NC totales, pagos borrados, ventas y otras empresas', async () => {
    const db = fakeDb({
      invoices: [
        factura('f1'),
        factura('anulada', { void_type: 'total' }),
        factura('venta', { type: 'venta' }),
        factura('otra', { user_id: 'u2' }),
      ],
      transactions: [{ user_id: U, invoice_id: 'f1', amount: -500_000, deleted_at: '2026-08-01' }],
      invoice_transaction_matches: [],
    });
    const rows = await computePayables(db, U, { today: hoy });
    expect(rows.map((r) => r.id)).toEqual(['f1']);
    expect(rows[0].saldo).toBe(1_000_000);
  });

  it('calcula días vencidos por fecha de vencimiento o días de crédito', async () => {
    const db = fakeDb({
      invoices: [
        factura('credito', { issue_date: '2026-10-01', dias_credito: 30 }),
        factura('vence', { issue_date: '2026-10-01', due_date: '2026-12-01' }),
      ],
      transactions: [],
      invoice_transaction_matches: [],
    });
    const rows = await computePayables(db, U, { today: hoy });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.days_overdue]));
    expect(byId.credito).toBe(12);
    expect(byId.vence).toBeLessThan(0);
  });

  it('pagina de a 1000 y no pierde facturas', async () => {
    const muchas = Array.from({ length: 1_450 }, (_, i) => factura(`f${String(i).padStart(4, '0')}`, { total_amount: 1_000 }));
    const db = fakeDb({ invoices: muchas, transactions: [], invoice_transaction_matches: [] });
    const rows = await computePayables(db, U, { today: hoy });
    expect(rows).toHaveLength(1_450);
    expect(rows.reduce((s, r) => s + r.saldo, 0)).toBe(1_450_000);
  });
});
