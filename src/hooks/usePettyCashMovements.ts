import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type PettyCashKind = 'gasto_efectivo' | 'cuenta_de_cobro';

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
  numero_cuenta_cobro: string | null;
  notes: string | null;
  created_at: string;
  /** FK a petty_cash_closings. NULL = abierto/editable. NOT NULL = cerrado e inmutable. */
  closing_id: string | null;
  /** FK a cash_movements. NOT NULL = ya fue replicado al Modo Gerencial. */
  cash_movement_id: string | null;
}

export interface PettyCashSummary {
  rows: PettyCashRow[];
  total_mes_actual: number;
  total_deducible_mes_actual: number;
  total_no_deducible_mes_actual: number;
  count_mes_actual: number;
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
        total_deducible_mes_actual: 0,
        total_no_deducible_mes_actual: 0,
        count_mes_actual: 0,
      };
      if (!user?.id) return empty;

      const [movementsRes, categoriesRes, responsiblesRes] = await Promise.all([
        supabase
          .from('petty_cash_movements')
          .select('*')
          .eq('user_id', user.id)
          .order('date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('categories')
          .select('id, name, is_tax_deductible')
          .eq('user_id', user.id),
        supabase
          .from('responsibles')
          .select('id, name')
          .eq('user_id', user.id),
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
          numero_cuenta_cobro: m.numero_cuenta_cobro,
          notes: m.notes,
          created_at: m.created_at,
          closing_id: (m as { closing_id?: string | null }).closing_id ?? null,
          cash_movement_id: (m as { cash_movement_id?: string | null }).cash_movement_id ?? null,
        };
      });

      const monthStart = startOfMonth();
      const mesActual = rows.filter((r) => r.date >= monthStart);
      const total_mes_actual = mesActual.reduce((s, r) => s + r.amount, 0);
      const total_deducible_mes_actual = mesActual
        .filter((r) => r.category_is_tax_deductible)
        .reduce((s, r) => s + r.amount, 0);
      const total_no_deducible_mes_actual = total_mes_actual - total_deducible_mes_actual;

      return {
        rows,
        total_mes_actual,
        total_deducible_mes_actual,
        total_no_deducible_mes_actual,
        count_mes_actual: mesActual.length,
      };
    },
  });
}
