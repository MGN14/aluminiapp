import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarIcon, ArrowDownToLine, UserPlus } from 'lucide-react';
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
import { usePersistedFormState, usePersistedDialogOpen, dateToIso, isoToDate } from '@/hooks/usePersistedFormState';
import CrearPrestadorModal from './CrearPrestadorModal';

const NEW_PRESTADOR_VALUE = '__new__';

export default function RegistrarIngresoModal() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Open state persistido: si Nico estaba en el modal y refresca / cambia
  // de tab, vuelve y el modal se reabre solo con los datos.
  const [open, setOpen] = usePersistedDialogOpen('caja-menor:registrar-ingreso:open');
  // Persistencia del form en sessionStorage (cambios de pestaña / tab discard
  // no pierden lo tipeado). clearForm() al guardar exitoso.
  type FormState = {
    amount: string;
    dateIso: string | null;
    origen: string;
    responsibleId: string;
    concept: string;
    notes: string;
  };
  const INITIAL_FORM: FormState = {
    amount: '',
    dateIso: dateToIso(new Date()),
    origen: '',
    responsibleId: '__none__',
    concept: '',
    notes: '',
  };
  const [form, setForm, clearForm] = usePersistedFormState<FormState>(
    'caja-menor:registrar-ingreso:v1',
    INITIAL_FORM,
  );
  const date = isoToDate(form.dateIso);
  const setDate = (d: Date | undefined) => setForm((f) => ({ ...f, dateIso: dateToIso(d) }));
  const amount = form.amount;
  const setAmount = (v: string) => setForm((f) => ({ ...f, amount: v }));
  const origen = form.origen;
  const setOrigen = (v: string) => setForm((f) => ({ ...f, origen: v }));
  const responsibleId = form.responsibleId;
  const setResponsibleId = (v: string) => setForm((f) => ({ ...f, responsibleId: v }));
  const concept = form.concept;
  const setConcept = (v: string) => setForm((f) => ({ ...f, concept: v }));
  const notes = form.notes;
  const setNotes = (v: string) => setForm((f) => ({ ...f, notes: v }));
  const [saving, setSaving] = useState(false);
  // Modal anidado para crear un beneficiario nuevo sin salir del flujo.
  const [crearPrestadorOpen, setCrearPrestadorOpen] = useState(false);

  const handleResponsibleChange = (v: string) => {
    if (v === NEW_PRESTADOR_VALUE) {
      setCrearPrestadorOpen(true);
    } else {
      setResponsibleId(v);
    }
  };

  // Beneficiarios disponibles (clientes / personas que pueden generar ingreso).
  // RLS filtra por owner; sin .eq('user_id', user.id) que rompía a colaboradores.
  const { data: responsibles = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['responsibles-caja-ingreso', user?.id],
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

  const reset = () => {
    setForm(INITIAL_FORM);
    clearForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!date) {
      toast({ title: 'Falta fecha', variant: 'destructive' });
      return;
    }
    if (!origen.trim()) {
      toast({ title: 'Falta origen', description: 'Indicá de dónde viene el ingreso.', variant: 'destructive' });
      return;
    }
    const num = parseFloat(amount);
    if (!Number.isFinite(num) || num <= 0) {
      toast({ title: 'Monto inválido', description: 'El monto debe ser mayor a 0.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      // El concepto guarda "Ingreso: <origen>" para diferenciarlo en el listado
      // y mantener compatibilidad con la columna `concept` que ya muestra el texto.
      const conceptFinal = concept.trim()
        ? `${origen.trim()} — ${concept.trim()}`
        : origen.trim();

      const respIdFinal = responsibleId && responsibleId !== '__none__' ? responsibleId : null;
      const { error } = await supabase.from('petty_cash_movements').insert({
        user_id: user.id,
        date: format(date, 'yyyy-MM-dd'),
        amount: num,
        responsible_id: respIdFinal,
        category_id: null,
        concept: conceptFinal,
        kind: 'ingreso_efectivo',
        notes: notes.trim() || null,
      } as never);
      if (error) throw error;

      await queryClient.invalidateQueries({ queryKey: ['petty-cash-movements'] });
      toast({ title: 'Ingreso registrado' });
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
        <Button variant="outline" className="gap-2 border-success/40 text-success hover:bg-success/10 hover:text-success">
          <ArrowDownToLine className="h-4 w-4" />
          Registrar ingreso
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Registrar ingreso en Caja Menor</DialogTitle>
            <DialogDescription>
              Entrada de efectivo: devolución, ingreso misceláneo, reembolso, etc.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label>Origen del ingreso</Label>
            <Input
              autoFocus
              placeholder="Ej: Devolución proveedor, Reembolso, Pago en efectivo"
              value={origen}
              onChange={(e) => setOrigen(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              ¿De dónde viene el dinero? Se mostrará en el listado.
            </p>
          </div>

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
            <Label>Beneficiario / cliente (opcional)</Label>
            <Select value={responsibleId} onValueChange={handleResponsibleChange}>
              <SelectTrigger>
                <SelectValue placeholder="Sin beneficiario" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sin beneficiario</SelectItem>
                {responsibles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
                <SelectItem value={NEW_PRESTADOR_VALUE} className="text-primary">
                  <span className="inline-flex items-center gap-1.5">
                    <UserPlus className="h-3.5 w-3.5" />
                    Crear nuevo beneficiario
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Si el ingreso viene de un cliente o persona específica, vinculalo acá.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Concepto adicional (opcional)</Label>
            <Input
              placeholder="Detalle adicional"
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
            />
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
              {saving ? 'Guardando...' : 'Registrar ingreso'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      <CrearPrestadorModal
        open={crearPrestadorOpen}
        onOpenChange={setCrearPrestadorOpen}
        responsibleType="both"
        onCreated={(c) => setResponsibleId(c.id)}
      />
    </Dialog>
  );
}
