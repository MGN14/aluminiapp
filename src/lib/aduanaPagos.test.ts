import { describe, it, expect } from 'vitest';
import {
  detectarPagosAduana,
  esPagoAImpuestos,
  liquidacionesDesdeCosteo,
  liquidacionesDesdeRecibos,
  type PagoBanco,
} from './aduanaPagos';

// Casos reales de 2026 (auditoría 2026-11-12), con los montos al peso.
const pagos: PagoBanco[] = [
  // Declaración normal: NO es aduana.
  { id: 'decl-ene', date: '2026-01-23', amount: -19_044_000, description: 'PAGO PSE IMPUESTO DIAN', beneficiario: 'DIAN' },
  // Contenedores anteriores al módulo: recibo vinculado como factura de compra.
  { id: 'ene', date: '2026-01-29', amount: -113_406_000, description: 'PAGO PSE IMPUESTO DIAN', beneficiario: 'DIAN', invoice_id: 'rec-ene' },
  { id: 'abr', date: '2026-04-20', amount: -111_172_000, description: 'PAGO PSE IMPUESTO DIAN', beneficiario: 'DIAN', invoice_id: 'rec-abr' },
  // 2026-1: un solo pago por arancel + IVA del costeo.
  { id: 'jul', date: '2026-07-15', amount: -103_544_000, description: 'PAGO PSE DIAN   PSE', beneficiario: 'DIAN' },
  // 2026-2: dos PSE el mismo día que suman la liquidación.
  { id: 'oct-a', date: '2026-10-01', amount: -15_023_000, description: 'PAGO PSE DIAN PSE', beneficiario: 'DIAN' },
  { id: 'oct-b', date: '2026-10-01', amount: -82_751_000, description: 'PAGO PSE DIAN PSE', beneficiario: 'DIAN' },
  // Retención mensual chiquita: tampoco es aduana.
  { id: 'ret-ago', date: '2026-08-18', amount: -1_724_000, description: 'PAGO PSE DIAN   PSE', beneficiario: 'DIAN' },
];

const costeo = liquidacionesDesdeCosteo([
  { importId: 'i1', refPedido: '2026-1', tipo: 'arancel', montoCop: 20_750_000, fecha: '2026-07-09' },
  { importId: 'i1', refPedido: '2026-1', tipo: 'iva_importacion', montoCop: 82_794_000, fecha: '2026-07-09' },
  { importId: 'i2', refPedido: '2026-2', tipo: 'arancel', montoCop: 21_445_000, fecha: '2026-09-24' },
  { importId: 'i2', refPedido: '2026-2', tipo: 'iva_importacion', montoCop: 76_329_000, fecha: '2026-09-24' },
  // Otros costos del contenedor no son liquidación de aduana.
  { importId: 'i2', refPedido: '2026-2', tipo: 'nacionalizacion', montoCop: 21_000_000, fecha: '2026-09-24' },
]);

const recibos = liquidacionesDesdeRecibos([
  { id: 'rec-ene', counterparty_name: 'DIAN - PSE', issue_date: '2026-01-29', total_amount: 113_406_000, iva_amount: 94_957_000 },
  { id: 'rec-abr', counterparty_name: 'DIAN - PSE', issue_date: '2026-04-20', total_amount: 111_172_000, iva_amount: 91_000_000 },
  // Factura de un proveedor normal: no es recibo DIAN.
  { id: 'fc-ali', counterparty_name: 'ALI TRADING EXPRESS SAS', issue_date: '2026-07-24', total_amount: 20_552_136, iva_amount: 760_000 },
]);

describe('liquidaciones de aduana', () => {
  it('agrupa el costeo por contenedor e ignora otros costos', () => {
    expect(costeo).toHaveLength(2);
    const c1 = costeo.find((c) => c.etiqueta === 'Pedido 2026-1')!;
    expect(c1.arancel + c1.iva).toBe(103_544_000);
  });

  it('solo toma recibos de la DIAN con IVA y saca el arancel como total − IVA', () => {
    expect(recibos).toHaveLength(2);
    expect(recibos[0].arancel).toBe(18_449_000);
    expect(recibos[0].etiqueta).toBe('Recibo DIAN 29 ene 2026');
  });
});

describe('detectarPagosAduana', () => {
  const r = detectarPagosAduana(pagos, [...costeo, ...recibos]);

  it('reconoce los cuatro pagos de aduana de 2026 y nada más', () => {
    expect(Object.keys(r).sort()).toEqual(['abr', 'ene', 'jul', 'oct-a', 'oct-b']);
  });

  it('no confunde declaraciones ni retenciones con aduana', () => {
    expect(r['decl-ene']).toBeUndefined();
    expect(r['ret-ago']).toBeUndefined();
  });

  it('empareja el pago único del 2026-1 y reparte arancel e IVA exactos', () => {
    expect(r.jul).toMatchObject({ etiqueta: 'Pedido 2026-1', fuente: 'costeo', arancel: 20_750_000, iva: 82_794_000 });
  });

  it('empareja los dos PSE del mismo día con el 2026-2', () => {
    expect(r['oct-a'].etiqueta).toBe('Pedido 2026-2');
    expect(r['oct-b'].etiqueta).toBe('Pedido 2026-2');
    const arancel = r['oct-a'].arancel + r['oct-b'].arancel;
    const iva = r['oct-a'].iva + r['oct-b'].iva;
    expect(arancel + iva).toBe(97_774_000);
    expect(Math.abs(arancel - 21_445_000)).toBeLessThanOrEqual(1);
  });

  it('usa el vínculo del recibo para enero y abril', () => {
    expect(r.ene).toMatchObject({ fuente: 'recibo', arancel: 18_449_000, iva: 94_957_000 });
    expect(r.abr).toMatchObject({ fuente: 'recibo', arancel: 20_172_000, iva: 91_000_000 });
  });

  it('un recibo DIAN que duplica el costeo no reclama el mismo pago dos veces', () => {
    const dup = liquidacionesDesdeRecibos([
      { id: 'rec-dup', counterparty_name: 'DIAN - PSE', issue_date: '2026-07-15', total_amount: 103_544_000, iva_amount: 88_900_000 },
    ]);
    const out = detectarPagosAduana(pagos, [...costeo, ...dup]);
    expect(out.jul.fuente).toBe('costeo');
    expect(Object.values(out).filter((p) => p.liquidacionId === 'rec:rec-dup')).toHaveLength(0);
  });

  it('un pago fuera de la ventana del contenedor no se empareja', () => {
    const lejos: PagoBanco[] = [{ id: 'x', date: '2026-12-20', amount: -103_544_000, description: 'PAGO PSE DIAN PSE' }];
    expect(detectarPagosAduana(lejos, costeo)).toEqual({});
  });

  it('solo mira egresos a impuestos', () => {
    expect(esPagoAImpuestos({ id: 'a', date: '2026-01-01', amount: 5_000, description: 'DEVOLUCION DIAN' })).toBe(false);
    expect(esPagoAImpuestos({ id: 'b', date: '2026-01-01', amount: -5_000, description: 'TRANSF INTERNACIONAL', beneficiario: 'Shandong' })).toBe(false);
    expect(esPagoAImpuestos({ id: 'c', date: '2026-01-01', amount: -5_000, description: 'PAGO PSE DIAN PSE' })).toBe(true);
  });
});
