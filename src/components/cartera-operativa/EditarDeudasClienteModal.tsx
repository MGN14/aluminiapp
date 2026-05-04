import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Loader2, Pencil, Trash2, X, Check, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

interface Deuda {
  id: string;
  amount: number;
  date: string;
  description: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  responsibleId: string;
  responsibleName: string;
  saldo: number;
}

export default function EditarDeudasClienteModal({
  open, onOpenChange, responsibleId, responsibleName, saldo,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deudas, setDeudas] = useState<Deuda[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  useEffect(() => {
    if (!open || !user || !responsibleId) return;
    setLoading(true);
    supabase
      .from('operative_receivables')
      .select('id, amount, date, description')
      .eq('responsible_id', responsibleId)
      .order('date', { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          toast({ title: 'Error al cargar deudas', description: error.message, variant: 'destructive' });
        } else {
          setDeudas((data ?? []) as Deuda[]);
        }
        setLoading(false);
      });
  }, [open, user, responsibleId, toast]);

  const startEdit = (d: Deuda) => {
    setEditingId(d.id);
    setEditAmount(String(d.amount));
    setEditDescription(d.description ?? '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditAmount('');
    setEditDescription('');
  };

  const saveEdit = async (d: Deuda) => {
    const num = parseFloat(editAmount);
    if (!num || num <= 0) {
      toast({ title: 'Monto inválido', description: 'Debe ser mayor a 0.', variant: 'destructive' });
      return;
    }
    setSavingId(d.id);
    const { error } = await supabase
      .from('operative_receivables')
      .update({ amount: num, description: editDescription.trim() || null })
      .eq('id', d.id);
    setSavingId(null);
    if (error) {
      toast({ title: 'Error al actualizar', description: error.message, variant: 'destructive' });
      return;
    }
    setDeudas(prev => prev.map(x => x.id === d.id ? { ...x, amount: num, description: editDescription.trim() || null } : x));
    cancelEdit();
    queryClient.invalidateQueries({ queryKey: ['operative-receivables'] });
    toast({ title: 'Deuda actualizada' });
  };

  const deleteOne = async (d: Deuda) => {
    if (!confirm(`¿Eliminar esta deuda de ${formatCurrency(d.amount)} del ${format(new Date(d.date + 'T00:00:00'), 'dd MMM yyyy', { locale: es })}?`)) return;
    setDeletingId(d.id);
    const { error } = await supabase
      .from('operative_receivables')
      .delete()
      .eq('id', d.id);
    setDeletingId(null);
    if (error) {
      toast({ title: 'Error al eliminar', description: error.message, variant: 'destructive' });
      return;
    }
    setDeudas(prev => prev.filter(x => x.id !== d.id));
    queryClient.invalidateQueries({ queryKey: ['operative-receivables'] });
    toast({ title: 'Deuda eliminada' });
  };

  const deleteAll = async () => {
    if (!user) return;
    setBulkDeleting(true);
    const { error } = await supabase
      .from('operative_receivables')
      .delete()
      .eq('responsible_id', responsibleId);
    setBulkDeleting(false);
    setConfirmDeleteAll(false);
    if (error) {
      toast({ title: 'Error al eliminar todas', description: error.message, variant: 'destructive' });
      return;
    }
    setDeudas([]);
    queryClient.invalidateQueries({ queryKey: ['operative-receivables'] });
    toast({
      title: 'Cartera del cliente eliminada',
      description: `Se borraron todas las deudas de ${responsibleName}.`,
    });
    onOpenChange(false);
  };

  const totalDeuda = deudas.reduce((s, d) => s + Number(d.amount), 0);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cartera de {responsibleName}</DialogTitle>
            <DialogDescription>
              Editá o eliminá cada deuda registrada manualmente. Los pagos en efectivo y bancarios
              asignados se descuentan automáticamente — no se editan acá.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : deudas.length === 0 ? (
            <div className="text-sm text-muted-foreground p-4 text-center">
              No hay deudas registradas para este cliente.
            </div>
          ) : (
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {deudas.map(d => {
                const isEditing = editingId === d.id;
                return (
                  <div key={d.id} className="border border-border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(d.date + 'T00:00:00'), 'dd MMM yyyy', { locale: es })}
                      </div>
                      <div className="flex items-center gap-1">
                        {isEditing ? (
                          <>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => saveEdit(d)} disabled={savingId === d.id}>
                              {savingId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 text-success" />}
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelEdit} disabled={savingId === d.id}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(d)} title="Editar">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteOne(d)} disabled={deletingId === d.id} title="Eliminar">
                              {deletingId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    {isEditing ? (
                      <div className="space-y-2">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={editAmount}
                          onChange={e => setEditAmount(e.target.value)}
                          className="text-sm"
                        />
                        <Textarea
                          value={editDescription}
                          onChange={e => setEditDescription(e.target.value)}
                          placeholder="Descripción (opcional)"
                          rows={2}
                          className="text-sm"
                        />
                      </div>
                    ) : (
                      <>
                        <div className="text-base font-semibold tabular-nums">{formatCurrency(Number(d.amount))}</div>
                        {d.description && (
                          <div className="text-xs text-muted-foreground">{d.description}</div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="border-t border-border pt-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total deuda registrada</span>
            <span className="font-semibold tabular-nums">{formatCurrency(totalDeuda)}</span>
          </div>

          <DialogFooter className="gap-2 sm:justify-between flex-col-reverse sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
              onClick={() => setConfirmDeleteAll(true)}
              disabled={deudas.length === 0 || bulkDeleting}
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Eliminar todas las deudas
            </Button>
            <Button type="button" onClick={() => onOpenChange(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDeleteAll} onOpenChange={setConfirmDeleteAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar todas las deudas de {responsibleName}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {saldo > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 flex gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-900 dark:text-amber-100">
                      <strong>Atención:</strong> este cliente todavía tiene un saldo pendiente de{' '}
                      <strong>{formatCurrency(saldo)}</strong>. Lo recomendable es saldarlo antes
                      de eliminar la cartera (el saldo debería estar en $0).
                    </div>
                  </div>
                )}
                <div className="text-sm">
                  Se eliminarán {deudas.length} {deudas.length === 1 ? 'deuda' : 'deudas'} por un
                  total de <strong>{formatCurrency(totalDeuda)}</strong>. Esta acción no se puede
                  deshacer.
                </div>
                <div className="text-xs text-muted-foreground">
                  Los pagos asignados (efectivo + banco) NO se borran — solo se desvinculan de
                  la cartera operativa de este cliente.
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteAll}
              disabled={bulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Eliminar todas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
