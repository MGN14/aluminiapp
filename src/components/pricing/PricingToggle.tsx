import { cn } from '@/lib/utils';
import { Flame } from 'lucide-react';

interface PricingToggleProps {
  isAnnual: boolean;
  onToggle: (annual: boolean) => void;
}

export default function PricingToggle({ isAnnual, onToggle }: PricingToggleProps) {
  return (
    <div className="flex items-center justify-center gap-1 p-1 rounded-full bg-muted border border-border max-w-xs mx-auto">
      <button
        onClick={() => onToggle(false)}
        className={cn(
          'px-5 py-2 rounded-full text-sm font-semibold transition-all duration-300',
          !isAnnual
            ? 'bg-card text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        Mensual
      </button>
      <button
        onClick={() => onToggle(true)}
        className={cn(
          'px-5 py-2 rounded-full text-sm font-semibold transition-all duration-300 flex items-center gap-1.5',
          isAnnual
            ? 'bg-success text-success-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        Anual
        <span className={cn(
          'text-xs font-bold transition-colors',
          isAnnual ? 'text-success-foreground' : 'text-success'
        )}>
          -20%
        </span>
        <Flame className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
