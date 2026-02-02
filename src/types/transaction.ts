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
  has_vat: boolean;
  vat_percentage: number;
  vat_amount: number | null;
  withholding: number | null;
  affects_dian: boolean;
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
