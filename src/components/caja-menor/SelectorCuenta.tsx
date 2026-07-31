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
  /** Cuentas que este usuario no puede usar acá, con el motivo a mostrar. */
  bloqueadas?: Record<string, string>;
}

/**
 * De qué caja sale (o a cuál entra) la plata.
 *
 * Botones y no un <Select>: son dos o tres opciones y esto se llena a diario
 * desde el celular — un tap contra abrir un menú y elegir.
 */
export default function SelectorCuenta({
  value,
  onChange,
  disabled,
  label = 'Caja',
  bloqueadas,
}: Props) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {PETTY_CASH_ACCOUNTS.map((a) => {
          const activa = value === a.id;
          const motivo = bloqueadas?.[a.id];
          const Icon = a.id === 'efectivo' ? Banknote : Smartphone;
          return (
            <Button
              key={a.id}
              type="button"
              variant={activa ? 'default' : 'outline'}
              size="sm"
              disabled={disabled || !!motivo}
              title={motivo}
              onClick={() => onChange(a.id)}
              className={cn('gap-1.5 h-9', activa && 'shadow-sm')}
            >
              <Icon className="h-3.5 w-3.5" />
              {a.label}
            </Button>
          );
        })}
      </div>
      {/* El motivo se muestra siempre, no solo en el tooltip: en celular no hay
          hover y el botón gris sin explicación se lee como si estuviera roto. */}
      {bloqueadas && Object.entries(bloqueadas).map(([id, motivo]) => (
        <p key={id} className="text-[11px] text-muted-foreground">{motivo}</p>
      ))}
    </div>
  );
}
