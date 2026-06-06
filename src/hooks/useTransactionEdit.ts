import { useState, useCallback, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Transaction, IVA_RATE, RETEFUENTE_RATE } from '@/types/transaction';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseTransactionEditOptions {
  debounceMs?: number;
  onError?: (error: Error) => void;
  reteicaRate?: number; // Rate from user settings
}

interface UseTransactionEditReturn {
  status: SaveStatus;
  errorMessage: string | null;
  updateField: (updates: Partial<Transaction>) => void;
  localTransaction: Transaction;
}

// COP no usa centavos en transacciones reales — las 3 retenciones redondean
// al peso entero para evitar drift acumulativo y mantener cuadre con totales.

function calculateIvaAmount(amount: number | null, hasIva: boolean, type: string): number {
  if (!hasIva || type === 'transferencia') return 0;
  return Math.round(Math.abs(amount ?? 0) * IVA_RATE);
}

function calculateRetefuenteAmount(amount: number | null, hasRetefuente: boolean, type: string): number {
  if (!hasRetefuente || type !== 'egreso') return 0;
  return Math.round(Math.abs(amount ?? 0) * RETEFUENTE_RATE);
}

function calculateReteicaAmount(amount: number | null, hasReteica: boolean, type: string, reteicaRate: number): number {
  if (!hasReteica || type !== 'ingreso' || reteicaRate <= 0) return 0;
  return Math.round(Math.abs(amount ?? 0) * reteicaRate);
}

// Get IVA type based on transaction type
function getIvaType(type: string, hasIva: boolean): 'debito' | 'credito' | null {
  if (!hasIva || type === 'transferencia') return null;
  return type === 'ingreso' ? 'debito' : 'credito';
}

export function useTransactionEdit(
  initialTransaction: Transaction,
  options: UseTransactionEditOptions = {}
): UseTransactionEditReturn {
  const { debounceMs = 600, onError, reteicaRate = 0 } = options;
  const queryClient = useQueryClient();

  const [localTransaction, setLocalTransaction] = useState<Transaction>(initialTransaction);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const pendingUpdatesRef = useRef<Partial<Transaction>>({});
  const savedTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Sync with external changes (e.g., after initial load)
  useEffect(() => {
    setLocalTransaction(initialTransaction);
  }, [initialTransaction.id]);

  const saveToDatabase = useCallback(async (updates: Partial<Transaction>) => {
    setStatus('saving');
    setErrorMessage(null);
    
    try {
      const { error } = await supabase
        .from('transactions')
        // `as never`: movement_nature es columna nueva (migración) aún no en los
        // tipos generados de Supabase. El resto de campos siguen tipados arriba.
        .update(updates as never)
        .eq('id', localTransaction.id);

      if (error) throw error;

      // Invalidar queries que derivan de transactions. El staleTime global
      // de 60s hace que sin esto, "Relación de pagos" sirva cache viejo
      // si el usuario navega ahí dentro de ese minuto.
      queryClient.invalidateQueries({ queryKey: ['payments-log-v4'] });
      queryClient.invalidateQueries({ queryKey: ['payments-log-counterparty-summary-v6'] });
      queryClient.invalidateQueries({ queryKey: ['payments-log-counterparties-v5'] });
      queryClient.invalidateQueries({ queryKey: ['payments-log-invoice-totals'] });

      setStatus('saved');
      pendingUpdatesRef.current = {};
      
      // Clear "saved" status after 2 seconds
      if (savedTimeoutRef.current) {
        clearTimeout(savedTimeoutRef.current);
      }
      savedTimeoutRef.current = setTimeout(() => {
        setStatus('idle');
      }, 2000);
      
    } catch (error) {
      console.error('Error saving transaction:', error);
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Error al guardar');
      onError?.(error instanceof Error ? error : new Error('Unknown error'));
    }
  }, [localTransaction.id, onError, queryClient]);

  const updateField = useCallback((updates: Partial<Transaction>) => {
    let computedUpdates: Partial<Transaction> = { ...updates };
    
    // Apply updates and recalculate computed fields
    setLocalTransaction(prev => {
      const merged = { ...prev, ...updates };
      const type = merged.type || 'egreso';
      
      // Recalculate IVA when has_iva or type changes
      if ('has_iva' in updates || 'type' in updates || 'amount' in updates) {
        merged.iva_amount = calculateIvaAmount(merged.amount, merged.has_iva, type);
        merged.iva_type = getIvaType(type, merged.has_iva);
        
        // Auto-disable IVA for transfers
        if (type === 'transferencia') {
          merged.has_iva = false;
          merged.iva_amount = 0;
          merged.iva_type = null;
        }
        
        // Add computed fields to save
        computedUpdates.iva_amount = merged.iva_amount;
        computedUpdates.iva_type = merged.iva_type;
        computedUpdates.has_iva = merged.has_iva;
      }
      
      // Recalculate Retefuente when has_retefuente or type changes
      if ('has_retefuente' in updates || 'type' in updates || 'amount' in updates) {
        merged.retefuente_amount = calculateRetefuenteAmount(merged.amount, merged.has_retefuente, type);
        
        // Auto-disable retefuente for non-expenses
        if (type !== 'egreso') {
          merged.has_retefuente = false;
          merged.retefuente_amount = 0;
        }
        
        // Add computed fields to save
        computedUpdates.retefuente_amount = merged.retefuente_amount;
        computedUpdates.has_retefuente = merged.has_retefuente;
      }
      
      // Recalculate ReteICA when has_reteica or type changes (only for income)
      if ('has_reteica' in updates || 'type' in updates || 'amount' in updates) {
        merged.reteica_amount = calculateReteicaAmount(merged.amount, merged.has_reteica, type, reteicaRate);
        
        // Auto-disable reteica for non-income
        if (type !== 'ingreso') {
          merged.has_reteica = false;
          merged.reteica_amount = 0;
        }
        
        // Add computed fields to save
        computedUpdates.reteica_amount = merged.reteica_amount;
        computedUpdates.has_reteica = merged.has_reteica;
      }
      
      return merged;
    });
    
    // Accumulate pending updates
    pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...computedUpdates };
    
    // Clear existing debounce timer
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    
    // Set new debounce timer
    debounceRef.current = setTimeout(() => {
      const updatesToSave = { ...pendingUpdatesRef.current };
      if (Object.keys(updatesToSave).length > 0) {
        saveToDatabase(updatesToSave);
      }
    }, debounceMs);
  }, [debounceMs, saveToDatabase]);

  // Cleanup on unmount — flush pending updates antes de salir.
  // Bug real: si el usuario cambia un campo y navega antes del debounce
  // (600ms), el cambio se perdía. El pendingUpdatesRef tenía los cambios
  // pero el clearTimeout cancelaba el save y nunca se persistía.
  // El fetch en supabase-js sobrevive a un unmount SPA (no se cancela
  // hasta que se cierre la pestaña), así que fire-and-forget es seguro.
  const saveRef = useRef(saveToDatabase);
  useEffect(() => { saveRef.current = saveToDatabase; }, [saveToDatabase]);
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        const pending = pendingUpdatesRef.current;
        if (Object.keys(pending).length > 0) {
          saveRef.current(pending);
          pendingUpdatesRef.current = {};
        }
      }
      if (savedTimeoutRef.current) {
        clearTimeout(savedTimeoutRef.current);
      }
    };
  }, []);

  return {
    status,
    errorMessage,
    updateField,
    localTransaction,
  };
}
