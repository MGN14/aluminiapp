import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Transaction } from '@/types/transaction';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseTransactionEditOptions {
  debounceMs?: number;
  onError?: (error: Error) => void;
}

interface UseTransactionEditReturn {
  status: SaveStatus;
  errorMessage: string | null;
  updateField: (updates: Partial<Transaction>) => void;
  localTransaction: Transaction;
}

export function useTransactionEdit(
  initialTransaction: Transaction,
  options: UseTransactionEditOptions = {}
): UseTransactionEditReturn {
  const { debounceMs = 600, onError } = options;
  
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
        .update(updates)
        .eq('id', localTransaction.id);

      if (error) throw error;
      
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
  }, [localTransaction.id, onError]);

  const updateField = useCallback((updates: Partial<Transaction>) => {
    // Update local state immediately (optimistic)
    setLocalTransaction(prev => ({ ...prev, ...updates }));
    
    // Accumulate pending updates
    pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...updates };
    
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
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
