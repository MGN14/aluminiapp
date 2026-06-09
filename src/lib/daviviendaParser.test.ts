import { describe, it, expect } from 'vitest';
import { parseDaviviendaStatement, detectBankFromText } from './daviviendaParser';

// Muestra REAL: extracto Davivienda de SERJUNICO SAS, marzo 2026 (texto extraído
// del PDF). Incluye créditos (+), débitos (-: retiro y 4x1000) y descripciones
// multilínea (PORTAL PYMES). Los totales del resumen cuadran al peso.
const SERJUNI_MARZO = `
INFORME DEL MES: MARZO /2026
Banco Davivienda S.A NIT.860.034.313-7
Apreciado Cliente
SERJUNICO SAS
Saldo Anterior $30,455,749.44
Más Créditos $23,441,692.39
Menos Débitos $14,160,416.00
Nuevo Saldo $39,737,025.83
Saldo Promedio $32,816,415.95
Fecha Valor Doc. Clase de Movimiento Oficina
02 03 $ 1,609,476.00+ 1416 Abono ACH BANCOLOMBIA 901445759 MGN GLOBALTRADE SAS PROCESOS ACH
02 03 $ 14,104,000.00- 4286 Retiro Efectivo con Talonario Oficina HAYUELOS
02 03 $ 900,000.00+ 2224 Abono Transferencia 550488445149989 51682949 App Davivienda
04 03 $ 1,489,464.00+ 3436 Abono ACH BANCOLOMBIA 900883176 268 UNIFORMES MEC SAS PROCESOS ACH
10 03 $ 1,378,522.00+ 7649 Abono Por Pago a proveedores 9003929024 PAGO A PROPIETARIOS
MARZ
PORTAL PYMES
10 03 $ 14,842,425.00+ 7650 Abono Por Pago a proveedores 9003929024 PAGO A PROPIETARIOS
MARZ
PORTAL PYMES
18 03 $ 1,609,540.00+ 8390 Abono Por Pago a proveedores 9003929024 PAGO PROPIETARIOS
MARZO
PORTAL PYMES
31 03 $ 1,609,476.00+ 8468 Abono ACH 0000000901445759 PROCESOS ACH
31 03 $ 2,789.39+ 0000 Rendimientos Financieros. 0000
31 03 $ 56,416.00- 0000 Gravamen a los Movimientos Financieros 0000
`;

describe('daviviendaParser', () => {
  const r = parseDaviviendaStatement(SERJUNI_MARZO);

  it('detecta el banco como davivienda', () => {
    expect(detectBankFromText(SERJUNI_MARZO)).toBe('davivienda');
    expect(r.bank).toBe('davivienda');
  });

  it('lee el período', () => {
    expect(r.period.month).toBe(3);
    expect(r.period.year).toBe(2026);
  });

  it('lee el resumen', () => {
    expect(r.summary.saldo_anterior).toBe(30455749.44);
    expect(r.summary.total_abonos).toBe(23441692.39);
    expect(r.summary.total_cargos).toBe(14160416);
    expect(r.summary.saldo_actual).toBe(39737025.83);
  });

  it('parsea las 10 transacciones con signos correctos', () => {
    expect(r.transactions).toHaveLength(10);
    // Retiro efectivo = débito (negativo).
    const retiro = r.transactions.find(t => t.dcto === '4286');
    expect(retiro?.amount).toBe(-14104000);
    // 4x1000 = débito (negativo).
    const gmf = r.transactions.find(t => /Gravamen/i.test(t.description));
    expect(gmf?.amount).toBe(-56416);
    // Abono = crédito (positivo).
    const abono = r.transactions.find(t => t.dcto === '1416');
    expect(abono?.amount).toBe(1609476);
  });

  it('cuadra: Σ créditos y Σ débitos == resumen (guarda de seguridad)', () => {
    expect(r.computed.total_creditos).toBe(23441692.39);
    expect(r.computed.total_debitos).toBe(14160416);
    expect(r.balances_match).toBe(true);
  });

  it('une las descripciones multilínea', () => {
    const multi = r.transactions.find(t => t.dcto === '7650');
    expect(multi?.description).toContain('PORTAL PYMES');
  });
});
