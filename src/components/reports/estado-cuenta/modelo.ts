/**
 * Estado de cuenta de clientes — modelo de la TABLA (pedido de Nico
 * 2026-11-11: "renovación completa, que haya filtros en la tabla").
 *
 * Todo lo de acá es presentación sobre números que YA calculó el motor
 * canónico de cartera (calculateAllClientReceivables + calculateAgingFromClients,
 * vía useCollectionData). No se re-deriva ninguna fórmula de saldo ni de mora:
 *   · saldo / facturado / cobrado → ClientReceivable
 *   · días de mora y edades       → AgingReport del mismo motor (cuadra con
 *                                   Cobranza por construcción)
 * Lo único nuevo es cómo se FILTRA, se ORDENA y se TOTALIZA la vista.
 *
 * Funciones puras → testeables sin base de datos.
 */
import type { ClientReceivable } from '@/lib/clientReceivables';
import type { AgingBuckets } from '@/lib/agingBuckets';

export type EstadoCliente = 'cxc' | 'anticipos' | 'aldia';
export type EstadoFilter = 'todos' | EstadoCliente;

/** Saldos < $1 se consideran al día (residuos por decimales de retención). */
export const EPSILON = 1;

// Corte ESTRICTO (>0 / <0), idéntico al motor y a Cobranza: así la tarjeta, el
// conteo, el filtro y el export cuadran al peso con total_saldo_pendiente /
// total_saldo_a_favor.
export function estadoDe(c: Pick<ClientReceivable, 'saldo_neto'>): EstadoCliente {
  if (c.saldo_neto > 0) return 'cxc';
  if (c.saldo_neto < 0) return 'anticipos';
  return 'aldia';
}

// ── Edades de la cartera (mismos tramos que agingBuckets) ──────────────────
export type TramoMora = Exclude<keyof AgingBuckets, 'total'>;
export const TRAMOS: { key: TramoMora; label: string; corto: string }[] = [
  { key: 'corriente', label: 'Sin vencer', corto: 'Sin vencer' },
  { key: 'd1_30', label: 'Vencida 1 a 30 días', corto: '1-30 d' },
  { key: 'd31_60', label: 'Vencida 31 a 60 días', corto: '31-60 d' },
  { key: 'd61_90', label: 'Vencida 61 a 90 días', corto: '61-90 d' },
  { key: 'd90_plus', label: 'Vencida más de 90 días', corto: '+90 d' },
];

export type MoraFilter = 'todas' | 'vencida' | TramoMora;

// ── Una fila de la tabla ───────────────────────────────────────────────────
export interface FilaEstado {
  client: ClientReceivable;
  estado: EstadoCliente;
  nit: string | null;
  /** Facturado del año + saldo inicial. */
  facturado: number;
  /** Banco + efectivo + anticipos + retenciones: facturado − cobrado = saldo. */
  cobrado: number;
  /** cobrado ÷ facturado, 0..1 (0 si no hay facturado). */
  pctCobrado: number;
  despachado: number;
  /** Despachado − facturado del año, si es > $1 (plata en tránsito sin facturar). */
  sinFacturar: number;
  /** Días de la deuda más vieja según el aging del motor (0 = nada vencido). */
  mora: number;
  /** Edades de su saldo (solo clientes que te deben). */
  tramos: AgingBuckets | null;
  /** Próxima promesa de pago pendiente, si hay. */
  promesa: { amount: number; due_date: string } | null;
}

export function construirFila(p: {
  client: ClientReceivable;
  nit: string | null;
  despachado: number;
  aging?: { buckets: AgingBuckets; oldest_overdue_days: number } | null;
  promesa?: { amount: number; due_date: string } | null;
}): FilaEstado {
  const c = p.client;
  const facturado = c.facturado_venta + c.cxc_inicial;
  const cobrado = c.cobrado_banco + c.cobrado_efectivo + c.anticipos_total + c.retenciones_total;
  const sinFacturar = p.despachado - c.facturado_venta;
  return {
    client: c,
    estado: estadoDe(c),
    nit: p.nit,
    facturado,
    cobrado,
    pctCobrado: facturado > 0 ? Math.min(1, Math.max(0, cobrado / facturado)) : 0,
    despachado: p.despachado,
    sinFacturar: sinFacturar > EPSILON ? sinFacturar : 0,
    mora: p.aging ? Math.max(0, p.aging.oldest_overdue_days) : 0,
    tramos: p.aging?.buckets ?? null,
    promesa: p.promesa ?? null,
  };
}

// ── Filtros ────────────────────────────────────────────────────────────────
export interface FiltrosTabla {
  q: string;
  estado: EstadoFilter;
  mora: MoraFilter;
  /** Saldo (en valor absoluto) desde este monto. 0 = sin mínimo. */
  saldoMin: number;
  soloSinFacturar: boolean;
  soloSinNit: boolean;
  soloConPromesa: boolean;
}

export const FILTROS_DEFAULT: FiltrosTabla = {
  q: '', estado: 'todos', mora: 'todas', saldoMin: 0,
  soloSinFacturar: false, soloSinNit: false, soloConPromesa: false,
};

/** Cuántos filtros cambian la vista (sin contar el estado: tiene su propio selector). */
export function contarFiltrosActivos(f: FiltrosTabla): number {
  return [
    f.q.trim() !== '', f.mora !== 'todas', f.saldoMin > 0,
    f.soloSinFacturar, f.soloSinNit, f.soloConPromesa,
  ].filter(Boolean).length;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function cumpleMora(fila: FilaEstado, mora: MoraFilter): boolean {
  if (mora === 'todas') return true;
  if (mora === 'vencida') return fila.mora > 0;
  return (fila.tramos?.[mora] ?? 0) > EPSILON;
}

/** Todos los filtros MENOS el de estado (para que los conteos del selector de
 *  estado reflejen lo que se vería al elegir cada uno). */
export function aplicarFiltrosSinEstado(filas: FilaEstado[], f: FiltrosTabla): FilaEstado[] {
  const q = norm(f.q.trim());
  const qDigitos = f.q.replace(/[^0-9]/g, '');
  return filas.filter((r) => {
    if (q && !(norm(r.client.client_name).includes(q) || (qDigitos.length >= 3 && (r.nit ?? '').replace(/[^0-9]/g, '').includes(qDigitos)))) return false;
    if (!cumpleMora(r, f.mora)) return false;
    if (f.saldoMin > 0 && Math.abs(r.client.saldo_neto) < f.saldoMin) return false;
    if (f.soloSinFacturar && r.sinFacturar <= 0) return false;
    if (f.soloSinNit && r.nit) return false;
    if (f.soloConPromesa && !r.promesa) return false;
    return true;
  });
}

export function aplicarFiltros(filas: FilaEstado[], f: FiltrosTabla): FilaEstado[] {
  const base = aplicarFiltrosSinEstado(filas, f);
  return f.estado === 'todos' ? base : base.filter((r) => r.estado === f.estado);
}

// ── Orden ──────────────────────────────────────────────────────────────────
export type SortKey = 'cliente' | 'despachado' | 'facturado' | 'cobrado' | 'saldo' | 'mora';
export interface Orden { key: SortKey; dir: 'asc' | 'desc' }

/**
 * Sin orden elegido: el de siempre — a favor más grande primero en
 * Anticipos, mayor facturado en Al día, y en el resto el saldo más grande en
 * valor absoluto. Con orden elegido: por esa columna (desempate por nombre).
 */
export function ordenarFilas(filas: FilaEstado[], orden: Orden | null, estado: EstadoFilter): FilaEstado[] {
  const out = [...filas];
  if (!orden) {
    if (estado === 'anticipos') out.sort((a, b) => a.client.saldo_neto - b.client.saldo_neto);
    else if (estado === 'aldia') out.sort((a, b) => b.client.facturado_venta - a.client.facturado_venta);
    else out.sort((a, b) => Math.abs(b.client.saldo_neto) - Math.abs(a.client.saldo_neto));
    return out;
  }
  const val = (r: FilaEstado): number | string => {
    switch (orden.key) {
      case 'cliente': return norm(r.client.client_name);
      case 'despachado': return r.despachado;
      case 'facturado': return r.facturado;
      case 'cobrado': return r.cobrado;
      case 'saldo': return r.client.saldo_neto;
      case 'mora': return r.mora;
    }
  };
  const sign = orden.dir === 'asc' ? 1 : -1;
  out.sort((a, b) => {
    const va = val(a); const vb = val(b);
    const c = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return c !== 0 ? sign * c : a.client.client_name.localeCompare(b.client.client_name);
  });
  return out;
}

/** Clic en un encabezado: primero el sentido natural, después el otro, después sin orden. */
export function siguienteOrden(actual: Orden | null, key: SortKey): Orden | null {
  const natural: Orden['dir'] = key === 'cliente' ? 'asc' : 'desc';
  if (!actual || actual.key !== key) return { key, dir: natural };
  if (actual.dir === natural) return { key, dir: natural === 'asc' ? 'desc' : 'asc' };
  return null;
}

// ── Totales de lo que se ve ────────────────────────────────────────────────
export interface TotalesTabla {
  clientes: number;
  despachado: number;
  facturado: number;
  cobrado: number;
  /** Suma de saldos positivos (te deben) y de los negativos en valor absoluto (a favor). */
  teDeben: number;
  aFavor: number;
  neto: number;
}

export function totalesDe(filas: FilaEstado[]): TotalesTabla {
  const t: TotalesTabla = { clientes: filas.length, despachado: 0, facturado: 0, cobrado: 0, teDeben: 0, aFavor: 0, neto: 0 };
  for (const r of filas) {
    t.despachado += r.despachado;
    t.facturado += r.facturado;
    t.cobrado += r.cobrado;
    const s = r.client.saldo_neto;
    if (s > 0) t.teDeben += s; else if (s < 0) t.aFavor += -s;
    t.neto += s;
  }
  return t;
}

// ── Formato ────────────────────────────────────────────────────────────────
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Math.round(value));
}

/** $12,4 M · $850 mil · $9.500 — para cifras dentro de barras y chips. */
export function formatCompacto(value: number): string {
  const a = Math.abs(value);
  const s = value < 0 ? '-' : '';
  if (a >= 1_000_000_000) return `${s}$${(a / 1_000_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} mil M`;
  if (a >= 1_000_000) return `${s}$${(a / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
  if (a >= 10_000) return `${s}$${Math.round(a / 1000).toLocaleString('es-CO')} mil`;
  return `${s}$${Math.round(a).toLocaleString('es-CO')}`;
}

/** Iniciales para el avatar: "Vidrios y Aluminios Castaño" → "VA". */
export function iniciales(nombre: string): string {
  const palabras = nombre
    .replace(/\b(s\.?a\.?s\.?|ltda\.?|s\.?a\.?)\b/gi, '')
    .split(/\s+/)
    .filter((p) => /^\p{L}/u.test(p) && !/^(y|e|de|del|la|el|los|las)$/i.test(p));
  const letras = palabras.slice(0, 2).map((p) => p[0]).join('');
  return (letras || nombre.slice(0, 2)).toUpperCase();
}
