/**
 * UVT (Unidad de Valor Tributario) — valor oficial publicado anualmente por la
 * DIAN vía resolución de noviembre del año previo, basado en variación del IPC.
 *
 * Histórico:
 *   - UVT 2024: $47.065 (Res 000187 de 2023)
 *   - UVT 2025: $49.799 (Res 000168 de 2024)
 *   - UVT 2026: $52.370 (valor actual del sistema — TODO verificar contra
 *     resolución oficial DIAN publicada en noviembre 2025; el valor real
 *     publicado podría ser $52.846 según estimación de IPC oct-nov 2025)
 *
 * Cuando se confirme el valor oficial 2026, actualizar la constante.
 */
export const UVT_2026 = 52_370;

/** Formatea un múltiplo de UVT como COP. Ejemplo: formatUvt(100) → "$5.237.000". */
export function formatUvtAsCOP(multiplier: number, uvt: number = UVT_2026): string {
  return (multiplier * uvt).toLocaleString('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  });
}
