import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Props {
  statementId: string;
  fileName: string;
  filePath?: string;
  transactionCount?: number;
  onDeleted: () => void;
}

export default function DeleteStatementButton({ 
  statementId, 
  fileName, 
  filePath, 
  transactionCount: initialCount,
  onDeleted 
}: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [transactionCount, setTransactionCount] = useState(initialCount ?? 0);

  // Fetch transaction count when dialog opens
  useEffect(() => {
    if (open && initialCount === undefined) {
      fetchTransactionCount();
    }
  }, [open, initialCount]);

  const fetchTransactionCount = async () => {
    const { count } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('statement_id', statementId)
      .is('deleted_at', null);
    
    setTransactionCount(count ?? 0);
  };

  const handleDelete = async () => {
    if (confirmText !== 'ELIMINAR') return;
    
    setDeleting(true);
    try {
      const now = new Date().toISOString();

      // Soft delete transactions (set deleted_at)
      const { error: txError } = await supabase
        .from('transactions')
        .update({ deleted_at: now })
        .eq('statement_id', statementId);

      if (txError) throw txError;

      // Soft delete statement
      const { error } = await supabase
        .from('bank_statements')
        .update({ deleted_at: now })
        .eq('id', statementId);

      if (error) throw error;

      toast({
        title: 'Extracto eliminado',
        description: `Se eliminó "${fileName}" y ${transactionCount} transacciones asociadas.`,
      });
      
      setOpen(false);
      setConfirmText('');
      onDeleted();
    } catch (error: any) {
      console.error('Delete error:', error);
      toast({
        title: 'Error',
        description: 'No se pudo eliminar el extracto.',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen);
      if (!isOpen) setConfirmText('');
    }}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            ¿Eliminar extracto?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                Esto eliminará permanentemente el extracto <strong>"{fileName}"</strong> y 
                <strong className="text-destructive"> {transactionCount} transacciones asociadas</strong>.
              </p>
              <p className="text-destructive font-medium">
                Esta acción no se puede deshacer. Los datos desaparecerán del dashboard.
              </p>
              <div className="pt-2">
                <label className="text-sm text-foreground">
                  Escribe <strong>ELIMINAR</strong> para confirmar:
                </label>
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                  placeholder="ELIMINAR"
                  className="mt-2"
                />
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setConfirmText('')}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={confirmText !== 'ELIMINAR' || deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Eliminando...
              </>
            ) : (
              'Eliminar'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
