/**
 * Sugerencia de referencia correcta ante un posible error de digitación.
 *
 * Caso real (jul 2026): una remisión se despachó con la referencia "B" y otra
 * con la medida escrita distinto; esas filas entraban a la cobertura como
 * faltantes reales. La app ya unifica las diferencias de escritura
 * (canonicalizeRef); esto ataca lo otro: el dedo.
 *
 * Distancia de Levenshtein sobre la forma canónica, con un umbral relativo al
 * largo — así "MN1103" no sugiere cualquier cosa y "38x38-3" sí encuentra
 * "38X38-3". Función pura → testeable.
 */

import { canonicalizeRef } from '@/lib/refFamily';

export interface RefSuggestion {
  /** La referencia del maestro, tal cual está escrita ahí. */
  reference: string;
  /** 0 = idéntica (canónicamente); a mayor número, más lejos. */
  distancia: number;
}

/** Levenshtein clásico, iterativo (O(n·m), refs cortas). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,          // borrado
        curr[j - 1] + 1,      // inserción
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), // sustitución
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Mejores candidatos del maestro para una referencia tecleada.
 *
 * Reglas del umbral (conservadoras: mejor no sugerir que sugerir mal):
 *   · una referencia de 1-2 caracteres ("B") no se parece a nada → sin sugerencia;
 *   · se acepta hasta 1 edición cada 4 caracteres, mínimo 1, máximo 3;
 *   · un candidato que CONTIENE lo tecleado como prefijo entra igual (typos
 *     por referencia incompleta: "DIA09" → "DIA09-2").
 */
export function suggestReferences(
  input: string,
  knownRefs: string[],
  max = 3,
): RefSuggestion[] {
  const q = canonicalizeRef(input);
  if (q.length < 3) return []; // demasiado corta para adivinar sin inventar
  const umbral = Math.min(3, Math.max(1, Math.floor(q.length / 4)));

  const out: RefSuggestion[] = [];
  for (const ref of knownRefs) {
    const c = canonicalizeRef(ref);
    if (!c) continue;
    if (c === q) return [{ reference: ref, distancia: 0 }];
    const d = levenshtein(q, c);
    const esPrefijo = c.startsWith(q) || q.startsWith(c);
    if (d <= umbral || esPrefijo) {
      out.push({ reference: ref, distancia: esPrefijo ? Math.min(d, umbral) : d });
    }
  }
  return out.sort((a, b) => a.distancia - b.distancia || a.reference.localeCompare(b.reference)).slice(0, max);
}
