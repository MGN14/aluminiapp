// Calculadora de la pantalla de cargue: suma, resta, multiplicación y
// división con la precedencia de siempre (× y ÷ antes que + y −). Sin eval:
// la expresión se arma con botones y se evalúa acá.
//
// La expresión se guarda como texto con los símbolos de pantalla:
// dígitos, "," decimal y los operadores + − × ÷.

export const OPERADORES = ['+', '−', '×', '÷'] as const;
export type Operador = (typeof OPERADORES)[number];

const esOperador = (c: string): c is Operador => (OPERADORES as readonly string[]).includes(c);

/** Agrega una tecla a la expresión respetando reglas básicas (sin dos operadores seguidos, una coma por número). */
export function teclear(expr: string, tecla: string): string {
  if (/^\d$/.test(tecla)) {
    const ultimoNumero = expr.split(/[+−×÷]/).pop() ?? '';
    if (ultimoNumero === '0') return expr.slice(0, -1) + tecla;
    if (ultimoNumero.replace(',', '').length >= 12) return expr;
    return expr + tecla;
  }
  if (tecla === ',') {
    const ultimoNumero = expr.split(/[+−×÷]/).pop() ?? '';
    if (ultimoNumero.includes(',')) return expr;
    return expr + (ultimoNumero === '' ? '0,' : ',');
  }
  if (esOperador(tecla)) {
    if (expr === '') return tecla === '−' ? '−' : expr;
    const ultimo = expr[expr.length - 1];
    if (esOperador(ultimo)) return expr.length === 1 ? expr : expr.slice(0, -1) + tecla;
    if (ultimo === ',') return expr.slice(0, -1) + tecla;
    return expr + tecla;
  }
  return expr;
}

export function borrarUltimo(expr: string): string {
  return expr.slice(0, -1);
}

type Token = { tipo: 'num'; valor: number } | { tipo: 'op'; op: Operador };

function tokenizar(expr: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (esOperador(c)) {
      // "−" al comienzo o después de otro operador = signo del número
      const prev = tokens[tokens.length - 1];
      if (c === '−' && (!prev || prev.tipo === 'op')) {
        let j = i + 1;
        while (j < expr.length && /[\d,]/.test(expr[j])) j++;
        if (j === i + 1) return null;
        const n = Number(expr.slice(i + 1, j).replace(',', '.'));
        if (!Number.isFinite(n)) return null;
        tokens.push({ tipo: 'num', valor: -n });
        i = j;
        continue;
      }
      tokens.push({ tipo: 'op', op: c });
      i++;
      continue;
    }
    if (/[\d,]/.test(c)) {
      let j = i;
      while (j < expr.length && /[\d,]/.test(expr[j])) j++;
      const n = Number(expr.slice(i, j).replace(',', '.'));
      if (!Number.isFinite(n)) return null;
      tokens.push({ tipo: 'num', valor: n });
      i = j;
      continue;
    }
    return null;
  }
  return tokens;
}

/**
 * Evalúa la expresión. Si termina en operador lo ignora (muestra el resultado
 * parcial mientras se escribe). Devuelve null si no hay nada que calcular o
 * si hay una división por cero.
 */
export function evaluar(expr: string): number | null {
  let e = expr.trim();
  while (e && (esOperador(e[e.length - 1]) || e.endsWith(','))) e = e.slice(0, -1);
  if (!e) return null;
  const tokens = tokenizar(e);
  if (!tokens || tokens.length === 0) return null;

  // Primera pasada: × y ÷.
  const pila: (number | Operador)[] = [];
  let i = 0;
  const primero = tokens[0];
  if (primero.tipo !== 'num') return null;
  let acum = primero.valor;
  i = 1;
  while (i < tokens.length) {
    const op = tokens[i];
    const sig = tokens[i + 1];
    if (op.tipo !== 'op' || !sig || sig.tipo !== 'num') return null;
    if (op.op === '×') acum *= sig.valor;
    else if (op.op === '÷') {
      if (sig.valor === 0) return null;
      acum /= sig.valor;
    } else {
      pila.push(acum, op.op);
      acum = sig.valor;
    }
    i += 2;
  }
  pila.push(acum);

  // Segunda pasada: + y −.
  let total = pila[0] as number;
  for (let k = 1; k < pila.length; k += 2) {
    const op = pila[k] as Operador;
    const n = pila[k + 1] as number;
    total = op === '+' ? total + n : total - n;
  }
  // Quitar ruido de coma flotante (0,1 + 0,2).
  return Math.round(total * 1e9) / 1e9;
}

/** Número para la pantalla: miles con punto y decimales con coma (es-CO). */
export function mostrar(n: number | null): string {
  if (n == null) return '';
  return n.toLocaleString('es-CO', { maximumFractionDigits: 6 });
}

/** El resultado como nueva expresión (para seguir calculando sobre él). */
export function resultadoComoExpresion(n: number): string {
  const s = String(n).replace('.', ',');
  return s.startsWith('-') ? '−' + s.slice(1) : s;
}
