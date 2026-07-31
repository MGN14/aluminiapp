/**
 * Cuentas de Caja Menor.
 *
 * Caja Menor arrancó siendo una sola bolsa de plata física. Nico sumó Nequi
 * (jul 2026) porque parte de los pagos del día salen de ahí y no había forma
 * de saber cuánto debería quedar en esa cuenta.
 *
 * Cada cuenta cuadra POR SEPARADO en el cierre: el efectivo se cuenta con la
 * mano, el Nequi se mira en la app del banco. Sumarlas daría un número que no
 * se puede verificar contra nada.
 *
 * Agregar una cuenta = una entrada más acá. No hace falta migración: la
 * columna `cuenta` es texto libre y el desglose del cierre es jsonb.
 */

export interface PettyCashAccount {
  id: string;
  label: string;
  /** Cómo se verifica el saldo al cerrar — se muestra en el modal de cierre. */
  comoSeVerifica: string;
}

export const PETTY_CASH_ACCOUNTS: PettyCashAccount[] = [
  {
    id: 'efectivo',
    label: 'Efectivo',
    comoSeVerifica: 'Contá los billetes que hay en la caja',
  },
  {
    id: 'nequi',
    label: 'Nequi',
    comoSeVerifica: 'Mirá el saldo en la app de Nequi',
  },
];

export const DEFAULT_ACCOUNT = 'efectivo';

export function accountLabel(id: string | null | undefined): string {
  if (!id) return PETTY_CASH_ACCOUNTS[0].label;
  return PETTY_CASH_ACCOUNTS.find((a) => a.id === id)?.label ?? id;
}

export function accountById(id: string | null | undefined): PettyCashAccount | null {
  if (!id) return null;
  return PETTY_CASH_ACCOUNTS.find((a) => a.id === id) ?? null;
}

/**
 * Cuentas a mostrar: las conocidas + cualquier otra que ya exista en los
 * datos. Si mañana alguien inserta 'daviplata' por fuera, no desaparece de la
 * pantalla — aparece con su id como etiqueta.
 */
export function accountsPresentes(cuentasEnDatos: Iterable<string>): PettyCashAccount[] {
  const extra: PettyCashAccount[] = [];
  const conocidas = new Set(PETTY_CASH_ACCOUNTS.map((a) => a.id));
  for (const c of cuentasEnDatos) {
    if (c && !conocidas.has(c) && !extra.some((e) => e.id === c)) {
      extra.push({ id: c, label: c, comoSeVerifica: 'Verificá el saldo de esta cuenta' });
    }
  }
  return [...PETTY_CASH_ACCOUNTS, ...extra];
}
