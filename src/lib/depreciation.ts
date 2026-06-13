/**
 * Depreciación lineal de activos fijos (PP&E) para PYME colombiana.
 *
 * Línea recta: el costo depreciable (valor de compra − valor residual) se
 * reparte parejo a lo largo de la vida útil. El valor en libros = costo −
 * depreciación acumulada, con piso en el valor residual.
 *
 * Vidas útiles por defecto según el Art. 137 ET (editable por activo).
 * Función pura → testeable.
 */

export type AssetCategory = 'edificaciones' | 'maquinaria' | 'vehiculos' | 'equipo_computo' | 'muebles' | 'otro';

export const CATEGORY_LABEL: Record<AssetCategory, string> = {
  edificaciones: 'Edificaciones y construcciones',
  maquinaria: 'Maquinaria y equipo',
  vehiculos: 'Vehículos / flota de transporte',
  equipo_computo: 'Equipo de cómputo y comunicación',
  muebles: 'Muebles y enseres',
  otro: 'Otro',
};

/** Vida útil por defecto en MESES (Art. 137 ET). */
export const VIDA_UTIL_DEFAULT: Record<AssetCategory, number> = {
  edificaciones: 45 * 12,   // 45 años
  maquinaria: 10 * 12,      // 10 años
  vehiculos: 5 * 12,        // 5 años
  equipo_computo: 5 * 12,   // 5 años
  muebles: 10 * 12,         // 10 años
  otro: 10 * 12,
};

export interface FixedAssetInput {
  valor_compra: number;
  fecha_compra: string;       // YYYY-MM-DD
  vida_util_meses: number;
  valor_residual: number;
}

export interface DepreciationResult {
  mesesTranscurridos: number;   // capado a la vida útil
  depreciableBase: number;      // valor_compra − valor_residual
  depMensual: number;
  depAcumulada: number;
  valorEnLibros: number;        // costo − dep acumulada (piso = residual)
  depAnioActual: number;        // depreciación que cae dentro del año de `asOf`
  totalmenteDepreciado: boolean;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Meses enteros entre dos fechas (a partir del mes de compra). */
function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

export function computeDepreciation(asset: FixedAssetInput, asOf: Date = new Date()): DepreciationResult {
  const costo = num(asset.valor_compra);
  const residual = Math.min(num(asset.valor_residual), costo);
  const vida = Math.max(1, Math.floor(num(asset.vida_util_meses)));
  const depreciableBase = Math.max(0, costo - residual);
  const depMensual = depreciableBase / vida;

  const compra = asset.fecha_compra ? new Date(asset.fecha_compra + 'T00:00:00') : asOf;
  const mesesBrutos = Math.max(0, monthsBetween(compra, asOf));
  const mesesTranscurridos = Math.min(mesesBrutos, vida);

  const depAcumulada = r2(Math.min(depMensual * mesesTranscurridos, depreciableBase));
  const valorEnLibros = r2(costo - depAcumulada);

  // Depreciación del año de asOf: meses depreciados que caen dentro de ese año.
  const inicioAnio = new Date(asOf.getFullYear(), 0, 1);
  const mesesHastaInicioAnio = Math.min(Math.max(0, monthsBetween(compra, inicioAnio)), vida);
  const depAnioActual = r2(depMensual * Math.max(0, mesesTranscurridos - mesesHastaInicioAnio));

  return {
    mesesTranscurridos,
    depreciableBase: r2(depreciableBase),
    depMensual: r2(depMensual),
    depAcumulada,
    valorEnLibros,
    depAnioActual,
    totalmenteDepreciado: mesesTranscurridos >= vida,
  };
}
