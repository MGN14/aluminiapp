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
          .maybeSingle(),
        supabase
          .from('initial_state_details' as any)
          .select('*')
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

  // Devuelve un mapping tmp-id → uuid real para los detalles recién insertados.
  // El componente lo aplica quirúrgicamente sobre su state local SIN
  // sobrescribir cambios concurrentes (ej: un cliente recién seleccionado
  // mientras el save estaba en vuelo).
  const persistNow = useCallback(async (
    formData: InitialStateFormData,
    newDetails: InitialStateDetail[]
  ): Promise<Map<string, string>> => {
    const idMap = new Map<string, string>();
    if (!user) return idMap;

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

      // initial_financial_state.user_id es UNIQUE → upsert atómico.
      const { data: stateRow, error: stateError } = await supabase
        .from('initial_financial_state' as any)
        .upsert(payload as any, { onConflict: 'user_id' })
        .select()
        .single();
      if (stateError) throw stateError;

      // CRÍTICO — diff-based update de initial_state_details.
      // initial_balance_matches tiene FK a initial_state_details(id) ON DELETE
      // CASCADE: un "delete all + insert all" borraba todos los matches de
      // pagos vinculados manualmente desde VincularPagoModal. También
      // preservamos invoice_id (vincula anticipos a facturas) — solo se
      // mantiene si UPDATE no toca esa columna.
      const validDetails = newDetails.filter(d => d.responsible_name.trim() || d.amount > 0);

      const isRealId = (id: string | undefined) => !!id && !id.startsWith('tmp-');
      const toUpdate = validDetails.filter(d => isRealId(d.id));
      const toInsert = validDetails.filter(d => !isRealId(d.id));
      const keepIds = new Set(toUpdate.map(d => d.id));

      // IDs en DB que el usuario removió de la UI — solo esos se borran.
      const { data: dbDetails, error: fetchErr } = await supabase
        .from('initial_state_details' as any)
        .select('id');
      if (fetchErr) throw fetchErr;

      const toDeleteIds = ((dbDetails as any[]) || [])
        .map(d => d.id as string)
        .filter(id => !keepIds.has(id));

      if (toDeleteIds.length > 0) {
        const { error: delErr } = await supabase
          .from('initial_state_details' as any)
          .delete()
          .in('id', toDeleteIds);
        if (delErr) throw delErr;
      }

      // UPDATE por id — preserva invoice_id y otros campos no incluidos.
      for (const d of toUpdate) {
        const { error: upErr } = await supabase
          .from('initial_state_details' as any)
          .update({
            field_type: d.field_type,
            responsible_id: d.responsible_id,
            responsible_name: d.responsible_name,
            amount: d.amount,
          } as any)
          .eq('id', d.id!);
        if (upErr) throw upErr;
      }

      if (toInsert.length > 0) {
        const insertPayloads = toInsert.map(d => ({
          user_id: user.id,
          field_type: d.field_type,
          responsible_id: d.responsible_id,
          responsible_name: d.responsible_name,
          amount: d.amount,
        }));
        const { data, error: insErr } = await supabase
          .from('initial_state_details' as any)
          .insert(insertPayloads as any)
          .select();
        if (insErr) throw insErr;
        const insertedRows = (data as any[]) || [];
        // Mapping tmp-id → uuid real, en orden (insert preserva orden).
        toInsert.forEach((d, i) => {
          if (d.id && insertedRows[i]?.id) {
            idMap.set(d.id, insertedRows[i].id);
          }
        });
      }

      // Solo seteamos initialData (snapshot del row maestro). NO seteamos
      // initialDetails para evitar el loop de autosave: el componente sync-ea
      // los IDs nuevos vía idMap, sin sobrescribir cambios concurrentes.
      setInitialData(stateRow as any);
      setIsConfigured(true);
      setSaveStatus('saved');
      savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2500);
      return idMap;
    } catch (e) {
      console.error('Auto-save error:', e);
      setSaveStatus('error');
      savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 4000);
      return idMap;
    }
  }, [user]);

  // onIdsResolved se llama tras un autosave/save que insertó filas nuevas, con
  // un map tmp-id → uuid real. El componente lo aplica sobre su state local
  // sin perder cambios concurrentes (ej: cliente seleccionado durante el save).
  const onIdsResolvedRef = useRef<((idMap: Map<string, string>) => void) | null>(null);
  const setOnIdsResolved = useCallback((cb: ((idMap: Map<string, string>) => void) | null) => {
    onIdsResolvedRef.current = cb;
  }, []);

  const autoSave = useCallback((formData: InitialStateFormData, newDetails: InitialStateDetail[]) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const idMap = await persistNow(formData, newDetails);
      if (idMap.size > 0) onIdsResolvedRef.current?.(idMap);
    }, AUTOSAVE_DELAY_MS);
  }, [persistNow]);

  const save = useCallback(async (formData: InitialStateFormData, newDetails: InitialStateDetail[]) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const idMap = await persistNow(formData, newDetails);
    if (idMap.size > 0) onIdsResolvedRef.current?.(idMap);
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
    setOnIdsResolved,
  };
}
