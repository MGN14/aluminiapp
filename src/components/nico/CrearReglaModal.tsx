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
import { MOVEMENT_NATURES, type MovementNature } from '@/types/transaction';
import { toast } from 'sonner';
import { Zap, Info, Shield, Lock } from 'lucide-react';

export interface ReglaPatronSugerido {
  id: string;
  titulo: string;
  descripcion: string;
  confianza: number;
  suggestedKeyword?: string;
  suggestedAmountMin?: number;
  suggestedAmountMax?: number;
  suggestedType?: 'ingreso' | 'egreso';
  /** Pre-llenados derivados de cómo el usuario YA clasificó estas TX a mano */
  suggestedCategoryId?: string;
  suggestedResponsibleId?: string;
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
  const { createRule, updateRule, applyPendingRulesViaRPC } = useReconciliationRules();
  const isEdit = !!editRule;
  // Keyword bloqueada cuando la regla nace de un patrón detectado: es el texto
  // exacto con el que la app encontró las TX; editarla rompe el matching.
  const keywordLocked = !isEdit && !!patron?.suggestedKeyword;

  const [name, setName] = useState('');
  const [keyword, setKeyword] = useState('');
  const [txType, setTxType] = useState<'ingreso' | 'egreso'>('egreso');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [dayMin, setDayMin] = useState('');
  const [dayMax, setDayMax] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [responsibleId, setResponsibleId] = useState('');
  const [movementNature, setMovementNature] = useState<string>('__none__');
  const [autoConciliate, setAutoConciliate] = useState(true);
  const [keywordIsRegex, setKeywordIsRegex] = useState(false);
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
      setMovementNature(editRule.movement_nature ?? '__none__');
      setAutoConciliate(editRule.auto_conciliate ?? true);
      setKeywordIsRegex((editRule as { keyword_is_regex?: boolean }).keyword_is_regex ?? false);
    } else {
      setName(patron?.titulo ?? '');
      setKeyword(patron?.suggestedKeyword ?? '');
      setTxType(patron?.suggestedType ?? 'egreso');
      setAmountMin(patron?.suggestedAmountMin?.toLocaleString('es-CO') ?? '');
      setAmountMax(patron?.suggestedAmountMax?.toLocaleString('es-CO') ?? '');
      setDayMin('');
      setDayMax('');
      // Derivados de cómo el usuario ya venía clasificando estas TX a mano
      setCategoryId(patron?.suggestedCategoryId ?? '');
      setResponsibleId(patron?.suggestedResponsibleId ?? '');
      setMovementNature('__none__');
      setAutoConciliate(true);
      setKeywordIsRegex(false);
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
      // Si es regex, validar que compile (evitar guardar regex inválido que rompa el trigger)
      if (keywordIsRegex && keyword.trim()) {
        try {
          new RegExp(keyword.trim(), 'i');
        } catch (e) {
          toast.error('Regex inválido: ' + (e as Error).message);
          setSaving(false);
          return;
        }
      }
      const payload: NewReconciliationRule & { keyword_is_regex?: boolean } = {
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
        movement_nature: movementNature && movementNature !== '__none__' ? (movementNature as MovementNature) : undefined,
        auto_conciliate: autoConciliate,
        keyword_is_regex: keywordIsRegex,
      };

      if (isEdit && editRule) {
        await updateRule.mutateAsync({ id: editRule.id, updates: payload });
        toast.success('Regla actualizada');
      } else {
        await createRule.mutateAsync(payload);
        toast.success('¡Regla creada!');
      }
      onClose();
      // Aplicar retroactivamente a las TX pendientes YA, sin esperar al próximo
      // extracto. Antes la regla nueva quedaba dormida hasta el siguiente upload
      // (o hasta tocar "Aplicar a transacciones existentes") y parecía que "no
      // funcionaba". El RPC ya muestra su propio toast con el resultado.
      try {
        await applyPendingRulesViaRPC(5000);
      } catch (retroErr) {
        console.warn('Retro-aplicación de reglas falló (la regla quedó guardada):', retroErr);
      }
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
            <Label className="text-sm font-medium">
              {keywordLocked
                ? 'Palabra clave (detectada del patrón)'
                : keywordIsRegex ? 'Regex (case-insensitive) *' : 'Palabra clave en la descripción bancaria *'}
            </Label>
            {keywordLocked ? (
              <>
                {/* La keyword viene del detector de patrones: es EXACTAMENTE el texto
                    con el que la app encontró las transacciones. Editarla a mano rompía
                    la regla (dejaba de matchear), así que acá queda bloqueada. */}
                <div className="mt-1.5 flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-muted/50">
                  <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="font-mono text-sm uppercase truncate">{keyword}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Es el texto con el que Nico identificó el patrón en tus extractos — no se puede editar
                  para garantizar que la regla matchee. Si necesitás otra palabra, creá la regla desde el módulo Reglas.
                </p>
              </>
            ) : (
              <>
                <Input
                  value={keyword}
                  onChange={e => setKeyword(keywordIsRegex ? e.target.value : e.target.value.toUpperCase())}
                  placeholder={keywordIsRegex ? 'Ej: PAGO.*ALUMINIOS|FERR' : 'Ej: NETFLIX, CLARO, ARRIENDO...'}
                  className={`mt-1.5 font-mono ${keywordIsRegex ? '' : 'uppercase'}`}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {keywordIsRegex
                    ? 'Regex POSIX (ej: "ALUMINIOS|FERR" matchea cualquiera de los dos). Sin distinguir mayúsculas.'
                    : 'Si la transacción contiene esta palabra, Nico aplica la regla automáticamente (sin distinguir mayúsculas).'}
                </p>
                <div className="flex items-center gap-2 mt-2 px-2 py-1.5 rounded bg-muted/40 border border-border">
                  <Switch
                    id="regex-toggle"
                    checked={keywordIsRegex}
                    onCheckedChange={setKeywordIsRegex}
                  />
                  <Label htmlFor="regex-toggle" className="text-xs cursor-pointer">
                    Usar regex (avanzado) — para patrones complejos con OR / wildcards
                  </Label>
                </div>
              </>
            )}
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

          {/* Movement nature — para traslados/devoluciones/etc que NO deben
              contar en el P&G (ej: "PAGO TARJETA" → Traspaso entre cuentas). */}
          <div>
            <Label className="text-sm font-medium">Naturaleza del movimiento</Label>
            <Select value={movementNature} onValueChange={setMovementNature}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sin cambiar (movimiento operativo normal)</SelectItem>
                {MOVEMENT_NATURES.filter(n => n.value !== 'operativo').map(n => (
                  <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Si elegís Traspaso / Devolución / Préstamo / Aporte, estos movimientos NO
              cuentan como ingreso ni gasto en el P&amp;G. Ej: marcá el "PAGO TARJETA" como
              <strong> Traspaso entre cuentas</strong> para no doble-contar con las compras de la tarjeta.
            </p>
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
