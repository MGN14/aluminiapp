import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Info, Loader2 } from 'lucide-react';

const BANKS = [
  'Bancolombia',
  'Davivienda',
  'BBVA',
  'Banco de Bogotá',
  'Occidente',
  'Popular',
  'Otro',
];

const MONTHS = [
  { value: 1, label: 'Enero', short: 'Ene' },
  { value: 2, label: 'Febrero', short: 'Feb' },
  { value: 3, label: 'Marzo', short: 'Mar' },
  { value: 4, label: 'Abril', short: 'Abr' },
  { value: 5, label: 'Mayo', short: 'May' },
  { value: 6, label: 'Junio', short: 'Jun' },
  { value: 7, label: 'Julio', short: 'Jul' },
  { value: 8, label: 'Agosto', short: 'Ago' },
  { value: 9, label: 'Septiembre', short: 'Sep' },
  { value: 10, label: 'Octubre', short: 'Oct' },
  { value: 11, label: 'Noviembre', short: 'Nov' },
  { value: 12, label: 'Diciembre', short: 'Dic' },
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: currentYear - 2020 + 2 }, (_, i) => 2020 + i).reverse();

export function buildDisplayName(
  bankName: string,
  monthNum: number,
  year: number,
  accountNumber?: string
): string {
  const monthShort = MONTHS.find((m) => m.value === monthNum)?.short ?? '';
  let name = `${bankName} ${monthShort} ${year}`;
  if (accountNumber?.trim()) {
    name += ` - ${accountNumber.trim()}`;
  }
  return name;
}

interface StatementConfigModalProps {
  open: boolean;
  statementId: string;
  /** Initial values for edit mode */
  initialBankName?: string;
  initialMonth?: number | null;
  initialYear?: number | null;
  initialAccountNumber?: string | null;
  onSaved: () => void;
  /** If true the modal cannot be dismissed without saving */
  required?: boolean;
}

export default function StatementConfigModal({
  open,
  statementId,
  initialBankName,
  initialMonth,
  initialYear,
  initialAccountNumber,
  onSaved,
  required = false,
}: StatementConfigModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { getPlanLimits, isAdmin, isFounder } = useSubscription();
  const limits = getPlanLimits();

  const [bankName, setBankName] = useState(initialBankName || '');
  const [customBank, setCustomBank] = useState('');
  const [month, setMonth] = useState<string>(initialMonth ? String(initialMonth) : '');
  const [year, setYear] = useState<string>(initialYear ? String(initialYear) : '');
  const [accountNumber, setAccountNumber] = useState(initialAccountNumber || '');
  const [saving, setSaving] = useState(false);

  // Reset when statementId/open changes
  useEffect(() => {
    if (open) {
      setBankName(initialBankName || '');
      setCustomBank('');
      setMonth(initialMonth ? String(initialMonth) : '');
      setYear(initialYear ? String(initialYear) : '');
      setAccountNumber(initialAccountNumber || '');
    }
  }, [open, statementId]);

  const isOtherBank = bankName === 'Otro';
  const effectiveBankName = isOtherBank ? customBank.trim() : bankName;

  const monthNum = parseInt(month);
  const yearNum = parseInt(year);

  const previewName =
    effectiveBankName && monthNum && yearNum
      ? buildDisplayName(effectiveBankName, monthNum, yearNum, accountNumber)
      : '';

  const isValid =
    effectiveBankName.length > 0 &&
    monthNum >= 1 && monthNum <= 12 &&
    yearNum >= 2020;

  const handleSave = async () => {
    if (!isValid) return;
    setSaving(true);

    // Enforce bank account limit
    const newAccount = accountNumber.trim() || null;
    if (newAccount && limits.bankAccounts > 0 && !isAdmin && !isFounder && user) {
      const { data: existingAccounts } = await supabase
        .from('bank_statements')
        .select('account_number')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .not('account_number', 'is', null)
        .neq('id', statementId); // Exclude current statement

      const distinctAccounts = new Set(
        (existingAccounts || []).map(s => s.account_number).filter(Boolean)
      );
      
      if (!distinctAccounts.has(newAccount) && distinctAccounts.size >= limits.bankAccounts) {
        toast({
          title: 'Límite de cuentas bancarias',
          description: `Tu plan permite hasta ${limits.bankAccounts} cuenta${limits.bankAccounts > 1 ? 's' : ''} bancaria${limits.bankAccounts > 1 ? 's' : ''}. Elimina un extracto de otra cuenta o actualiza tu plan.`,
          variant: 'destructive',
        });
        setSaving(false);
        return;
      }
    }

    const periodStart = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
    const periodEnd = new Date(yearNum, monthNum, 0).toISOString().split('T')[0];
    const displayName = buildDisplayName(effectiveBankName, monthNum, yearNum, accountNumber);

    try {
      const { error } = await supabase
        .from('bank_statements')
        .update({
          bank_name: effectiveBankName,
          statement_month: monthNum,
          statement_year: yearNum,
          account_number: accountNumber.trim() || null,
          display_name: displayName,
          period_start: periodStart,
          period_end: periodEnd,
        })
        .eq('id', statementId);

      if (error) {
        // Unique constraint violation
        if (error.code === '23505' || error.message.includes('unique')) {
          toast({
            title: 'Período duplicado',
            description: 'Ya existe un extracto para ese banco y período.',
            variant: 'destructive',
          });
          return;
        }
        throw error;
      }

      toast({
        title: 'Extracto configurado',
        description: displayName,
      });

      onSaved();
    } catch (err: any) {
      console.error(err);
      toast({
        title: 'Error al guardar',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // If required, prevent closing without saving
        if (!v && required) return;
      }}
    >
      <DialogContent className="sm:max-w-md" onInteractOutside={required ? (e) => e.preventDefault() : undefined}>
        <DialogHeader>
          <DialogTitle>Configurar Extracto</DialogTitle>
          <DialogDescription className="flex items-start gap-2 text-sm">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            Esto nos ayuda a organizar mejor tus reportes y comparaciones futuras.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Banco */}
          <div className="space-y-1.5">
            <Label htmlFor="bank">Banco <span className="text-destructive">*</span></Label>
            <Select value={bankName} onValueChange={setBankName}>
              <SelectTrigger id="bank">
                <SelectValue placeholder="Selecciona el banco..." />
              </SelectTrigger>
              <SelectContent>
                {BANKS.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isOtherBank && (
              <Input
                placeholder="Nombre del banco"
                value={customBank}
                onChange={(e) => setCustomBank(e.target.value)}
                autoFocus
              />
            )}
          </div>

          {/* Mes */}
          <div className="space-y-1.5">
            <Label htmlFor="month">Mes <span className="text-destructive">*</span></Label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger id="month">
                <SelectValue placeholder="Selecciona el mes..." />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m) => (
                  <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Año */}
          <div className="space-y-1.5">
            <Label htmlFor="year">Año <span className="text-destructive">*</span></Label>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger id="year">
                <SelectValue placeholder="Selecciona el año..." />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Número de cuenta (opcional) */}
          <div className="space-y-1.5">
            <Label htmlFor="account">Número de cuenta <span className="text-muted-foreground text-xs">(opcional)</span></Label>
            <Input
              id="account"
              placeholder="Ej: 0220"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              maxLength={20}
            />
          </div>

          {/* Preview del display_name */}
          {previewName && (
            <div className="rounded-md bg-muted px-4 py-2.5 text-sm">
              <span className="text-muted-foreground text-xs block mb-0.5">Nombre generado:</span>
              <span className="font-semibold text-foreground">{previewName}</span>
            </div>
          )}

          <Button
            className="w-full"
            onClick={handleSave}
            disabled={!isValid || saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Guardar configuración
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
