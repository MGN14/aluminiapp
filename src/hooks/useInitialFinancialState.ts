import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface InitialFinancialState {
  id: string;
  user_id: string;
  fecha_inicio: string;
  saldo_bancos: number;
  cuentas_por_cobrar: number;
  inventario: number;
  anticipos_a_proveedores: number;
  otros_activos: number;
  cuentas_por_pagar: number;
  anticipos_de_clientes: number;
  impuestos_por_pagar: number;
  prestamos: number;
  iva_a_favor: number;
  iva_por_pagar: number;
  retefuente_por_pagar: number;
  ica_por_pagar: number;
  created_at: string;
  updated_at: string;
}

export interface InitialStateDetail {
  id?: string;
  user_id?: string;
  field_type: 'cuentas_por_cobrar' | 'anticipos_a_proveedores' | 'anticipos_de_clientes' | 'cuentas_por_pagar';
  responsible_id: string | null;
  responsible_name: string;
  amount: number;
}

export type InitialStateFormData = {
  fecha_inicio: string;
  saldo_bancos: number;
  inventario: number;
  otros_activos: number;
  impuestos_por_pagar: number;
  prestamos: number;
  iva_a_favor: number;
};

const DETAIL_FIELDS = ['cuentas_por_cobrar', 'anticipos_a_proveedores', 'anticipos_de_clientes', 'cuentas_por_pagar'] as const;

export function sumDetailsByType(details: InitialStateDetail[], type: string): number {
  return details.filter(d => d.field_type === type).reduce((s, d) => s + d.amount, 0);
}

export function getTotalActivos(form: InitialStateFormData, details: InitialStateDetail[]): number {
  return form.saldo_bancos
    + sumDetailsByType(details, 'cuentas_por_cobrar')
    + form.inventario
    + sumDetailsByType(details, 'anticipos_a_proveedores')
    + form.otros_activos;
}

export function getTotalPasivos(form: InitialStateFormData, details: InitialStateDetail[]): number {
  return sumDetailsByType(details, 'cuentas_por_pagar')
    + sumDetailsByType(details, 'anticipos_de_clientes')
    + form.impuestos_por_pagar
    + form.prestamos;
}

export function getPatrimonio(form: InitialStateFormData, details: InitialStateDetail[]): number {
  return getTotalActivos(form, details) - getTotalPasivos(form, details);
}

export function useInitialFinancialState() {
  const { user } = useAuth();
  const [data, setData] = useState<InitialFinancialState | null>(null);
  const [details, setDetails] = useState<InitialStateDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [isConfigured, setIsConfigured] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const [{ data: row, error }, { data: detailRows, error: detailError }] = await Promise.all([
        supabase
          .from('initial_financial_state' as any)
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('initial_state_details' as any)
          .select('*')
          .eq('user_id', user.id)
          .order('created_at'),
      ]);

      if (error) throw error;
      if (detailError) throw detailError;
      setData(row as any);
      setDetails((detailRows as any[]) || []);
      setIsConfigured(!!row);
    } catch (e) {
      console.error('Error fetching initial financial state:', e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const save = useCallback(async (formData: InitialStateFormData, newDetails: InitialStateDetail[]) => {
    if (!user) throw new Error('No user');

    // Save main record (set detail-based columns to 0 since they live in details table now)
    const payload = {
      ...formData,
      user_id: user.id,
      updated_at: new Date().toISOString(),
      cuentas_por_cobrar: sumDetailsByType(newDetails, 'cuentas_por_cobrar'),
      anticipos_a_proveedores: sumDetailsByType(newDetails, 'anticipos_a_proveedores'),
      cuentas_por_pagar: sumDetailsByType(newDetails, 'cuentas_por_pagar'),
      anticipos_de_clientes: sumDetailsByType(newDetails, 'anticipos_de_clientes'),
      iva_por_pagar: 0,
      retefuente_por_pagar: 0,
      ica_por_pagar: 0,
    };

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

    // Replace all details: delete existing, insert new
    await supabase
      .from('initial_state_details' as any)
      .delete()
      .eq('user_id', user.id);

    if (newDetails.length > 0) {
      const detailPayloads = newDetails.map(d => ({
        user_id: user.id,
        field_type: d.field_type,
        responsible_id: d.responsible_id,
        responsible_name: d.responsible_name,
        amount: d.amount,
      }));
      const { error } = await supabase
        .from('initial_state_details' as any)
        .insert(detailPayloads as any);
      if (error) throw error;
    }

    await fetchData();
  }, [user, data, fetchData]);

  return { data, details, loading, isConfigured, save, refetch: fetchData };
}
