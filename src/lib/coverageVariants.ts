/**
 * Cobertura por VARIANTE DE COLOR (no por familia -5) — pedido de Nico:
 * "yo no monto pedido con -5; LIV-40-5 no me dice nada porque no sé si es
 * mate, negro o blanco".
 *
 * Fuentes, cada una en su idioma:
 *   · Demanda real  → remision_items (ventas): traen la referencia tal como
 *     se despachó. Si viene con sufijo (-2/-3/-0), demanda por color real.
 *     Si viene en -5 o base, esa demanda queda en esa fila — la tabla MUESTRA
 *     la verdad de los datos, no la inventa.
 *   · Tránsito      → packing list (con sufijo) + proforma (la app le pone el
 *     sufijo desde la columna Color — applyColorSuffix).
 *   · Stock físico  → inventario. Hoy Siigo solo tiene la -5: si una familia
 *     tiene stock SOLO en la -5 pero demanda por colores, el stock se REPARTE
 *     entre las variantes proporcional a su demanda (marcado "estimado") —
 *     el día que el inventario discrimine color, el reparto desaparece solo.
 *
 * La proyección de quiebre por variante reusa projectQuiebres del motor.
 */

import { projectQuiebres, type QuiebreProducto, type TransitoItem } from '@/lib/reorderSuggestion';
import { refFamilyKey, variantKey, colorLabel, colorFromSuffix } from '@/lib/refFamily';

export interface VentaRow {
  /** Referencia tal como salió en la remisión (con o sin sufijo). */
  reference: string;
  units: number;
  /** ISO YYYY-MM-DD */
  date: string;
}

export interface StockVarianteRow {
  reference: string;
  stockPhysical: number;
}

export interface VarianteCobertura extends QuiebreProducto {
  /** Llave normalizada de la variante. */
  key: string;
  familia: string;
  color: string;
  /** true = stock repartido desde la -5 por mezcla de demanda (no contado). */
  stockEstimado: boolean;
}

export function buildCoverageVariants(params: {
  todayIso: string;
  ventanaDias: number;
  ventas: VentaRow[];
  inventario: StockVarianteRow[];
  transito: TransitoItem[];
  /** Corrección por censura (días con stock) de la familia: censurado/simple. */
  factorCensuraPorFamilia?: Map<string, number>;
}): VarianteCobertura[] {
  const { todayIso, ventanaDias, ventas, inventario, transito } = params;
  const desde = new Date(todayIso + 'T00:00:00Z');
  desde.setUTCDate(desde.getUTCDate() - ventanaDias);
  const desdeIso = desde.toISOString().slice(0, 10);

  // ── Demanda por variante (ventana), corregida por censura familiar ──
  const salidasPorVariante = new Map<string, { label: string; units: number }>();
  for (const v of ventas) {
    const day = (v.date ?? '').slice(0, 10);
    if (!day || day < desdeIso || day > todayIso) continue;
    const key = variantKey(v.reference);
    if (!key) continue;
    const acc = salidasPorVariante.get(key) ?? { label: v.reference.trim(), units: 0 };
    acc.units += Math.abs(Number(v.units ?? 0));
    salidasPorVariante.set(key, acc);
  }

  const consumoPorVariante = new Map<string, number>();
  for (const [key, acc] of salidasPorVariante) {
    const familia = refFamilyKey(key);
    const censura = params.factorCensuraPorFamilia?.get(familia) ?? 1;
    consumoPorVariante.set(key, (acc.units / ventanaDias) * Math.max(1, censura));
  }

  // ── Universo de variantes: demanda ∪ inventario ∪ tránsito ──
  const labels = new Map<string, string>();
  for (const [key, acc] of salidasPorVariante) labels.set(key, acc.label);
  for (const r of inventario) {
    const key = variantKey(r.reference);
    if (key && !labels.has(key)) labels.set(key, r.reference.trim());
  }
  for (const t of transito) {
    const key = t.matchKey ?? variantKey(t.reference);
    if (key && !labels.has(key)) labels.set(key, t.reference.trim());
  }

  // ── Stock por variante: exacto si existe; si no, reparto desde la -5 ──
  const stockExacto = new Map<string, number>();
  for (const r of inventario) {
    const key = variantKey(r.reference);
    if (!key) continue;
    stockExacto.set(key, (stockExacto.get(key) ?? 0) + Math.max(0, Number(r.stockPhysical ?? 0)));
  }

  // Stock de la -5 por familia (el "pote" a repartir cuando no hay por color).
  const poteFamilia = new Map<string, number>();
  for (const [key, stock] of stockExacto) {
    if (colorFromSuffix(key) === 'total') {
      poteFamilia.set(refFamilyKey(key), (poteFamilia.get(refFamilyKey(key)) ?? 0) + stock);
    }
  }
  // Demanda total por familia de las variantes de color (para el reparto).
  const demandaColorPorFamilia = new Map<string, number>();
  for (const [key, consumo] of consumoPorVariante) {
    if (colorFromSuffix(key) === 'total') continue; // la -5 no participa del reparto
    const familia = refFamilyKey(key);
    demandaColorPorFamilia.set(familia, (demandaColorPorFamilia.get(familia) ?? 0) + consumo);
  }

  const stockRows: { productId: string; reference: string; stockPhysical: number; matchKey: string; estimado: boolean }[] = [];
  for (const [key, label] of labels) {
    const esTotal = colorFromSuffix(key) === 'total';
    const familia = refFamilyKey(key);
    const exacto = stockExacto.get(key) ?? 0;
    let stock = exacto;
    let estimado = false;

    if (!esTotal) {
      const pote = poteFamilia.get(familia) ?? 0;
      const demandaColores = demandaColorPorFamilia.get(familia) ?? 0;
      const consumo = consumoPorVariante.get(key) ?? 0;
      if (exacto === 0 && pote > 0 && demandaColores > 0 && consumo > 0) {
        // Reparto proporcional a la mezcla de demanda por color.
        stock = pote * (consumo / demandaColores);
        estimado = true;
      }
    } else {
      // La fila -5 muestra lo NO repartido: si toda su demanda de familia está
      // por colores, su stock efectivo para proyección es lo que queda.
      const demandaColores = demandaColorPorFamilia.get(familia) ?? 0;
      if (demandaColores > 0) {
        // Todo el pote se repartió entre los colores.
        stock = 0;
        estimado = true;
      }
    }

    stockRows.push({ productId: key, reference: label, stockPhysical: stock, matchKey: key, estimado });
  }

  // ── Proyección de quiebre por variante (mismo motor) ──
  const quiebres = projectQuiebres({
    todayIso,
    stock: stockRows,
    salidas: [...salidasPorVariante.entries()].map(([key, acc]) => ({ productId: key, quantity: acc.units })),
    transito: transito.map((t) => ({ ...t, matchKey: t.matchKey ?? variantKey(t.reference) })),
    ventanaDias,
    consumoPorProducto: consumoPorVariante,
  });

  const estimadoPorKey = new Map(stockRows.map((r) => [r.productId, r.estimado]));
  const keyPorLabel = new Map(stockRows.map((r) => [r.reference, r.productId]));

  return quiebres.map((q) => {
    const key = keyPorLabel.get(q.reference) ?? variantKey(q.reference);
    return {
      ...q,
      key,
      familia: refFamilyKey(key),
      color: colorLabel(key),
      stockEstimado: estimadoPorKey.get(key) ?? false,
    };
  });
}
