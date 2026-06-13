/**
 * Construcción del Balance General "vivo" a una fecha (hoy) a partir de las
 * fuentes operativas que ya tiene la app, más el estado inicial para los
 * rubros que no se trackean operativamente (anticipos, IVA a favor).
 *
 * NO es contabilidad de partida doble: es un balance gerencial derivado. Por
 * eso el patrimonio se calcula como Activo − Pasivo (cuadra por definición) y
 * aparte se muestra una VALIDACIÓN: patrimonio inicial + utilidad acumulada.
 * La diferencia entre ambos = "partidas por clasificar" (señal de calidad de
 * datos), que se muestra explícitamente en vez de esconderse.
 *
 * Funciones puras → testeables y auditables.
 */

export interface BalanceInputs {
  // Activos (a hoy)
  caja_bancos: number;          // último saldo bancario conocido
  cuentas_por_cobrar: number;   // facturas venta con saldo pendiente
  inventario: number;           // Σ stock_system × cost_per_unit
  anticipos_a_proveedores: number;
  iva_a_favor: number;
  otros_activos: number;
  // Pasivos (a hoy)
  cuentas_por_pagar: number;    // facturas compra con saldo pendiente
  anticipos_de_clientes: number;
  prestaciones_por_pagar: number; // provisión laboral acumulada (módulo Nómina)
  impuestos_por_pagar: number;
  deuda_financiera: number;     // saldo de créditos (capital pendiente)
  // Validación
  patrimonio_inicial: number;
  utilidad_acumulada: number;   // resultado operativo desde fecha_inicio
}

export interface BalanceLine {
  key: string;
  label: string;
  value: number;
  /** corriente (< 1 año) para el cálculo de razón corriente / capital de trabajo */
  corriente: boolean;
}

export interface BalanceSheet {
  activos: BalanceLine[];
  pasivos: BalanceLine[];
  total_activos: number;
  total_pasivos: number;
  activo_corriente: number;
  pasivo_corriente: number;
  patrimonio: number;            // total_activos − total_pasivos
  // Validación de cuadre
  patrimonio_esperado: number;   // patrimonio_inicial + utilidad_acumulada
  descuadre: number;             // patrimonio − patrimonio_esperado
  ratios: {
    razon_corriente: number | null;        // AC / PC
    capital_trabajo: number;                // AC − PC
    prueba_acida: number | null;            // (AC − inventario) / PC
    endeudamiento_pct: number | null;       // Pasivo / Activo × 100
    apalancamiento: number | null;          // Pasivo / Patrimonio
  };
}

const n = (v: number | null | undefined) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (x: number) => Math.round(x * 100) / 100;

export function buildBalanceSheet(input: BalanceInputs): BalanceSheet {
  const activos: BalanceLine[] = [
    { key: 'caja_bancos', label: 'Caja y bancos', value: n(input.caja_bancos), corriente: true },
    { key: 'cuentas_por_cobrar', label: 'Cuentas por cobrar (cartera)', value: n(input.cuentas_por_cobrar), corriente: true },
    { key: 'inventario', label: 'Inventario', value: n(input.inventario), corriente: true },
    { key: 'anticipos_a_proveedores', label: 'Anticipos a proveedores', value: n(input.anticipos_a_proveedores), corriente: true },
    { key: 'iva_a_favor', label: 'IVA a favor (saldo DIAN)', value: n(input.iva_a_favor), corriente: true },
    { key: 'otros_activos', label: 'Otros activos', value: n(input.otros_activos), corriente: false },
  ];
  const pasivos: BalanceLine[] = [
    { key: 'cuentas_por_pagar', label: 'Cuentas por pagar (proveedores)', value: n(input.cuentas_por_pagar), corriente: true },
    { key: 'anticipos_de_clientes', label: 'Anticipos de clientes', value: n(input.anticipos_de_clientes), corriente: true },
    { key: 'prestaciones_por_pagar', label: 'Prestaciones sociales por pagar', value: n(input.prestaciones_por_pagar), corriente: true },
    { key: 'impuestos_por_pagar', label: 'Impuestos por pagar', value: n(input.impuestos_por_pagar), corriente: true },
    // Deuda financiera: tratada como NO corriente por defecto (la mayoría de
    // los créditos a término superan los 12 meses). Conservador para no inflar
    // artificialmente la razón corriente.
    { key: 'deuda_financiera', label: 'Deuda financiera (créditos)', value: n(input.deuda_financiera), corriente: false },
  ];

  const total_activos = r2(activos.reduce((s, l) => s + l.value, 0));
  const total_pasivos = r2(pasivos.reduce((s, l) => s + l.value, 0));
  const activo_corriente = r2(activos.filter(l => l.corriente).reduce((s, l) => s + l.value, 0));
  const pasivo_corriente = r2(pasivos.filter(l => l.corriente).reduce((s, l) => s + l.value, 0));
  const patrimonio = r2(total_activos - total_pasivos);
  const patrimonio_esperado = r2(n(input.patrimonio_inicial) + n(input.utilidad_acumulada));
  const descuadre = r2(patrimonio - patrimonio_esperado);

  return {
    activos,
    pasivos,
    total_activos,
    total_pasivos,
    activo_corriente,
    pasivo_corriente,
    patrimonio,
    patrimonio_esperado,
    descuadre,
    ratios: {
      razon_corriente: pasivo_corriente > 0 ? r2(activo_corriente / pasivo_corriente) : null,
      capital_trabajo: r2(activo_corriente - pasivo_corriente),
      prueba_acida: pasivo_corriente > 0 ? r2((activo_corriente - n(input.inventario)) / pasivo_corriente) : null,
      endeudamiento_pct: total_activos > 0 ? r2((total_pasivos / total_activos) * 100) : null,
      apalancamiento: patrimonio > 0 ? r2(total_pasivos / patrimonio) : null,
    },
  };
}

/** Semáforo para los ratios principales (verde/ámbar/rojo). */
export type Semaforo = 'green' | 'yellow' | 'red';

export function semaforoRazonCorriente(v: number | null): Semaforo {
  if (v === null) return 'yellow';
  if (v >= 1.5) return 'green';
  if (v >= 1) return 'yellow';
  return 'red';
}
export function semaforoEndeudamiento(pct: number | null): Semaforo {
  if (pct === null) return 'yellow';
  if (pct <= 50) return 'green';
  if (pct <= 70) return 'yellow';
  return 'red';
}
