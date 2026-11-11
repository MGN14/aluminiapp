/**
 * Terceros PARTIDOS: el mismo cliente o proveedor viviendo en dos fichas.
 *
 * Caso real (Nico 2026-11-11: "con la de Polyacril no estaba restando"): la
 * sincronización de facturas creó en mayo un tercero provisional "Cliente NIT
 * 901317432" porque ese día no llegó el nombre. Desde entonces toda factura
 * con ese NIT cae ahí, mientras los pagos se concilian contra "Polyacril"
 * (creado a mano, sin NIT). Dos fichas = dos cuentas corrientes: $22,5 M de
 * pagos de Polyacril vinculados a la FV-2-321 no le bajaban el saldo, porque
 * la cartera reparte los pagos por tercero y la factura era "de otro".
 *
 * Este detector junta la evidencia de que dos fichas son el mismo tercero,
 * de la más dura a la más blanda:
 *   · facturas — las facturas de A están a nombre de alguien que es el nombre
 *                o un alias de B (el caso Polyacril);
 *   · nit      — mismo NIT;
 *   · nombre   — mismo nombre salvo mayúsculas, tildes o "S.A.S";
 *   · parecido — nombres casi iguales (findLikelyDuplicateClients).
 * La unión real la hace el RPC merge_responsibles (reasigna todo y copia el
 * NIT al que queda), así que acá solo se decide QUÉ proponer y cuál conservar.
 *
 * Funciones puras → testeables sin base de datos.
 */

import { normalizeName } from './clientReceivables';
import { findLikelyDuplicateClients } from './duplicateClients';

export interface TerceroParaUnir {
  id: string;
  name: string;
  nit: string | null;
}

export type MotivoPartido = 'facturas' | 'nit' | 'nombre' | 'parecido';

export interface ParPartido {
  /** El que desaparece: queda como alias del otro. */
  absorber: TerceroParaUnir;
  /** El que queda. */
  conservar: TerceroParaUnir;
  motivo: MotivoPartido;
  /** Frase para el usuario: por qué parecen el mismo. */
  detalle: string;
  /** true = evidencia dura; false = solo se parecen (pedir más cuidado). */
  seguro: boolean;
}

/** Ficha provisional creada por la sincronización cuando no llegó el nombre. */
export const esTerceroProvisional = (name: string | null | undefined): boolean =>
  /^\s*(cliente|proveedor)\s+nit\b/i.test(name ?? '');

const soloDigitos = (nit: string | null | undefined) => (nit ?? '').replace(/[^0-9]/g, '');

/** Llave estable de un par, sin importar el orden (para descartar y deduplicar). */
export const llavePar = (a: string, b: string) => [a, b].sort().join('|');

export function detectarTercerosPartidos(input: {
  /** Terceros ACTIVOS. */
  terceros: TerceroParaUnir[];
  aliases: { responsible_id: string; alias: string }[];
  facturas: { responsible_id: string | null; counterparty_name: string | null }[];
  /** Movimientos + facturas por tercero: decide cuál se conserva. */
  actividad?: Map<string, number>;
  max?: number;
}): ParPartido[] {
  const { terceros, aliases, facturas } = input;
  const porId = new Map(terceros.map((t) => [t.id, t]));
  const act = (id: string) => input.actividad?.get(id) ?? 0;

  /** De dos fichas, cuál queda: la que tiene nombre real, después la más usada. */
  const elegir = (a: TerceroParaUnir, b: TerceroParaUnir): [conservar: TerceroParaUnir, absorber: TerceroParaUnir] => {
    const pa = esTerceroProvisional(a.name);
    const pb = esTerceroProvisional(b.name);
    if (pa !== pb) return pa ? [b, a] : [a, b];
    if (act(a.id) !== act(b.id)) return act(a.id) > act(b.id) ? [a, b] : [b, a];
    const na = !!soloDigitos(a.nit);
    const nb = !!soloDigitos(b.nit);
    if (na !== nb) return na ? [a, b] : [b, a];
    return a.id < b.id ? [a, b] : [b, a];
  };

  const vistos = new Set<string>();
  const out: ParPartido[] = [];
  const agregar = (a: TerceroParaUnir, b: TerceroParaUnir, motivo: MotivoPartido, detalle: () => string, seguro: boolean) => {
    if (a.id === b.id) return;
    const k = llavePar(a.id, b.id);
    if (vistos.has(k)) return;
    vistos.add(k);
    const [conservar, absorber] = elegir(a, b);
    out.push({ conservar, absorber, motivo, detalle: detalle(), seguro });
  };

  // ── 1. Facturas a nombre de otro ─────────────────────────────────────────
  // nombre o alias normalizado → dueño. Los provisionales no "son dueños" de
  // un nombre: su único alias es el propio "Cliente NIT …".
  const duenoDe = new Map<string, { id: string; esAlias: boolean }>();
  for (const t of terceros) {
    const n = normalizeName(t.name);
    if (n && !esTerceroProvisional(t.name) && !duenoDe.has(n)) duenoDe.set(n, { id: t.id, esAlias: false });
  }
  for (const a of aliases) {
    const n = normalizeName(a.alias);
    if (n && porId.has(a.responsible_id) && !esTerceroProvisional(a.alias) && !duenoDe.has(n)) {
      duenoDe.set(n, { id: a.responsible_id, esAlias: true });
    }
  }
  for (const f of facturas) {
    if (!f.responsible_id || !f.counterparty_name) continue;
    const de = porId.get(f.responsible_id);
    if (!de) continue;
    const dueno = duenoDe.get(normalizeName(f.counterparty_name));
    if (!dueno || dueno.id === de.id) continue;
    const otro = porId.get(dueno.id)!;
    const nombreFactura = f.counterparty_name.trim();
    // Evidencia dura solo si una de las dos es provisional: entre dos fichas
    // con nombre real puede ser una factura reasignada a propósito.
    const seguro = esTerceroProvisional(de.name) || esTerceroProvisional(otro.name);
    agregar(de, otro, 'facturas',
      () => `las facturas de «${de.name}» están a nombre de ${nombreFactura}, que es ${dueno.esAlias ? 'un alias' : 'el nombre'} de «${otro.name}»`,
      seguro);
  }

  // ── 2. Mismo NIT ──────────────────────────────────────────────────────────
  const porNit = new Map<string, TerceroParaUnir[]>();
  for (const t of terceros) {
    const nit = soloDigitos(t.nit);
    if (nit.length < 6) continue;
    porNit.set(nit, [...(porNit.get(nit) ?? []), t]);
  }
  for (const [nit, grupo] of porNit) {
    for (let i = 1; i < grupo.length; i++) agregar(grupo[0], grupo[i], 'nit', () => `tienen el mismo NIT (${nit})`, true);
  }

  // ── 3. Mismo nombre normalizado ──────────────────────────────────────────
  const porNombre = new Map<string, TerceroParaUnir[]>();
  for (const t of terceros) {
    const n = normalizeName(t.name);
    if (!n) continue;
    porNombre.set(n, [...(porNombre.get(n) ?? []), t]);
  }
  for (const grupo of porNombre.values()) {
    for (let i = 1; i < grupo.length; i++) agregar(grupo[0], grupo[i], 'nombre', () => 'se llaman igual (solo cambian mayúsculas, tildes o la sigla)', true);
  }

  // ── 4. Nombres muy parecidos (el más blando) ─────────────────────────────
  const candidatos = terceros
    .filter((t) => !esTerceroProvisional(t.name))
    .map((t) => ({ client_id: t.id, client_name: t.name }));
  for (const p of findLikelyDuplicateClients(candidatos)) {
    const a = porId.get(p.a.client_id);
    const b = porId.get(p.b.client_id);
    if (a && b) agregar(a, b, 'parecido', () => `sus nombres se parecen un ${Math.round(p.score * 100)} %`, false);
  }

  return out
    .sort((x, y) => Number(y.seguro) - Number(x.seguro))
    .slice(0, input.max ?? 12);
}
