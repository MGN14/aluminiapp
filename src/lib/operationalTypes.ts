export const OPERATIONAL_TYPES = [
  { value: 'ingreso', label: 'Ingreso', color: 'text-success' },
  { value: 'costo', label: 'Costo', color: 'text-destructive' },
  { value: 'gasto_operativo', label: 'Gasto Operativo', color: 'text-warning' },
  { value: 'impuesto', label: 'Impuesto', color: 'text-accent' },
  { value: 'transferencia', label: 'Transferencia', color: 'text-muted-foreground' },
  { value: 'ajuste', label: 'Ajuste', color: 'text-foreground' },
  { value: 'otros', label: 'Otros', color: 'text-muted-foreground' },
] as const;

export type OperationalType = typeof OPERATIONAL_TYPES[number]['value'];

export function getOperationalTypeLabel(value: string | null): string {
  const type = OPERATIONAL_TYPES.find((t) => t.value === value);
  return type?.label ?? 'Otros';
}

export function getOperationalTypeColor(value: string | null): string {
  const type = OPERATIONAL_TYPES.find((t) => t.value === value);
  return type?.color ?? 'text-muted-foreground';
}

/**
 * Get default operational type based on transaction type
 * - Ventas (sales) → Ingreso
 * - Compras (purchases) → Gasto Operativo
 */
export function getDefaultOperationalType(transactionType: 'compra' | 'venta' | null): OperationalType {
  if (transactionType === 'venta') return 'ingreso';
  if (transactionType === 'compra') return 'gasto_operativo';
  return 'otros';
}
