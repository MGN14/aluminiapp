import { useSubscription, SubscriptionPlan } from '@/hooks/useSubscription';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { 
  Sparkles, 
  Crown, 
  Rocket, 
  ArrowRight, 
  Settings, 
  Loader2,
  FileText,
  Calendar,
  Shield
} from 'lucide-react';
import { useState } from 'react';

interface PlanConfig {
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeVariant: 'default' | 'secondary' | 'outline';
  badgeClass: string;
  features: string[];
}

const planConfigs: Record<SubscriptionPlan, PlanConfig> = {
  demo: {
    name: 'Plan Demo',
    description: 'Estás usando la versión gratuita',
    icon: Sparkles,
    badgeVariant: 'secondary',
    badgeClass: 'bg-muted text-muted-foreground',
    features: ['1 PDF en total', '1 cuenta bancaria'],
  },
  basico: {
    name: 'Plan Básico',
    description: 'Gestión financiera para tu negocio',
    icon: Crown,
    badgeVariant: 'default',
    badgeClass: 'bg-accent text-accent-foreground',
    features: ['10 PDFs por mes', '1 cuenta bancaria', '6 meses de historial'],
  },
  empresarial: {
    name: 'Plan Empresarial',
    description: 'Solución completa para empresas',
    icon: Rocket,
    badgeVariant: 'default',
    badgeClass: 'bg-primary text-primary-foreground',
    features: ['PDFs ilimitados', 'Hasta 3 cuentas', 'Historial ilimitado'],
  },
  admin: {
    name: 'Enterprise (Internal)',
    description: 'Acceso completo sin límites',
    icon: Shield,
    badgeVariant: 'default',
    badgeClass: 'bg-purple-600 text-white',
    features: ['PDFs ilimitados', 'Todas las funcionalidades', 'Sin restricciones'],
  },
};

export default function PlanStatusCard() {
  const { 
    plan, 
    subscribed, 
    pdfUploadsTotal, 
    pdfUploadsThisMonth, 
    subscriptionEnd,
    openCustomerPortal,
    getPlanLimits,
    isAdmin,
    loading
  } = useSubscription();
  
  const [loadingPortal, setLoadingPortal] = useState(false);
  
  const config = planConfigs[plan];
  const Icon = config.icon;
  const limits = getPlanLimits();
  
  const handleManageSubscription = async () => {
    setLoadingPortal(true);
    try {
      const url = await openCustomerPortal();
      if (url) {
        window.open(url, '_blank');
      }
    } catch (error) {
      console.error('Error opening portal:', error);
    } finally {
      setLoadingPortal(false);
    }
  };

  // Calculate usage
  const usageText = plan === 'demo' 
    ? `${pdfUploadsTotal}/1 PDF usado`
    : plan === 'empresarial' || plan === 'admin'
    ? `${pdfUploadsThisMonth} PDFs este mes`
    : `${pdfUploadsThisMonth}/${limits.pdfLimit} PDFs este mes`;

  const renewalText = subscriptionEnd 
    ? `Renovación: ${new Date(subscriptionEnd).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}`
    : null;

  // Determine card styling based on plan
  const isPrivilegedPlan = plan !== 'demo';

  if (loading) {
    return (
      <Card className="animate-pulse">
        <CardContent className="p-4">
          <div className="h-16 bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={plan === 'demo' ? 'border-warning/30 bg-warning/5' : plan === 'admin' ? 'border-purple-500/30 bg-purple-500/5' : 'border-accent/30 bg-accent/5'}>
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          {/* Plan Info */}
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              plan === 'demo' ? 'bg-warning/10' : plan === 'admin' ? 'bg-purple-500/10' : 'bg-accent/10'
            }`}>
              <Icon className={`h-5 w-5 ${plan === 'demo' ? 'text-warning' : plan === 'admin' ? 'text-purple-500' : 'text-accent'}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{config.name}</span>
                {plan !== 'demo' && (
                  <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/30">
                    Activo
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{config.description}</p>
            </div>
          </div>

          {/* Usage & Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {/* Usage info */}
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <FileText className="h-4 w-4" />
                {usageText}
              </span>
              {renewalText && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {renewalText}
                </span>
              )}
            </div>

            {/* Action buttons - hidden for admin users */}
            {!isAdmin && (
              plan === 'demo' ? (
                <Link to="/pricing">
                  <Button size="sm" className="gap-1">
                    Actualizar plan
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              ) : subscribed && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleManageSubscription}
                  disabled={loadingPortal}
                  className="gap-1"
                >
                  {loadingPortal ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Cargando...
                    </>
                  ) : (
                    <>
                      <Settings className="h-4 w-4" />
                      Gestionar
                    </>
                  )}
                </Button>
              )
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
