import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';

const isDev = import.meta.env.DEV;

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (isDev) {
    console.log('[ProtectedRoute]', { 
      path: location.pathname, 
      loading, 
      hasUser: !!user
    });
  }

  // CRITICAL: Never redirect while loading
  // This prevents false logouts during initial load or token refresh
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

  // Only redirect if loading is complete AND we confirmed no user
  if (!user) {
    if (isDev) {
      console.log('[ProtectedRoute] No user after load complete, redirecting to login');
    }
    // Store the intended destination so we can redirect back after login
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}
