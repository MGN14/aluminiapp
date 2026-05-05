import { useSubscription } from '@/hooks/useSubscription';
import { useDataOwner } from '@/hooks/useDataOwner';
import { Button } from '@/components/ui/button';
import { Lock } from 'lucide-react';
import { Link } from 'react-router-dom';

interface TrialExpiredOverlayProps {
  children: React.ReactNode;
  /** If true, blocks interaction (for editing sections). If false, content is visible but not editable */
  blockType?: 'edit' | 'create';
  message?: string;
}

export default function TrialExpiredOverlay({ 
  children, 
  blockType = 'edit',
  message = 'Tu prueba gratuita terminó. Activa tu plan para continuar editando tu información.'
}: TrialExpiredOverlayProps) {
  const { trialExpired, loading, isAdmin, isFounder } = useSubscription();
  const { isCollaborator, loading: collabLoading } = useDataOwner();

  // Colaboradores no tienen prueba propia — usan el plan del owner.
  if (collabLoading || isCollaborator) return <>{children}</>;

  // Don't block for admins, founders, or while loading
  if (loading || isAdmin || isFounder || !trialExpired) {
    return <>{children}</>;
  }

  return (
    <div className="relative">
      <div className="pointer-events-none opacity-50 select-none">
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[2px] rounded-lg">
        <div className="text-center p-6 max-w-md">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center">
            <Lock className="h-6 w-6 text-warning" />
          </div>
          <p className="text-sm font-medium text-foreground mb-2">
            {message}
          </p>
          <Link to="/pricing">
            <Button size="sm" className="mt-2">
              Activar Plan
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
