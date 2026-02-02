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
  has_iva: boolean;
  iva_rate: number;
  iva_amount: number;
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

// Get current cuatrimestre (quadrimester) period
export function getCurrentCuatrimestre(): { start: Date; end: Date; label: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11
  
  let start: Date, end: Date, label: string;
  
  if (month >= 0 && month <= 3) {
    // Ene-Abr (Cuatrimestre 1)
    start = new Date(year, 0, 1);
    end = new Date(year, 3, 30);
    label = `Ene-Abr ${year}`;
  } else if (month >= 4 && month <= 7) {
    // May-Ago (Cuatrimestre 2)
    start = new Date(year, 4, 1);
    end = new Date(year, 7, 31);
    label = `May-Ago ${year}`;
  } else {
    // Sep-Dic (Cuatrimestre 3)
    start = new Date(year, 8, 1);
    end = new Date(year, 11, 31);
    label = `Sep-Dic ${year}`;
  }
  
  return { start, end, label };
}

// Get current month period
export function getCurrentMonth(): { start: Date; end: Date; label: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const label = `${monthNames[month]} ${year}`;
  
  return { start, end, label };
}

// Helper to detect DIAN payments
export function isDIANPayment(description: string): boolean {
  return /PAGO PSE IMPUESTO DIAN/i.test(description);
}
