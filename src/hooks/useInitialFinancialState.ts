import { useState, useEffect, useCallback, useRef } from 'react';
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

// field_types soportados.
//
// Existentes (no romper — varios módulos los leen para reportes):
//   - cuentas_por_cobrar / cuentas_por_pagar : carteras al inicio por tercero
//   - anticipos_de_clientes / anticipos_a_proveedores : anticipos por tercero,
//     opcionalmente vinculados a una factura (invoice_id)
//
// Nuevos (post-rework solicitado por Nico):
//   - saldo_cuentas : detalle del saldo en bancos/caja por cuenta. La suma
//     se persiste en initial_financial_state.saldo_bancos (mismo campo, nuevo
//     detalle granular).
//   - deudas : detalle de pasivos cortos (tarjetas de crédito, préstamos
//     pequeños). La suma se persiste en initial_financial_state.prestamos.
export interface InitialStateDetail {
  id?: string;
  user_id?: string;
  field_type:
    | 'cuentas_por_cobrar'
    | 'anticipos_a_proveedores'
    | 'anticipos_de_clientes'
    | 'cuentas_por_pagar'
    | 'saldo_cuentas'
    | 'deudas';
  responsible_id: string | null;
  responsible_name: string;
  amount: number;
}

// formData ahora solo tiene los campos que NO se calculan desde details.
// saldo_bancos y prestamos pasaron a calcularse desde sus detalles.
export type InitialStateFormData = {
  fecha_inicio: string;
  inventario: number;
  otros_activos: number;
  impuestos_por_pagar: number;
  iva_a_favor: number;
};

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function sumDetailsByType(details: InitialStateDetail[], type: string): number {
  return details.filter(d => d.field_type === type).reduce((s, d) => s + d.amount, 0);
}

export function getTotalActivos(form: InitialStateFormData, details: InitialStateDetail[]): number {
  return sumDetailsByType(details, 'saldo_cuentas')
    + sumDetailsByType(details, 'cuentas_por_cobrar')
    + form.inventario
    + sumDetailsByType(details, 'anticipos_a_proveedores')
    + (form.iva_a_favor || 0)
    + form.otros_activos;
}

export function getTotalPasivos(form: InitialStateFormData, details: InitialStateDetail[]): number {
  return sumDetailsByType(details, 'cuentas_por_pagar')
    + sumDetailsByType(details, 'anticipos_de_clientes')
    + form.impuestos_por_pagar
    + sumDetailsByType(details, 'deudas');
}

export function getPatrimonio(form: InitialStateFormData, details: InitialStateDetail[]): number {
  return getTotalActivos(form, details) - getTotalPasivos(form, details);
}

const AUTOSAVE_DELAY_MS = 1200;

export function useInitialFinancialState() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [isConfigured, setIsConfigured] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [initialData, setInitialData] = useState<InitialFinancialState | null>(null);
  const [initialDetails, setInitialDetails] = useState<InitialStateDetail[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setInitialData(row as any);
      setInitialDetails((detailRows as any[]) || []);
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

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const persistNow = useCallback(async (formData: InitialStateFormData, newDetails: InitialStateDetail[]) => {
    if (!user) return;

    setSaveStatus('saving');
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);

    try {
      // Los agregados se calculan desde los details. saldo_bancos y prestamos
      // pasaron de ser campos de form a calcularse desde sus respectivos
      // details (saldo_cuentas, deudas) — la columna de DB se mantiene
      // por compatibilidad con código que ya la lee.
      const payload = {
        ...formData,
        user_id: user.id,
        updated_at: new Date().toISOString(),
        saldo_bancos: sumDetailsByType(newDetails, 'saldo_cuentas'),
        prestamos: sumDetailsByType(newDetails, 'deudas'),
        cuentas_por_cobrar: sumDetailsByType(newDetails, 'cuentas_por_cobrar'),
        anticipos_a_proveedores: sumDetailsByType(newDetails, 'anticipos_a_proveedores'),
        cuentas_por_pagar: sumDetailsByType(newDetails, 'cuentas_por_pagar'),
        anticipos_de_clientes: sumDetailsByType(newDetails, 'anticipos_de_clientes'),
        iva_por_pagar: 0,
        retefuente_por_pagar: 0,
        ica_por_pagar: 0,
      };

      const { data: existing } = await supabase
        .from('initial_financial_state' as any)
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existing) {
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

      // Replace all details
      await supabase
        .from('initial_state_details' as any)
        .delete()
        .eq('user_id', user.id);

      const validDetails = newDetails.filter(d => d.responsible_name.trim() || d.amount > 0);
      if (validDetails.length > 0) {
        const detailPayloads = validDetails.map(d => ({
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

      setIsConfigured(true);
      setSaveStatus('saved');
      savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2500);
    } catch (e) {
      console.error('Auto-save error:', e);
      setSaveStatus('error');
      savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 4000);
    }
  }, [user]);

  const autoSave = useCallback((formData: InitialStateFormData, newDetails: InitialStateDetail[]) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      persistNow(formData, newDetails);
    }, AUTOSAVE_DELAY_MS);
  }, [persistNow]);

  const save = useCallback(async (formData: InitialStateFormData, newDetails: InitialStateDetail[]) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    await persistNow(formData, newDetails);
  }, [persistNow]);

  return { 
    initialData, 
    initialDetails, 
    loading, 
    isConfigured, 
    save, 
    autoSave, 
    saveStatus, 
    refetch: fetchData,
  };
}
