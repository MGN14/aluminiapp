import { describe, it, expect } from 'vitest';
import { buildBalanceSheet, semaforoRazonCorriente, semaforoEndeudamiento, type BalanceInputs } from './balanceSheet';

const base: BalanceInputs = {
  caja_bancos: 10_000_000,
  cuentas_por_cobrar: 5_000_000,
  inventario: 8_000_000,
  activos_fijos: 0,
  anticipos_a_proveedores: 1_000_000,
  iva_a_favor: 500_000,
  otros_activos: 0,
  cuentas_por_pagar: 4_000_000,
  anticipos_de_clientes: 1_000_000,
  prestaciones_por_pagar: 2_000_000,
  impuestos_por_pagar: 1_000_000,
  deuda_financiera: 6_000_000,
  patrimonio_inicial: 8_000_000,
  utilidad_acumulada: 2_500_000,
};

describe('buildBalanceSheet', () => {
  it('suma activos y pasivos correctamente', () => {
    const b = buildBalanceSheet(base);
    expect(b.total_activos).toBe(24_500_000); // 10+5+8+1+0.5M
    expect(b.total_pasivos).toBe(14_000_000); // 4+1+2+1+6M
  });

  it('patrimonio = activos − pasivos', () => {
    const b = buildBalanceSheet(base);
    expect(b.patrimonio).toBe(10_500_000);
  });

  it('clasifica corriente vs no corriente (deuda financiera no corriente)', () => {
    const b = buildBalanceSheet(base);
    // Activo corriente = todo menos otros_activos (0) = 24.5M
    expect(b.activo_corriente).toBe(24_500_000);
    // Pasivo corriente = CxP + anticipos + prestaciones + impuestos = 8M (sin deuda)
    expect(b.pasivo_corriente).toBe(8_000_000);
  });

  it('razón corriente y capital de trabajo', () => {
    const b = buildBalanceSheet(base);
    expect(b.ratios.razon_corriente).toBe(3.06); // 24.5 / 8 = 3.0625 → 3.06
    expect(b.ratios.capital_trabajo).toBe(16_500_000); // 24.5 − 8
  });

  it('prueba ácida excluye inventario', () => {
    const b = buildBalanceSheet(base);
    // (24.5 − 8) / 8 = 2.0625 → 2.06
    expect(b.ratios.prueba_acida).toBe(2.06);
  });

  it('endeudamiento y apalancamiento', () => {
    const b = buildBalanceSheet(base);
    // 14 / 24.5 × 100 = 57.14 → 57.14
    expect(b.ratios.endeudamiento_pct).toBe(57.14);
    // 14 / 10.5 = 1.333 → 1.33
    expect(b.ratios.apalancamiento).toBe(1.33);
  });

  it('valida el cuadre: descuadre = patrimonio − (inicial + utilidad)', () => {
    const b = buildBalanceSheet(base);
    // esperado = 8M + 2.5M = 10.5M; calculado = 10.5M → descuadre 0
    expect(b.patrimonio_esperado).toBe(10_500_000);
    expect(b.descuadre).toBe(0);
  });

  it('detecta descuadre cuando faltan datos', () => {
    const b = buildBalanceSheet({ ...base, utilidad_acumulada: 5_000_000 });
    // esperado = 13M; calculado sigue 10.5M → descuadre −2.5M
    expect(b.descuadre).toBe(-2_500_000);
  });

  it('maneja pasivo corriente = 0 sin dividir por cero', () => {
    const b = buildBalanceSheet({
      ...base, cuentas_por_pagar: 0, anticipos_de_clientes: 0, prestaciones_por_pagar: 0, impuestos_por_pagar: 0,
    });
    expect(b.ratios.razon_corriente).toBeNull();
    expect(b.ratios.prueba_acida).toBeNull();
  });

  it('semáforos', () => {
    expect(semaforoRazonCorriente(2)).toBe('green');
    expect(semaforoRazonCorriente(1.2)).toBe('yellow');
    expect(semaforoRazonCorriente(0.8)).toBe('red');
    expect(semaforoEndeudamiento(40)).toBe('green');
    expect(semaforoEndeudamiento(60)).toBe('yellow');
    expect(semaforoEndeudamiento(80)).toBe('red');
  });
});
