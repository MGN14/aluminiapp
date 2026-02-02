import { useState } from 'react';
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
import { Trash2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Props {
  statementId: string;
  fileName: string;
  filePath?: string;
  onDeleted: () => void;
}

export default function DeleteStatementButton({ statementId, fileName, filePath, onDeleted }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (confirmText !== 'ELIMINAR') return;
    
    setDeleting(true);
    try {
      // Delete transactions first (cascade)
      const { error: txError } = await supabase
        .from('transactions')
        .delete()
        .eq('statement_id', statementId);

      if (txError) throw txError;

      // Delete storage file if exists
      if (filePath) {
        await supabase.storage.from('bank-statements').remove([filePath]);
      }

      // Delete statement
      const { error } = await supabase
        .from('bank_statements')
        .delete()
        .eq('id', statementId);

      if (error) throw error;

      toast({
        title: 'Extracto eliminado',
        description: `Se eliminó "${fileName}" y todas sus transacciones.`,
      });
      
      setOpen(false);
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
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar extracto?</AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p>
              Esto eliminará permanentemente el extracto <strong>"{fileName}"</strong> y 
              <strong> todas sus transacciones asociadas</strong>.
            </p>
            <p className="text-destructive font-medium">
              Esta acción no se puede deshacer.
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
