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
  owner: string | null;
  reconciled: boolean;
  applies_iva: boolean;
  applies_retefuente: boolean;
  notes: string | null;
  sucursal: string | null;
  dcto: string | null;
  created_at: string;
  user_id: string;
}

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

// Helper to calculate IVA from transaction amount
export function calculateIVA(amount: number): number {
  // IVA is included in the amount, we need to extract it
  // Amount = base + (base * 0.19) = base * 1.19
  // So base = Amount / 1.19 and IVA = Amount - base
  const base = amount / (1 + IVA_RATE);
  return amount - base;
}

// Helper to calculate retefuente
export function calculateRetefuente(amount: number): number {
  return Math.abs(amount) * RETEFUENTE_RATE;
}

// Helper to detect IVA transactions by description
export function isIVATransaction(description: string): boolean {
  const ivaPatterns = [
    /COBRO IVA/i,
    /IVA PAGOS/i,
    /PAGO.*IVA/i,
  ];
  return ivaPatterns.some(pattern => pattern.test(description));
}

// Helper to detect DIAN payments
export function isDIANPayment(description: string): boolean {
  return /PAGO PSE IMPUESTO DIAN/i.test(description);
}

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
