export type TransactionType = 'compra' | 'venta';
export type IvaType = 'credito' | 'debito' | null;
export type OperationalType = 'ingreso' | 'costo' | 'gasto_operativo' | 'impuesto' | 'transferencia' | 'ajuste' | 'otros';

export interface Transaction {
  id: string;
  statement_id: string;
  date: string;
  description: string;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  category: string | null;
  category_id: string | null;
  owner: string | null;
  responsible_id: string | null;
  transaction_type: TransactionType;
  operational_type: OperationalType | null;
  has_iva: boolean;
  iva_rate: number;
  iva_amount: number;
  iva_type: IvaType;
  has_retefuente: boolean;
  retefuente_rate: number;
  retefuente_amount: number;
  notes: string | null;
  sucursal: string | null;
  dcto: string | null;
  raw_line: string | null;
  created_at: string;
  user_id: string;
}

export interface BankStatement {
  id: string;
  user_id: string;
  file_name: string;
  file_path: string;
  bank_name: string;
  statement_month: number | null;
  statement_year: number | null;
  period_start: string | null;
  period_end: string | null;
  processed: boolean;
  processing_error: string | null;
  uploaded_at: string;
}

export interface Responsible {
  id: string;
  user_id: string;
  name: string;
  active: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  active: boolean;
  sort_order: number;
  created_at: string;
}

// Legacy categories for backward compatibility
export const CATEGORIES = [
  { value: 'ventas', label: 'Ventas' },
  { value: 'nomina', label: 'Nómina' },
  { value: 'proveedores', label: 'Proveedores' },
  { value: 'servicios', label: 'Servicios' },
  { value: 'impuestos', label: 'Impuestos' },
  { value: 'transferencias', label: 'Transferencias' },
  { value: 'gastos_operativos', label: 'Gastos Operativos' },
  { value: 'otros', label: 'Otros' },
] as const;

export type CategoryValue = typeof CATEGORIES[number]['value'];

// Colombian tax constants
export const IVA_RATE = 0.19; // 19%
export const RETEFUENTE_RATE = 0.025; // 2.5%

// Month names for display
export const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Get cuatrimestre based on a given month (1-12) and year
export function getCuatrimestreForPeriod(month: number, year: number): { start: Date; end: Date; label: string; number: 1 | 2 | 3 } {
  let start: Date, end: Date, label: string, cuatrimestreNum: 1 | 2 | 3;
  
  if (month >= 1 && month <= 4) {
    // Ene-Abr (Cuatrimestre 1)
    start = new Date(year, 0, 1);
    end = new Date(year, 3, 30, 23, 59, 59);
    label = `Ene-Abr ${year}`;
    cuatrimestreNum = 1;
  } else if (month >= 5 && month <= 8) {
    // May-Ago (Cuatrimestre 2)
    start = new Date(year, 4, 1);
    end = new Date(year, 7, 31, 23, 59, 59);
    label = `May-Ago ${year}`;
    cuatrimestreNum = 2;
  } else {
    // Sep-Dic (Cuatrimestre 3)
    start = new Date(year, 8, 1);
    end = new Date(year, 11, 31, 23, 59, 59);
    label = `Sep-Dic ${year}`;
    cuatrimestreNum = 3;
  }
  
  return { start, end, label, number: cuatrimestreNum };
}

// Get month period based on a given month (1-12) and year
export function getMonthPeriod(month: number, year: number): { start: Date; end: Date; label: string } {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59); // Last day of month
  
  const label = `${MONTH_NAMES[month - 1]} ${year}`;
  
  return { start, end, label };
}

// Get current cuatrimestre (quadrimester) period - for backward compatibility
export function getCurrentCuatrimestre(): { start: Date; end: Date; label: string } {
  const now = new Date();
  return getCuatrimestreForPeriod(now.getMonth() + 1, now.getFullYear());
}

// Get current month period - for backward compatibility
export function getCurrentMonth(): { start: Date; end: Date; label: string } {
  const now = new Date();
  return getMonthPeriod(now.getMonth() + 1, now.getFullYear());
}

// Helper to detect DIAN payments
export function isDIANPayment(description: string): boolean {
  return /PAGO PSE IMPUESTO DIAN/i.test(description);
}

// Parse month name from Spanish to month number (1-12)
export function parseSpanishMonth(monthStr: string): number | null {
  const monthMap: Record<string, number> = {
    'ene': 1, 'enero': 1,
    'feb': 2, 'febrero': 2,
    'mar': 3, 'marzo': 3,
    'abr': 4, 'abril': 4,
    'may': 5, 'mayo': 5,
    'jun': 6, 'junio': 6,
    'jul': 7, 'julio': 7,
    'ago': 8, 'agosto': 8,
    'sep': 9, 'sept': 9, 'septiembre': 9,
    'oct': 10, 'octubre': 10,
    'nov': 11, 'noviembre': 11,
    'dic': 12, 'diciembre': 12,
  };
  
  return monthMap[monthStr.toLowerCase()] || null;
}
