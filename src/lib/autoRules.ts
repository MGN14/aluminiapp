/**
 * Auto-categorization rules for bank transactions based on description matching.
 * Rules are applied in order, from most specific to most general.
 * The first matching rule wins.
 */

export interface AutoRule {
  id: string;
  name: string;
  // Keywords to match (case-insensitive, "description contains")
  keywords: string[];
  // Fields to set when rule matches
  type: 'ingreso' | 'egreso';
  categoryName: string;
  responsibleName: string | null; // null = leave empty for human review
  hasIva: boolean;
  hasRetefuente: boolean;
  hasReteica: boolean;
  // Invoice tag to auto-assign (e.g. 'na' for N/A - sin factura asociada)
  invoiceTag?: 'na' | 'iva_favor' | 'retefuente' | null;
}

/**
 * Auto-categorization rules ordered from most specific to most general.
 * Each rule matches if the description contains ANY of the keywords (case-insensitive).
 */
export const AUTO_RULES: AutoRule[] = [
  // Rule A: Bank interest deposits
  {
    id: 'interest',
    name: 'Abono intereses',
    keywords: ['ABONO INTERESES AHORROS', 'ABONO INTERESES', 'INTERESES AHORROS', 'INTERESES CUENTA', 'INTERESES CTA'],
    type: 'ingreso',
    categoryName: 'Otros',
    responsibleName: 'Banco',
    hasIva: false,
    hasRetefuente: false,
    hasReteica: false,
    invoiceTag: 'na',
  },
  // Rule B: GMF / 4x1000 tax
  {
    id: 'gmf',
    name: 'GMF / 4x1000',
    keywords: ['IMPTO GOBIERNO 4X1000', '4X1000', 'GMF', 'GRAVAMEN MOVIMIENTOS FINANCIEROS', 'IMPUESTO GMF'],
    type: 'egreso',
    categoryName: 'Impuestos',
    responsibleName: 'DIAN',
    hasIva: false,
    hasRetefuente: false,
    hasReteica: false,
    invoiceTag: 'na',
  },
  // Rule E: IVA automatic payments
  {
    id: 'cobro_iva',
    name: 'Cobro IVA pagos automáticos',
    keywords: ['COBRO IVA PAGOS AUTOMATICOS', 'COBRO IVA PAGOS'],
    type: 'egreso',
    categoryName: 'Impuestos',
    responsibleName: 'DIAN',
    hasIva: false,
    hasRetefuente: false,
    hasReteica: false,
    invoiceTag: 'na',
  },
  // Rule F: Virtual transfer service fee
  {
    id: 'servicio_transferencia',
    name: 'Servicio transferencia virtual',
    keywords: ['SERVICIO TRANSFERENCIA VIRTUAL'],
    type: 'egreso',
    categoryName: 'Gastos Operativos',
    responsibleName: 'Banco',
    hasIva: false,
    hasRetefuente: false,
    hasReteica: false,
    invoiceTag: 'na',
  },
  // Rule C: National cash deposits (Sales, needs human review)
  {
    id: 'consig_efectivo',
    name: 'Consignación nacional efectivo',
    keywords: ['CONSIG NACIONAL EFECTIVO'],
    type: 'ingreso',
    categoryName: 'Ventas',
    responsibleName: null, // Leave empty for human review
    hasIva: true,
    hasRetefuente: false,
    hasReteica: true,
  },
  // Rule D: Correspondent banking deposits (Sales, needs human review)
  {
    id: 'consig_corresponsal',
    name: 'Consignación corresponsal',
    keywords: ['CONSIGNACION CORRESPONSAL CB', 'CONSIGNACION CORRESPONSAL'],
    type: 'ingreso',
    categoryName: 'Ventas',
    responsibleName: null, // Leave empty for human review
    hasIva: true,
    hasRetefuente: false,
    hasReteica: true,
  },
];

/**
 * Find the first matching rule for a transaction description.
 * Returns null if no rule matches.
 */
export function findMatchingRule(description: string): AutoRule | null {
  const descUpper = description.toUpperCase();
  
  for (const rule of AUTO_RULES) {
    const matches = rule.keywords.some(keyword => 
      descUpper.includes(keyword.toUpperCase())
    );
    if (matches) {
      return rule;
    }
  }
  
  return null;
}

/**
 * Check if a description matches a specific rule by ID.
 */
export function matchesRule(description: string, ruleId: string): boolean {
  const rule = AUTO_RULES.find(r => r.id === ruleId);
  if (!rule) return false;
  
  const descUpper = description.toUpperCase();
  return rule.keywords.some(keyword => 
    descUpper.includes(keyword.toUpperCase())
  );
}
