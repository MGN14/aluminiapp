// Editor completo de un movimiento de Caja Menor. Reemplaza al viejo
// EditarPrestadorModal que solo dejaba cambiar el prestador.
//
// Permite corregir: fecha, monto, concepto, categoría, prestador y notas.
// Solo si el movimiento NO está en un cierre (closing_id NULL) — un
// movimiento cerrado es inmutable.

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarIcon, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { PettyCashRow } from '@/hooks/usePettyCashMovements';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  movement: PettyCashRow | null;
}

const NONE = '__none__';

export default function EditarMovimientoModal({ open, onOpenChange, movement }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [date, setDate] = useState<Date | undefined>(undefined);
  const [amount, setAmount] = useState('');
  const [concept, setConcept] = useState('');
  const [categoryId, setCategoryId] = useState<string>(NONE);
  const [responsibleId, setResponsibleId] = useState<string>(NONE);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const isIngreso = movement?.kind === 'ingreso_efectivo';

  // Rehidratar al abrir con los datos del movimiento.
  useEffect(() => {
    if (open && movement) {
      setDate(movement.date ? new Date(movement.date + 'T00:00:00') : undefined);
      setAmount(String(movement.amount ?? ''));
      setConcept(movement.concept ?? '');
      setCategoryId(movement.category_id ?? NONE);
      setResponsibleId(movement.responsible_id ?? NONE);
      setNotes(movement.notes ?? '');
    }
  }, [open, movement]);

  // RLS filtra por owner — sin .eq('user_id') que rompía a colaboradores.
  const { data: responsibles = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['responsibles-editar-movimiento', user?.id],
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

  const { data: categories = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['categories-editar-movimiento', user?.id],
    enabled: !!user?.id && open && !isIngreso,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data || []) as { id: string; name: string }[];
    },
  });

  const handleSave = async () => {
    if (!movement) return;
    if (movement.closing_id) {
      toast({ title: 'Movimiento cerrado', description: 'No se puede editar un movimiento incluido en un cierre de caja.', variant: 'destructive' });
      return;
    }
    if (!date) {
      toast({ title: 'Falta fecha', variant: 'destructive' });
      return;
    }
    const num = parseFloat(amount);
    if (!Number.isFinite(num) || num <= 0) {
      toast({ title: 'Monto inválido', description: 'El monto debe ser mayor a 0.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('petty_cash_movements')
        .update({
          date: format(date, 'yyyy-MM-dd'),
          amount: num,
          concept: concept.trim() || null,
          // Las categorías no aplican a ingresos.
          category_id: isIngreso ? null : (categoryId === NONE ? null : categoryId),
          responsible_id: responsibleId === NONE ? null : responsibleId,
          notes: notes.trim() || null,
        } as never)
        .eq('id', movement.id);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['petty-cash-movements'] });
      toast({ title: 'Movimiento actualizado' });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Error al guardar', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar movimiento</DialogTitle>
          <DialogDescription>
            Corregí cualquier dato del movimiento. Solo se puede mientras la caja no esté cerrada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Monto</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Fecha</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn('w-full justify-start text-left font-normal', !date && 'text-muted-foreground')}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, 'dd MMM yyyy', { locale: es }) : 'Seleccionar'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={date} onSelect={setDate} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{isIngreso ? 'Beneficiario / cliente' : 'Prestador'}</Label>
            <Select value={responsibleId} onValueChange={setResponsibleId}>
              <SelectTrigger>
                <SelectValue placeholder="Sin asignar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sin asignar</SelectItem>
                {responsibles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!isIngreso && (
            <div className="space-y-1.5">
              <Label>Categoría</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin categoría" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sin categoría</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Concepto</Label>
            <Input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Detalle del movimiento" />
          </div>

          <div className="space-y-1.5">
            <Label>Notas (opcional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notas internas..." />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Guardando...</> : 'Guardar cambios'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
