import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { parseLocalDate } from '@/lib/dateUtils';

export interface DuplicateMatch {
  candidate_index: number;
  matched_tx_id: string;
  matched_date: string;
  matched_amount: number;
  matched_description: string;
  matched_statement_id: string | null;
}

interface Props {
  open: boolean;
  duplicates: DuplicateMatch[];
  totalCandidates: number;
  onCancel: () => void;
  onSkipDuplicates: () => void;
  onImportAll: () => void;
}

export default function DuplicatesConfirmModal({
  open,
  duplicates,
  totalCandidates,
  onCancel,
  onSkipDuplicates,
  onImportAll,
}: Props) {
  const dupCount = duplicates.length;
  const newCount = totalCandidates - dupCount;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-warning/15 flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle className="h-5 w-5 text-warning" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-base">
                Encontramos {dupCount} {dupCount === 1 ? 'transacción' : 'transacciones'} que ya tenés cargadas
              </DialogTitle>
              <DialogDescription className="mt-1">
                De {totalCandidates} movimientos en este extracto, {dupCount} coinciden exacto (fecha + monto + descripción) con transacciones existentes en tu cuenta.
                {newCount > 0 && (
                  <> Si omitís duplicados, se importarán <strong>{newCount} nuevas</strong>.</>
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6 py-2 border-y bg-muted/30">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur">
              <tr className="text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Fecha</th>
                <th className="py-2 pr-3 font-medium text-right">Monto</th>
                <th className="py-2 font-medium">Descripción</th>
              </tr>
            </thead>
            <tbody>
              {duplicates.slice(0, 50).map((d) => (
                <tr key={d.matched_tx_id} className="border-t border-border/40">
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    {parseLocalDate(d.matched_date).toLocaleDateString('es-CO', {
                      day: '2-digit', month: 'short', year: 'numeric',
                    })}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap">
                    {formatCurrency(d.matched_amount)}
                  </td>
                  <td className="py-1.5 truncate max-w-[280px]" title={d.matched_description}>
                    {d.matched_description}
                  </td>
                </tr>
              ))}
              {duplicates.length > 50 && (
                <tr>
                  <td colSpan={3} className="py-2 text-center text-muted-foreground italic">
                    ... y {duplicates.length - 50} más
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-2 mt-2">
          <Button variant="outline" onClick={onCancel} className="sm:mr-auto">
            Cancelar
          </Button>
          <Button variant="outline" onClick={onImportAll}>
            Importar todo igual ({totalCandidates})
          </Button>
          <Button onClick={onSkipDuplicates} disabled={newCount === 0}>
            Omitir duplicados {newCount > 0 ? `(importar ${newCount})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
