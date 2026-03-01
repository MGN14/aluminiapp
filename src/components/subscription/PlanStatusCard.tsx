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
  Shield,
  FileText,
  Calendar
} from 'lucide-react';

interface PlanConfig {
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  features: string[];
}

const planConfigs: Record<SubscriptionPlan, PlanConfig> = {
  demo: {
    name: 'Plan Demo',
    description: 'Estás usando la versión gratuita',
    icon: Sparkles,
    features: ['1 PDF en total', '1 cuenta bancaria'],
  },
  basico: {
    name: 'Plan Básico',
    description: 'Gestión financiera para tu negocio',
    icon: Crown,
    features: ['10 PDFs por mes', '1 cuenta bancaria', '6 meses de historial'],
  },
  pro: {
    name: 'Plan Pro',
    description: 'Facturación DIAN y gestión avanzada',
    icon: Crown,
    features: ['PDFs ilimitados', 'Módulo Facturas DIAN', '2 cuentas bancarias'],
  },
  empresarial: {
    name: 'Plan Empresarial',
    description: 'Solución completa para empresas',
    icon: Rocket,
    features: ['PDFs ilimitados', 'Hasta 3 cuentas', 'Historial ilimitado'],
  },
  admin: {
    name: 'Enterprise (Internal)',
    description: 'Acceso completo sin límites',
    icon: Shield,
    features: ['PDFs ilimitados', 'Todas las funcionalidades', 'Sin restricciones'],
  },
};

export default function PlanStatusCard() {
  const { 
    plan, 
    pdfUploadsTotal, 
    pdfUploadsThisMonth, 
    subscriptionEnd,
    getPlanLimits,
    isAdmin,
    isFounder,
    loading
  } = useSubscription();
  
  const displayPlan = isFounder ? 'basico' : plan;
  const config = planConfigs[displayPlan];
  const Icon = config.icon;
  const limits = getPlanLimits();
  const displayName = isFounder ? 'Plan Básico (Admin)' : config.name;

  const getUsageText = () => {
    if (isFounder) return `PDFs usados: ${pdfUploadsThisMonth}/10 este mes`;
    if (plan === 'demo') return `PDFs usados: ${pdfUploadsTotal}/1`;
    if (plan === 'empresarial' || plan === 'admin') return `PDFs usados: ${pdfUploadsThisMonth} este mes`;
    return `PDFs usados: ${pdfUploadsThisMonth}/${limits.pdfLimit} este mes`;
  };
  
  const usageText = getUsageText();

  const getExpirationText = () => {
    if (!subscriptionEnd) return null;
    const expiresAt = new Date(subscriptionEnd);
    const now = new Date();
    const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysLeft <= 0) return 'Expirado';
    return `Vence en ${daysLeft} día${daysLeft !== 1 ? 's' : ''}`;
  };

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

  return (
    <Card className={plan === 'demo' ? 'border-warning/30 bg-warning/5' : plan === 'admin' ? 'border-purple-500/30 bg-purple-500/5' : 'border-accent/30 bg-accent/5'}>
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              plan === 'demo' ? 'bg-warning/10' : plan === 'admin' ? 'bg-purple-500/10' : 'bg-accent/10'
            }`}>
              <Icon className={`h-5 w-5 ${plan === 'demo' ? 'text-warning' : plan === 'admin' ? 'text-purple-500' : 'text-accent'}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{displayName}</span>
                {(plan !== 'demo' || isFounder) && (
                  <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/30">
                    Activo
                  </Badge>
                )}
                {isFounder && (
                  <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-600 border-purple-500/30">
                    Interno
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{config.description}</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <FileText className="h-4 w-4" />
                {usageText}
              </span>
              {expirationText && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {expirationText}
                </span>
              )}
            </div>

            {!isAdmin && plan === 'demo' && (
              <Link to="/pricing">
                <Button size="sm" className="gap-1">
                  Ver planes
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
