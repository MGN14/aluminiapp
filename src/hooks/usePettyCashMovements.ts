import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { DEFAULT_ACCOUNT } from '@/lib/pettyCashAccounts';

export type PettyCashKind = 'gasto_efectivo' | 'cuenta_de_cobro' | 'ingreso_efectivo' | 'retiro_efectivo';

/**
 * SEIS lugares distintos calculaban el signo con `kind === 'ingreso_efectivo'
 * ? +1 : -1` y trataban todo el resto como gasto del P&G. Con la llegada de
 * 'retiro_efectivo' (plata que sale de la caja pero NO es gasto) esa cuenta
 * dejó de servir, así que la regla vive acá y todos la importan.
 */

/** Signo sobre el SALDO de la caja: solo el ingreso suma; retiros y gastos restan. */
export function signoCaja(kind: string | null | undefined): 1 | -1 {
  return kind === 'ingreso_efectivo' ? 1 : -1;
}

/**
 * ¿Este movimiento entra al P&G / estado de resultados?
 * El retiro NO: la plata cambia de bolsillo, el negocio no gastó ni ganó nada.
 */
export function afectaResultado(kind: string | null | undefined): boolean {
  return kind !== 'retiro_efectivo';
}

/** true si suma a INGRESOS del resultado (los demás que afectan son egresos). */
export function esIngresoResultado(kind: string | null | undefined): boolean {
  return kind === 'ingreso_efectivo';
}

export const PETTY_KIND_LABELS: Record<PettyCashKind, string> = {
  gasto_efectivo: 'Gasto en efectivo (sin documento)',
  cuenta_de_cobro: 'Cuenta de cobro (servicio ocasional)',
  ingreso_efectivo: 'Ingreso de efectivo',
  retiro_efectivo: 'Retiro de efectivo (no es gasto)',
};

export interface PettyCashRow {
  id: string;
  date: string;
  amount: number;
  responsible_id: string | null;
  responsible_name: string | null;
  category_id: string | null;
  category_name: string | null;
  category_is_tax_deductible: boolean;
  concept: string | null;
  kind: PettyCashKind;
  /** De qué cuenta salió/entró la plata: 'efectivo' | 'nequi' | … Cada una
   *  cuadra por separado en el cierre (ver lib/pettyCashAccounts). */
  cuenta: string;
  numero_cuenta_cobro: string | null;
  /** Auto-asignado por trigger BEFORE INSERT (CDC-YYYY-NNNN para cuenta_de_cobro,
   *  CP-YYYY-NNNN para gasto_efectivo). Editable manualmente desde el modal de PDF. */
  numero_consecutivo: string | null;
  notes: string | null;
  created_at: string;
  /** FK a petty_cash_closings. NULL = abierto/editable. NOT NULL = cerrado e inmutable. */
  closing_id: string | null;
  /** FK a cash_movements. NOT NULL = ya fue replicado al Modo Gerencial. */
  cash_movement_id: string | null;
}

export interface PettyCashSummary {
  rows: PettyCashRow[];
  /** Total egresos del mes actual (excluye ingresos). */
  total_mes_actual: number;
  /** Cantidad de movimientos del mes (incluye ingresos para el contador). */
  count_mes_actual: number;
  /** Suma de ingresos en efectivo del mes actual. */
  total_ingresos_mes: number;
  /** Saldo neto en caja: suma histórica de ingresos − suma histórica de
   *  egresos. Lo que efectivamente debería haber en la caja física hoy. */
  saldo_caja: number;
  /** El mismo saldo neto pero POR CUENTA ('efectivo', 'nequi', …). Es lo que
   *  se puede verificar: el efectivo contra los billetes, Nequi contra la app.
   *  El total solo sirve de resumen — no se verifica contra nada. */
  saldo_por_cuenta: Record<string, number>;
}

function startOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export function usePettyCashMovements() {
  const { user } = useAuth();
  return useQuery<PettyCashSummary>({
    queryKey: ['petty-cash-movements', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const empty: PettyCashSummary = {
        rows: [],
        total_mes_actual: 0,
        count_mes_actual: 0,
        total_ingresos_mes: 0,
        saldo_caja: 0,
        saldo_por_cuenta: {},
      };
      if (!user?.id) return empty;

      // RLS filtra automáticamente por current_data_owner() — no agregar
      // .eq('user_id', user.id) que rompe para colaboradores.
      const [movementsRes, categoriesRes, responsiblesRes] = await Promise.all([
        supabase
          .from('petty_cash_movements')
          .select('*')
          .order('date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('categories')
          .select('id, name, is_tax_deductible'),
        supabase
          .from('responsibles')
          .select('id, name'),
      ]);

      if (movementsRes.error) throw movementsRes.error;
      if (categoriesRes.error) throw categoriesRes.error;
      if (responsiblesRes.error) throw responsiblesRes.error;

      const catMap = new Map<string, { name: string; deductible: boolean }>();
      for (const c of categoriesRes.data ?? []) {
        catMap.set(c.id, { name: c.name, deductible: c.is_tax_deductible });
      }
      const respMap = new Map<string, string>();
      for (const r of responsiblesRes.data ?? []) {
        respMap.set(r.id, r.name);
      }

      const rows: PettyCashRow[] = (movementsRes.data ?? []).map((m) => {
        const cat = m.category_id ? catMap.get(m.category_id) : undefined;
        return {
          id: m.id,
          date: m.date,
          amount: Number(m.amount) || 0,
          responsible_id: m.responsible_id,
          responsible_name: m.responsible_id ? respMap.get(m.responsible_id) ?? null : null,
          category_id: m.category_id,
          category_name: cat?.name ?? null,
          category_is_tax_deductible: cat?.deductible ?? false,
          concept: m.concept,
          kind: (m.kind as PettyCashKind) ?? 'gasto_efectivo',
          cuenta: (m as { cuenta?: string | null }).cuenta || DEFAULT_ACCOUNT,
          numero_cuenta_cobro: m.numero_cuenta_cobro,
          numero_consecutivo: (m as { numero_consecutivo?: string | null }).numero_consecutivo ?? null,
          notes: m.notes,
          created_at: m.created_at,
          closing_id: (m as { closing_id?: string | null }).closing_id ?? null,
          cash_movement_id: (m as { cash_movement_id?: string | null }).cash_movement_id ?? null,
        };
      });

      const monthStart = startOfMonth();
      const mesActual = rows.filter((r) => r.date >= monthStart);
      // Gasto del mes = solo lo que el negocio realmente gastó. El retiro
      // sale de la caja pero no es gasto, así que no infla este KPI.
      const egresosMes = mesActual.filter((r) => !esIngresoResultado(r.kind) && afectaResultado(r.kind));
      const ingresosMes = mesActual.filter((r) => r.kind === 'ingreso_efectivo');
      const total_mes_actual = egresosMes.reduce((s, r) => s + r.amount, 0);
      const total_ingresos_mes = ingresosMes.reduce((s, r) => s + r.amount, 0);

      // Saldo de caja físico = ingresos históricos − egresos históricos.
      const totalIngresosHist = rows
        .filter((r) => r.kind === 'ingreso_efectivo')
        .reduce((s, r) => s + r.amount, 0);
      // El SALDO sí resta los retiros: esa plata ya no está en la caja.
      const totalEgresosHist = rows
        .filter((r) => signoCaja(r.kind) === -1)
        .reduce((s, r) => s + r.amount, 0);
      const saldo_caja = totalIngresosHist - totalEgresosHist;

      // Mismo cálculo, segmentado por cuenta. Sin esto el saldo mezcla los
      // billetes de la caja con el saldo de Nequi y no se puede verificar
      // contra nada.
      const saldo_por_cuenta: Record<string, number> = {};
      for (const r of rows) {
        const signo = r.kind === 'ingreso_efectivo' ? 1 : -1;
        saldo_por_cuenta[r.cuenta] = (saldo_por_cuenta[r.cuenta] ?? 0) + signo * r.amount;
      }

      return {
        rows,
        total_mes_actual,
        count_mes_actual: mesActual.length,
        total_ingresos_mes,
        saldo_caja,
        saldo_por_cuenta,
      };
    },
  });
}
