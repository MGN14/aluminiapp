import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useSubscription } from '@/hooks/useSubscription';

interface AdminRouteProps {
  children: React.ReactNode;
}

function AdminGate({ children }: AdminRouteProps) {
  const { isAdmin, loading } = useSubscription();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export default function AdminRoute({ children }: AdminRouteProps) {
  return (
    <ProtectedRoute>
      <AdminGate>{children}</AdminGate>
    </ProtectedRoute>
  );
}
