/**
 * Impacto del costo del contenedor en la LISTA DE PRECIOS.
 *
 * Es la última tarjeta del calculador HTML de Nico y la única que quedó sin
 * portar entera — y no es casualidad que sea la última: es la conclusión. El
 * tablero te dice cuánto cuesta el contenedor; esto te dice si con ese costo
 * seguís ganando plata a los precios que ya tenés publicados.
 *
 * Margen MAYORISTA (la definición del HTML): sobre el precio, no sobre el costo.
 *     margen = (precio_sin_iva − costo_landed) / precio_sin_iva
 * Una lista armada como costo × 1,18 deja 0,18/1,18 = 15,25%.
 *
 * El precio de lista de inventory_products puede estar cargado con o sin IVA
 * — por eso `ivaIncluido` es explícito y la UI lo deja cambiar: adivinarlo
 * sería inventar el margen.
 */

export interface RefPrecio {
  /** Clave de familia (refFamilyKey) para cruzar packing ↔ inventario. */
  familia: string;
  reference: string;
  descripcion: string | null;
  cantidad: number;
  /** Costo landed unitario proyectado con el escenario. */
  landedUnit: number;
  /** Precio de lista del maestro (0/null = sin precio cargado). */
  precioLista: number | null;
}

export interface RefMargen extends RefPrecio {
  /** Precio de lista sin IVA. */
  precioSinIva: number | null;
  /** Margen mayorista 0-1 (null si no hay precio). */
  margen: number | null;
  /** Utilidad unitaria en COP. */
  utilidadUnit: number | null;
  /** Utilidad de toda la cantidad de esa ref en el contenedor. */
  utilidadTotal: number | null;
  /** Precio sin IVA que haría falta para volver al margen objetivo. */
  precioNecesario: number | null;
  /** % que habría que subir la lista para volver al objetivo (null si ya está). */
  ajustePct: number | null;
}

export interface PriceImpactResult {
  refs: RefMargen[];
  /** Cuántas referencias tienen precio de lista cargado. */
  conPrecio: number;
  sinPrecio: number;
  /** Margen ponderado por valor del contenedor (la foto global). */
  margenPonderado: number | null;
  /** Utilidad total que deja el contenedor a lista actual. */
  utilidadTotal: number | null;
  /** Refs cuyo margen quedó bajo el umbral — las que hay que mirar. */
  enRiesgo: RefMargen[];
  /** Refs que ya se venden a pérdida (margen negativo). */
  enPerdida: RefMargen[];
  /** Ajuste promedio de lista para volver al margen objetivo (ponderado). */
  ajusteNecesarioPct: number | null;
}

export const MARGEN_OBJETIVO = 0.1525; // el 15,25% de una lista costo × 1,18
export const MARGEN_RIESGO = 0.08;

export function computePriceImpact(
  refs: RefPrecio[],
  opts: { ivaIncluido: boolean; ivaPct?: number; margenObjetivo?: number },
): PriceImpactResult {
  const ivaRate = (opts.ivaPct ?? 19) / 100;
  const objetivo = opts.margenObjetivo ?? MARGEN_OBJETIVO;

  const out: RefMargen[] = refs.map((r) => {
    const bruto = Number(r.precioLista) || 0;
    const precioSinIva = bruto > 0 ? (opts.ivaIncluido ? bruto / (1 + ivaRate) : bruto) : null;
    if (precioSinIva == null || precioSinIva <= 0) {
      return { ...r, precioSinIva: null, margen: null, utilidadUnit: null, utilidadTotal: null, precioNecesario: null, ajustePct: null };
    }
    const margen = (precioSinIva - r.landedUnit) / precioSinIva;
    const utilidadUnit = precioSinIva - r.landedUnit;
    // Para volver al margen objetivo: precio = costo / (1 − objetivo).
    const precioNecesario = objetivo < 1 ? r.landedUnit / (1 - objetivo) : null;
    const ajustePct = precioNecesario != null && precioNecesario > precioSinIva
      ? (precioNecesario / precioSinIva - 1) * 100
      : null;
    return {
      ...r, precioSinIva, margen, utilidadUnit,
      utilidadTotal: utilidadUnit * (Number(r.cantidad) || 0),
      precioNecesario, ajustePct,
    };
  });

  const conPrecioArr = out.filter((r) => r.precioSinIva != null);
  const ventaTotal = conPrecioArr.reduce((s, r) => s + (r.precioSinIva ?? 0) * (Number(r.cantidad) || 0), 0);
  const costoTotal = conPrecioArr.reduce((s, r) => s + r.landedUnit * (Number(r.cantidad) || 0), 0);
  const utilidadTotal = conPrecioArr.reduce((s, r) => s + (r.utilidadTotal ?? 0), 0);

  // Ajuste ponderado: cuánto habría que subir la venta total para llegar al
  // objetivo sobre ESTE costo. Si ya se está por encima, null.
  const ventaNecesaria = objetivo < 1 ? costoTotal / (1 - objetivo) : null;
  const ajusteNecesarioPct = ventaNecesaria != null && ventaTotal > 0 && ventaNecesaria > ventaTotal
    ? (ventaNecesaria / ventaTotal - 1) * 100
    : null;

  return {
    refs: out,
    conPrecio: conPrecioArr.length,
    sinPrecio: out.length - conPrecioArr.length,
    margenPonderado: ventaTotal > 0 ? (ventaTotal - costoTotal) / ventaTotal : null,
    utilidadTotal: conPrecioArr.length > 0 ? utilidadTotal : null,
    enRiesgo: out.filter((r) => r.margen != null && r.margen >= 0 && r.margen < MARGEN_RIESGO)
      .sort((a, b) => (a.margen ?? 0) - (b.margen ?? 0)),
    enPerdida: out.filter((r) => r.margen != null && r.margen < 0)
      .sort((a, b) => (a.utilidadTotal ?? 0) - (b.utilidadTotal ?? 0)),
    ajusteNecesarioPct,
  };
}
