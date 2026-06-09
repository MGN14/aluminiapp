import { Transaction } from '@/types/transaction';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';

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
