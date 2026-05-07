import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarIcon, Plus, BadgeCheck, BadgeX, UserPlus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import CrearPrestadorModal from './CrearPrestadorModal';
import { usePersistedFormState, dateToIso, isoToDate } from '@/hooks/usePersistedFormState';

interface Responsible {
  id: string;
  name: string;
}
interface Category {
  id: string;
  name: string;
  is_tax_deductible: boolean;
}

const KIND_LABELS: Record<string, string> = {
  gasto_efectivo: 'Gasto en efectivo (sin documento)',
  cuenta_de_cobro: 'Cuenta de cobro (servicio ocasional)',
};

const NEW_PRESTADOR_VALUE = '__new__';

export default function RegistrarGastoModal() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  // Persistir el form en sessionStorage. Si el usuario cambia de pestaña /
  // navega a otra ruta / Chrome descarta el tab, al volver el form sigue
  // donde lo dejó. clearForm() se llama al guardar exitosamente.
  type FormState = {
    kind: 'gasto_efectivo' | 'cuenta_de_cobro';
    categoryId: string;
    responsibleId: string;
    amount: string;
    dateIso: string | null;
    concept: string;
    notes: string;
  };
  const INITIAL_FORM: FormState = {
    kind: 'gasto_efectivo',
    categoryId: '',
    responsibleId: '',
    amount: '',
    dateIso: dateToIso(new Date()),
    concept: '',
    notes: '',
  };
  const [form, setForm, clearForm] = usePersistedFormState<FormState>(
    'caja-menor:registrar-gasto:v1',
    INITIAL_FORM,
  );
  const date = isoToDate(form.dateIso);
  const setDate = (d: Date | undefined) => setForm((f) => ({ ...f, dateIso: dateToIso(d) }));
  // Aliases compatibles con el resto del componente (mínimo refactor).
  const kind = form.kind;
  const setKind = (v: FormState['kind']) => setForm((f) => ({ ...f, kind: v }));
  const categoryId = form.categoryId;
  const setCategoryId = (v: string) => setForm((f) => ({ ...f, categoryId: v }));
  const responsibleId = form.responsibleId;
  const setResponsibleId = (v: string) => setForm((f) => ({ ...f, responsibleId: v }));
  const amount = form.amount;
  const setAmount = (v: string) => setForm((f) => ({ ...f, amount: v }));
  const concept = form.concept;
  const setConcept = (v: string) => setForm((f) => ({ ...f, concept: v }));
  const notes = form.notes;
  const setNotes = (v: string) => setForm((f) => ({ ...f, notes: v }));
  const [saving, setSaving] = useState(false);

  // Modal para crear prestador con todos los datos (no inline; el inline solo
  // guardaba el nombre y obligaba a tipear de nuevo en cuenta de cobro).
  const [crearPrestadorOpen, setCrearPrestadorOpen] = useState(false);

  const { data: responsibles = [] } = useQuery<Responsible[]>({
    queryKey: ['responsibles-caja-menor', user?.id],
    enabled: !!user?.id && open,
    queryFn: async () => {
      // RLS filtra por owner; sin .eq('user_id', user.id) que rompía a colaboradores.
      const { data, error } = await supabase
        .from('responsibles')
        .select('id, name, responsible_type')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      // Solo prestadores de Caja Menor o ambos
      return ((data ?? []) as unknown as Array<{ id: string; name: string; responsible_type: string }>)
        .filter((r) => r.responsible_type === 'petty_cash' || r.responsible_type === 'both')
        .map((r) => ({ id: r.id, name: r.name }));
    },
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories-caja-menor', user?.id],
    enabled: !!user?.id && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, is_tax_deductible')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const selectedCategory = categories.find((c) => c.id === categoryId);

  const reset = () => {
    // Reset al estado inicial Y limpiar el sessionStorage (sino al volver a
    // abrir el modal recuperaría el estado anterior recién guardado).
    setForm(INITIAL_FORM);
    clearForm();
  };

  const handleResponsibleChange = (value: string) => {
    if (value === NEW_PRESTADOR_VALUE) {
      // Abrir el modal completo de creación
      setCrearPrestadorOpen(true);
      setResponsibleId('');
    } else {
      setResponsibleId(value);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!responsibleId) {
      toast({ title: 'Falta prestador', description: 'Seleccioná o creá un prestador.', variant: 'destructive' });
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
      const { error } = await supabase.from('petty_cash_movements').insert({
        user_id: user.id,
        date: format(date, 'yyyy-MM-dd'),
        amount: num,
        responsible_id: responsibleId,
        category_id: categoryId || null,
        concept: concept.trim() || null,
        kind,
        notes: notes.trim() || null,
      });
      if (error) throw error;

      await queryClient.invalidateQueries({ queryKey: ['petty-cash-movements'] });
      toast({ title: 'Gasto registrado' });
      reset();
      setOpen(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Registrar gasto
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Registrar gasto en Caja Menor</DialogTitle>
            <DialogDescription>
              Egreso del Modo DIAN. La deducibilidad se calcula automáticamente según la categoría.
            </DialogDescription>
          </DialogHeader>

          {/* Tipo */}
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as 'gasto_efectivo' | 'cuenta_de_cobro')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gasto_efectivo">{KIND_LABELS.gasto_efectivo}</SelectItem>
                <SelectItem value="cuenta_de_cobro">{KIND_LABELS.cuenta_de_cobro}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Categoría — justo después de Tipo */}
          <div className="space-y-1.5">
            <Label>Categoría</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Sin categoría" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCategory && (
              <div className="flex items-center gap-1.5 text-[11px] mt-1">
                {selectedCategory.is_tax_deductible ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <BadgeCheck className="h-3 w-3" />
                    Categoría deducible DIAN
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <BadgeX className="h-3 w-3" />
                    No deducible (cambialo en Settings si corresponde)
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Prestador — separado de los beneficiarios de Conciliación bancaria */}
          <div className="space-y-1.5">
            <Label>Prestador del servicio</Label>
            <Select value={responsibleId} onValueChange={handleResponsibleChange}>
              <SelectTrigger>
                <SelectValue placeholder={responsibles.length === 0 ? 'Crear nuevo prestador' : 'Seleccionar prestador'} />
              </SelectTrigger>
              <SelectContent>
                {responsibles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_PRESTADOR_VALUE} className="text-primary">
                  <span className="inline-flex items-center gap-1.5">
                    <UserPlus className="h-3.5 w-3.5" />
                    Crear nuevo prestador
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Lista separada de los beneficiarios de Conciliación Bancaria.
            </p>
          </div>

          {/* Monto + Fecha */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Monto</Label>
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="0"
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
            <Label>Concepto</Label>
            <Input placeholder="Ej: Servicio de cargue 28 abril" value={concept} onChange={(e) => setConcept(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Notas (opcional)</Label>
            <Textarea placeholder="Notas internas..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando...' : 'Registrar gasto'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      <CrearPrestadorModal
        open={crearPrestadorOpen}
        onOpenChange={setCrearPrestadorOpen}
        responsibleType="petty_cash"
        onCreated={(c) => setResponsibleId(c.id)}
      />
    </Dialog>
  );
}
