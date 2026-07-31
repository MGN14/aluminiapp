import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Banknote, Smartphone } from 'lucide-react';
import { PETTY_CASH_ACCOUNTS } from '@/lib/pettyCashAccounts';

interface Props {
  value: string;
  onChange: (cuenta: string) => void;
  disabled?: boolean;
  label?: string;
}

/**
 * De qué cuenta sale (o a cuál entra) la plata.
 *
 * Botones y no un <Select>: son dos o tres opciones y esto se llena a diario
 * desde el celular — un tap contra abrir un menú y elegir.
 */
export default function SelectorCuenta({ value, onChange, disabled, label = 'Cuenta' }: Props) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {PETTY_CASH_ACCOUNTS.map((a) => {
          const activa = value === a.id;
          const Icon = a.id === 'efectivo' ? Banknote : Smartphone;
          return (
            <Button
              key={a.id}
              type="button"
              variant={activa ? 'default' : 'outline'}
              size="sm"
              disabled={disabled}
              onClick={() => onChange(a.id)}
              className={cn('gap-1.5 h-9', activa && 'shadow-sm')}
            >
              <Icon className="h-3.5 w-3.5" />
              {a.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
