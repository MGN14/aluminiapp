import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type SubscriptionPlan = 'demo' | 'basico' | 'empresarial' | 'admin';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'inactive';

interface SubscriptionState {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  subscribed: boolean;
  subscriptionEnd: string | null;
  pdfUploadsTotal: number;
  pdfUploadsThisMonth: number;
  isAdmin: boolean;
  isFounder: boolean;
  planSource: 'stripe' | 'founder' | 'admin' | null;
  loading: boolean;
  error: string | null;
}

interface SubscriptionContextType extends SubscriptionState {
  checkSubscription: () => Promise<void>;
  checkUploadLimit: () => Promise<{ canUpload: boolean; message: string }>;
  createCheckout: (plan: 'basico' | 'empresarial') => Promise<string | null>;
  openCustomerPortal: () => Promise<string | null>;
  getPlanLimits: () => { pdfLimit: number; bankAccounts: number; historyMonths: number | null };
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

const defaultState: SubscriptionState = {
  plan: 'demo',
  status: 'active',
  subscribed: false,
  subscriptionEnd: null,
  pdfUploadsTotal: 0,
  pdfUploadsThisMonth: 0,
  isAdmin: false,
  isFounder: false,
  planSource: null,
  loading: true,
  error: null,
};

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user, session } = useAuth();
  const [state, setState] = useState<SubscriptionState>(defaultState);

  const checkSubscription = useCallback(async () => {
    if (!user) {
      setState({ ...defaultState, loading: false });
      return;
    }

    try {
      setState(prev => ({ ...prev, loading: true, error: null }));
      
      // Get fresh session to avoid expired token issues
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      
      if (!accessToken) {
        // No access token means user isn't properly authenticated
        setState({ ...defaultState, loading: false });
        return;
      }
      
      const { data, error } = await supabase.functions.invoke('check-subscription', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      // Handle auth errors gracefully (session expired, etc.)
      if (error) {
        // Check if it's an auth-related error - reset to default state silently
        if (error.message?.includes('401') || 
            error.message?.includes('Unauthorized') ||
            error.message?.includes('non-2xx')) {
          setState({ ...defaultState, loading: false });
          return;
        }
        throw error;
      }

      setState({
        plan: data.plan || 'demo',
        status: data.status || 'active',
        subscribed: data.subscribed || false,
        subscriptionEnd: data.subscription_end || null,
        pdfUploadsTotal: data.pdf_uploads_total || 0,
        pdfUploadsThisMonth: data.pdf_uploads_this_month || 0,
        isAdmin: data.is_admin || false,
        isFounder: data.is_founder || false,
        planSource: data.plan_source || (data.is_admin ? 'admin' : 'stripe'),
        loading: false,
        error: null,
      });
    } catch (err) {
      const e = err as unknown as { name?: string; message?: string };
      const name = typeof e?.name === 'string' ? e.name : '';
      const message = typeof e?.message === 'string' ? e.message : '';

      // supabase-js may throw (reject) on non-2xx statuses; treat auth failures as a silent reset.
      if (
        name === 'FunctionsHttpError' &&
        (message.includes('non-2xx') || message.includes('401') || message.toLowerCase().includes('unauthorized'))
      ) {
        setState({ ...defaultState, loading: false });
        return;
      }

      console.error('Error checking subscription:', err);
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Error checking subscription',
      }));
    }
  }, [user]);

  const checkUploadLimit = useCallback(async (): Promise<{ canUpload: boolean; message: string }> => {
    if (!user) {
      return { canUpload: false, message: 'Debes iniciar sesión para subir archivos.' };
    }

    try {
      const { data, error } = await supabase.rpc('check_pdf_upload_limit', {
        p_user_id: user.id,
      });

      if (error) throw error;

      // Parse the JSON response from the database function
      const result = typeof data === 'string' ? JSON.parse(data) : data;
      
      return {
        canUpload: result?.can_upload ?? false,
        message: result?.message || '',
      };
    } catch (err) {
      console.error('Error checking upload limit:', err);
      return { canUpload: false, message: 'Error al verificar límites.' };
    }
  }, [user]);

  const createCheckout = useCallback(async (plan: 'basico' | 'empresarial'): Promise<string | null> => {
    if (!user) return null;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) return null;

      const { data, error } = await supabase.functions.invoke('create-checkout', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: { plan },
      });

      if (error) throw error;
      return data.url;
    } catch (err) {
      console.error('Error creating checkout:', err);
      return null;
    }
  }, [user]);

  const openCustomerPortal = useCallback(async (): Promise<string | null> => {
    if (!user) return null;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) return null;

      const { data, error } = await supabase.functions.invoke('customer-portal', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (error) throw error;
      return data.url;
    } catch (err) {
      console.error('Error opening customer portal:', err);
      return null;
    }
  }, [user]);

  const getPlanLimits = useCallback(() => {
    switch (state.plan) {
      case 'demo':
        return { pdfLimit: 1, bankAccounts: 1, historyMonths: null };
      case 'basico':
        return { pdfLimit: 10, bankAccounts: 1, historyMonths: 6 };
      case 'empresarial':
        return { pdfLimit: -1, bankAccounts: 3, historyMonths: null }; // -1 = unlimited
      case 'admin':
        return { pdfLimit: -1, bankAccounts: -1, historyMonths: null }; // No limits
      default:
        return { pdfLimit: 1, bankAccounts: 1, historyMonths: null };
    }
  }, [state.plan]);

  // Check subscription on mount and when user changes
  useEffect(() => {
    if (user && session) {
      checkSubscription();
    } else {
      setState(defaultState);
    }
  }, [user, session, checkSubscription]);

  // Periodic refresh every 60 seconds
  useEffect(() => {
    if (!user || !session) return;

    const interval = setInterval(checkSubscription, 60000);
    return () => clearInterval(interval);
  }, [user, session, checkSubscription]);

  return (
    <SubscriptionContext.Provider
      value={{
        ...state,
        checkSubscription,
        checkUploadLimit,
        createCheckout,
        openCustomerPortal,
        getPlanLimits,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (context === undefined) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return context;
}
