import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { BankPayment } from '@/hooks/useUnassignedBankPayments';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

interface Props {
  payment: BankPayment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AsignarPagoBancarioModal({ payment, open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [responsibleId, setResponsibleId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (payment) {
      setResponsibleId(payment.responsible_id ?? '');
    } else {
      setResponsibleId('');
    }
  }, [payment]);

  const { data: responsibles = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['responsibles-asignar-pago', user?.id],
    enabled: !!user?.id && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('responsibles')
        .select('id, name')
        .eq('user_id', user!.id)
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const handleSubmit = async () => {
    if (!payment || !responsibleId) {
      toast({ title: 'Falta beneficiario', description: 'Seleccioná un cliente.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('transactions')
        .update({
          responsible_id: responsibleId,
          operative_receivable_assigned: true,
        })
        .eq('id', payment.id);
      if (error) throw error;

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['unassigned-bank-payments'] }),
        queryClient.invalidateQueries({ queryKey: ['assigned-operative-payments'] }),
        queryClient.invalidateQueries({ queryKey: ['operative-receivables'] }),
      ]);
      toast({ title: 'Pago asignado a Cartera Operativa' });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Asignar pago a Cartera Operativa</DialogTitle>
          <DialogDescription>
            Esto descuenta de la deuda operativa del cliente sin tocar la conciliación DIAN —
            la transacción sigue marcada como pendiente de factura.
          </DialogDescription>
        </DialogHeader>

        {payment && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Fecha</span>
                <span className="font-medium">
                  {format(parseLocalDate(payment.date), 'dd MMM yyyy', { locale: es })}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Monto</span>
                <span className="font-semibold text-success">{formatCurrency(payment.credit)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Concepto</span>
                <span className="text-right truncate max-w-[60%]" title={payment.description}>
                  {payment.description || '—'}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="responsible">Beneficiario</Label>
              <Select value={responsibleId} onValueChange={setResponsibleId}>
                <SelectTrigger id="responsible">
                  <SelectValue placeholder="Seleccionar cliente" />
                </SelectTrigger>
                <SelectContent>
                  {responsibles.length === 0 ? (
                    <div className="text-xs text-muted-foreground p-2">
                      No tenés beneficiarios. Creá uno desde Conciliación bancaria.
                    </div>
                  ) : (
                    responsibles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={saving || !responsibleId}>
            {saving ? 'Asignando...' : 'Asignar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
