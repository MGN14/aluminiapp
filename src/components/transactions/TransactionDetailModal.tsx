import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Transaction, IVA_RATE, RETEFUENTE_RATE } from '@/types/transaction';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  transaction: Transaction | null;
  open: boolean;
  onClose: () => void;
}

function formatCurrency(value: number | null) {
  // Ocultamos los ceros: en un movimiento bancario el débito O el crédito es 0
  // (nunca ambos), y el saldo suele no venir. Mostrar "$0" llena el detalle de
  // ceros sin valor. '—' = "no aplica".
  if (value === null || value === undefined || value === 0) return '—';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function TransactionDetailModal({ transaction, open, onClose }: Props) {
  const queryClient = useQueryClient();
  // IVA/Retefuente son atributos tributarios del PAGO — se editan acá, no en
  // el selector de factura (de donde salieron). Los montos se recalculan con
  // las mismas fórmulas de useTransactionEdit.
  const [hasIva, setHasIva] = useState(false);
  const [hasRetefuente, setHasRetefuente] = useState(false);
  const [savingTax, setSavingTax] = useState(false);

  useEffect(() => {
    setHasIva(!!transaction?.has_iva);
    setHasRetefuente(!!transaction?.has_retefuente);
  }, [transaction?.id, transaction?.has_iva, transaction?.has_retefuente]);

  const saveTax = async (field: 'has_iva' | 'has_retefuente', value: boolean) => {
    if (!transaction) return;
    setSavingTax(true);
    const amountAbs = Math.abs(transaction.amount ?? 0);
    const patch: Record<string, unknown> = field === 'has_iva'
      ? { has_iva: value, iva_amount: value && transaction.type !== 'transferencia' ? Math.round(amountAbs * IVA_RATE) : 0 }
      : { has_retefuente: value, retefuente_amount: value && transaction.type === 'egreso' ? Math.round(amountAbs * RETEFUENTE_RATE) : 0 };
    const { error } = await supabase.from('transactions').update(patch).eq('id', transaction.id);
    if (!error) {
      if (field === 'has_iva') setHasIva(value); else setHasRetefuente(value);
      queryClient.invalidateQueries({ queryKey: ['conciliacion'] });
    }
    setSavingTax(false);
  };

  if (!transaction) return null;

  const isReconciled = !!transaction.responsible_id;
  const hasInvoice = !!(transaction as any).invoice_id;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Detalle de Transacción</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground">Fecha</label>
              <p className="font-medium">
                {format(parseLocalDate(transaction.date), 'dd MMMM yyyy', { locale: es })}
              </p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Monto</label>
              <p className={`font-bold ${(transaction.amount ?? 0) >= 0 ? 'text-success' : 'text-destructive'}`}>
                {formatCurrency(transaction.amount)}
              </p>
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Descripción Completa</label>
            <p className="font-medium text-sm bg-muted/50 p-3 rounded-lg">
              {transaction.description}
            </p>
          </div>

          {transaction.raw_line && (
            <div>
              <label className="text-xs text-muted-foreground">Línea Original del PDF</label>
              <p className="font-mono text-xs bg-muted/50 p-3 rounded-lg overflow-x-auto">
                {transaction.raw_line}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground">Sucursal</label>
              <p className="text-sm">{transaction.sucursal || '-'}</p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Dcto</label>
              <p className="text-sm">{transaction.dcto || '-'}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-muted-foreground">Débito</label>
              <p className="text-sm text-destructive">{formatCurrency(transaction.debit)}</p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Crédito</label>
              <p className="text-sm text-success">{formatCurrency(transaction.credit)}</p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Saldo</label>
              <p className="text-sm font-medium">{formatCurrency(transaction.balance)}</p>
            </div>
          </div>

          {/* Atributos tributarios del pago (viven acá, no en el selector de factura) */}
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border">
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <p className="text-sm font-medium">IVA incluido</p>
                <p className="text-[11px] text-muted-foreground">
                  {hasIva && transaction.iva_amount
                    ? `${formatCurrency(transaction.iva_amount)} (19%)`
                    : 'El pago incluye IVA'}
                </p>
              </div>
              <Switch
                checked={hasIva}
                disabled={savingTax || transaction.type === 'transferencia'}
                onCheckedChange={(v) => saveTax('has_iva', v)}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <p className="text-sm font-medium">Retefuente</p>
                <p className="text-[11px] text-muted-foreground">
                  {hasRetefuente && transaction.retefuente_amount
                    ? `${formatCurrency(transaction.retefuente_amount)} (2.5%)`
                    : 'Se practicó retención'}
                </p>
              </div>
              <Switch
                checked={hasRetefuente}
                disabled={savingTax || transaction.type !== 'egreso'}
                onCheckedChange={(v) => saveTax('has_retefuente', v)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border">
            <div>
              <label className="text-xs text-muted-foreground">Factura Asociada</label>
              <p className="text-sm">
                {hasInvoice ? (
                  <span className="text-success font-medium">✓ Conciliada por factura</span>
                ) : transaction.notes === '[N/A - Sin factura]' ? (
                  <span className="text-muted-foreground">N/A</span>
                ) : transaction.notes === '[IVA a favor - Pago DIAN]' ? (
                  <span className="text-success font-medium">✓ IVA a favor (Pago DIAN)</span>
                ) : (
                  <span className="text-warning font-medium">Pendiente de asociar</span>
                )}
              </p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Estado de Conciliación</label>
              <p className={`text-sm font-medium ${isReconciled ? 'text-success' : 'text-destructive'}`}>
                {isReconciled ? '✓ Conciliada' : '⏳ Pendiente'}
              </p>
            </div>
          </div>

          {transaction.notes && transaction.notes !== '[N/A - Sin factura]' && transaction.notes !== '[IVA a favor - Pago DIAN]' && (
            <div>
              <label className="text-xs text-muted-foreground">Notas</label>
              <p className="text-sm bg-muted/50 p-3 rounded-lg">{transaction.notes}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
