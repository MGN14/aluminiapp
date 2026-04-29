import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Briefcase, Save, Loader2 } from 'lucide-react';

interface AboutFields {
  business_description: string | null;
  business_warehouse_location: string | null;
  business_employees_count: number | null;
  business_operation_days: string | null;
  business_logistics: string | null;
  business_main_suppliers: string | null;
}

const EMPTY: AboutFields = {
  business_description: '',
  business_warehouse_location: '',
  business_employees_count: null,
  business_operation_days: '',
  business_logistics: '',
  business_main_suppliers: '',
};

export default function BusinessAboutSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<AboutFields>(EMPTY);

  const { data } = useQuery<AboutFields>({
    queryKey: ['business-about', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('business_description, business_warehouse_location, business_employees_count, business_operation_days, business_logistics, business_main_suppliers')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? EMPTY) as unknown as AboutFields;
    },
  });

  useEffect(() => {
    if (data) {
      setFields({
        business_description: data.business_description ?? '',
        business_warehouse_location: data.business_warehouse_location ?? '',
        business_employees_count: data.business_employees_count,
        business_operation_days: data.business_operation_days ?? '',
        business_logistics: data.business_logistics ?? '',
        business_main_suppliers: data.business_main_suppliers ?? '',
      });
    }
  }, [data]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          business_description: fields.business_description?.trim() || null,
          business_warehouse_location: fields.business_warehouse_location?.trim() || null,
          business_employees_count: fields.business_employees_count,
          business_operation_days: fields.business_operation_days?.trim() || null,
          business_logistics: fields.business_logistics?.trim() || null,
          business_main_suppliers: fields.business_main_suppliers?.trim() || null,
        } as never)
        .eq('user_id', user.id);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['business-about'] });
      await queryClient.invalidateQueries({ queryKey: ['informe-banco'] });
      toast({ title: 'Información del negocio guardada' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="font-medium text-sm flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-muted-foreground" />
          Acerca del negocio
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Información cualitativa que aparece en el Informe para Banco. Te ayuda a responder
          preguntas como "¿cómo opera tu negocio?" o "¿cuál es tu logística?".
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5 col-span-2">
          <Label className="text-xs">Descripción breve del negocio</Label>
          <Textarea
            rows={2}
            value={fields.business_description ?? ''}
            onChange={(e) => setFields({ ...fields, business_description: e.target.value })}
            placeholder="Ej: Comercializamos perfilería de aluminio para arquitectura, vendiendo a fabricantes de ventanas en Bogotá y Medellín."
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Ubicación de bodega</Label>
          <Input
            value={fields.business_warehouse_location ?? ''}
            onChange={(e) => setFields({ ...fields, business_warehouse_location: e.target.value })}
            placeholder="Ej: Calle 80 #45-12, Bogotá"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Empleados directos</Label>
          <Input
            type="number"
            min="0"
            value={fields.business_employees_count ?? ''}
            onChange={(e) => setFields({ ...fields, business_employees_count: e.target.value ? Number(e.target.value) : null })}
            placeholder="Ej: 8"
          />
        </div>
        <div className="space-y-1.5 col-span-2">
          <Label className="text-xs">Días y horario de operación</Label>
          <Input
            value={fields.business_operation_days ?? ''}
            onChange={(e) => setFields({ ...fields, business_operation_days: e.target.value })}
            placeholder="Ej: Lunes a Viernes 8am-6pm, Sábado 8am-12pm"
          />
        </div>
        <div className="space-y-1.5 col-span-2">
          <Label className="text-xs">Logística (transporte, distribución, entrega)</Label>
          <Textarea
            rows={2}
            value={fields.business_logistics ?? ''}
            onChange={(e) => setFields({ ...fields, business_logistics: e.target.value })}
            placeholder="Ej: Despachos propios en camión NPR a Bogotá, Coordinadora a otras ciudades. Plazos 24-72h."
          />
        </div>
        <div className="space-y-1.5 col-span-2">
          <Label className="text-xs">Principales proveedores</Label>
          <Textarea
            rows={2}
            value={fields.business_main_suppliers ?? ''}
            onChange={(e) => setFields({ ...fields, business_main_suppliers: e.target.value })}
            placeholder="Ej: Alcoa Cerámica (perfiles), Vidrios del Valle (vidrio), Tornillos S.A. (herrajes)"
          />
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        Guardar información
      </Button>
    </div>
  );
}
