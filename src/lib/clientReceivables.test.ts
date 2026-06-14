import { describe, it, expect } from 'vitest';
import { applyClientCreditFIFO, type InvoiceLine } from './clientReceivables';

// Factory: línea de factura con defaults. `effective_pending` arranca en NaN
// para verificar que el helper SIEMPRE lo setea.
function line(partial: Partial<InvoiceLine> & { id: string; issue_date: string; total_amount: number }): InvoiceLine {
  return {
    invoice_number: partial.id,
    retefuente: 0,
    reteica: 0,
    autoretefuente: 0,
    retenciones_total: 0,
    paid_direct: 0,
    pending_invoice: partial.total_amount,
    effective_pending: NaN,
    void_type: null,
    days_since: 0,
    ...partial,
  };
}

describe('applyClientCreditFIFO — imputación de pagos (Art. 1653-1654 CC)', () => {
  it('cliente que prepaga: cubre la factura más VIEJA primero, el resto a la nueva', () => {
    // Caso real Aluminios del Eje: FV-2-279 (07-abr, 167.135.200, reten 5.640.463)
    // y FV-2-284 (02-may, 147.107.900, reten 679.910). Crédito recibido 221M.
    const lines = [
      line({ id: 'FV-2-284', issue_date: '2026-05-02', total_amount: 147107900, retenciones_total: 679910 }),
      line({ id: 'FV-2-279', issue_date: '2026-04-07', total_amount: 167135200, retenciones_total: 5640463 }),
    ];
    applyClientCreditFIFO(lines, 221000000);

    const v279 = lines.find(l => l.id === 'FV-2-279')!;
    const v284 = lines.find(l => l.id === 'FV-2-284')!;
    // 279 (vieja) coverable = 161.494.737 → totalmente cubierta.
    expect(v279.effective_pending).toBe(0);
    // Remanente 221M − 161.494.737 = 59.505.263 aplicado a 284 (coverable 146.427.990).
    expect(v284.effective_pending).toBe(146427990 - (221000000 - (167135200 - 5640463)));
    expect(v284.effective_pending).toBeCloseTo(86922727, 0);
  });

  it('crédito exacto = coverable total → todas en 0', () => {
    const lines = [
      line({ id: 'A', issue_date: '2026-01-01', total_amount: 100 }),
      line({ id: 'B', issue_date: '2026-02-01', total_amount: 50 }),
    ];
    applyClientCreditFIFO(lines, 150);
    expect(lines.every(l => l.effective_pending === 0)).toBe(true);
  });

  it('crédito en exceso (saldo a favor) → todas en 0, no negativo', () => {
    const lines = [line({ id: 'A', issue_date: '2026-01-01', total_amount: 100 })];
    applyClientCreditFIFO(lines, 500);
    expect(lines[0].effective_pending).toBe(0);
  });

  it('sin crédito → cada factura queda con su coverable (total − retenciones)', () => {
    const lines = [
      line({ id: 'A', issue_date: '2026-01-01', total_amount: 1000, retenciones_total: 25 }),
    ];
    applyClientCreditFIFO(lines, 0);
    expect(lines[0].effective_pending).toBe(975);
  });

  it('las retenciones reducen lo que el crédito debe cubrir', () => {
    // Factura 1000 con 100 de retención: coverable 900. Crédito 900 la cubre.
    const lines = [line({ id: 'A', issue_date: '2026-01-01', total_amount: 1000, retenciones_total: 100 })];
    applyClientCreditFIFO(lines, 900);
    expect(lines[0].effective_pending).toBe(0);
  });

  it('reparte oldest-first sin importar el orden de entrada', () => {
    const lines = [
      line({ id: 'NUEVA', issue_date: '2026-03-01', total_amount: 100 }),
      line({ id: 'VIEJA', issue_date: '2026-01-01', total_amount: 100 }),
      line({ id: 'MEDIA', issue_date: '2026-02-01', total_amount: 100 }),
    ];
    applyClientCreditFIFO(lines, 150); // cubre VIEJA (100) + mitad de MEDIA (50)
    expect(lines.find(l => l.id === 'VIEJA')!.effective_pending).toBe(0);
    expect(lines.find(l => l.id === 'MEDIA')!.effective_pending).toBe(50);
    expect(lines.find(l => l.id === 'NUEVA')!.effective_pending).toBe(100);
  });

  it('desempata por número de factura cuando la fecha coincide', () => {
    const lines = [
      line({ id: 'x2', invoice_number: 'FV-2', issue_date: '2026-01-01', total_amount: 100 }),
      line({ id: 'x1', invoice_number: 'FV-1', issue_date: '2026-01-01', total_amount: 100 }),
    ];
    applyClientCreditFIFO(lines, 100); // debe cubrir FV-1 primero
    expect(lines.find(l => l.id === 'x1')!.effective_pending).toBe(0);
    expect(lines.find(l => l.id === 'x2')!.effective_pending).toBe(100);
  });

  it('crédito negativo o cero se trata como 0', () => {
    const lines = [line({ id: 'A', issue_date: '2026-01-01', total_amount: 100 })];
    applyClientCreditFIFO(lines, -50);
    expect(lines[0].effective_pending).toBe(100);
  });

  it('reservar el saldo inicial (cxc) del pool deja viva la deuda en facturas, no las marca cubiertas de más', () => {
    // Cliente con saldo inicial 30 (deuda más vieja) + 2 facturas de 30 c/u y
    // crédito recibido 30. El caller reserva cxc del pool: creditParaFacturas =
    // max(0, 30 − 30) = 0 → ninguna factura se cubre (la plata pagó la deuda
    // vieja). Σ effective_pending = 60 = saldo_neto ((60+30)−30).
    const cxc = 30;
    const credito = 30;
    const lines = [
      line({ id: 'FV1', issue_date: '2026-01-01', total_amount: 30 }),
      line({ id: 'FV2', issue_date: '2026-02-01', total_amount: 30 }),
    ];
    applyClientCreditFIFO(lines, Math.max(0, credito - cxc));
    expect(lines.find(l => l.id === 'FV1')!.effective_pending).toBe(30);
    expect(lines.find(l => l.id === 'FV2')!.effective_pending).toBe(30);
  });
});
