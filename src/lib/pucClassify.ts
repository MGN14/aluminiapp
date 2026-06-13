/**
 * Clasificación de cuentas del PUC colombiano (Decreto 2650) en las secciones
 * del Balance General, para comparar el balance de prueba de Siigo contra el
 * balance derivado de la app.
 *
 * Se clasifica por los primeros dígitos del código de cuenta:
 *   Clase 1 = Activo · 2 = Pasivo · 3 = Patrimonio (las demás —4 ingresos,
 *   5 gastos, 6 costos— no van al balance y se ignoran).
 *
 * Grupos (2 dígitos) relevantes:
 *   11 Disponible · 12 Inversiones · 13 Deudores (CxC) · 14 Inventarios
 *   15 Propiedad planta y equipo · 16-19 otros activos
 *   21 Obligaciones financieras · 22 Proveedores · 23 Cuentas por pagar
 *   24 Impuestos · 25 Obligaciones laborales · 26-28 otros pasivos
 */

export type BalanceSection =
  | 'disponible' | 'cartera' | 'inventario' | 'activos_fijos' | 'otros_activos'
  | 'obligaciones_financieras' | 'proveedores_cxp' | 'impuestos' | 'obligaciones_laborales' | 'otros_pasivos'
  | 'patrimonio'
  | 'no_balance';   // clases 4-7 (resultado) → fuera del balance

export const SECTION_LABEL: Record<BalanceSection, string> = {
  disponible: 'Caja y bancos',
  cartera: 'Cuentas por cobrar',
  inventario: 'Inventario',
  activos_fijos: 'Activos fijos (PP&E)',
  otros_activos: 'Otros activos',
  obligaciones_financieras: 'Deuda financiera',
  proveedores_cxp: 'Proveedores y CxP',
  impuestos: 'Impuestos por pagar',
  obligaciones_laborales: 'Obligaciones laborales',
  otros_pasivos: 'Otros pasivos',
  patrimonio: 'Patrimonio',
  no_balance: 'Fuera del balance',
};

export const SECTION_ORDER: BalanceSection[] = [
  'disponible', 'cartera', 'inventario', 'activos_fijos', 'otros_activos',
  'obligaciones_financieras', 'proveedores_cxp', 'impuestos', 'obligaciones_laborales', 'otros_pasivos',
  'patrimonio',
];

export function isActivo(s: BalanceSection): boolean {
  return s === 'disponible' || s === 'cartera' || s === 'inventario' || s === 'activos_fijos' || s === 'otros_activos';
}
export function isPasivo(s: BalanceSection): boolean {
  return s === 'obligaciones_financieras' || s === 'proveedores_cxp' || s === 'impuestos'
    || s === 'obligaciones_laborales' || s === 'otros_pasivos';
}

/** Clasifica un código PUC en su sección de balance. */
export function classifyPucAccount(rawCode: string): BalanceSection {
  const code = String(rawCode ?? '').replace(/\D/g, '');
  if (code.length === 0) return 'no_balance';
  const c1 = code[0];
  const g2 = code.slice(0, 2);

  if (c1 === '3') return 'patrimonio';
  if (c1 === '4' || c1 === '5' || c1 === '6' || c1 === '7') return 'no_balance';

  if (c1 === '1') {
    switch (g2) {
      case '11': return 'disponible';
      case '13': return 'cartera';
      case '14': return 'inventario';
      case '15': return 'activos_fijos';
      default: return 'otros_activos'; // 12, 16, 17, 18, 19
    }
  }
  if (c1 === '2') {
    switch (g2) {
      case '21': return 'obligaciones_financieras';
      case '22': return 'proveedores_cxp';
      case '23': return 'proveedores_cxp';
      case '24': return 'impuestos';
      case '25': return 'obligaciones_laborales';
      default: return 'otros_pasivos'; // 26, 27, 28
    }
  }
  return 'no_balance';
}

/**
 * Agrega un balance de prueba (cuentas con saldo) por sección.
 * Convención de signo del PUC: activos y gastos saldo débito (+), pasivos,
 * patrimonio e ingresos saldo crédito. El balance de prueba suele venir con
 * saldo final ya con signo natural; tomamos el valor absoluto por sección
 * (el balance reorganiza por naturaleza, no por signo contable).
 */
export interface TrialBalanceLine {
  account_code: string;
  saldo: number;
}

const digits = (code: string) => String(code ?? '').replace(/\D/g, '');

/**
 * Cuenta de naturaleza CONTRARIA dentro del activo (saldo crédito que RESTA):
 * depreciación acumulada, agotamiento, amortización, provisiones/deterioro.
 * En el PUC son las subcuentas 92/96/97/98/99 dentro de grupos de activo
 * (ej. 1592 depreciación, 1399/1499/1299 provisiones). Hay que NETEARLAS, no
 * sumarlas, o el activo queda inflado (bruto + depreciación).
 */
function isContraActivo(code: string): boolean {
  const d = digits(code);
  if (d[0] !== '1' || d.length < 4) return false;
  const subcuenta = parseInt(d.slice(2, 4), 10);
  return Number.isFinite(subcuenta) && subcuenta >= 92; // 92,96,97,98,99
}

/**
 * Una fila es "hoja" (cuenta de detalle) si ninguna OTRA fila tiene un código
 * que empiece con el suyo y sea más largo. Sumar solo hojas evita duplicar el
 * activo al contar la cuenta mayor/subtotal (ej. '15') además de sus
 * auxiliares ('152405', '159205'), que el balance de prueba trae todas.
 */
function leafCodes(codes: string[]): Set<string> {
  const norm = codes.map(digits).filter((c) => c.length > 0);
  const leaves = new Set<string>();
  for (const c of norm) {
    const isParent = norm.some((other) => other !== c && other.startsWith(c) && other.length > c.length);
    if (!isParent) leaves.add(c);
  }
  return leaves;
}

export function aggregateTrialBalance(lines: TrialBalanceLine[]): Record<BalanceSection, number> {
  const acc: Record<BalanceSection, number> = {
    disponible: 0, cartera: 0, inventario: 0, activos_fijos: 0, otros_activos: 0,
    obligaciones_financieras: 0, proveedores_cxp: 0, impuestos: 0, obligaciones_laborales: 0, otros_pasivos: 0,
    patrimonio: 0, no_balance: 0,
  };
  const leaves = leafCodes(lines.map((l) => l.account_code));
  const seen = new Set<string>();
  for (const l of lines) {
    const d = digits(l.account_code);
    if (d.length === 0 || !leaves.has(d) || seen.has(d)) continue; // solo hojas, sin repetir
    seen.add(d);
    const section = classifyPucAccount(l.account_code);
    const val = Math.abs(Number(l.saldo) || 0);
    // Contra-activos (depreciación/provisión) restan de su sección de activo.
    if (isActivo(section) && isContraActivo(l.account_code)) acc[section] -= val;
    else acc[section] += val;
  }
  return acc;
}
