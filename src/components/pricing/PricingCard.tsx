import { Check, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface PlanData {
  id: string;
  name: string;
  monthlyPrice: number;
  period: string;
  description: string;
  features: string[];
  cta: string;
  ctaAction: string;
  highlighted: boolean;
  note: string | null;
  badge: string | null;
}

interface PricingCardProps {
  plan: PlanData;
  isAnnual: boolean;
  isCurrentPlan: boolean;
  isLoading: boolean;
  onAction: (action: string) => void;
}

function formatCOP(n: number) {
  return '$' + n.toLocaleString('es-CO');
}

export default function PricingCard({
  plan,
  isAnnual,
  isCurrentPlan,
  isLoading,
  onAction,
}: PricingCardProps) {
  const isFree = plan.monthlyPrice === 0;
  const annualTotal = Math.round(plan.monthlyPrice * 12 * 0.8);
  const annualMonthly = Math.round(annualTotal / 12);
  const annualSavings = plan.monthlyPrice * 12 - annualTotal;

  const displayPrice = isFree
    ? '$0'
    : isAnnual
      ? formatCOP(annualTotal)
      : formatCOP(plan.monthlyPrice);

  const displayPeriod = isFree
    ? 'Para siempre'
    : isAnnual
      ? 'COP / año'
      : 'COP / mes';

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-2xl border-2 bg-card transition-all duration-300',
        plan.highlighted
          ? 'border-success shadow-lg shadow-success/15 scale-[1.03] z-10'
          : 'border-border',
        isCurrentPlan && 'ring-2 ring-primary'
      )}
    >
      {/* Badges */}
      {plan.badge && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <Badge className="bg-success text-success-foreground px-3 py-1 text-xs font-bold shadow-md">
            <Sparkles className="w-3 h-3 mr-1" />
            {plan.badge}
          </Badge>
        </div>
      )}
      {isAnnual && plan.highlighted && (
        <div className="absolute -top-3.5 right-4">
          <Badge className="bg-warning text-warning-foreground px-3 py-1 text-xs font-bold shadow-md">
            Mejor valor
          </Badge>
        </div>
      )}
      {isCurrentPlan && (
        <div className="absolute -top-3.5 right-4">
          <Badge className="bg-primary text-primary-foreground px-3 py-1 text-xs font-bold">
            Tu plan actual
          </Badge>
        </div>
      )}

      <div className="p-6 pb-4 flex flex-col">
        <h3 className="text-lg font-bold text-foreground">{plan.name}</h3>
        <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>

        <div className="mt-5">
          <span className={cn(
            'font-bold text-foreground transition-all duration-300',
            plan.highlighted ? 'text-4xl' : 'text-3xl'
          )}>
            {displayPrice}
          </span>
          <span className="text-muted-foreground ml-1.5 text-sm">{displayPeriod}</span>
        </div>

        {/* Annual sub-info */}
        {!isFree && isAnnual && (
          <div className="mt-2 space-y-1 animate-fade-in">
            <p className="text-xs text-muted-foreground">
              Equivale a {formatCOP(annualMonthly)} COP/mes facturado anualmente
            </p>
            <Badge variant="secondary" className="text-xs bg-success/10 text-success border-success/20">
              🔥 Ahorras {formatCOP(annualSavings)} al año
            </Badge>
          </div>
        )}
      </div>

      <div className="px-6 pb-6 flex-1 flex flex-col">
        <ul className="space-y-2.5 flex-1">
          {plan.features.map((feature, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <Check className={cn(
                'w-4 h-4 flex-shrink-0 mt-0.5',
                plan.highlighted ? 'text-success' : 'text-muted-foreground'
              )} />
              <span className="text-sm text-muted-foreground leading-tight">{feature}</span>
            </li>
          ))}
        </ul>

        {plan.note && (
          <p className="text-xs text-muted-foreground mt-4 italic border-t border-border pt-3">
            💡 {plan.note}
          </p>
        )}

        <div className="mt-6">
          <Button
            className={cn(
              'w-full transition-all duration-300',
              plan.highlighted && 'bg-success hover:bg-success/90 text-success-foreground h-12 text-base font-bold shadow-md'
            )}
            size={plan.highlighted ? 'lg' : 'default'}
            variant={plan.highlighted ? 'default' : plan.id === 'demo' ? 'outline' : 'secondary'}
            disabled={!!isCurrentPlan || isLoading}
            onClick={() => onAction(plan.ctaAction)}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Redirigiendo...
              </>
            ) : isCurrentPlan ? (
              'Plan actual'
            ) : (
              <>
                {plan.cta}
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
