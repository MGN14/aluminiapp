import { Badge } from '@/components/ui/badge';
import { Crown, Sparkles, Star, Shield } from 'lucide-react';
import { SubscriptionPlan } from '@/hooks/useSubscription';

interface PlanBadgeProps {
  plan: SubscriptionPlan;
  size?: 'sm' | 'md';
}

export default function PlanBadge({ plan, size = 'sm' }: PlanBadgeProps) {
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

  const { label, icon: Icon, className } = config[plan];
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <Badge className={`${className} ${textSize} gap-1`}>
      <Icon className={iconSize} />
      {label}
    </Badge>
  );
}
