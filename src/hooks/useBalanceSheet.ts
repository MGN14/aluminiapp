import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { buildBalanceSheet, type BalanceSheet } from '@/lib/balanceSheet';
import { computeDepreciation } from '@/lib/depreciation';

/**
 * Balance General "vivo" a hoy. Orquesta las fuentes operativas que ya tiene
 * la app y completa con el estado inicial los rubros sin tracking operativo.
 * El cálculo (totales, ratios, validación) vive en lib/balanceSheet.ts.
 */

export interface BalanceSheetData extends BalanceSheet {
  fechaInicio: string | null;
  isConfigured: boolean;
  /** rubros que vienen del estado inicial (sin tracking operativo a hoy) */
  sources: Record<string, string>;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function useBalanceSheet() {
  const { user } = useAuth();

  return useQuery<BalanceSheetData>({
    queryKey: ['balance-sheet-v1', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [stateRes, detailRes, invRes, prodRes, credRes, credPayRes, payrollRes, assetsRes] = await Promise.all([
        supabase.from('initial_financial_state' as never).select('*').maybeSingle(),
        supabase.from('initial_state_details' as never).select('field_type, amount'),
        // Facturas confirmadas con saldo pendiente (CxC venta / CxP compra).
        supabase.from('invoices').select('type, balance_pending')
          .eq('status', 'confirmed').gt('balance_pending', 0),
        // Inventario valorizado.
        supabase.from('inventory_products').select('stock_system, cost_per_unit').eq('active', true),
        // Créditos activos (para saldo de deuda).
        (supabase.from('credits' as never) as any).select('id, principal, status').eq('status', 'active'),
        (supabase.from('credit_payments' as never) as any).select('credit_id, principal_paid'),
        // Provisión de prestaciones devengada (módulo Nómina). Pasivo laboral
        // acumulado de TODOS los periodos registrados (no solo el año actual).
        (supabase.from('payroll_entries' as never) as any).select('provision_prestaciones'),
        // Activos fijos en uso (módulo Activos fijos) → valor en libros.
        (supabase.from('fixed_assets' as never) as any)
          .select('valor_compra, fecha_compra, vida_util_meses, valor_residual, activo').eq('activo', true),
      ]);

      const state = (stateRes.data as Record<string, number> | null) ?? null;
      const details = ((detailRes.data as unknown) as Array<{ field_type: string; amount: number }>) ?? [];
      const sumDetail = (t: string) => details.filter((d) => d.field_type === t).reduce((s, d) => s + num(d.amount), 0);
      const fechaInicio = state?.fecha_inicio ? String(state.fecha_inicio) : null;

      // ── Caja y bancos a hoy ──
      // NO usamos transactions.balance: es un running balance GLOBAL sembrado
      // en 0, mezcla todas las cuentas y bancos, e inválido con multi-cuenta.
      // En su lugar: saldo inicial de cuentas + todos los flujos posteriores de
      // banco y efectivo. Consistente con la utilidad acumulada de más abajo.
      const saldoInicialCuentas = sumDetail('saldo_cuentas');
      let flujoBanco = 0;          // Σ transactions.amount (todos los movimientos)
      let flujoEfectivo = 0;       // cash_movements + petty_cash netos
      let utilidad_acumulada = 0;  // solo movimientos operativos (proxy de resultado)
      if (fechaInicio) {
        const [txRes, cashRes, pettyRes] = await Promise.all([
          (supabase.from('transactions') as any)
            .select('amount, movement_nature').is('deleted_at', null).gt('date', fechaInicio),
          (supabase.from('cash_movements') as any)
            .select('amount, type').is('petty_cash_movement_id', null).gt('date', fechaInicio),
          supabase.from('petty_cash_movements').select('amount, kind').gt('date', fechaInicio),
        ]);
        for (const t of (txRes.data ?? []) as Array<{ amount: number | null; movement_nature: string | null }>) {
          const amt = num(t.amount);
          flujoBanco += amt;
          if ((t.movement_nature ?? 'operativo') === 'operativo') utilidad_acumulada += amt;
        }
        for (const c of (cashRes.data ?? []) as Array<{ amount: number | null; type: string }>) {
          const signed = (c.type === 'ingreso' ? 1 : -1) * Math.abs(num(c.amount));
          flujoEfectivo += signed;
          utilidad_acumulada += signed;
        }
        for (const p of (pettyRes.data ?? []) as Array<{ amount: number | null; kind: string | null }>) {
          const signed = (p.kind === 'ingreso_efectivo' ? 1 : -1) * Math.abs(num(p.amount));
          flujoEfectivo += signed;
          utilidad_acumulada += signed;
        }
      }
      const caja_bancos = saldoInicialCuentas + flujoBanco + flujoEfectivo;

      // ── Resto de activos a hoy ──
      const invoices = ((invRes.data as unknown) as Array<{ type: string; balance_pending: number | null }>) ?? [];
      const cuentas_por_cobrar = invoices.filter((i) => i.type === 'venta').reduce((s, i) => s + num(i.balance_pending), 0);
      const cuentas_por_pagar = invoices.filter((i) => i.type === 'compra').reduce((s, i) => s + num(i.balance_pending), 0);
      const inventario = (((prodRes.data as unknown) as Array<{ stock_system: number; cost_per_unit: number }>) ?? [])
        .reduce((s, p) => s + num(p.stock_system) * num(p.cost_per_unit), 0);
      const anticipos_a_proveedores = sumDetail('anticipos_a_proveedores');
      const iva_a_favor = num(state?.iva_a_favor);

      // ── Pasivos a hoy ──
      const anticipos_de_clientes = sumDetail('anticipos_de_clientes');
      // Deuda financiera = principal − capital abonado, por crédito activo.
      const activeCredits = ((credRes.data as unknown) as Array<{ id: string; principal: number }>) ?? [];
      const paidByCredit = new Map<string, number>();
      for (const p of ((credPayRes.data as unknown) as Array<{ credit_id: string; principal_paid: number | null }>) ?? []) {
        paidByCredit.set(p.credit_id, (paidByCredit.get(p.credit_id) ?? 0) + num(p.principal_paid));
      }
      const deuda_financiera = activeCredits.reduce(
        (s, c) => s + Math.max(0, num(c.principal) - (paidByCredit.get(c.id) ?? 0)), 0,
      );
      // Prestaciones: provisión devengada acumulada de todos los periodos
      // registrados en Nómina (pasivo laboral). No hay tracking de pagos al
      // fondo todavía, así que es el devengado bruto — se documenta en source.
      const prestaciones_por_pagar = (((payrollRes.data as unknown) as Array<{ provision_prestaciones: number }>) ?? [])
        .reduce((s, r) => s + num(r.provision_prestaciones), 0);
      // Impuestos por pagar: el form del estado inicial NO captura estos campos
      // (se reescriben a 0 en cada save), así que hoy siempre es 0. Lo dejamos
      // explícito pero la línea se oculta en la UI cuando es 0 (no rubro fantasma).
      const impuestos_por_pagar = 0;

      // Activos fijos a hoy = Σ valor en libros de los activos en uso.
      const activos_fijos = (((assetsRes.data as unknown) as Array<{ valor_compra: number; fecha_compra: string; vida_util_meses: number; valor_residual: number }>) ?? [])
        .reduce((s, a) => s + computeDepreciation({
          valor_compra: num(a.valor_compra), fecha_compra: a.fecha_compra,
          vida_util_meses: num(a.vida_util_meses), valor_residual: num(a.valor_residual),
        }).valorEnLibros, 0);

      // Patrimonio inicial: activos iniciales − pasivos iniciales (lo que cuadra
      // por construcción en el estado inicial capturado). Incluimos los activos
      // fijos en el patrimonio_inicial porque en una PYME en marcha la
      // maquinaria/vehículos ya existían (capital aportado): sin esto, sumarlos
      // al activo sin contrapartida descuadraría la validación de patrimonio.
      const activosIniciales = sumDetail('saldo_cuentas') + sumDetail('cuentas_por_cobrar') + sumDetail('anticipos_a_proveedores') + iva_a_favor + activos_fijos;
      const pasivosIniciales = sumDetail('cuentas_por_pagar') + sumDetail('anticipos_de_clientes') + sumDetail('deudas');
      const patrimonio_inicial = activosIniciales - pasivosIniciales;

      const sheet = buildBalanceSheet({
        caja_bancos, cuentas_por_cobrar, inventario, activos_fijos, anticipos_a_proveedores, iva_a_favor, otros_activos: 0,
        cuentas_por_pagar, anticipos_de_clientes, prestaciones_por_pagar, impuestos_por_pagar, deuda_financiera,
        patrimonio_inicial, utilidad_acumulada,
      });

      return {
        ...sheet,
        fechaInicio,
        isConfigured: !!state,
        sources: {
          caja_bancos: 'Saldo inicial + movimientos de banco y efectivo',
          cuentas_por_cobrar: 'Facturas de venta con saldo pendiente',
          inventario: 'Inventario valorizado (stock × costo)',
          activos_fijos: 'Módulo Activos fijos (valor en libros)',
          anticipos_a_proveedores: 'Estado financiero inicial',
          iva_a_favor: 'Estado financiero inicial',
          cuentas_por_pagar: 'Facturas de compra con saldo pendiente',
          anticipos_de_clientes: 'Estado financiero inicial',
          prestaciones_por_pagar: 'Módulo Nómina (provisión devengada acumulada)',
          impuestos_por_pagar: 'Estado financiero inicial',
          deuda_financiera: 'Créditos activos (capital pendiente)',
        },
      };
    },
  });
}
