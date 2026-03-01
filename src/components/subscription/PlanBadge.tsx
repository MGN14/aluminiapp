import { Badge } from '@/components/ui/badge';
import { Crown, Sparkles, Star, Shield, Loader2 } from 'lucide-react';
import { SubscriptionPlan, useSubscription } from '@/hooks/useSubscription';

interface PlanBadgeProps {
  plan?: SubscriptionPlan;
  size?: 'sm' | 'md';
  isFounder?: boolean;
}

export default function PlanBadge({ plan: propPlan, size = 'sm', isFounder: propIsFounder }: PlanBadgeProps) {
  const { plan: contextPlan, isFounder: contextIsFounder, loading } = useSubscription();
  
  // Use props if provided, otherwise use context
  const plan = propPlan ?? contextPlan;
  const isFounder = propIsFounder ?? contextIsFounder;
  
  const config = {
    demo: {
      label: 'Demo',
      icon: Star,
      variant: 'secondary' as const,
      className: 'bg-muted text-muted-foreground',
    },
    basico: {
      label: 'Básico',
      icon: Sparkles,
      variant: 'default' as const,
      className: 'bg-primary text-primary-foreground',
    },
    pro: {
      label: 'Pro',
      icon: Crown,
      variant: 'default' as const,
      className: 'bg-warning text-warning-foreground',
    },
    empresarial: {
      label: 'Empresarial',
      icon: Crown,
      variant: 'default' as const,
      className: 'bg-success text-success-foreground',
    },
    admin: {
      label: 'Enterprise (Internal)',
      icon: Shield,
      variant: 'default' as const,
      className: 'bg-purple-600 text-white',
    },
  };

  // While loading, show a loading badge instead of "Demo"
  if (loading) {
    return (
      <Badge className="bg-muted text-muted-foreground text-xs gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Cargando...
      </Badge>
    );
  }

  // For founder, show basico plan with (Admin) suffix
  const displayPlan = isFounder ? 'basico' : plan;
  const { label: baseLabel, icon: Icon, className } = config[displayPlan];
  const label = isFounder ? 'Básico (Admin)' : baseLabel;
  
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';
  
  // Founder gets purple styling
  const finalClassName = isFounder ? 'bg-purple-600 text-white' : className;

  return (
    <Badge className={`${finalClassName} ${textSize} gap-1`}>
      <Icon className={iconSize} />
      {label}
    </Badge>
  );
}
