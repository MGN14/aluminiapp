// Convierte un numero entero positivo a su representacion en letras en espanol
// (variante colombiana). Pensado para "valor en letras" en cuentas de cobro.
// Soporta hasta cientos de millones; suficiente para el caso de uso real.

const UNITS = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
const TEENS = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve'];
const TENS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

function under1000(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cien';

  const c = Math.floor(n / 100);
  const rem = n % 100;
  let out = HUNDREDS[c];

  if (rem === 0) return out.trim();
  if (out) out += ' ';

  if (rem < 10) return (out + UNITS[rem]).trim();
  if (rem < 20) return (out + TEENS[rem - 10]).trim();

  const t = Math.floor(rem / 10);
  const u = rem % 10;
  if (t === 2 && u !== 0) {
    // veintiuno, veintidós, etc.
    const veinti: Record<number, string> = { 1: 'veintiuno', 2: 'veintidós', 3: 'veintitrés', 4: 'veinticuatro', 5: 'veinticinco', 6: 'veintiséis', 7: 'veintisiete', 8: 'veintiocho', 9: 'veintinueve' };
    return (out + veinti[u]).trim();
  }
  out += TENS[t];
  if (u > 0) out += ' y ' + UNITS[u];
  return out.trim();
}

export function numberToSpanishWords(amount: number): string {
  const n = Math.floor(Math.abs(amount));
  if (n === 0) return 'cero pesos';

  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;

  const parts: string[] = [];

  if (millones > 0) {
    if (millones === 1) parts.push('un millón');
    else parts.push(under1000(millones) + ' millones');
  }
  if (miles > 0) {
    if (miles === 1) parts.push('mil');
    else parts.push(under1000(miles) + ' mil');
  }
  if (resto > 0) parts.push(under1000(resto));

  let result = parts.join(' ').trim();
  // En cuentas de cobro: "uno" se usa "un" antes de "peso" (ej. "un peso").
  // Pero al final la palabra termina en "uno", convertimos a "un" si va seguida de pesos.
  if (result.endsWith(' uno')) {
    result = result.slice(0, -4) + ' un';
  } else if (result === 'uno') {
    result = 'un';
  }
  return result + ' pesos';
}
