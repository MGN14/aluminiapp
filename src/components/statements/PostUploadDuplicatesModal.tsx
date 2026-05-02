import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { parseLocalDate } from '@/lib/dateUtils';

export interface PostUploadDuplicate {
  /** ID de la nueva transacción recién insertada (la candidata, en el statement nuevo). */
  new_tx_id: string;
  /** ID de la tx existente en otro statement que matchea. */
  matched_tx_id: string;
  matched_date: string;
  matched_amount: number;
  matched_description: string;
}

interface Props {
  open: boolean;
  duplicates: PostUploadDuplicate[];
  totalNew: number;
  isProcessing: boolean;
  onKeep: () => void;
  onDeleteDuplicates: () => void;
}

export default function PostUploadDuplicatesModal({
  open,
  duplicates,
  totalNew,
  isProcessing,
  onKeep,
  onDeleteDuplicates,
}: Props) {
  const dupCount = duplicates.length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !isProcessing) onKeep(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-warning/15 flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle className="h-5 w-5 text-warning" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-base">
                {dupCount} {dupCount === 1 ? 'transacción' : 'transacciones'} de este extracto ya existían en otros
              </DialogTitle>
              <DialogDescription className="mt-1">
                El extracto se cargó con {totalNew} transacciones, pero {dupCount} coinciden exacto (fecha + monto + descripción) con tx que ya tenías cargadas en extractos previos.
                Para evitar duplicar tu PYG y conciliación, podés <strong>borrar las nuevas duplicadas</strong> (las originales quedan intactas).
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
                <tr key={d.new_tx_id} className="border-t border-border/40">
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
          <Button variant="outline" onClick={onKeep} disabled={isProcessing}>
            Mantener todas
          </Button>
          <Button onClick={onDeleteDuplicates} disabled={isProcessing}>
            {isProcessing ? (
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Borrando...</>
            ) : (
              <>Borrar {dupCount} nuevas duplicadas</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
