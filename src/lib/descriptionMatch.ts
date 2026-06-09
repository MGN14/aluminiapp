// Normalización de descripciones bancarias para AGRUPAR las que son "la misma"
// aunque difieran en puntuación, espacios, acentos o mayúsculas.
//
// Ej: "PAGO PSE COMPENSAR-OI" y "PAGO PSE COMPENSAR OI" → misma clave
//     "pago pse compensar oi". "COMPRA INTL Spotify  " (espacio extra) idem.
//
// Conservador a propósito ("de la manera más acertada"): NO usa fuzzy/Levenshtein
// — eso arriesga fusionar comercios distintos (Spotify vs Netflix). Solo colapsa
// diferencias de formato, que es donde están los duplicados reales.

export function normalizeDesc(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[^a-z0-9]+/g, ' ')                        // puntuación/símbolos → espacio
    .replace(/\s+/g, ' ')                               // colapsa espacios
    .trim();
}

// ¿El monto es "ruido"? (no numérico, o redondea a 0 → "$0"/"-$0"). Regla para
// ocultar líneas como ajustes de interés de centavos o "FIN ESTADO CUENTA".
export function isNoiseAmount(amount: unknown): boolean {
  const a = Number(amount);
  return !Number.isFinite(a) || Math.round(a) === 0;
}
