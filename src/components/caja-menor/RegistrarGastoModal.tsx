import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarIcon, Plus, BadgeCheck, BadgeX } from 'lucide-react';
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
  cuenta_de_cobro: 'Cuenta de cobro (proveedor sin factura electrónica)',
};

export default function RegistrarGastoModal() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'gasto_efectivo' | 'cuenta_de_cobro'>('gasto_efectivo');
  const [responsibleId, setResponsibleId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [concept, setConcept] = useState('');
  const [notes, setNotes] = useState('');
  const [numeroCdc, setNumeroCdc] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: responsibles = [] } = useQuery<Responsible[]>({
    queryKey: ['responsibles-caja-menor', user?.id],
    enabled: !!user?.id && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('responsibles')
        .select('id, name')
        .eq('user_id', user!.id)
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories-caja-menor', user?.id],
    enabled: !!user?.id && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, is_tax_deductible')
        .eq('user_id', user!.id)
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const selectedCategory = categories.find((c) => c.id === categoryId);

  const reset = () => {
    setKind('gasto_efectivo');
    setResponsibleId('');
    setCategoryId('');
    setAmount('');
    setDate(new Date());
    setConcept('');
    setNotes('');
    setNumeroCdc('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!responsibleId) {
      toast({ title: 'Falta proveedor', description: 'Seleccioná un proveedor.', variant: 'destructive' });
      return;
    }
    if (!date) {
      toast({ title: 'Falta fecha', variant: 'destructive' });
      return;
    }
    const num = parseFloat(amount);
    if (!num || num <= 0) {
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
        numero_cuenta_cobro: kind === 'cuenta_de_cobro' ? (numeroCdc.trim() || null) : null,
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
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Registrar gasto en Caja Menor</DialogTitle>
            <DialogDescription>
              Egreso del Modo DIAN. La deducibilidad se calcula automáticamente según la categoría.
            </DialogDescription>
          </DialogHeader>

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

          <div className="space-y-1.5">
            <Label>Proveedor</Label>
            <Select value={responsibleId} onValueChange={setResponsibleId}>
              <SelectTrigger>
                <SelectValue placeholder={responsibles.length === 0 ? 'Crealo en Conciliación bancaria primero' : 'Seleccionar proveedor'} />
              </SelectTrigger>
              <SelectContent>
                {responsibles.length === 0 ? (
                  <div className="text-xs text-muted-foreground p-2">
                    No tenés proveedores. Creá uno desde Conciliación bancaria.
                  </div>
                ) : (
                  responsibles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
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

          <div className="space-y-1.5">
            <Label>Concepto</Label>
            <Input placeholder="Ej: Servicio de mantenimiento marzo" value={concept} onChange={(e) => setConcept(e.target.value)} />
          </div>

          {kind === 'cuenta_de_cobro' && (
            <div className="space-y-1.5">
              <Label>Número de cuenta de cobro (opcional)</Label>
              <Input
                placeholder="Ej: CDC-001-2026"
                value={numeroCdc}
                onChange={(e) => setNumeroCdc(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                En el próximo update vas a poder generar el PDF con consecutivo automático.
              </p>
            </div>
          )}

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
    </Dialog>
  );
}
