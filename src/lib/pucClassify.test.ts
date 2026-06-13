import { describe, it, expect } from 'vitest';
import { classifyPucAccount, aggregateTrialBalance } from './pucClassify';

describe('classifyPucAccount', () => {
  it('clase 1 → activos por grupo', () => {
    expect(classifyPucAccount('110505')).toBe('disponible');     // caja
    expect(classifyPucAccount('111005')).toBe('disponible');     // bancos
    expect(classifyPucAccount('130505')).toBe('cartera');        // clientes
    expect(classifyPucAccount('143501')).toBe('inventario');     // mercancías
    expect(classifyPucAccount('152405')).toBe('activos_fijos');  // maquinaria
    expect(classifyPucAccount('120505')).toBe('otros_activos');  // inversiones
    expect(classifyPucAccount('170505')).toBe('otros_activos');  // diferidos
  });
  it('clase 2 → pasivos por grupo', () => {
    expect(classifyPucAccount('210505')).toBe('obligaciones_financieras');
    expect(classifyPucAccount('220505')).toBe('proveedores_cxp');
    expect(classifyPucAccount('233505')).toBe('proveedores_cxp');     // costos y gastos por pagar
    expect(classifyPucAccount('240805')).toBe('impuestos');           // IVA
    expect(classifyPucAccount('250505')).toBe('obligaciones_laborales');
    expect(classifyPucAccount('280505')).toBe('otros_pasivos');
  });
  it('clase 3 → patrimonio; clases 4-7 → fuera del balance', () => {
    expect(classifyPucAccount('310505')).toBe('patrimonio');
    expect(classifyPucAccount('413505')).toBe('no_balance'); // ingresos
    expect(classifyPucAccount('510505')).toBe('no_balance'); // gastos
    expect(classifyPucAccount('613505')).toBe('no_balance'); // costo de ventas
  });
  it('tolera códigos con puntos/espacios y vacíos', () => {
    expect(classifyPucAccount('1105-05')).toBe('disponible');
    expect(classifyPucAccount(' 22 ')).toBe('proveedores_cxp');
    expect(classifyPucAccount('')).toBe('no_balance');
  });
});

describe('aggregateTrialBalance', () => {
  it('agrupa por sección (hojas) e ignora resultado', () => {
    const r = aggregateTrialBalance([
      { account_code: '110505', saldo: 10_000_000 },
      { account_code: '111005', saldo: 5_000_000 },   // también disponible
      { account_code: '130505', saldo: 8_000_000 },
      { account_code: '220505', saldo: -4_000_000 },  // pasivo con signo → abs
      { account_code: '310505', saldo: 19_000_000 },
      { account_code: '413505', saldo: 50_000_000 },  // ingreso → ignorado
    ]);
    expect(r.disponible).toBe(15_000_000);
    expect(r.cartera).toBe(8_000_000);
    expect(r.proveedores_cxp).toBe(4_000_000);
    expect(r.patrimonio).toBe(19_000_000);
    expect(r.no_balance).toBe(50_000_000);
  });

  it('descarta cuentas mayores/subtotales (suma solo hojas, no duplica)', () => {
    const r = aggregateTrialBalance([
      { account_code: '15', saldo: 100_000_000 },     // mayor (subtotal) → ignorar
      { account_code: '1524', saldo: 100_000_000 },   // cuenta (subtotal) → ignorar
      { account_code: '152405', saldo: 100_000_000 }, // auxiliar (hoja) → cuenta
    ]);
    expect(r.activos_fijos).toBe(100_000_000); // no 300M
  });

  it('netea depreciación acumulada (contra-activo) del activo fijo', () => {
    const r = aggregateTrialBalance([
      { account_code: '152405', saldo: 80_000_000 },  // maquinaria (débito)
      { account_code: '159205', saldo: 30_000_000 },  // depreciación acum. (crédito) → resta
    ]);
    expect(r.activos_fijos).toBe(50_000_000); // 80 − 30 neto
  });

  it('netea provisión de cartera (deterioro)', () => {
    const r = aggregateTrialBalance([
      { account_code: '130505', saldo: 20_000_000 },  // clientes
      { account_code: '139905', saldo: 3_000_000 },   // provisión → resta
    ]);
    expect(r.cartera).toBe(17_000_000);
  });
});
