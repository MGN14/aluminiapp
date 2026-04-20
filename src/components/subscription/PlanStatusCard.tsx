import { useSubscription } from '@/hooks/useSubscription';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { 
  Zap, 
  Crown, 
  Rocket, 
  ArrowRight, 
  Shield,
  FileText,
  Calendar,
  Clock
} from 'lucide-react';

export default function PlanStatusCard() {
  const { 
    plan, 
    pdfUploadsTotal, 
    pdfUploadsThisMonth, 
    subscriptionEnd,
    getPlanLimits,
    isAdmin,
    isFounder,
    loading,
    isTrialing,
    trialExpired,
    trialDaysLeft,
  } = useSubscription();
  
  const limits = getPlanLimits();

  const getDisplayInfo = () => {
    if (isFounder) return { name: 'Plan Básico (Admin)', icon: Crown, description: 'Acceso administrativo' };
    if (plan === 'admin') return { name: 'Enterprise (Internal)', icon: Shield, description: 'Acceso completo sin límites' };
    if (isTrialing) return { name: 'Empresarial Gratuito', icon: Zap, description: 'Acceso completo por 14 días para que pruebes AluminIA sin límites' };
    if (trialExpired) return { name: 'Prueba Expirada', icon: Clock, description: 'Tu prueba gratuita terminó. Activa un plan para continuar.' };
    if (plan === 'basico') return { name: 'Plan Básico', icon: Crown, description: 'Gestión financiera para tu negocio' };
    if (plan === 'pro' || plan === 'empresarial') return { name: 'Plan Empresarial', icon: Rocket, description: 'Solución completa para empresas' };
    return { name: 'Empresarial Gratuito', icon: Zap, description: 'Prueba gratuita' };
  };

  const info = getDisplayInfo();
  const Icon = info.icon;

  const getUsageText = () => {
    if (isFounder) return `Extractos guardados: ${pdfUploadsTotal}/10`;
    if (isTrialing) return `Extractos guardados: ${pdfUploadsTotal}`;
    if (trialExpired) return 'Acceso de solo lectura';
    if (plan === 'empresarial' || plan === 'pro' || plan === 'admin') return `Extractos guardados: ${pdfUploadsTotal}`;
    if (plan === 'basico') return `Extractos guardados: ${pdfUploadsTotal}/${limits.pdfLimit}`;
    return '';
  };

  const getExpirationText = () => {
    if (isTrialing && trialDaysLeft !== null) {
      return `${trialDaysLeft} día${trialDaysLeft !== 1 ? 's' : ''} restante${trialDaysLeft !== 1 ? 's' : ''}`;
    }
    if (trialExpired) return 'Expirado';
    if (!subscriptionEnd) return null;
    const expiresAt = new Date(subscriptionEnd);
    const now = new Date();
    const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 0) return 'Expirado';
    return `Vence en ${daysLeft} día${daysLeft !== 1 ? 's' : ''}`;
  };

  const usageText = getUsageText();
  const expirationText = getExpirationText();

  if (loading) {
    return (
      <Card className="border-muted">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-muted animate-pulse" />
            <div className="space-y-2">
              <div className="h-4 w-32 bg-muted rounded animate-pulse" />
              <div className="h-3 w-48 bg-muted rounded animate-pulse" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const cardColor = trialExpired 
    ? 'border-destructive/30 bg-destructive/5' 
    : isTrialing 
      ? 'border-accent/30 bg-accent/5'
      : plan === 'admin' 
        ? 'border-purple-500/30 bg-purple-500/5' 
        : 'border-accent/30 bg-accent/5';

  const iconColor = trialExpired 
    ? 'bg-destructive/10' 
    : isTrialing 
      ? 'bg-accent/10' 
      : plan === 'admin' 
        ? 'bg-purple-500/10' 
        : 'bg-accent/10';

  const iconTextColor = trialExpired 
    ? 'text-destructive' 
    : isTrialing 
      ? 'text-accent' 
      : plan === 'admin' 
        ? 'text-purple-500' 
        : 'text-accent';

  return (
    <Card className={cardColor}>
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconColor}`}>
              <Icon className={`h-5 w-5 ${iconTextColor}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{info.name}</span>
                {(isTrialing || (plan !== 'demo' && !trialExpired)) && (
                  <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/30">
                    Activo
                  </Badge>
                )}
                {trialExpired && (
                  <Badge variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/30">
                    Expirado
                  </Badge>
                )}
                {isFounder && (
                  <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-600 border-purple-500/30">
                    Interno
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{info.description}</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {usageText && (
                <span className="flex items-center gap-1">
                  <FileText className="h-4 w-4" />
                  {usageText}
                </span>
              )}
              {expirationText && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {expirationText}
                </span>
              )}
            </div>

            {(trialExpired || isTrialing) && !isAdmin && (
              <Link to="/pricing">
                <Button size="sm" className="gap-1">
                  {trialExpired ? 'Activar Plan' : 'Ver planes'}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
