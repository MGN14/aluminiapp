import { useSubscription } from '@/hooks/useSubscription';
import { Button } from '@/components/ui/button';
import { Clock, Zap, AlertTriangle, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function TrialBanner() {
  const { isTrialing, trialExpired, trialDaysLeft, loading, isAdmin, isFounder, plan } = useSubscription();

  // Don't show for admins, founders, paid plans, or while loading
  if (loading || isAdmin || isFounder || (plan !== 'demo')) return null;
  if (!isTrialing && !trialExpired) return null;

  if (trialExpired) {
    return (
      <div className="bg-destructive text-destructive-foreground">
        <div className="container mx-auto px-4 py-2.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <XCircle className="h-4 w-4 flex-shrink-0" />
            <span>Tu prueba gratuita terminó. Activa tu plan para seguir trabajando sin interrupciones.</span>
          </div>
          <Link to="/pricing">
            <Button size="sm" variant="secondary" className="whitespace-nowrap text-xs font-semibold">
              Activar Plan
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Active trial
  const days = trialDaysLeft ?? 0;
  
  let message: string;
  let Icon = Clock;
  let bgClass = 'bg-accent text-accent-foreground';

  if (days >= 8) {
    message = `Te quedan ${days} días de acceso Empresarial Gratuito. Explora todas las funciones sin límites.`;
    Icon = Zap;
    bgClass = 'bg-accent text-accent-foreground';
  } else if (days >= 4) {
    message = `Te quedan ${days} días. Ya probaste el módulo fiscal. Activa tu plan para mantener tus datos activos.`;
    Icon = Clock;
    bgClass = 'bg-warning text-warning-foreground';
  } else if (days >= 2) {
    message = `Tu acceso termina en ${days} días. No pierdas la continuidad de tu información.`;
    Icon = AlertTriangle;
    bgClass = 'bg-warning text-warning-foreground';
  } else {
    message = 'Tu prueba termina hoy. Activa tu plan para seguir trabajando sin interrupciones.';
    Icon = AlertTriangle;
    bgClass = 'bg-destructive text-destructive-foreground';
  }

  return (
    <div className={bgClass}>
      <div className="container mx-auto px-4 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4 flex-shrink-0" />
          <span className="hidden sm:inline">{message}</span>
          <span className="sm:hidden">
            {days >= 2 ? `${days} días restantes` : 'Tu prueba termina hoy'}
          </span>
        </div>
        <Link to="/pricing">
          <Button size="sm" variant="secondary" className="whitespace-nowrap text-xs font-semibold">
            Activar Plan
          </Button>
        </Link>
      </div>
    </div>
  );
}
