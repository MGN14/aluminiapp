/**
 * FICHA 360° DE UN TERCERO — el agregador del módulo Terceros.
 *
 * Nico (2026-08-06): compró un seguro, vio un beneficiario "Seguros no sé
 * qué" y no pudo averiguar quién era. La app ya sabe muchísimo de cada
 * tercero pero está repartido en 10 módulos; acá se junta todo.
 *
 * `responsibles` es la tabla única de terceros. El ROL (cliente, proveedor,
 * empleado, entidad) NO se digita: se DERIVA de lo que el tercero hizo — así
 * no hay nada que mantener a mano y nunca queda desactualizado.
 *
 * Las funciones de cálculo son puras (testeables); el fetch va aparte.
 */

import { supabase } from '@/integrations/supabase/client';
import { normalizeForMatch } from '@/lib/stringUtils';

const db = supabase as never as { from: (t: string) => any };

// ── Tipos ───────────────────────────────────────────────────────────────────

export interface Tercero {
  id: string;
  name: string;
  active: boolean;
  nit: string | null;
  dv: number | null;
  razon_social: string | null;
  tipo_documento: string | null;
  tipo_persona: string | null;
  regimen: string | null;
  actividad_economica: string | null;
  ciudad: string | null;
  telefono: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notas: string | null;
  dias_credito: number | null;
  cupo_credito: number | null;
  responsible_type: string | null;
  created_at: string;
}

export interface TxLite {
  id: string; date: string; description: string | null; amount: number | null;
  type: string | null; category_id: string | null; responsible_id: string | null;
}
export interface InvoiceLite {
  id: string; invoice_number: string; type: string; issue_date: string;
  total_amount: number; balance_pending: number | null; responsible_id: string | null;
  counterparty_name: string | null; status: string | null;
}
export interface InvoiceItemLite {
  invoice_id: string; reference: string | null; description: string | null;
  quantity: number; line_total: number;
}
export interface RemisionLite {
  id: string; number: string; date: string; remision_type: string;
  status: string | null; responsible_id: string | null; total_manual: number | null;
}
export interface RemisionItemLite {
  remision_id: string; reference: string; units: number; total_cost: number;
}

export type RolTercero = 'cliente' | 'proveedor' | 'empleado' | 'entidad';

export interface TerceroProfile {
  tercero: Tercero;
  roles: RolTercero[];
  alias: string[];
  /** Facturado como cliente (ventas) y como proveedor (compras). */
  totalVentas: number;
  totalCompras: number;
  /** Saldo pendiente de sus facturas de venta (balance_pending de Siigo). */
  pendienteCobrar: number;
  /** Saldo pendiente de sus facturas de compra. */
  pendientePagar: number;
  /** Neto movido por banco: ingresos − egresos. */
  netoBancario: number;
  movimientos: TxLite[];
  facturasVenta: InvoiceLite[];
  facturasCompra: InvoiceLite[];
  remisiones: RemisionLite[];
  /** Ranking de referencias: qué es lo que más compra/despacha. */
  topReferencias: RankingRef[];
  /** Actividad por mes (para la evolución del resumen). */
  porMes: { mes: string; ventas: number; compras: number; banco: number }[];
  ultimaActividad: string | null;
  totalDocumentos: number;
}

export interface RankingRef {
  reference: string;
  descripcion: string | null;
  unidades: number;
  importe: number;
  /** De cuántos documentos distintos salió. */
  documentos: number;
}

// ── Derivación de rol ───────────────────────────────────────────────────────

/** Nombres de entidades que no son ni cliente ni proveedor comercial. */
const ENTIDAD_RE = /\b(dian|banco|bancolombia|davivienda|nequi|daviplata|gobierno|camara de comercio|secretaria|alcaldia|tesoreria)\b/;

/**
 * Un tercero es lo que HIZO, no lo que alguien tildó en un formulario.
 * Puede tener varios roles a la vez (un proveedor que además te compra).
 */
export function derivarRoles(input: {
  nombre: string;
  facturasVenta: number;
  facturasCompra: number;
  remisionesVenta: number;
  remisionesCompra: number;
  cotizaciones: number;
  movimientosCajaMenor: number;
  categoriasNombres: string[];   // categorías de sus transacciones bancarias
}): RolTercero[] {
  const roles: RolTercero[] = [];
  if (input.facturasVenta > 0 || input.remisionesVenta > 0 || input.cotizaciones > 0) roles.push('cliente');
  if (input.facturasCompra > 0 || input.remisionesCompra > 0) roles.push('proveedor');

  const cats = input.categoriasNombres.map((c) => normalizeForMatch(c));
  if (input.movimientosCajaMenor > 0 || cats.some((c) => c.includes('nomina'))) roles.push('empleado');

  const esEntidad = ENTIDAD_RE.test(normalizeForMatch(input.nombre))
    || cats.some((c) => c.includes('impuesto'));
  if (esEntidad && !roles.length) roles.push('entidad');
  // Una entidad puede además ser proveedor (el banco te cobra comisiones):
  // se agrega sin desplazar a los demás.
  if (esEntidad && !roles.includes('entidad')) roles.push('entidad');

  return roles;
}

// ── Ranking de referencias ──────────────────────────────────────────────────

/**
 * "Qué es lo que más compra": cruza las líneas de factura con las de
 * remisión. Las referencias se agrupan por forma normalizada para que
 * "LIV-40" y "liv 40" no salgan dos veces.
 */
export function rankearReferencias(
  invoiceItems: InvoiceItemLite[],
  remisionItems: RemisionItemLite[],
  limit = 25,
): RankingRef[] {
  const acc = new Map<string, RankingRef & { docs: Set<string> }>();
  const push = (rawRef: string | null, desc: string | null, unidades: number, importe: number, docId: string) => {
    const ref = (rawRef ?? '').trim();
    if (!ref) return;
    const key = normalizeForMatch(ref);
    const a = acc.get(key) ?? { reference: ref.toUpperCase(), descripcion: desc, unidades: 0, importe: 0, documentos: 0, docs: new Set<string>() };
    a.unidades += unidades;
    a.importe += importe;
    a.docs.add(docId);
    if (!a.descripcion && desc) a.descripcion = desc;
    acc.set(key, a);
  };

  for (const it of invoiceItems) {
    push(it.reference, it.description, Number(it.quantity ?? 0), Number(it.line_total ?? 0), it.invoice_id);
  }
  for (const it of remisionItems) {
    push(it.reference, null, Number(it.units ?? 0), Number(it.total_cost ?? 0), it.remision_id);
  }

  return [...acc.values()]
    .map(({ docs, ...r }) => ({ ...r, documentos: docs.size }))
    .sort((a, b) => b.importe - a.importe || b.unidades - a.unidades)
    .slice(0, limit);
}

// ── Actividad mensual ───────────────────────────────────────────────────────

export function actividadPorMes(
  facturasVenta: InvoiceLite[],
  facturasCompra: InvoiceLite[],
  movimientos: TxLite[],
): TerceroProfile['porMes'] {
  const acc = new Map<string, { ventas: number; compras: number; banco: number }>();
  const bump = (fecha: string, campo: 'ventas' | 'compras' | 'banco', valor: number) => {
    const mes = (fecha ?? '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mes)) return;
    const a = acc.get(mes) ?? { ventas: 0, compras: 0, banco: 0 };
    a[campo] += valor;
    acc.set(mes, a);
  };
  for (const f of facturasVenta) bump(f.issue_date, 'ventas', Number(f.total_amount ?? 0));
  for (const f of facturasCompra) bump(f.issue_date, 'compras', Number(f.total_amount ?? 0));
  for (const t of movimientos) bump(t.date, 'banco', Number(t.amount ?? 0));
  return [...acc.entries()]
    .map(([mes, v]) => ({ mes, ...v }))
    .sort((a, b) => a.mes.localeCompare(b.mes));
}

// ── Armado del perfil (puro) ────────────────────────────────────────────────

export interface RawTerceroData {
  tercero: Tercero;
  alias: string[];
  movimientos: TxLite[];
  facturas: InvoiceLite[];
  invoiceItems: InvoiceItemLite[];
  remisiones: RemisionLite[];
  remisionItems: RemisionItemLite[];
  cotizaciones: number;
  movimientosCajaMenor: number;
  categoriasNombres: string[];
}

export function construirPerfil(raw: RawTerceroData): TerceroProfile {
  const facturasVenta = raw.facturas.filter((f) => f.type === 'venta');
  const facturasCompra = raw.facturas.filter((f) => f.type === 'compra');
  const remisionesVenta = raw.remisiones.filter((r) => r.remision_type === 'venta');
  const remisionesCompra = raw.remisiones.filter((r) => r.remision_type === 'compra');

  const suma = (arr: InvoiceLite[], campo: 'total_amount' | 'balance_pending') =>
    arr.reduce((s, f) => s + Number(f[campo] ?? 0), 0);

  const fechas = [
    ...raw.movimientos.map((m) => m.date),
    ...raw.facturas.map((f) => f.issue_date),
    ...raw.remisiones.map((r) => r.date),
  ].filter(Boolean).sort();

  return {
    tercero: raw.tercero,
    roles: derivarRoles({
      nombre: raw.tercero.name,
      facturasVenta: facturasVenta.length,
      facturasCompra: facturasCompra.length,
      remisionesVenta: remisionesVenta.length,
      remisionesCompra: remisionesCompra.length,
      cotizaciones: raw.cotizaciones,
      movimientosCajaMenor: raw.movimientosCajaMenor,
      categoriasNombres: raw.categoriasNombres,
    }),
    alias: raw.alias,
    totalVentas: suma(facturasVenta, 'total_amount'),
    totalCompras: suma(facturasCompra, 'total_amount'),
    pendienteCobrar: suma(facturasVenta, 'balance_pending'),
    pendientePagar: suma(facturasCompra, 'balance_pending'),
    netoBancario: raw.movimientos.reduce((s, m) => s + Number(m.amount ?? 0), 0),
    movimientos: [...raw.movimientos].sort((a, b) => b.date.localeCompare(a.date)),
    facturasVenta: [...facturasVenta].sort((a, b) => b.issue_date.localeCompare(a.issue_date)),
    facturasCompra: [...facturasCompra].sort((a, b) => b.issue_date.localeCompare(a.issue_date)),
    remisiones: [...raw.remisiones].sort((a, b) => b.date.localeCompare(a.date)),
    topReferencias: rankearReferencias(raw.invoiceItems, raw.remisionItems),
    porMes: actividadPorMes(facturasVenta, facturasCompra, raw.movimientos),
    ultimaActividad: fechas.length ? fechas[fechas.length - 1] : null,
    totalDocumentos: raw.facturas.length + raw.remisiones.length + raw.cotizaciones,
  };
}

// ── Fetch ───────────────────────────────────────────────────────────────────

const CAMPOS_TERCERO =
  'id, name, active, nit, dv, razon_social, tipo_documento, tipo_persona, regimen, ' +
  'actividad_economica, ciudad, telefono, email, phone, address, notas, dias_credito, ' +
  'cupo_credito, responsible_type, created_at';
/** Sin las columnas de la migración nueva (fallback si no está aplicada). */
const CAMPOS_TERCERO_BASE =
  'id, name, active, nit, tipo_documento, tipo_persona, ciudad, telefono, email, ' +
  'phone, address, responsible_type, created_at';

const completar = (t: Record<string, unknown>): Tercero => ({
  dv: null, razon_social: null, regimen: null, actividad_economica: null,
  notas: null, dias_credito: null, cupo_credito: null,
  ...t,
} as Tercero);

/** Todos los terceros para el listado (tolera la migración sin aplicar). */
export async function fetchTerceros(): Promise<Tercero[]> {
  let res = await db.from('responsibles').select(CAMPOS_TERCERO).order('name');
  if (res.error) res = await db.from('responsibles').select(CAMPOS_TERCERO_BASE).order('name');
  if (res.error) throw res.error;
  return ((res.data ?? []) as Record<string, unknown>[]).map(completar);
}

export interface ResumenTercero {
  id: string;
  movimientos: number;
  facturas: number;
  pendienteCobrar: number;
  ultimaActividad: string | null;
  roles: RolTercero[];
}

/**
 * Resumen liviano de TODOS los terceros para el listado — una pasada por
 * tabla en vez de N consultas por fila.
 */
export async function fetchResumenTerceros(terceros: Tercero[]): Promise<Map<string, ResumenTercero>> {
  const [txsRes, invRes, remRes, catsRes, pettyRes, quotesRes] = await Promise.all([
    db.from('transactions').select('responsible_id, date, amount, category_id').is('deleted_at', null),
    db.from('invoices').select('responsible_id, type, issue_date, total_amount, balance_pending'),
    db.from('remisiones').select('responsible_id, date, remision_type'),
    db.from('categories').select('id, name'),
    db.from('petty_cash_movements').select('responsible_id'),
    db.from('quotations').select('responsible_id'),
  ]);

  const catName = new Map(((catsRes.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const acc = new Map<string, ResumenTercero & { cats: Set<string>; fv: number; fc: number; rv: number; rc: number; cot: number; petty: number }>();
  const get = (id: string | null) => {
    if (!id) return null;
    const a = acc.get(id) ?? {
      id, movimientos: 0, facturas: 0, pendienteCobrar: 0, ultimaActividad: null, roles: [],
      cats: new Set<string>(), fv: 0, fc: 0, rv: 0, rc: 0, cot: 0, petty: 0,
    };
    acc.set(id, a);
    return a;
  };
  const marcarFecha = (a: { ultimaActividad: string | null }, fecha: string | null) => {
    if (fecha && (!a.ultimaActividad || fecha > a.ultimaActividad)) a.ultimaActividad = fecha;
  };

  for (const t of ((txsRes.data ?? []) as { responsible_id: string | null; date: string; category_id: string | null }[])) {
    const a = get(t.responsible_id); if (!a) continue;
    a.movimientos++;
    marcarFecha(a, t.date);
    if (t.category_id) { const n = catName.get(t.category_id); if (n) a.cats.add(n); }
  }
  for (const f of ((invRes.data ?? []) as { responsible_id: string | null; type: string; issue_date: string; balance_pending: number | null }[])) {
    const a = get(f.responsible_id); if (!a) continue;
    a.facturas++;
    marcarFecha(a, f.issue_date);
    if (f.type === 'venta') { a.fv++; a.pendienteCobrar += Number(f.balance_pending ?? 0); } else a.fc++;
  }
  for (const r of ((remRes.data ?? []) as { responsible_id: string | null; date: string; remision_type: string }[])) {
    const a = get(r.responsible_id); if (!a) continue;
    marcarFecha(a, r.date);
    if (r.remision_type === 'compra') a.rc++; else a.rv++;
  }
  for (const p of ((pettyRes.data ?? []) as { responsible_id: string | null }[])) {
    const a = get(p.responsible_id); if (a) a.petty++;
  }
  for (const q of ((quotesRes.data ?? []) as { responsible_id: string | null }[])) {
    const a = get(q.responsible_id); if (a) a.cot++;
  }

  const out = new Map<string, ResumenTercero>();
  for (const t of terceros) {
    const a = acc.get(t.id);
    out.set(t.id, a
      ? {
        id: t.id, movimientos: a.movimientos, facturas: a.facturas,
        pendienteCobrar: a.pendienteCobrar, ultimaActividad: a.ultimaActividad,
        roles: derivarRoles({
          nombre: t.name, facturasVenta: a.fv, facturasCompra: a.fc,
          remisionesVenta: a.rv, remisionesCompra: a.rc, cotizaciones: a.cot,
          movimientosCajaMenor: a.petty, categoriasNombres: [...a.cats],
        }),
      }
      : {
        id: t.id, movimientos: 0, facturas: 0, pendienteCobrar: 0, ultimaActividad: null,
        roles: derivarRoles({
          nombre: t.name, facturasVenta: 0, facturasCompra: 0, remisionesVenta: 0,
          remisionesCompra: 0, cotizaciones: 0, movimientosCajaMenor: 0, categoriasNombres: [],
        }),
      });
  }
  return out;
}

/** Todo lo que la app sabe de UN tercero. */
export async function fetchTerceroProfile(id: string): Promise<TerceroProfile> {
  let tRes = await db.from('responsibles').select(CAMPOS_TERCERO).eq('id', id).limit(1);
  if (tRes.error) tRes = await db.from('responsibles').select(CAMPOS_TERCERO_BASE).eq('id', id).limit(1);
  if (tRes.error) throw tRes.error;
  const fila = ((tRes.data ?? []) as Record<string, unknown>[])[0];
  if (!fila) throw new Error('Tercero no encontrado.');
  const tercero = completar(fila);

  const [aliasRes, txsRes, invRes, remRes, catsRes, pettyRes, quotesRes] = await Promise.all([
    db.from('responsible_aliases').select('alias').eq('responsible_id', id),
    db.from('transactions')
      .select('id, date, description, amount, type, category_id, responsible_id')
      .eq('responsible_id', id).is('deleted_at', null).order('date', { ascending: false }),
    db.from('invoices')
      .select('id, invoice_number, type, issue_date, total_amount, balance_pending, responsible_id, counterparty_name, status')
      .eq('responsible_id', id),
    db.from('remisiones')
      .select('id, number, date, remision_type, status, responsible_id, total_manual')
      .eq('responsible_id', id),
    db.from('categories').select('id, name'),
    db.from('petty_cash_movements').select('id').eq('responsible_id', id),
    db.from('quotations').select('id').eq('responsible_id', id),
  ]);

  const facturas = ((invRes.data ?? []) as InvoiceLite[]);
  const remisiones = ((remRes.data ?? []) as RemisionLite[]);

  // Líneas de sus documentos: el "qué compra". Solo si hay documentos.
  const [itemsInvRes, itemsRemRes] = await Promise.all([
    facturas.length
      ? db.from('invoice_items').select('invoice_id, reference, description, quantity, line_total').in('invoice_id', facturas.map((f) => f.id))
      : Promise.resolve({ data: [] }),
    remisiones.length
      ? db.from('remision_items').select('remision_id, reference, units, total_cost').in('remision_id', remisiones.map((r) => r.id))
      : Promise.resolve({ data: [] }),
  ]);

  const catName = new Map(((catsRes.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const movimientos = ((txsRes.data ?? []) as TxLite[]);

  return construirPerfil({
    tercero,
    alias: ((aliasRes.data ?? []) as { alias: string }[]).map((a) => a.alias),
    movimientos,
    facturas,
    invoiceItems: ((itemsInvRes.data ?? []) as InvoiceItemLite[]),
    remisiones,
    remisionItems: ((itemsRemRes.data ?? []) as RemisionItemLite[]),
    cotizaciones: ((quotesRes.data ?? []) as unknown[]).length,
    movimientosCajaMenor: ((pettyRes.data ?? []) as unknown[]).length,
    categoriasNombres: [...new Set(movimientos.map((m) => (m.category_id ? catName.get(m.category_id) : null)).filter(Boolean) as string[])],
  });
}

/** Guarda los datos maestros editados a mano. */
export async function saveTercero(id: string, patch: Partial<Tercero>): Promise<void> {
  const { error } = await db.from('responsibles').update(patch).eq('id', id);
  if (error) throw error;
}
