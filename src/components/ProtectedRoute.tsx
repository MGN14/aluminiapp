import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useForcePasswordChange } from '@/hooks/useForcePasswordChange';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { useDataOwner } from '@/hooks/useDataOwner';
import { Loader2 } from 'lucide-react';

const isDev = import.meta.env.MODE === 'development';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, session, loading, sessionExpired } = useAuth();
  const { loading: forceLoading, required: forcePasswordChange } = useForcePasswordChange();
  const { isLoading: onboardingLoading, completed: onboardingCompleted } = useOnboardingStatus();
  const { isCollaborator, loading: collabLoading } = useDataOwner();
  const location = useLocation();

  if (isDev) {
    console.log('[AUTH] ProtectedRoute', {
      path: `${location.pathname}${location.search}${location.hash}`,
      loading,
      hasUser: !!user,
      hasSession: !!session,
      sessionExpired,
    });
  }

  // CRITICAL: Never redirect while loading
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
          <p className="text-sm text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  // If the session is known to be expired, DO NOT aggressively redirect.
  // The global SessionExpiredModal will guide the user to re-login.
  if (!user && sessionExpired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-2 px-6 text-center">
          <p className="text-sm text-muted-foreground">Tu sesión expiró. Inicia sesión para continuar.</p>
        </div>
      </div>
    );
  }

  // Only redirect if loading is complete AND we confirmed no user
  if (!user) {
    const from = `${location.pathname}${location.search}${location.hash}`;

    if (isDev) {
      console.log('[AUTH] redirect_to_login', {
        reason: sessionExpired ? 'session_expired' : 'no_user_after_loading',
        from,
        loading,
        hasUser: false,
        hasSession: !!session,
      });
    }

    return <Navigate to="/login" state={{ from }} replace />;
  }

  // Wait for force_password_change flag to resolve before letting the user in.
  if (forceLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  // If the user is flagged, force them through /change-password first.
  if (forcePasswordChange && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  // Force users to complete onboarding before accessing anything else.
  // Fail-open in the hook (onboardingCompleted === true on error) means DB hiccups
  // won't lock anyone out. Exceptions: /onboarding itself, /change-password, /settings
  // (user may legitimately need to adjust something there before finishing).
  // Colaboradores entran a una cuenta ya configurada por el owner — no pasan
  // por onboarding propio.
  const onboardingExempt =
    location.pathname === '/onboarding' ||
    location.pathname === '/change-password' ||
    location.pathname === '/settings' ||
    isCollaborator;

  if (!collabLoading && !onboardingLoading && !onboardingCompleted && !onboardingExempt) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
