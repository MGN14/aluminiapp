import { useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/use-toast';
import type { ModuleKey } from '@/hooks/useCollaborators';

interface RequireModuleProps {
  moduleKey: ModuleKey;
  children: React.ReactNode;
}

function ModuleGate({ moduleKey, children }: RequireModuleProps) {
  const { hasModule, loading } = usePermissions();
  const { toast } = useToast();
  const toastedRef = useRef(false);

  // Si el colaborador no tiene permiso, lanzamos un toast informativo una sola
  // vez antes de redirigir. Sin esto, la redirección silenciosa parece bug.
  const denied = !loading && !hasModule(moduleKey);
  useEffect(() => {
    if (denied && !toastedRef.current) {
      toastedRef.current = true;
      toast({
        title: 'Sin permiso',
        description: 'No tenés acceso a esta sección. Pedile al administrador que te lo habilite.',
        variant: 'destructive',
      });
    }
  }, [denied, toast]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (denied) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export default function RequireModule({ moduleKey, children }: RequireModuleProps) {
  return (
    <ProtectedRoute>
      <ModuleGate moduleKey={moduleKey}>{children}</ModuleGate>
    </ProtectedRoute>
  );
}
