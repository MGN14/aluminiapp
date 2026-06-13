import { describe, it, expect } from 'vitest';
import { classifyPucAccount, aggregateTrialBalance, classifyPucResult, aggregatePyg } from './pucClassify';

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

describe('classifyPucResult', () => {
  it('clasifica clases de resultado', () => {
    expect(classifyPucResult('413501')).toBe('ingresos');
    expect(classifyPucResult('417505')).toBe('ingresos');     // devolución (resta)
    expect(classifyPucResult('510506')).toBe('gastos');       // sueldos
    expect(classifyPucResult('540505')).toBe('impuestos');    // impuesto de renta
    expect(classifyPucResult('613501')).toBe('costos_venta'); // costo de ventas
    expect(classifyPucResult('710101')).toBe('costos_venta'); // costos de producción
    expect(classifyPucResult('110505')).toBe('no_pnl');       // activo → fuera
  });
});

describe('aggregatePyg', () => {
  it('ingreso neto resta devoluciones; gastos en abs; calcula utilidad', () => {
    const r = aggregatePyg([
      { account_code: '41350101', saldo: 839_741_138 },  // ventas
      { account_code: '41750501', saldo: -27_413_361 },  // devoluciones (restan)
      { account_code: '51050601', saldo: -51_887_038 },  // sueldos (gasto)
      { account_code: '61350101', saldo: -400_000_000 }, // costo de ventas
      { account_code: '54050101', saldo: -10_000_000 },  // impuesto renta
    ]);
    expect(r.ingresos).toBe(812_327_777);   // 839.7M − 27.4M
    expect(r.costos_venta).toBe(400_000_000);
    expect(r.gastos).toBe(51_887_038);
    expect(r.impuestos).toBe(10_000_000);
    expect(r.utilidad).toBe(812_327_777 - 400_000_000 - 51_887_038 - 10_000_000);
  });

  it('descarta subtotales (suma solo hojas)', () => {
    const r = aggregatePyg([
      { account_code: '4', saldo: 800_000_000 },        // mayor → ignorar
      { account_code: '41', saldo: 800_000_000 },       // grupo → ignorar
      { account_code: '41350101', saldo: 800_000_000 }, // hoja
    ]);
    expect(r.ingresos).toBe(800_000_000); // no 2.4B
  });
});
