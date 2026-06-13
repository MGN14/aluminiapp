/**
 * Rentabilidad por referencia y por cliente: cruza las líneas de factura de
 * venta (ingreso = base gravable, sin IVA) contra el costo unitario del
 * inventario (cost_per_unit, que con landed cost / Siigo es el costo real).
 *
 * margen = ingreso − costo ; margen% = margen / ingreso.
 *
 * Si una referencia vendida no tiene costo en inventario, su costo se marca
 * como desconocido (costKnown=false) y NO se suma al costo total — para no
 * inflar el margen con costo 0. Función pura → testeable.
 */

export interface SaleLine {
  reference: string;
  quantity: number;
  /** Ingreso de la línea sin IVA (line_base). */
  ingreso: number;
  clientKey: string;   // responsible_id o nombre normalizado
  clientName: string;
}

export interface ProfitRow {
  key: string;
  label: string;
  cantidad: number;
  ingreso: number;
  costo: number;
  margen: number;
  margenPct: number | null;
  /** false si falta el costo de al menos una referencia del grupo. */
  costoCompleto: boolean;
}

export interface ProfitabilityResult {
  byReference: ProfitRow[];   // ordenado por margen desc
  byClient: ProfitRow[];      // ordenado por margen desc
  totals: {
    ingreso: number;
    costo: number;
    margen: number;
    margenPct: number | null;
    /** referencias vendidas sin costo en inventario (no costeables) */
    refsSinCosto: number;
  };
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function computeProfitability(
  lines: SaleLine[],
  costByRef: Map<string, number>,
): ProfitabilityResult {
  interface Acc { cantidad: number; ingreso: number; costo: number; costoCompleto: boolean; label: string; }
  const byRef = new Map<string, Acc>();
  const byClient = new Map<string, Acc>();
  const refsSinCostoSet = new Set<string>();

  for (const l of lines) {
    const refKey = (l.reference ?? '').trim().toLowerCase();
    const qty = num(l.quantity);
    const ingreso = num(l.ingreso);
    const hasCost = refKey !== '' && costByRef.has(refKey);
    const costo = hasCost ? qty * num(costByRef.get(refKey)) : 0;
    if (refKey !== '' && !hasCost) refsSinCostoSet.add(refKey);

    // Por referencia
    if (refKey !== '') {
      const a = byRef.get(refKey) ?? { cantidad: 0, ingreso: 0, costo: 0, costoCompleto: true, label: l.reference };
      a.cantidad += qty; a.ingreso += ingreso; a.costo += costo;
      if (!hasCost) a.costoCompleto = false;
      byRef.set(refKey, a);
    }

    // Por cliente (incluye líneas sin referencia, contadas al ingreso del cliente)
    const ck = l.clientKey || '__sin__';
    const c = byClient.get(ck) ?? { cantidad: 0, ingreso: 0, costo: 0, costoCompleto: true, label: l.clientName || 'Sin identificar' };
    c.cantidad += qty; c.ingreso += ingreso; c.costo += costo;
    // Costo incompleto del grupo si una referencia no tiene costo, O si la
    // línea no tiene referencia con ingreso (servicio/mano de obra sin costo).
    if (refKey !== '' && !hasCost) c.costoCompleto = false;
    if (refKey === '' && ingreso > 0) c.costoCompleto = false;
    byClient.set(ck, c);
  }

  const toRows = (m: Map<string, Acc>): ProfitRow[] =>
    Array.from(m.entries()).map(([key, a]) => {
      const margen = r2(a.ingreso - a.costo);
      return {
        key, label: a.label,
        cantidad: r2(a.cantidad), ingreso: r2(a.ingreso), costo: r2(a.costo),
        margen, margenPct: a.ingreso > 0 ? r2((margen / a.ingreso) * 100) : null,
        costoCompleto: a.costoCompleto,
      };
    }).sort((x, y) => y.margen - x.margen);

  const ingreso = r2(lines.reduce((s, l) => s + num(l.ingreso), 0));
  // Costo total: solo de líneas con costo conocido.
  let costo = 0;
  for (const l of lines) {
    const refKey = (l.reference ?? '').trim().toLowerCase();
    if (refKey !== '' && costByRef.has(refKey)) costo += num(l.quantity) * num(costByRef.get(refKey));
  }
  costo = r2(costo);
  const margen = r2(ingreso - costo);

  return {
    byReference: toRows(byRef),
    byClient: toRows(byClient),
    totals: {
      ingreso, costo, margen,
      margenPct: ingreso > 0 ? r2((margen / ingreso) * 100) : null,
      refsSinCosto: refsSinCostoSet.size,
    },
  };
}
