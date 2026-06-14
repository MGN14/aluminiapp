// Cierre de Año — cálculo de saldos de cierre SUGERIDOS por la app.
//
// El "sugerido" es la foto del balance al 31-dic del año: la app lo propone,
// el contador carga el "real" al lado y se ve la diferencia. Reusa las mismas
// fuentes que el Balance General (useBalanceSheet) y la cartera
// (clientReceivables) para no inventar números nuevos.
//
// Rubros CON desglose por tercero: cuentas_por_cobrar, anticipos_de_clientes
// (por cliente, vía clientReceivables) y cuentas_por_pagar, anticipos_a_proveedores
// (por proveedor). El resto son totales (caja, inventario, activos fijos,
// créditos, prestaciones, IVA, patrimonio).

import { supabase } from '@/integrations/supabase/client';
import { calculateAllClientReceivables } from '@/lib/clientReceivables';
import { computeDepreciation } from '@/lib/depreciation';

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export type RubroKind = 'activo' | 'pasivo' | 'patrimonio';

export interface YearCloseTercero {
  responsible_id: string | null;
  responsible_name: string;
  suggested: number;
}

export interface YearCloseRubro {
  key: string;
  label: string;
  kind: RubroKind;
  /** rubros operativos NO se sobreescriben en el roll-forward (se arrastran solos). */
  operativo: boolean;
  suggested: number;
  terceros: YearCloseTercero[]; // vacío si el rubro no tiene desglose
}

export interface YearCloseSuggestion {
  fiscalYear: number;
  cutoff: string; // YYYY-12-31
  rubros: YearCloseRubro[];
  totalActivos: number;
  totalPasivos: number;
  patrimonio: number;
}

/** Etiquetas y clasificación de cada rubro del balance. */
const RUBRO_META: Array<{ key: string; label: string; kind: RubroKind; operativo: boolean; hasTercero: boolean }> = [
  { key: 'caja_bancos', label: 'Caja y bancos', kind: 'activo', operativo: false, hasTercero: false },
  { key: 'cuentas_por_cobrar', label: 'Cuentas por cobrar', kind: 'activo', operativo: true, hasTercero: true },
  { key: 'inventario', label: 'Inventario', kind: 'activo', operativo: true, hasTercero: false },
  { key: 'activos_fijos', label: 'Activos fijos (valor en libros)', kind: 'activo', operativo: true, hasTercero: false },
  { key: 'anticipos_a_proveedores', label: 'Anticipos a proveedores', kind: 'activo', operativo: false, hasTercero: true },
  { key: 'iva_a_favor', label: 'IVA a favor', kind: 'activo', operativo: false, hasTercero: false },
  { key: 'cuentas_por_pagar', label: 'Cuentas por pagar', kind: 'pasivo', operativo: true, hasTercero: true },
  { key: 'anticipos_de_clientes', label: 'Anticipos de clientes', kind: 'pasivo', operativo: false, hasTercero: true },
  { key: 'deuda_financiera', label: 'Deuda financiera (créditos)', kind: 'pasivo', operativo: true, hasTercero: false },
  { key: 'prestaciones_por_pagar', label: 'Prestaciones por pagar', kind: 'pasivo', operativo: true, hasTercero: false },
];

/**
 * Calcula los saldos de cierre sugeridos al 31-dic del `year`.
 * Cifras informativas (el contador las valida/ajusta); por eso priorizamos
 * reusar las fuentes existentes sobre exactitud al peso.
 */
export async function computeYearCloseSuggestions(year: number): Promise<YearCloseSuggestion> {
  const cutoff = `${year}-12-31`;

  const [
    stateRes, detailRes, invRes, prodRes, credRes, credPayRes, payrollRes, assetsRes, receivables,
  ] = await Promise.all([
    supabase.from('initial_financial_state' as never).select('*').maybeSingle(),
    supabase.from('initial_state_details' as never).select('field_type, amount, responsible_id, responsible_name'),
    // Facturas confirmadas con saldo (CxC venta / CxP compra) emitidas hasta el corte.
    supabase.from('invoices').select('type, counterparty_name, responsible_id, balance_pending, issue_date')
      .eq('status', 'confirmed').gt('balance_pending', 0).lte('issue_date', cutoff),
    supabase.from('inventory_products').select('stock_system, cost_per_unit').eq('active', true),
    (supabase.from('credits' as never) as any).select('id, principal, status').eq('status', 'active'),
    (supabase.from('credit_payments' as never) as any).select('credit_id, principal_paid'),
    (supabase.from('payroll_entries' as never) as any).select('provision_prestaciones'),
    (supabase.from('fixed_assets' as never) as any)
      .select('valor_compra, fecha_compra, vida_util_meses, valor_residual, activo').eq('activo', true),
    calculateAllClientReceivables(year),
  ]);

  const state = (stateRes.data as Record<string, unknown> | null) ?? null;
  const details = ((detailRes.data as unknown) as Array<{ field_type: string; amount: number; responsible_id: string | null; responsible_name: string | null }>) ?? [];
  const fechaInicio = state?.fecha_inicio ? String(state.fecha_inicio) : null;
  const sumDetail = (t: string) => details.filter((d) => d.field_type === t).reduce((s, d) => s + num(d.amount), 0);

  // ── Caja y bancos al corte: saldo inicial de cuentas + flujos hasta 31-dic ──
  const saldoInicialCuentas = sumDetail('saldo_cuentas');
  let flujos = 0;
  if (fechaInicio) {
    const [txRes, cashRes, pettyRes] = await Promise.all([
      (supabase.from('transactions') as any)
        .select('amount').is('deleted_at', null).gt('date', fechaInicio).lte('date', cutoff),
      (supabase.from('cash_movements') as any)
        .select('amount, type').is('petty_cash_movement_id', null).gt('date', fechaInicio).lte('date', cutoff),
      (supabase.from('petty_cash_movements') as any)
        .select('amount, kind').gt('date', fechaInicio).lte('date', cutoff),
    ]);
    for (const t of (txRes.data as Array<{ amount: number | null }> ?? [])) flujos += num(t.amount);
    for (const c of (cashRes.data as Array<{ amount: number | null; type: string }> ?? [])) {
      flujos += (c.type === 'ingreso' ? 1 : -1) * Math.abs(num(c.amount));
    }
    for (const p of (pettyRes.data as Array<{ amount: number | null; kind: string | null }> ?? [])) {
      flujos += (p.kind === 'ingreso_efectivo' ? 1 : -1) * Math.abs(num(p.amount));
    }
  }
  const caja_bancos = saldoInicialCuentas + flujos;

  // ── Inventario, activos fijos, créditos, prestaciones, IVA ──
  const inventario = (((prodRes.data as unknown) as Array<{ stock_system: number; cost_per_unit: number }>) ?? [])
    .reduce((s, p) => s + num(p.stock_system) * num(p.cost_per_unit), 0);
  // Valor en libros AL CORTE (31-dic del año), no a hoy: si el cierre se corre
  // en el año siguiente, la depreciación debe ser la del cierre, no la actual.
  const asOfCorte = new Date(year, 11, 31);
  const activos_fijos = (((assetsRes.data as unknown) as Array<{ valor_compra: number; fecha_compra: string; vida_util_meses: number; valor_residual: number }>) ?? [])
    .reduce((s, a) => s + computeDepreciation({
      valor_compra: num(a.valor_compra), fecha_compra: a.fecha_compra,
      vida_util_meses: num(a.vida_util_meses), valor_residual: num(a.valor_residual),
    }, asOfCorte).valorEnLibros, 0);
  const activeCredits = ((credRes.data as unknown) as Array<{ id: string; principal: number }>) ?? [];
  const paidByCredit = new Map<string, number>();
  for (const p of ((credPayRes.data as unknown) as Array<{ credit_id: string; principal_paid: number | null }>) ?? []) {
    paidByCredit.set(p.credit_id, (paidByCredit.get(p.credit_id) ?? 0) + num(p.principal_paid));
  }
  const deuda_financiera = activeCredits.reduce((s, c) => s + Math.max(0, num(c.principal) - (paidByCredit.get(c.id) ?? 0)), 0);
  const prestaciones_por_pagar = (((payrollRes.data as unknown) as Array<{ provision_prestaciones: number }>) ?? [])
    .reduce((s, r) => s + num(r.provision_prestaciones), 0);
  const iva_a_favor = num(state?.iva_a_favor);

  // ── Por tercero: clientes (CxC + anticipos) vía cartera ──
  const cxcTerceros: YearCloseTercero[] = [];
  const anticiposCliTerceros: YearCloseTercero[] = [];
  for (const c of receivables.clients) {
    if (c.saldo_neto > 1) {
      cxcTerceros.push({ responsible_id: c.client_id.startsWith('__') ? null : c.client_id, responsible_name: c.client_name, suggested: c.saldo_neto });
    } else if (c.saldo_neto < -1) {
      anticiposCliTerceros.push({ responsible_id: c.client_id.startsWith('__') ? null : c.client_id, responsible_name: c.client_name, suggested: Math.abs(c.saldo_neto) });
    }
  }

  // ── Por tercero: proveedores (CxP = facturas compra abiertas por proveedor) ──
  const invoices = ((invRes.data as unknown) as Array<{ type: string; counterparty_name: string | null; responsible_id: string | null; balance_pending: number | null }>) ?? [];
  const cxpMap = new Map<string, YearCloseTercero>();
  for (const i of invoices) {
    if (i.type !== 'compra') continue;
    const key = i.responsible_id ?? i.counterparty_name ?? '(sin proveedor)';
    const cur = cxpMap.get(key) ?? { responsible_id: i.responsible_id ?? null, responsible_name: i.counterparty_name ?? '(sin proveedor)', suggested: 0 };
    cur.suggested += num(i.balance_pending);
    cxpMap.set(key, cur);
  }
  const cxpTerceros = Array.from(cxpMap.values()).filter((t) => t.suggested > 1);

  // Anticipos a proveedores: del estado inicial por tercero.
  const antProvMap = new Map<string, YearCloseTercero>();
  for (const d of details.filter((d) => d.field_type === 'anticipos_a_proveedores')) {
    const key = d.responsible_id ?? d.responsible_name ?? '(sin proveedor)';
    const cur = antProvMap.get(key) ?? { responsible_id: d.responsible_id ?? null, responsible_name: d.responsible_name ?? '(sin proveedor)', suggested: 0 };
    cur.suggested += num(d.amount);
    antProvMap.set(key, cur);
  }
  const antProvTerceros = Array.from(antProvMap.values()).filter((t) => t.suggested > 1);

  const totalsByKey: Record<string, { total: number; terceros: YearCloseTercero[] }> = {
    caja_bancos: { total: caja_bancos, terceros: [] },
    cuentas_por_cobrar: { total: cxcTerceros.reduce((s, t) => s + t.suggested, 0), terceros: cxcTerceros },
    inventario: { total: inventario, terceros: [] },
    activos_fijos: { total: activos_fijos, terceros: [] },
    anticipos_a_proveedores: { total: antProvTerceros.reduce((s, t) => s + t.suggested, 0), terceros: antProvTerceros },
    iva_a_favor: { total: iva_a_favor, terceros: [] },
    cuentas_por_pagar: { total: cxpTerceros.reduce((s, t) => s + t.suggested, 0), terceros: cxpTerceros },
    anticipos_de_clientes: { total: anticiposCliTerceros.reduce((s, t) => s + t.suggested, 0), terceros: anticiposCliTerceros },
    deuda_financiera: { total: deuda_financiera, terceros: [] },
    prestaciones_por_pagar: { total: prestaciones_por_pagar, terceros: [] },
  };

  const rubros: YearCloseRubro[] = RUBRO_META.map((m) => ({
    key: m.key, label: m.label, kind: m.kind, operativo: m.operativo,
    suggested: totalsByKey[m.key].total,
    terceros: m.hasTercero ? totalsByKey[m.key].terceros : [],
  }));

  const totalActivos = rubros.filter((r) => r.kind === 'activo').reduce((s, r) => s + r.suggested, 0);
  const totalPasivos = rubros.filter((r) => r.kind === 'pasivo').reduce((s, r) => s + r.suggested, 0);

  return { fiscalYear: year, cutoff, rubros, totalActivos, totalPasivos, patrimonio: totalActivos - totalPasivos };
}
