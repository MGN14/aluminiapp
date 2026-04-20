import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { invokeFunctionWithAuthRetry } from '@/lib/authRetry';

const isDev = import.meta.env.MODE === 'development';

export type SubscriptionPlan = 'demo' | 'basico' | 'pro' | 'empresarial' | 'admin';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'inactive';

export interface TrialChecklist {
  statement_uploaded: boolean;
  invoice_uploaded: boolean;
  invoice_matched: boolean;
  dian_reviewed: boolean;
}

interface SubscriptionState {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  subscribed: boolean;
  subscriptionEnd: string | null;
  pdfUploadsTotal: number;
  pdfUploadsThisMonth: number;
  isAdmin: boolean;
  isFounder: boolean;
  planSource: 'founder' | 'admin' | 'database' | null;
  loading: boolean;
  error: string | null;
  // Trial-specific
  isTrialing: boolean;
  trialExpired: boolean;
  trialDaysLeft: number | null;
  trialChecklist: TrialChecklist | null;
}

interface SubscriptionContextType extends SubscriptionState {
  checkSubscription: () => Promise<void>;
  checkUploadLimit: () => Promise<{ canUpload: boolean; message: string }>;
  createWompiCheckout: (planKey?: string) => Promise<string | null>;
  getPlanLimits: () => { pdfLimit: number; bankAccounts: number; historyMonths: number | null; invoiceLimit: number };
  updateTrialChecklist: (key: keyof TrialChecklist) => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

const defaultState: SubscriptionState = {
  plan: 'demo',
  status: 'trialing',
  subscribed: false,
  subscriptionEnd: null,
  pdfUploadsTotal: 0,
  pdfUploadsThisMonth: 0,
  isAdmin: false,
  isFounder: false,
  planSource: null,
  loading: true,
  error: null,
  isTrialing: false,
  trialExpired: false,
  trialDaysLeft: null,
  trialChecklist: null,
};

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user, session, sessionExpired } = useAuth();
  const [state, setState] = useState<SubscriptionState>(defaultState);

  const checkSubscription = useCallback(async (silent = false) => {
    if (!user || sessionExpired) {
      if (isDev) console.log('[PLAN] checkSubscription skipped - no user or expired session');
      setState({ ...defaultState, loading: false });
      return;
    }

    // Session can be transiently null during auth refresh cycles; avoid resetting the whole app state.
    if (!session) {
      if (isDev) console.log('[PLAN] checkSubscription waiting for session');
      return;
    }

    try {
      setState((prev) => ({
        ...prev,
        loading: silent ? prev.loading : true,
        error: null,
      }));

      const result = await invokeFunctionWithAuthRetry<any>(
        'check-subscription',
        {},
        'check-subscription'
      );

      if (result.error || !result.data) {
        if (isDev) console.error('[PLAN] Error from check-subscription:', result.error);
        // On transient failure, keep previous state if we had one (avoid blank screen)
        setState((prev) => ({
          ...prev,
          loading: false,
          error: prev.plan !== 'demo' || prev.subscribed ? null : 'No se pudo validar la suscripción.',
        }));
        return;
      }

      const data = result.data as any;
      let effectivePlan = data.plan || 'demo';

      // Excepción temporal: tratar como pro para acceso a módulos
      const INVOICE_ACCESS_EMAILS = ['niko14_gomez@hotmail.com'];
      if (user?.email && INVOICE_ACCESS_EMAILS.includes(user.email.toLowerCase()) && effectivePlan !== 'pro' && effectivePlan !== 'empresarial' && effectivePlan !== 'admin') {
        effectivePlan = 'pro';
      }

      setState({
        plan: effectivePlan,
        status: data.status || 'active',
        subscribed: data.subscribed || false,
        subscriptionEnd: data.subscription_end || null,
        pdfUploadsTotal: data.pdf_uploads_total || 0,
        pdfUploadsThisMonth: data.pdf_uploads_this_month || 0,
        isAdmin: data.is_admin || false,
        isFounder: data.is_founder || false,
        planSource: data.plan_source || (data.is_admin ? 'admin' : 'database'),
        loading: false,
        error: null,
        isTrialing: data.is_trialing || false,
        trialExpired: data.trial_expired || false,
        trialDaysLeft: data.trial_days_left ?? null,
        trialChecklist: data.trial_checklist || null,
      });
    } catch (err) {
      if (isDev) console.error('[PLAN] Exception in checkSubscription:', err);
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

  const createWompiCheckout = useCallback(async (planKey?: string): Promise<string | null> => {
    if (!user || sessionExpired) return null;

    try {
      const result = await invokeFunctionWithAuthRetry<any>(
        'create-wompi-checkout',
        { body: { plan: planKey || 'basico' } },
        'create-wompi-checkout'
      );

      if (result.error || !result.data) {
        console.error('Error creating Wompi checkout:', result.error);
        return null;
      }

      return result.data.url || null;
    } catch (err) {
      console.error('Error creating Wompi checkout:', err);
      return null;
    }
  }, [user, sessionExpired]);

  const getPlanLimits = useCallback(() => {
    // During trial, give full access (unlimited PDFs/invoices) to maximize data stickiness
    if (state.isTrialing) {
      return { pdfLimit: -1, bankAccounts: 1, historyMonths: null, invoiceLimit: -1 };
    }
    // Map legacy 'pro' to 'empresarial'
    const effectivePlan = state.plan === 'pro' ? 'empresarial' : state.plan;
    switch (effectivePlan) {
      case 'demo':
        return { pdfLimit: 0, bankAccounts: 1, historyMonths: null, invoiceLimit: 0 }; // expired trial
      case 'basico':
        return { pdfLimit: 2, bankAccounts: 1, historyMonths: 24, invoiceLimit: 0 };
      case 'empresarial':
        return { pdfLimit: -1, bankAccounts: 2, historyMonths: null, invoiceLimit: -1 };
      case 'admin':
        return { pdfLimit: -1, bankAccounts: -1, historyMonths: null, invoiceLimit: -1 };
      default:
        return { pdfLimit: 0, bankAccounts: 1, historyMonths: null, invoiceLimit: 0 };
    }
  }, [state.plan, state.isTrialing]);

  const updateTrialChecklist = useCallback(async (key: keyof TrialChecklist) => {
    if (!user || !state.trialChecklist) return;
    const updated = { ...state.trialChecklist, [key]: true };
    setState(prev => ({ ...prev, trialChecklist: updated }));
    // We can't update directly due to RLS, but we can call an edge function or just track locally
    // For now, update via localStorage as a lightweight approach
    localStorage.setItem(`trial_checklist_${user.id}`, JSON.stringify(updated));
  }, [user, state.trialChecklist]);

  useEffect(() => {
    if (user && session && !sessionExpired) {
      void checkSubscription(false);
    } else if (!user || sessionExpired) {
      setState({ ...defaultState, loading: false });
    }
  }, [user, session, sessionExpired, checkSubscription]);

  useEffect(() => {
    if (!user || !session || sessionExpired) return;
    const interval = setInterval(() => {
      void checkSubscription(true);
    }, 60000);
    return () => clearInterval(interval);
  }, [user, session, sessionExpired, checkSubscription]);

  // Merge localStorage checklist with server data
  useEffect(() => {
    if (user && state.trialChecklist) {
      const stored = localStorage.getItem(`trial_checklist_${user.id}`);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as TrialChecklist;
          const merged = {
            statement_uploaded: state.trialChecklist.statement_uploaded || parsed.statement_uploaded,
            invoice_uploaded: state.trialChecklist.invoice_uploaded || parsed.invoice_uploaded,
            invoice_matched: state.trialChecklist.invoice_matched || parsed.invoice_matched,
            dian_reviewed: state.trialChecklist.dian_reviewed || parsed.dian_reviewed,
          };
          if (JSON.stringify(merged) !== JSON.stringify(state.trialChecklist)) {
            setState(prev => ({ ...prev, trialChecklist: merged }));
          }
        } catch {}
      }
    }
  }, [user, state.trialChecklist]);

  return (
    <SubscriptionContext.Provider
      value={{
        ...state,
        checkSubscription,
        checkUploadLimit,
        createWompiCheckout,
        getPlanLimits,
        updateTrialChecklist,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (context === undefined) {
    // Fallback for HMR race conditions — avoids blank screen
    return {
      ...defaultState,
      checkSubscription: async () => {},
      checkUploadLimit: async () => ({ canUpload: false, message: '' }),
      createWompiCheckout: async () => null,
      getPlanLimits: () => ({ pdfLimit: 0, bankAccounts: 1, historyMonths: null, invoiceLimit: 0 }),
      updateTrialChecklist: async () => {},
    } as SubscriptionContextType;
  }
  return context;
}
