import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { invokeFunctionWithAuthRetry } from '@/lib/authRetry';

// CRITICAL: All plan debug logging is strictly dev-only
const isDev = import.meta.env.DEV;

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
  const { user, session, sessionExpired } = useAuth();
  const [state, setState] = useState<SubscriptionState>(defaultState);

  const checkSubscription = useCallback(async () => {
    if (!user || !session || sessionExpired) {
      if (isDev) console.log('[PLAN] checkSubscription skipped - no user/session', { 
        hasUser: !!user, 
        hasSession: !!session, 
        sessionExpired 
      });
      setState({ ...defaultState, loading: false });
      return;
    }

    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      if (isDev) console.log('[PLAN] Checking subscription for user:', user.email);

      const result = await invokeFunctionWithAuthRetry<any>(
        'check-subscription',
        {},
        'check-subscription'
      );

      if (result.error || !result.data) {
        if (isDev) console.error('[PLAN] Error from check-subscription:', result.error);
        // IMPORTANT: NEVER sign out here. Auth errors are handled by session-expired UX.
        // Keep current plan state, don't reset to demo on transient errors
        setState((prev) => ({
          ...prev,
          loading: false,
          error: 'No se pudo validar la suscripción.',
        }));
        return;
      }

      const data = result.data as any;

      if (isDev) console.log('[PLAN] Subscription data received:', {
        user_id: user.id,
        email: user.email,
        plan: data.plan,
        plan_source: data.plan_source,
        status: data.status,
        is_admin: data.is_admin,
        is_founder: data.is_founder,
        subscribed: data.subscribed,
        stripe_customer_id: data.stripe_customer_id || null,
      });

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
      if (isDev) console.error('[PLAN] Exception in checkSubscription:', err);
      // On error, keep previous state, just mark as not loading
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Error checking subscription',
      }));
    }
  }, [user, session, sessionExpired]);

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
    if (!user || sessionExpired) return null;

    try {
      const { data, error } = await invokeFunctionWithAuthRetry<any>(
        'create-checkout',
        {
          body: { plan },
        },
        'create-checkout'
      );

      if (error) throw error;
      return data.url;
    } catch (err) {
      console.error('Error creating checkout:', err);
      return null;
    }
  }, [user, sessionExpired]);

  const openCustomerPortal = useCallback(async (): Promise<string | null> => {
    if (!user || sessionExpired) return null;

    try {
      const { data, error } = await invokeFunctionWithAuthRetry<any>(
        'customer-portal',
        {},
        'customer-portal'
      );

      if (error) throw error;
      return data.url;
    } catch (err) {
      console.error('Error opening customer portal:', err);
      return null;
    }
  }, [user, sessionExpired]);

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
    if (user && session && !sessionExpired) {
      checkSubscription();
    } else {
      setState(defaultState);
    }
  }, [user, session, sessionExpired, checkSubscription]);

  // Periodic refresh every 60 seconds
  useEffect(() => {
    if (!user || !session || sessionExpired) return;

    const interval = setInterval(checkSubscription, 60000);
    return () => clearInterval(interval);
  }, [user, session, sessionExpired, checkSubscription]);

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
