// Consistent category colors for charts across the application
// These are vivid, distinct colors for easy visual comparison

export const CATEGORY_COLORS: Record<string, string> = {
  // Expenses categories
  impuestos: 'hsl(0, 84%, 60%)',        // Vivid red
  servicios: 'hsl(217, 91%, 60%)',      // Vivid blue
  proveedores: 'hsl(24, 95%, 53%)',     // Orange
  nomina: 'hsl(280, 84%, 60%)',         // Purple
  transferencias: 'hsl(220, 9%, 46%)',  // Slate gray
  gastos_operativos: 'hsl(173, 58%, 39%)', // Teal
  ventas: 'hsl(152, 69%, 40%)',         // Green
  otros: 'hsl(262, 52%, 47%)',          // Violet
  
  // Default fallback
  default: 'hsl(220, 9%, 46%)',
};

// For operational types if needed
export const OPERATIONAL_TYPE_COLORS: Record<string, string> = {
  ingreso: 'hsl(152, 69%, 40%)',        // Green
  costo: 'hsl(0, 84%, 60%)',            // Red
  gasto_operativo: 'hsl(24, 95%, 53%)', // Orange
  impuesto: 'hsl(280, 84%, 60%)',       // Purple
  transferencia: 'hsl(220, 9%, 46%)',   // Slate
  ajuste: 'hsl(217, 91%, 60%)',         // Blue
  otros: 'hsl(262, 52%, 47%)',          // Violet
};

// Chart semantic colors
export const CHART_COLORS = {
  income: 'hsl(152, 69%, 40%)',         // Green for income
  expense: 'hsl(0, 72%, 51%)',          // Red for expenses
  incomeAvg: 'hsl(152, 69%, 50%)',      // Lighter green for average line
  expenseAvg: 'hsl(0, 72%, 61%)',       // Lighter red for average line
};

export function getCategoryColor(category: string): string {
  const normalized = category.toLowerCase().replace(/\s+/g, '_');
  return CATEGORY_COLORS[normalized] || CATEGORY_COLORS.default;
}

// Get array of colors for category data
export function getCategoryColorsArray(categories: string[]): string[] {
  return categories.map(cat => getCategoryColor(cat));
}
