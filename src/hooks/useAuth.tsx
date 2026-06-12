import { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react';
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { AUTH_SESSION_EXPIRED_EVENT, emitSessionExpired, type SessionExpiredDetail } from '@/lib/authSessionEvents';
import {
  startInactivityTracker,
  isSessionInactive,
  clearLastActiveAt,
} from '@/lib/inactivityTracker';
import { logEvent } from '@/lib/analytics';

// CRITICAL: All auth debug logging is strictly dev-only. NEVER log in production.
const isDev = import.meta.env.MODE === 'development';
// Dev-only logging — completely silent in production builds
const authLog = (message: string, data?: unknown) => {
  if (isDev) {
    console.log(`[AUTH] ${message}`, data ?? '');
  }
};

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;

  // UX flags
  sessionExpired: boolean;
  sessionExpiredReason: string | null;

  // Debug telemetry
  lastAuthEvent: AuthChangeEvent | null;
  lastAuthEventAt: number | null;

  signUp: (email: string, password: string, fullName: string, captchaToken?: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string, captchaToken?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  clearSessionExpired: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function setupFetchUnauthorizedLogger() {
  if (!isDev) return;
  if (typeof window === 'undefined') return;
  const w = window as any;
  if (w.__authFetchLoggerInstalled) return;
  w.__authFetchLoggerInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await originalFetch(input, init);

    if (res.status === 401 || res.status === 403) {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      authLog('HTTP_401_403', {
        status: res.status,
        url,
        method: init?.method ?? 'GET',
      });
    }

    return res;
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionExpiredReason, setSessionExpiredReason] = useState<string | null>(null);

  const [lastAuthEvent, setLastAuthEvent] = useState<AuthChangeEvent | null>(null);
  const [lastAuthEventAt, setLastAuthEventAt] = useState<number | null>(null);

  // Prevent multiple initializations (StrictMode)
  const initialized = useRef(false);
  // Track if component is mounted
  const isMounted = useRef(true);
  // Track whether we already received an auth event (avoid getSession overriding it)
  const authEventReceived = useRef(false);
  // Track manual sign-out vs unexpected sign-out
  const manualSignOut = useRef(false);
  const prevUserId = useRef<string | null>(null);

  useEffect(() => {
    if (initialized.current) {
      authLog('Already initialized, skipping');
      return;
    }

    initialized.current = true;
    isMounted.current = true;

    setupFetchUnauthorizedLogger();

    authLog('Initializing auth provider');

    const onSessionExpired = (evt: Event) => {
      const detail = (evt as CustomEvent<SessionExpiredDetail>).detail;
      authLog('session_expired_event', detail);

      setSessionExpired(true);
      setSessionExpiredReason(detail?.reason ?? 'unauthorized');
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, onSessionExpired as EventListener);
    }

    const debugTelemetryEnabled =
      isDev &&
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('debug') === '1';

    const handleAuthChange = (event: AuthChangeEvent, newSession: Session | null) => {
      if (!isMounted.current) return;

      authEventReceived.current = true;

      // Avoid global re-renders on frequent TOKEN_REFRESHED events unless debug UI is enabled
      if (debugTelemetryEnabled || event !== 'TOKEN_REFRESHED') {
        setLastAuthEvent(event);
        setLastAuthEventAt(Date.now());
      }

      authLog('onAuthStateChange', {
        event,
        hasSession: !!newSession,
        hasUser: !!newSession?.user,
      });

      switch (event) {
        case 'TOKEN_REFRESHED': {
          const nextUser = newSession?.user ?? null;

          // Keep stable references for same logged user to prevent app-wide refresh feeling
          setUser((prev) => (prev?.id && nextUser?.id && prev.id === nextUser.id ? prev : nextUser));
          setSession((prev) => {
            if (!newSession) return null;
            return prev?.user?.id === newSession.user?.id ? prev ?? newSession : newSession;
          });

          setSessionExpired(false);
          setSessionExpiredReason(null);
          setLoading(false);
          prevUserId.current = nextUser?.id ?? null;
          break;
        }

        case 'SIGNED_IN':
        case 'USER_UPDATED': {
          setSession(newSession);
          setUser(newSession?.user ?? null);
          setSessionExpired(false);
          setSessionExpiredReason(null);
          setLoading(false);
          prevUserId.current = newSession?.user?.id ?? null;

          // Telemetría: detectar signup nuevo vs login existente.
          // Aplica para cualquier proveedor (email/password, Google OAuth, etc.).
          // Heurística: si user.created_at está dentro de los últimos 5 min,
          // es signup nuevo; si no, es login. localStorage flag evita duplicar
          // el evento de signup si SIGNED_IN se re-dispara (refresh, USER_UPDATED).
          if (event === 'SIGNED_IN' && newSession?.user) {
            const u = newSession.user;
            const flagKey = `aluminia_signup_logged_${u.id}`;
            let alreadyLogged = false;
            try {
              alreadyLogged = typeof window !== 'undefined' && localStorage.getItem(flagKey) === '1';
            } catch { /* localStorage may be unavailable */ }

            if (!alreadyLogged) {
              const createdAt = u.created_at ? new Date(u.created_at).getTime() : 0;
              const isFreshSignup = createdAt > 0 && (Date.now() - createdAt) < 5 * 60 * 1000;
              const provider = (u.app_metadata as { provider?: string } | undefined)?.provider ?? 'email';
              const fullName = (u.user_metadata as { full_name?: string; name?: string } | undefined)?.full_name
                ?? (u.user_metadata as { full_name?: string; name?: string } | undefined)?.name
                ?? null;

              if (isFreshSignup) {
                logEvent('signup', {
                  user_id: u.id,
                  user_email: u.email ?? null,
                  user_name: fullName,
                  props: { provider, source: 'web' },
                });
                try { localStorage.setItem(flagKey, '1'); } catch { /* ignore */ }
              } else {
                logEvent('login', {
                  user_id: u.id,
                  user_email: u.email ?? null,
                  props: { provider },
                });
              }
            }
          }
          break;
        }

        case 'SIGNED_OUT': {
          const hadUserBefore = !!prevUserId.current;
          const wasManual = manualSignOut.current;

          setSession(null);
          setUser(null);
          setLoading(false);

          authLog('SIGNED_OUT', { hadUserBefore, wasManual });

          // Only show session-expired UX if user *was* logged in and this was not a manual sign-out
          if (hadUserBefore && !wasManual) {
            setSessionExpired(true);
            setSessionExpiredReason('signed_out_unexpected');
          }

          manualSignOut.current = false;
          prevUserId.current = null;
          break;
        }

        case 'INITIAL_SESSION': {
          setSession(newSession);
          setUser(newSession?.user ?? null);
          setLoading(false);
          prevUserId.current = newSession?.user?.id ?? null;
          authLog('INITIAL_SESSION', { hasUser: !!newSession?.user });
          break;
        }

        default: {
          // For unknown events, just update if we have a session
          if (newSession) {
            setSession(newSession);
            setUser(newSession.user);
            prevUserId.current = newSession.user.id;
          }
          setLoading(false);
        }
      }
    };

    // Set up the auth state listener FIRST
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(handleAuthChange);

    // Then get the initial session (only if we didn't receive an event yet)
    const getInitialSession = async () => {
      try {
        const {
          data: { session: currentSession },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          authLog('getSession_error', error.message);
          if (isMounted.current) setLoading(false);
          return;
        }

        if (authEventReceived.current) {
          authLog('getSession_skipped', 'Auth event already received');
          return;
        }

        // Sliding inactivity guard: if the cached session is older than the
        // inactivity threshold, force sign out and block auto-login.
        if (currentSession && isSessionInactive()) {
          authLog('getSession_inactive_expired', 'last_active_at older than threshold');
          manualSignOut.current = false;
          await supabase.auth.signOut();
          clearLastActiveAt();
          if (isMounted.current) {
            setSession(null);
            setUser(null);
            setLoading(false);
          }
          emitSessionExpired({ reason: 'inactivity_timeout' });
          return;
        }

        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        setLoading(false);
        prevUserId.current = currentSession?.user?.id ?? null;
        authLog('getSession_ok', { hasUser: !!currentSession?.user });
      } catch (err) {
        authLog('getSession_exception', err);
        if (isMounted.current) setLoading(false);
      }
    };

    getInitialSession();

    return () => {
      authLog('Cleaning up auth provider');
      isMounted.current = false;
      subscription.unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, onSessionExpired as EventListener);
      }
    };
  }, []);

  // Sliding inactivity tracker — active only while user is signed in.
  useEffect(() => {
    if (!user) return;

    authLog('inactivity_tracker_start');
    const stop = startInactivityTracker({
      onExpire: async () => {
        authLog('inactivity_tracker_expired');
        // This is NOT a manual sign-out; we want SessionExpired UX to show.
        manualSignOut.current = false;
        try {
          await supabase.auth.signOut();
        } catch (err) {
          authLog('inactivity_signout_error', err);
        }
        clearLastActiveAt();
        emitSessionExpired({ reason: 'inactivity_timeout' });
      },
    });

    return () => {
      authLog('inactivity_tracker_stop');
      stop();
    };
  }, [user]);

  const signUp = useCallback(async (email: string, password: string, fullName: string, captchaToken?: string) => {
    authLog('signUp_attempt', { email });
    // Un signup siempre crea sesión persistente: pisa cualquier 'false' viejo
    // del checkbox "Recordarme" de un login anterior en este navegador. Sin
    // esto, la cuenta nueva caería en sessionStorage y "se desloguearía sola".
    try { localStorage.setItem('aluminia_remember_me', 'true'); } catch { /* noop */ }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: fullName },
        captchaToken,
      },
    });
    if (error) authLog('signUp_error', error.message);
    // El evento de telemetría 'signup' se emite desde handleAuthChange cuando
    // llega el SIGNED_IN — cubre tanto email/password como Google OAuth con un
    // solo punto de captura. Evita doble emisión.
    return { error };
  }, []);

  const signIn = useCallback(async (email: string, password: string, captchaToken?: string) => {
    authLog('signIn_attempt', { email });
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken },
    });
    if (error) authLog('signIn_error', error.message);
    return { error };
  }, []);

  const signOut = useCallback(async () => {
    authLog('signOut_initiated');
    manualSignOut.current = true;
    clearLastActiveAt();
    await supabase.auth.signOut();
    // Resetear "Recordarme" al default: el flag es por-login, no debe
    // sobrevivir al usuario que lo desmarcó y afectar al próximo login.
    try { localStorage.setItem('aluminia_remember_me', 'true'); } catch { /* noop */ }
  }, []);

  const clearSessionExpired = useCallback(() => {
    setSessionExpired(false);
    setSessionExpiredReason(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        sessionExpired,
        sessionExpiredReason,
        lastAuthEvent,
        lastAuthEventAt,
        signUp,
        signIn,
        signOut,
        clearSessionExpired,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
