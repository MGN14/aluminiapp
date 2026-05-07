// Modal compacto para cambiar el prestador (responsible_id) de un movimiento
// de Caja Menor ya registrado. Lo común: el usuario se equivocó al elegir
// el prestador inicial y antes solo podía borrar y crear de nuevo, lo cual
// rompía con el closing_id si ya estaba cerrado.
//
// No tocamos closing_id: si está cerrado, no se permite editar.

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  movementId: string | null;
  currentResponsibleId: string | null;
  currentResponsibleName: string | null;
}

export default function EditarPrestadorModal({
  open,
  onOpenChange,
  movementId,
  currentResponsibleId,
  currentResponsibleName,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [responsibleId, setResponsibleId] = useState<string>(currentResponsibleId ?? '__none__');
  const [saving, setSaving] = useState(false);

  // Cuando abre el modal, rehidrata con el valor actual del movimiento.
  useEffect(() => {
    if (open) {
      setResponsibleId(currentResponsibleId ?? '__none__');
    }
  }, [open, currentResponsibleId]);

  // RLS filtra por owner; sin .eq('user_id', user.id) que rompía a colaboradores.
  const { data: responsibles = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['responsibles-edit-prestador', user?.id],
    enabled: !!user?.id && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('responsibles')
        .select('id, name')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as { id: string; name: string }[];
    },
  });

  const handleSave = async () => {
    if (!movementId) return;
    setSaving(true);
    try {
      const newId = responsibleId === '__none__' ? null : responsibleId;
      const { error } = await supabase
        .from('petty_cash_movements')
        .update({ responsible_id: newId } as never)
        .eq('id', movementId);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['petty-cash-movements'] });
      toast({ title: 'Prestador actualizado' });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Error al guardar', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar prestador</DialogTitle>
          <DialogDescription>
            Cambiá el prestador asociado a este movimiento. {currentResponsibleName && `Actual: ${currentResponsibleName}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Prestador</Label>
          <Select value={responsibleId} onValueChange={setResponsibleId}>
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Sin prestador</SelectItem>
              {responsibles.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Guardando...</> : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
