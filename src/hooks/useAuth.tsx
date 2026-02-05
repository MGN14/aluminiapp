import { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react';
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

const isDev = import.meta.env.DEV;

// Dev-only logging
const authLog = (message: string, data?: unknown) => {
  if (isDev) {
    console.log(`[Auth] ${message}`, data ?? '');
  }
};

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  sessionExpired: boolean;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  clearSessionExpired: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  
  // Track if we've completed initial load
  const initialLoadComplete = useRef(false);
  // Track if we're in the middle of a refresh
  const isRefreshing = useRef(false);
  // Store the previous user to detect real logouts vs temporary states
  const previousUser = useRef<User | null>(null);

  // Handle auth state changes
  const handleAuthChange = useCallback((event: AuthChangeEvent, newSession: Session | null) => {
    authLog('Auth state changed', { event, hasSession: !!newSession, userId: newSession?.user?.id });

    switch (event) {
      case 'SIGNED_IN':
        setSession(newSession);
        setUser(newSession?.user ?? null);
        previousUser.current = newSession?.user ?? null;
        setSessionExpired(false);
        setLoading(false);
        authLog('User signed in', { userId: newSession?.user?.id });
        break;

      case 'SIGNED_OUT':
        // Only clear if we're not refreshing
        if (!isRefreshing.current) {
          setSession(null);
          setUser(null);
          previousUser.current = null;
          setLoading(false);
          authLog('User signed out');
        }
        break;

      case 'TOKEN_REFRESHED':
        setSession(newSession);
        setUser(newSession?.user ?? null);
        previousUser.current = newSession?.user ?? null;
        isRefreshing.current = false;
        authLog('Token refreshed successfully');
        break;

      case 'USER_UPDATED':
        setSession(newSession);
        setUser(newSession?.user ?? null);
        previousUser.current = newSession?.user ?? null;
        authLog('User updated');
        break;

      case 'INITIAL_SESSION':
        setSession(newSession);
        setUser(newSession?.user ?? null);
        previousUser.current = newSession?.user ?? null;
        initialLoadComplete.current = true;
        setLoading(false);
        authLog('Initial session loaded', { hasUser: !!newSession?.user });
        break;

      default:
        // For any other event, update state but be cautious
        if (newSession) {
          setSession(newSession);
          setUser(newSession.user);
          previousUser.current = newSession.user;
        }
        authLog('Other auth event', { event });
    }
  }, []);

  useEffect(() => {
    authLog('Setting up auth listener');
    
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(handleAuthChange);

    // THEN get current session (this triggers INITIAL_SESSION event)
    const initSession = async () => {
      try {
        const { data: { session: currentSession }, error } = await supabase.auth.getSession();
        
        if (error) {
          authLog('Error getting session', error);
          setLoading(false);
          return;
        }

        // If we got a session but it might be expired, try to refresh
        if (currentSession) {
          const expiresAt = currentSession.expires_at;
          const now = Math.floor(Date.now() / 1000);
          
          if (expiresAt && expiresAt < now) {
            authLog('Session expired, attempting refresh');
            isRefreshing.current = true;
            
            const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
            
            if (refreshError || !refreshData.session) {
              authLog('Refresh failed', refreshError);
              setSessionExpired(true);
              setSession(null);
              setUser(null);
              isRefreshing.current = false;
              setLoading(false);
              return;
            }
            
            authLog('Session refreshed successfully');
            setSession(refreshData.session);
            setUser(refreshData.session.user);
            previousUser.current = refreshData.session.user;
            isRefreshing.current = false;
          } else {
            // Session is valid
            setSession(currentSession);
            setUser(currentSession.user);
            previousUser.current = currentSession.user;
          }
        }
        
        initialLoadComplete.current = true;
        setLoading(false);
      } catch (err) {
        authLog('Exception getting session', err);
        setLoading(false);
      }
    };

    initSession();

    return () => {
      authLog('Cleaning up auth listener');
      subscription.unsubscribe();
    };
  }, [handleAuthChange]);

  // Proactive token refresh before expiry
  useEffect(() => {
    if (!session?.expires_at) return;

    const expiresAt = session.expires_at * 1000; // Convert to ms
    const now = Date.now();
    const timeUntilExpiry = expiresAt - now;
    
    // Refresh 5 minutes before expiry
    const refreshBuffer = 5 * 60 * 1000;
    const refreshIn = timeUntilExpiry - refreshBuffer;

    if (refreshIn <= 0) {
      // Already past refresh time, refresh now
      authLog('Token close to expiry, refreshing now');
      isRefreshing.current = true;
      supabase.auth.refreshSession().then(({ error }) => {
        isRefreshing.current = false;
        if (error) {
          authLog('Proactive refresh failed', error);
        }
      });
      return;
    }

    authLog('Scheduling token refresh', { refreshInMinutes: Math.round(refreshIn / 60000) });
    
    const timeoutId = setTimeout(() => {
      authLog('Executing scheduled token refresh');
      isRefreshing.current = true;
      supabase.auth.refreshSession().then(({ error }) => {
        isRefreshing.current = false;
        if (error) {
          authLog('Scheduled refresh failed', error);
        }
      });
    }, refreshIn);

    return () => clearTimeout(timeoutId);
  }, [session?.expires_at]);

  const signUp = async (email: string, password: string, fullName: string) => {
    authLog('Sign up attempt', { email });
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: fullName }
      }
    });
    if (error) authLog('Sign up error', error);
    return { error };
  };

  const signIn = async (email: string, password: string) => {
    authLog('Sign in attempt', { email });
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (error) authLog('Sign in error', error);
    return { error };
  };

  const signOut = async () => {
    authLog('Sign out initiated');
    previousUser.current = null;
    await supabase.auth.signOut();
  };

  const clearSessionExpired = useCallback(() => {
    setSessionExpired(false);
  }, []);

  return (
    <AuthContext.Provider value={{ 
      user, 
      session, 
      loading, 
      sessionExpired,
      signUp, 
      signIn, 
      signOut,
      clearSessionExpired
    }}>
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
