import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Loader2, Calculator, CheckCircle2 } from 'lucide-react';
import { IVA_RATE, RETEFUENTE_RATE } from '@/types/transaction';

// The "Ventas" category ID - same as in TransactionRow
const SALES_CATEGORY_ID = '0299ed3c-4b09-402d-bbf1-cf4b097ff8a5';

interface TaxRecalculationButtonProps {
  onComplete?: () => void;
}

export default function TaxRecalculationButton({ onComplete }: TaxRecalculationButtonProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<{ total: number; updated: number } | null>(null);

  const handleRecalculate = async () => {
    if (!user) return;

    setIsProcessing(true);
    setProgress(0);
    setStats(null);

    try {
      // 1. Fetch user's ReteICA config
      const { data: profile } = await supabase
        .from('profiles')
        .select('reteica_rate')
        .eq('user_id', user.id)
        .maybeSingle();

      const reteicaRate = profile?.reteica_rate || 0;
      const ivaRate = IVA_RATE;
      const retefuenteRate = RETEFUENTE_RATE;

      // 2. Fetch ALL user transactions (not deleted)
      const { data: transactions, error: fetchError } = await supabase
        .from('transactions')
        .select('id, category_id, amount, type')
        .eq('user_id', user.id)
        .is('deleted_at', null);

      if (fetchError) throw fetchError;

      if (!transactions || transactions.length === 0) {
        toast({
          title: 'Sin transacciones',
          description: 'No hay transacciones para recalcular.',
        });
        setIsProcessing(false);
        return;
      }

      const total = transactions.length;
      let updated = 0;

      // 3. Process in batches
      const batchSize = 50;
      for (let i = 0; i < transactions.length; i += batchSize) {
        const batch = transactions.slice(i, i + batchSize);
        
        const updates = batch.map(tx => {
          const isSales = tx.category_id === SALES_CATEGORY_ID;
          const isIncome = tx.type === 'ingreso';
          const isExpense = tx.type === 'egreso';
          const absAmount = Math.abs(tx.amount || 0);

          // Determine tax flags based on category
          const has_iva = isSales;
          const has_reteica = isSales && isIncome && reteicaRate > 0;
          const has_retefuente = isExpense; // Retefuente only on expenses

          // Calculate amounts
          const iva_amount = has_iva ? Math.round(absAmount * ivaRate) : 0;
          const reteica_amount = has_reteica ? Math.round(absAmount * reteicaRate) : 0;
          const retefuente_amount = has_retefuente ? Math.round(absAmount * retefuenteRate) : 0;

          return {
            id: tx.id,
            has_iva,
            has_reteica,
            has_retefuente,
            iva_amount,
            reteica_amount,
            retefuente_amount,
            iva_type: has_iva ? (isIncome ? 'debito' : 'credito') : null,
          };
        });

        // Update each transaction in the batch
        for (const update of updates) {
          const { error: updateError } = await supabase
            .from('transactions')
            .update({
              has_iva: update.has_iva,
              has_reteica: update.has_reteica,
              has_retefuente: update.has_retefuente,
              iva_amount: update.iva_amount,
              reteica_amount: update.reteica_amount,
              retefuente_amount: update.retefuente_amount,
              iva_type: update.iva_type,
            })
            .eq('id', update.id);

          if (!updateError) {
            updated++;
          }
        }

        // Update progress
        setProgress(Math.round(((i + batch.length) / total) * 100));
      }

      setStats({ total, updated });
      
      toast({
        title: 'Recálculo completado',
        description: `Se actualizaron ${updated} de ${total} transacciones.`,
      });

      // Notify parent to refresh data
      onComplete?.();

    } catch (error) {
      console.error('Error recalculating taxes:', error);
      toast({
        title: 'Error',
        description: 'No se pudo completar el recálculo.',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" disabled={isProcessing} className="w-full sm:w-auto">
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Procesando...
              </>
            ) : (
              <>
                <Calculator className="h-4 w-4 mr-2" />
                Recalcular reglas fiscales
              </>
            )}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Recalcular reglas fiscales?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Esta acción actualizará <strong>todas</strong> tus transacciones aplicando las reglas fiscales automáticas:
              </p>
              <ul className="list-disc list-inside text-sm space-y-1 mt-2">
                <li>Categoría "Ventas" → IVA y ReteICA activados</li>
                <li>Otras categorías → ReteICA desactivado, IVA desactivado</li>
                <li>Egresos → Retefuente activada</li>
              </ul>
              <p className="text-sm mt-2">
                Los montos se recalcularán con las tasas actuales.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRecalculate}>
              Continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isProcessing && (
        <div className="space-y-2">
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-muted-foreground text-center">
            Procesando... {progress}%
          </p>
        </div>
      )}

      {stats && !isProcessing && (
        <div className="flex items-center gap-2 text-sm text-primary">
          <CheckCircle2 className="h-4 w-4" />
          <span>{stats.updated} de {stats.total} transacciones actualizadas</span>
        </div>
      )}
    </div>
  );
}
