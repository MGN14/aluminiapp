import { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react';
import { User, Session, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

const isDev = import.meta.env.DEV;

// Dev-only logging with timestamp
const authLog = (message: string, data?: unknown) => {
  if (isDev) {
    const time = new Date().toISOString().split('T')[1].slice(0, 12);
    console.log(`[Auth ${time}] ${message}`, data ?? '');
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
  
  // Prevent multiple initializations
  const initialized = useRef(false);
  // Track if component is mounted
  const isMounted = useRef(true);

  useEffect(() => {
    // Prevent double initialization in StrictMode
    if (initialized.current) {
      authLog('Already initialized, skipping');
      return;
    }
    initialized.current = true;
    isMounted.current = true;
    
    authLog('Initializing auth provider');

    // Handle auth state changes
    const handleAuthChange = (event: AuthChangeEvent, newSession: Session | null) => {
      if (!isMounted.current) return;
      
      authLog('Auth state change', { event, hasSession: !!newSession });

      switch (event) {
        case 'SIGNED_IN':
        case 'TOKEN_REFRESHED':
        case 'USER_UPDATED':
          setSession(newSession);
          setUser(newSession?.user ?? null);
          setSessionExpired(false);
          setLoading(false);
          break;

        case 'SIGNED_OUT':
          setSession(null);
          setUser(null);
          setLoading(false);
          authLog('User signed out');
          break;

        case 'INITIAL_SESSION':
          setSession(newSession);
          setUser(newSession?.user ?? null);
          setLoading(false);
          authLog('Initial session', { hasUser: !!newSession?.user });
          break;

        default:
          // For unknown events, just update if we have a session
          if (newSession) {
            setSession(newSession);
            setUser(newSession.user);
          }
          setLoading(false);
      }
    };

    // Set up the auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(handleAuthChange);

    // Then get the initial session
    // This is needed because onAuthStateChange might not fire immediately
    const getInitialSession = async () => {
      try {
        const { data: { session: currentSession }, error } = await supabase.auth.getSession();
        
        if (error) {
          authLog('Error getting session', error.message);
          if (isMounted.current) {
            setLoading(false);
          }
          return;
        }

        // Only set state if we haven't received an auth event yet
        if (isMounted.current && loading) {
          setSession(currentSession);
          setUser(currentSession?.user ?? null);
          setLoading(false);
          authLog('Got initial session', { hasUser: !!currentSession?.user });
        }
      } catch (err) {
        authLog('Exception getting session', err);
        if (isMounted.current) {
          setLoading(false);
        }
      }
    };

    getInitialSession();

    return () => {
      authLog('Cleaning up auth provider');
      isMounted.current = false;
      subscription.unsubscribe();
    };
  }, []); // Empty deps - only run once

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
    authLog('Sign up attempt', { email });
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: fullName }
      }
    });
    if (error) authLog('Sign up error', error.message);
    return { error };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    authLog('Sign in attempt', { email });
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (error) authLog('Sign in error', error.message);
    return { error };
  }, []);

  const signOut = useCallback(async () => {
    authLog('Sign out initiated');
    await supabase.auth.signOut();
  }, []);

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
