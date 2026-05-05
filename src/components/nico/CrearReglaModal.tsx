import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useReconciliationRules, NewReconciliationRule, ReconciliationRule } from '@/hooks/useReconciliationRules';
import { toast } from 'sonner';
import { Zap, Info, Shield } from 'lucide-react';

export interface ReglaPatronSugerido {
  id: string;
  titulo: string;
  descripcion: string;
  confianza: number;
  suggestedKeyword?: string;
  suggestedAmountMin?: number;
  suggestedAmountMax?: number;
  suggestedType?: 'ingreso' | 'egreso';
}

interface CrearReglaModalProps {
  open: boolean;
  onClose: () => void;
  patron?: ReglaPatronSugerido;
  /** When provided, the modal opens in edit mode and updates this rule instead of creating a new one. */
  editRule?: ReconciliationRule;
}

function parseCOP(str: string): number | undefined {
  const cleaned = str.replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? undefined : n;
}

export default function CrearReglaModal({ open, onClose, patron, editRule }: CrearReglaModalProps) {
  const { user } = useAuth();
  const { createRule, updateRule } = useReconciliationRules();
  const isEdit = !!editRule;

  const [name, setName] = useState('');
  const [keyword, setKeyword] = useState('');
  const [txType, setTxType] = useState<'ingreso' | 'egreso'>('egreso');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [dayMin, setDayMin] = useState('');
  const [dayMax, setDayMax] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [responsibleId, setResponsibleId] = useState('');
  const [autoConciliate, setAutoConciliate] = useState(true);
  const [saving, setSaving] = useState(false);

  // Pre-fill from editRule (priority) or patron when modal opens
  useEffect(() => {
    if (!open) return;
    if (editRule) {
      setName(editRule.name ?? '');
      setKeyword(editRule.keyword ?? '');
      setTxType(editRule.tx_type ?? 'egreso');
      setAmountMin(editRule.amount_min != null ? editRule.amount_min.toLocaleString('es-CO') : '');
      setAmountMax(editRule.amount_max != null ? editRule.amount_max.toLocaleString('es-CO') : '');
      setDayMin(editRule.day_min != null ? String(editRule.day_min) : '');
      setDayMax(editRule.day_max != null ? String(editRule.day_max) : '');
      setCategoryId(editRule.category_id ?? '');
      setResponsibleId(editRule.responsible_id ?? '');
      setAutoConciliate(editRule.auto_conciliate ?? true);
    } else {
      setName(patron?.titulo ?? '');
      setKeyword(patron?.suggestedKeyword ?? '');
      setTxType(patron?.suggestedType ?? 'egreso');
      setAmountMin(patron?.suggestedAmountMin?.toLocaleString('es-CO') ?? '');
      setAmountMax(patron?.suggestedAmountMax?.toLocaleString('es-CO') ?? '');
      setDayMin('');
      setDayMax('');
      setCategoryId('');
      setResponsibleId('');
      setAutoConciliate(true);
    }
  }, [open, patron, editRule]);

  const { data: categories = [] } = useQuery({
    queryKey: ['categories-for-rules', user?.id],
    queryFn: async () => {
      // RLS filtra por owner; sin .eq('user_id', user.id) que rompía a colaboradores.
      const { data } = await supabase
        .from('categories')
        .select('id, name')
        .eq('active', true)
        .order('name');
      return (data || []) as unknown as { id: string; name: string }[];
    },
    enabled: !!user?.id && open,
  });

  const { data: responsibles = [] } = useQuery({
    queryKey: ['responsibles-for-rules', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('responsibles')
        .select('id, name')
        .eq('active', true)
        .order('name');
      return (data || []) as unknown as { id: string; name: string }[];
    },
    enabled: !!user?.id && open,
  });

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Ingresa un nombre para la regla');
      return;
    }
    if (!keyword.trim()) {
      toast.error('La palabra clave es obligatoria para identificar la transacción');
      return;
    }
    setSaving(true);
    try {
      const categoryIdClean = categoryId && categoryId !== '__none__' ? categoryId : undefined;
      const responsibleIdClean = responsibleId && responsibleId !== '__none__' ? responsibleId : undefined;
      const payload: NewReconciliationRule = {
        name: name.trim(),
        pattern_ref: editRule?.pattern_ref ?? patron?.id,
        keyword: keyword.trim(),
        tx_type: txType,
        amount_min: amountMin ? parseCOP(amountMin) : undefined,
        amount_max: amountMax ? parseCOP(amountMax) : undefined,
        day_min: dayMin ? parseInt(dayMin) : undefined,
        day_max: dayMax ? parseInt(dayMax) : undefined,
        category_id: categoryIdClean,
        category_name: categoryIdClean ? categories.find(c => c.id === categoryIdClean)?.name : undefined,
        responsible_id: responsibleIdClean,
        responsible_name: responsibleIdClean ? responsibles.find(r => r.id === responsibleIdClean)?.name : undefined,
        auto_conciliate: autoConciliate,
      };

      if (isEdit && editRule) {
        await updateRule.mutateAsync({ id: editRule.id, updates: payload });
        toast.success('Regla actualizada');
      } else {
        await createRule.mutateAsync(payload);
        toast.success('¡Regla creada! Nico la aplicará automáticamente en el próximo extracto.');
      }
      onClose();
    } catch (e: any) {
      console.error(e);
      toast.error('Error al guardar la regla: ' + (e?.message ?? 'Intenta de nuevo'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-success" />
            {isEdit ? 'Editar Regla' : 'Crear Regla de Conciliación'}
          </DialogTitle>
        </DialogHeader>

        {/* Pattern source badge (only when creating from a suggestion) */}
        {!isEdit && patron && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-success/5 border border-success/20 rounded-lg p-3">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-success" />
            <div>
              <span className="font-medium text-foreground">Basada en el patrón detectado:</span>
              <br />
              <span>{patron.titulo}</span>
              <Badge variant="outline" className="ml-2 text-[10px] py-0 border-success/40 text-success">
                {patron.confianza}% confianza
              </Badge>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {/* Name */}
          <div>
            <Label className="text-sm font-medium">Nombre de la regla *</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ej: Netflix mensual, Arriendo bodega..."
              className="mt-1.5"
            />
          </div>

          {/* Keyword */}
          <div>
            <Label className="text-sm font-medium">Palabra clave en la descripción bancaria *</Label>
            <Input
              value={keyword}
              onChange={e => setKeyword(e.target.value.toUpperCase())}
              placeholder="Ej: NETFLIX, CLARO, ARRIENDO..."
              className="mt-1.5 font-mono uppercase"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Si la transacción contiene esta palabra, Nico aplica la regla automáticamente (sin distinguir mayúsculas)
            </p>
          </div>

          {/* Type */}
          <div>
            <Label className="text-sm font-medium">Tipo de movimiento</Label>
            <Select value={txType} onValueChange={(v: 'ingreso' | 'egreso') => { setTxType(v); setCategoryId(''); }}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="egreso">Egreso (pago / gasto)</SelectItem>
                <SelectItem value="ingreso">Ingreso (cobro / venta)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Amount range */}
          <div>
            <Label className="text-sm font-medium">Rango de monto (opcional)</Label>
            <div className="grid grid-cols-2 gap-3 mt-1.5">
              <div>
                <Input
                  value={amountMin}
                  onChange={e => setAmountMin(e.target.value)}
                  placeholder="Mínimo ej: 45,000"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Desde (COP)</p>
              </div>
              <div>
                <Input
                  value={amountMax}
                  onChange={e => setAmountMax(e.target.value)}
                  placeholder="Máximo ej: 55,000"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Hasta (COP)</p>
              </div>
            </div>
          </div>

          {/* Day of month range */}
          <div>
            <Label className="text-sm font-medium">Día del mes (opcional)</Label>
            <div className="grid grid-cols-2 gap-3 mt-1.5">
              <div>
                <Input
                  value={dayMin}
                  onChange={e => setDayMin(e.target.value)}
                  placeholder="1"
                  type="number"
                  min="1"
                  max="31"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Día desde</p>
              </div>
              <div>
                <Input
                  value={dayMax}
                  onChange={e => setDayMax(e.target.value)}
                  placeholder="31"
                  type="number"
                  min="1"
                  max="31"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Día hasta</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Útil para egresos que siempre llegan entre el día X y el día Y del mes
            </p>
          </div>

          {/* Category */}
          <div>
            <Label className="text-sm font-medium">Categoría a asignar automáticamente</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Elige la categoría contable..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sin categoría (solo detectar)</SelectItem>
                {categories.map(cat => (
                  <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Responsible */}
          <div>
            <Label className="text-sm font-medium">Beneficiario a asignar automáticamente</Label>
            <Select value={responsibleId} onValueChange={setResponsibleId}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Elige el beneficiario..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sin beneficiario</SelectItem>
                {responsibles.map(r => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Auto conciliate toggle */}
          <div className="flex items-center justify-between rounded-xl border border-border p-4 bg-muted/20">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
                <Shield className="h-4 w-4 text-success" />
              </div>
              <div>
                <p className="text-sm font-medium">Conciliar automáticamente</p>
                <p className="text-xs text-muted-foreground">
                  Nico aplica esta regla sin pedirte confirmación cada vez
                </p>
              </div>
            </div>
            <Switch checked={autoConciliate} onCheckedChange={setAutoConciliate} />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-border">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !name.trim() || !keyword.trim()}
            className="gap-2"
          >
            <Zap className="h-4 w-4" />
            {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear Regla'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
