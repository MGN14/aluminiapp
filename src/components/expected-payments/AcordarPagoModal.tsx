import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useExpectedPayments } from '@/hooks/useExpectedPayments';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Si está, la promesa se asocia a esta factura. */
  invoice?: {
    id: string;
    invoice_number: string;
    pending: number;
  } | null;
  /** Si no hay factura, podemos asociar la promesa a un cliente directamente. */
  responsible?: {
    id: string;
    name: string;
  } | null;
  onSuccess?: () => void;
}

const todayIso = () => new Date().toISOString().split('T')[0];

// Modal para registrar una promesa de pago de un cliente. Se invoca desde el
// drill-down de una factura en "Lo que me deben" o desde la fila de un cliente.
export default function AcordarPagoModal({ open, onOpenChange, invoice, responsible, onSuccess }: Props) {
  const { create } = useExpectedPayments();
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState(0);
  const [notes, setNotes] = useState('');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      // Defaults al abrir: fecha = hoy +7 días, monto = saldo pendiente.
      const d = new Date();
      d.setDate(d.getDate() + 7);
      setDate(d.toISOString().split('T')[0]);
      setAmount(invoice?.pending ?? 0);
      setNotes('');
      setErrMsg(null);
    }
  }, [open, invoice]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrMsg(null);
    if (amount <= 0) {
      setErrMsg('El monto debe ser mayor a 0');
      return;
    }
    if (!date) {
      setErrMsg('Tenés que poner una fecha');
      return;
    }
    try {
      await create.mutateAsync({
        invoice_id: invoice?.id ?? null,
        responsible_id: responsible?.id ?? null,
        due_date: date,
        amount,
        notes: notes.trim() || null,
      });
      onSuccess?.();
      onOpenChange(false);
    } catch (err: unknown) {
      setErrMsg(err instanceof Error ? err.message : 'Error al guardar');
    }
  };

  const targetLabel = invoice
    ? `Factura ${invoice.invoice_number}`
    : responsible
      ? responsible.name
      : 'Sin factura específica';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Acordar pago de cliente</DialogTitle>
          <DialogDescription className="text-xs">
            Para <span className="font-medium text-foreground">{targetLabel}</span>.
            Aparece en el dashboard ("Cobros próximos") y en el calendario.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm">Fecha acordada *</Label>
              <Input
                type="date"
                required
                value={date}
                onChange={e => setDate(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Monto *</Label>
              <Input
                type="number"
                min={0}
                required
                value={amount || ''}
                onChange={e => setAmount(+e.target.value)}
                className="font-mono"
              />
              {invoice && invoice.pending > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  Saldo pendiente de la factura: ${invoice.pending.toLocaleString('es-CO')}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Nota <span className="text-muted-foreground text-xs">(opcional)</span></Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder='Ej: "Habló el martes, paga el viernes con transferencia"'
              rows={2}
              className="text-sm"
            />
          </div>

          {errMsg && (
            <p className="text-xs text-destructive">{errMsg}</p>
          )}

          <Button type="submit" disabled={create.isPending || amount <= 0} className="w-full">
            {create.isPending ? 'Guardando...' : 'Acordar cobro'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
