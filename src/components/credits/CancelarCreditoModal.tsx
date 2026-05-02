import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Credit } from '@/hooks/useCredits';
import { formatCurrency } from '@/lib/formatters';

const REASONS = [
  { value: 'refinanciado', label: 'Refinanciado (nuevo crédito reemplaza este)' },
  { value: 'acuerdo_pago', label: 'Acuerdo de pago / quita con el banco' },
  { value: 'error_carga', label: 'Error de carga (no debería existir)' },
  { value: 'otro', label: 'Otro' },
] as const;

interface Props {
  open: boolean;
  credit: Credit | null;
  currentBalance: number;
  onClose: () => void;
}

export default function CancelarCreditoModal({ open, credit, currentBalance, onClose }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState<string>('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) {
      setReason('');
      setNotes('');
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!user?.id || !credit) throw new Error('Datos faltantes');
      const fullReason = notes.trim()
        ? `${reason}: ${notes.trim()}`
        : reason;
      const { error } = await (supabase.from('credits' as never) as any)
        .update({
          status: 'cancelled',
          cancellation_reason: fullReason,
          cancelled_at: new Date().toISOString(),
        })
        .eq('id', credit.id)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credits', user?.id] });
      toast({
        title: 'Crédito cancelado',
        description: `"${credit?.name}" salió del cálculo de deuda activa. Histórico de pagos preservado.`,
      });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: 'Error al cancelar',
        description: err?.message ?? 'Error desconocido',
        variant: 'destructive',
      });
    },
  });

  const isProcessing = mutation.isPending;
  const canConfirm = !!reason && !isProcessing;

  if (!credit) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !isProcessing) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-warning/15 flex items-center justify-center shrink-0 mt-0.5">
              <XCircle className="h-5 w-5 text-warning" />
            </div>
            <div>
              <DialogTitle>Cancelar crédito</DialogTitle>
              <DialogDescription className="mt-1">
                Marcá el crédito como cancelado para sacarlo del cálculo de deuda activa, sin perder el histórico de pagos.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-sm">
            <div className="font-medium">{credit.name}</div>
            <div className="text-muted-foreground text-xs">
              {credit.bank_name ?? 'Sin banco'} · Saldo pendiente: <span className="font-medium text-foreground">{formatCurrency(currentBalance)}</span>
            </div>
          </div>

          <div className="rounded-md border border-warning/30 bg-warning/10 p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-medium">Esto NO borra los pagos hechos.</div>
              <div className="text-muted-foreground mt-0.5">
                Los pagos que ya registraste siguen contando en PYG / informes históricos. Solo desaparece la deuda futura del dashboard.
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="reason">Razón</Label>
            <Select value={reason} onValueChange={setReason} disabled={isProcessing}>
              <SelectTrigger id="reason">
                <SelectValue placeholder="Seleccioná una razón" />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="notes">Detalles (opcional)</Label>
            <Textarea
              id="notes"
              placeholder="Ej: refinanciado por crédito #1234 con tasa 1.4% mensual"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isProcessing}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isProcessing}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={!canConfirm}
          >
            {isProcessing ? (
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Cancelando...</>
            ) : (
              <><XCircle className="h-4 w-4 mr-1.5" /> Confirmar cancelación</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
