/**
 * APRENDIZAJE DE ALIAS al confirmar un match banco→factura (Fase 3 del
 * motor de ventas, Nico 2026-08-07).
 *
 * Muchos clientes pagan siempre desde la misma cuenta y el banco escribe
 * algo identificable ("PAGO PSE ALUMINIOS JH SAS"). Cuando Nico confirma un
 * match cuya descripción trae un fragmento distintivo que la app aún no
 * conoce, ese fragmento se guarda como alias del cliente
 * (responsible_aliases, source 'auto-detected') — y el scorer SQL lo
 * reconoce la próxima vez (+25 de confianza, señal client_match='alias').
 *
 * Las transferencias genéricas ("TRANSFERENCIA CTA SUC VIRTUAL") no dejan
 * nada aprendible: después de quitar la jerga bancaria no queda fragmento.
 */

import { normalizeForMatch } from '@/lib/stringUtils';

/** Jerga bancaria colombiana que no identifica a nadie. */
const TOKENS_GENERICOS = new Set([
  'transferencia', 'transf', 'transfer', 'trasferencia',
  'cta', 'cuenta', 'suc', 'sucursal', 'virtual',
  'pago', 'pagos', 'abono', 'abonos', 'pse',
  'consignacion', 'deposito', 'recibido', 'recibida',
  'interbancaria', 'interbancario', 'interbanc', 'ach', 'qr',
  'nequi', 'daviplata', 'banco', 'bancolombia', 'davivienda', 'bbva',
  'ahorros', 'ahorro', 'corriente', 'cte',
  'ref', 'referencia', 'nro', 'num', 'no', 'dcto', 'doc',
  'de', 'del', 'la', 'el', 'los', 'las', 'a', 'y', 'en', 'por', 'desde', 'para',
  // Tipos societarios: no identifican por sí solos.
  'sas', 'ltda', 'sa', 'eu', 'sc', 'cia',
]);

/** Tokens con contenido: al menos 2 letras seguidas ("JH" identifica; los
 *  números sueltos son ruido bancario). El peso mínimo del fragmento
 *  completo se valida aparte. */
const esTokenUtil = (t: string) => /[a-zñ]{2,}/.test(t);

const tokenizar = (s: string): string[] =>
  normalizeForMatch(s)
    .replace(/[^a-zñ0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * Extrae el fragmento identificable de una descripción bancaria, o null si
 * no hay nada que aprender:
 *   · sin tokens útiles después de quitar la jerga → null;
 *   · el fragmento ya está contenido en el nombre del cliente o en un alias
 *     conocido (o al revés) → null, no hay información nueva.
 */
export function extraerAliasAprendible(
  descripcion: string | null | undefined,
  nombreCliente: string | null | undefined,
  aliasesExistentes: string[] = [],
): string | null {
  const tokens = tokenizar(descripcion ?? '')
    .filter((t) => !TOKENS_GENERICOS.has(t))
    .filter(esTokenUtil);
  if (!tokens.length) return null;

  const fragmento = tokens.join(' ').slice(0, 60).trim();
  // Peso mínimo: al menos 5 letras en total ("jh" solo no identifica nada).
  const letras = (fragmento.match(/[a-zñ]/g) ?? []).length;
  if (fragmento.length < 4 || letras < 5) return null;

  // ¿Aporta algo nuevo? Si el nombre o un alias ya lo cubren, el scorer ya
  // reconocía a este cliente por nombre — no hay nada que aprender.
  const conocidos = [nombreCliente ?? '', ...aliasesExistentes]
    .map((s) => tokenizar(s).filter((t) => !TOKENS_GENERICOS.has(t)).join(' '))
    .filter((s) => s.length >= 3);
  for (const c of conocidos) {
    if (c.includes(fragmento) || fragmento.includes(c)) return null;
  }
  return fragmento;
}
