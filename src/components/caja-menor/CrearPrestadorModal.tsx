// Modal completo para crear un prestador con todos los datos necesarios
// para generar la cuenta de cobro después: nombre, tipo doc, número doc,
// ciudad, teléfono. Antes el inline-create solo guardaba el nombre y al
// generar la cuenta de cobro había que volver a tipear todo.

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, UserPlus } from 'lucide-react';
import { usePersistedFormState } from '@/hooks/usePersistedFormState';

type TipoDocumento = 'CC' | 'CE' | 'PA' | 'NIT';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill del nombre, p.ej. cuando el usuario ya tipeó algo en el select. */
  initialName?: string;
  /** "petty_cash" para Caja Menor, "banking" para Conciliación, "both" para ambos. */
  responsibleType?: 'petty_cash' | 'banking' | 'both';
  /** Callback con el id/nombre del prestador recién creado, para que el caller
   *  pueda preseleccionarlo en su Select. */
  onCreated?: (created: { id: string; name: string }) => void;
}

export default function CrearPrestadorModal({
  open,
  onOpenChange,
  initialName,
  responsibleType = 'petty_cash',
  onCreated,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Persistencia: si el usuario empieza a tipear y cambia de pestaña /
  // navega, al volver el form sigue donde estaba. Se limpia al guardar.
  type FormState = {
    name: string;
    tipoDoc: TipoDocumento;
    documento: string;
    ciudad: string;
    telefono: string;
  };
  const INITIAL: FormState = {
    name: '',
    tipoDoc: 'CC',
    documento: '',
    ciudad: '',
    telefono: '',
  };
  const [form, setForm, clearForm] = usePersistedFormState<FormState>(
    'caja-menor:crear-prestador:v1',
    INITIAL,
  );
  const name = form.name;
  const setName = (v: string) => setForm((f) => ({ ...f, name: v }));
  const tipoDoc = form.tipoDoc;
  const setTipoDoc = (v: TipoDocumento) => setForm((f) => ({ ...f, tipoDoc: v }));
  const documento = form.documento;
  const setDocumento = (v: string) => setForm((f) => ({ ...f, documento: v }));
  const ciudad = form.ciudad;
  const setCiudad = (v: string) => setForm((f) => ({ ...f, ciudad: v }));
  const telefono = form.telefono;
  const setTelefono = (v: string) => setForm((f) => ({ ...f, telefono: v }));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Solo aplicamos initialName si no hay un name persistido previo.
    if (open && initialName && !form.name) {
      setName(initialName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialName]);

  const handleCreate = async () => {
    if (!user) return;
    if (!name.trim()) {
      toast({ title: 'Falta nombre', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      // RLS + trigger set_user_id_to_data_owner garantizan que user_id queda
      // como el owner aunque el caller (colaborador) tenga otro auth.uid().
      const { data, error } = await supabase
        .from('responsibles')
        .insert({
          user_id: user.id,
          name: name.trim(),
          responsible_type: responsibleType,
          tipo_documento: tipoDoc,
          nit: documento.trim() || null,
          ciudad: ciudad.trim() || null,
          telefono: telefono.trim() || null,
        } as never)
        .select('id, name')
        .single();
      if (error) throw error;

      // Invalidar TODAS las queries de responsibles — distintas pantallas usan
      // queryKeys distintos.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['responsibles-caja-menor'] }),
        queryClient.invalidateQueries({ queryKey: ['responsibles-caja-ingreso'] }),
        queryClient.invalidateQueries({ queryKey: ['responsibles-edit-prestador'] }),
        queryClient.invalidateQueries({ queryKey: ['responsibles-remisiones'] }),
        queryClient.invalidateQueries({ queryKey: ['responsibles-for-rules'] }),
      ]);
      toast({ title: 'Prestador creado' });
      onCreated?.({ id: (data as any).id, name: (data as any).name });
      // Reset + clear sessionStorage tras guardado exitoso.
      setForm(INITIAL);
      clearForm();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Crear prestador
          </DialogTitle>
          <DialogDescription>
            Datos completos para que la cuenta de cobro se genere sin tener que volver a tipearlos.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Nombre completo *</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Juan Pérez"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Tipo documento</Label>
              <Select value={tipoDoc} onValueChange={(v) => setTipoDoc(v as TipoDocumento)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CC">Cédula de Ciudadanía</SelectItem>
                  <SelectItem value="CE">Cédula de Extranjería</SelectItem>
                  <SelectItem value="PA">Pasaporte</SelectItem>
                  <SelectItem value="NIT">NIT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Número documento</Label>
              <Input
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                placeholder="1.020.456.789"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Ciudad</Label>
              <Input
                value={ciudad}
                onChange={(e) => setCiudad(e.target.value)}
                placeholder="Bogotá"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Teléfono</Label>
              <Input
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="3001234567"
              />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={saving || !name.trim()}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Guardando...</> : 'Crear prestador'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
