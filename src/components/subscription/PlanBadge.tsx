import { Badge } from '@/components/ui/badge';
import { Crown, Sparkles, Star, Shield, Loader2, Zap } from 'lucide-react';
import { SubscriptionPlan, useSubscription } from '@/hooks/useSubscription';

interface PlanBadgeProps {
  plan?: SubscriptionPlan;
  size?: 'sm' | 'md';
  isFounder?: boolean;
}

export default function PlanBadge({ plan: propPlan, size = 'sm', isFounder: propIsFounder }: PlanBadgeProps) {
  const { plan: contextPlan, isFounder: contextIsFounder, isTrialing, trialExpired, trialDaysLeft, loading } = useSubscription();
  
  const plan = propPlan ?? contextPlan;
  const isFounder = propIsFounder ?? contextIsFounder;
  
  const config = {
    demo: {
      label: isTrialing ? 'Empresarial Gratuito' : 'Prueba Expirada',
      icon: isTrialing ? Zap : Star,
      className: isTrialing ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground',
    },
    basico: {
      label: 'Básico',
      icon: Sparkles,
      className: 'bg-primary text-primary-foreground',
    },
    pro: {
      label: 'Pro',
      icon: Crown,
      className: 'bg-warning text-warning-foreground',
    },
    empresarial: {
      label: 'Empresarial',
      icon: Crown,
      className: 'bg-success text-success-foreground',
    },
    admin: {
      label: 'Enterprise (Internal)',
      icon: Shield,
      className: 'bg-purple-600 text-white',
    },
  };

  if (loading) {
    return (
      <Badge className="bg-muted text-muted-foreground text-xs gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Cargando...
      </Badge>
    );
  }

  const displayPlan = isFounder ? 'basico' : plan;
  const { label: baseLabel, icon: Icon, className } = config[displayPlan];
  const label = isFounder ? 'Básico (Admin)' : baseLabel;
  
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';
  
  const finalClassName = isFounder ? 'bg-purple-600 text-white' : className;

  // Show days left during trial
  const trialSuffix = isTrialing && trialDaysLeft !== null && !isFounder ? ` · ${trialDaysLeft}d` : '';

  return (
    <Badge className={`${finalClassName} ${textSize} gap-1`}>
      <Icon className={iconSize} />
      {label}{trialSuffix}
    </Badge>
  );
}
