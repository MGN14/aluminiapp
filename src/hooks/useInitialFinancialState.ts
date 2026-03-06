import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface InitialFinancialState {
  id: string;
  user_id: string;
  fecha_inicio: string;
  // Activos
  saldo_bancos: number;
  cuentas_por_cobrar: number;
  inventario: number;
  anticipos_a_proveedores: number;
  otros_activos: number;
  // Pasivos
  cuentas_por_pagar: number;
  anticipos_de_clientes: number;
  impuestos_por_pagar: number;
  prestamos: number;
  // Impuestos
  iva_a_favor: number;
  iva_por_pagar: number;
  retefuente_por_pagar: number;
  ica_por_pagar: number;
  created_at: string;
  updated_at: string;
}

export type InitialStateFormData = Omit<InitialFinancialState, 'id' | 'user_id' | 'created_at' | 'updated_at'>;

export function getTotalActivos(s: InitialStateFormData) {
  return s.saldo_bancos + s.cuentas_por_cobrar + s.inventario + s.anticipos_a_proveedores + s.otros_activos;
}

export function getTotalPasivos(s: InitialStateFormData) {
  return s.cuentas_por_pagar + s.anticipos_de_clientes + s.impuestos_por_pagar + s.prestamos;
}

export function getPatrimonio(s: InitialStateFormData) {
  return getTotalActivos(s) - getTotalPasivos(s);
}

export function useInitialFinancialState() {
  const { user } = useAuth();
  const [data, setData] = useState<InitialFinancialState | null>(null);
  const [loading, setLoading] = useState(true);
  const [isConfigured, setIsConfigured] = useState(false);

  const fetch = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const { data: row, error } = await supabase
        .from('initial_financial_state' as any)
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      setData(row as any);
      setIsConfigured(!!row);
    } catch (e) {
      console.error('Error fetching initial financial state:', e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const save = useCallback(async (formData: InitialStateFormData) => {
    if (!user) throw new Error('No user');

    const payload = { ...formData, user_id: user.id, updated_at: new Date().toISOString() };

    if (data) {
      const { error } = await supabase
        .from('initial_financial_state' as any)
        .update(payload as any)
        .eq('user_id', user.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('initial_financial_state' as any)
        .insert(payload as any);
      if (error) throw error;
    }

    await fetch();
  }, [user, data, fetch]);

  return { data, loading, isConfigured, save, refetch: fetch };
}
