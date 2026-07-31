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
/**
 * Parte una referencia en prefijo de letras + el número que la identifica.
 * "mn91-3" → { letras: 'mn', numero: '91' } · "mgn91-5" → { 'mgn', '91' }.
 * El sufijo de color (-0/-2/-3/-5) no entra: es la misma pieza en otro color.
 */
function partirRef(canon: string): { letras: string; numero: string } | null {
  const sinColor = canon.replace(/-(0|2|3|5)$/, '');
  const m = /^([a-z]+)-?(\d[\d\w]*)$/.exec(sinColor);
  if (!m) return null;
  return { letras: m[1], numero: m[2] };
}

/**
 * Misma pieza escrita con otro prefijo de letras.
 *
 * Caso real (jul 2026): Lina despachó "MN91-3" y el maestro tiene "MGN91-5"
 * (Riel Closet). Bodega escribe MN, Siigo escribe MGN — la misma convención
 * que ya está documentada en la migración de product_aliases (MN1103 → MGN1103-5).
 * Para Levenshtein son 2 ediciones sobre 5 caracteres, o sea afuera del umbral,
 * y la referencia salía como "sin parecido en el maestro" aunque existiera.
 *
 * La regla es deliberadamente estrecha: el NÚMERO tiene que ser idéntico y las
 * letras diferir en una sola edición. Así "MN91" encuentra "MGN91" pero NO
 * "MN-92" (Riel Dukasia), que es un producto distinto.
 */
function mismaPiezaOtroPrefijo(q: string, c: string): boolean {
  const a = partirRef(q);
  const b = partirRef(c);
  if (!a || !b) return false;
  if (a.numero !== b.numero) return false;
  if (a.letras === b.letras) return false;
  return levenshtein(a.letras, b.letras) <= 1;
}

/** Idénticas salvo el sufijo de color: "MGN91" vs "MGN91-5" es la MISMA ref. */
function mismaFamilia(q: string, c: string): boolean {
  const a = partirRef(q);
  const b = partirRef(c);
  if (!a || !b) return false;
  return a.numero === b.numero && a.letras === b.letras;
}

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
    // Orden de confianza: misma familia (solo cambia el color) > mismo número
    // con otra convención de prefijo > parecido de letras suelto. Sin esto,
    // "MGN91" prefería "MN91-5" antes que "MGN91-5", que es la misma pieza.
    if (mismaFamilia(q, c)) {
      out.push({ reference: ref, distancia: 0.2 });
      continue;
    }
    if (mismaPiezaOtroPrefijo(q, c)) {
      out.push({ reference: ref, distancia: 0.5 });
      continue;
    }
    if (d <= umbral || esPrefijo) {
      out.push({ reference: ref, distancia: esPrefijo ? Math.min(d, umbral) : d });
    }
  }
  return out.sort((a, b) => a.distancia - b.distancia || a.reference.localeCompare(b.reference)).slice(0, max);
}
