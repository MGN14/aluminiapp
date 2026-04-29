import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface OperativeReceivableRow {
  responsible_id: string;
  responsible_name: string;
  total_deuda: number;
  pagado_efectivo: number;
  pagado_banco: number;
  saldo: number;
}

export interface OperativeReceivablesSummary {
  rows: OperativeReceivableRow[];
  total_deudas: number;
  total_pagado: number;
  total_saldo_pendiente: number;
  total_saldo_a_favor: number;
  clientes_con_deuda: number;
}

export function useOperativeReceivables() {
  const { user } = useAuth();
  return useQuery<OperativeReceivablesSummary>({
    queryKey: ['operative-receivables', user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) {
        return {
          rows: [],
          total_deudas: 0,
          total_pagado: 0,
          total_saldo_pendiente: 0,
          total_saldo_a_favor: 0,
          clientes_con_deuda: 0,
        };
      }

      const [debtsRes, cashRes, bankRes, responsiblesRes] = await Promise.all([
        supabase
          .from('operative_receivables')
          .select('responsible_id, amount')
          .eq('user_id', user.id),
        supabase
          .from('cash_movements')
          .select('responsible_id, amount')
          .eq('user_id', user.id)
          .eq('type', 'ingreso')
          .not('responsible_id', 'is', null),
        supabase
          .from('transactions')
          .select('operative_responsible_id, credit')
          .eq('user_id', user.id)
          .eq('operative_receivable_assigned', true)
          .not('operative_responsible_id', 'is', null)
          .is('deleted_at', null),
        supabase
          .from('responsibles')
          .select('id, name')
          .eq('user_id', user.id),
      ]);

      if (debtsRes.error) throw debtsRes.error;
      if (cashRes.error) throw cashRes.error;
      if (bankRes.error) throw bankRes.error;
      if (responsiblesRes.error) throw responsiblesRes.error;

      const namesMap = new Map<string, string>(
        (responsiblesRes.data ?? []).map((r) => [r.id, r.name])
      );

      const acc = new Map<string, OperativeReceivableRow>();
      const getRow = (id: string): OperativeReceivableRow => {
        let row = acc.get(id);
        if (!row) {
          row = {
            responsible_id: id,
            responsible_name: namesMap.get(id) ?? '(Sin nombre)',
            total_deuda: 0,
            pagado_efectivo: 0,
            pagado_banco: 0,
            saldo: 0,
          };
          acc.set(id, row);
        }
        return row;
      };

      for (const d of debtsRes.data ?? []) {
        if (!d.responsible_id) continue;
        getRow(d.responsible_id).total_deuda += Number(d.amount) || 0;
      }
      for (const c of cashRes.data ?? []) {
        if (!c.responsible_id) continue;
        getRow(c.responsible_id).pagado_efectivo += Number(c.amount) || 0;
      }
      for (const b of (bankRes.data ?? []) as unknown as Array<{ operative_responsible_id: string | null; credit: number | null }>) {
        if (!b.operative_responsible_id) continue;
        getRow(b.operative_responsible_id).pagado_banco += Number(b.credit) || 0;
      }

      const rows = Array.from(acc.values()).map((r) => ({
        ...r,
        saldo: r.total_deuda - r.pagado_efectivo - r.pagado_banco,
      }));

      // Solo mostramos clientes que tienen alguna deuda registrada o algún pago asignado
      const visible = rows.filter(
        (r) => r.total_deuda > 0 || r.pagado_efectivo > 0 || r.pagado_banco > 0
      );

      // Orden: saldos pendientes primero (de mayor a menor), después saldos en cero, después saldos a favor
      visible.sort((a, b) => {
        if (a.saldo > 0 && b.saldo <= 0) return -1;
        if (a.saldo <= 0 && b.saldo > 0) return 1;
        return b.saldo - a.saldo;
      });

      const total_deudas = visible.reduce((s, r) => s + r.total_deuda, 0);
      const total_pagado = visible.reduce(
        (s, r) => s + r.pagado_efectivo + r.pagado_banco,
        0
      );
      const total_saldo_pendiente = visible
        .filter((r) => r.saldo > 0)
        .reduce((s, r) => s + r.saldo, 0);
      const total_saldo_a_favor = visible
        .filter((r) => r.saldo < 0)
        .reduce((s, r) => s + Math.abs(r.saldo), 0);
      const clientes_con_deuda = visible.filter((r) => r.saldo > 0).length;

      return {
        rows: visible,
        total_deudas,
        total_pagado,
        total_saldo_pendiente,
        total_saldo_a_favor,
        clientes_con_deuda,
      };
    },
  });
}
