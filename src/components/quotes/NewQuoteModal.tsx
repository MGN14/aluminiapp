import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  Plus,
  Trash2,
  UserPlus,
  Sparkles,
  Calculator as CalculatorIcon,
  Receipt,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useAluminumCatalog } from '@/hooks/useAluminumCatalog';
import { useResponsiblesWithSalesFlag } from '@/hooks/useResponsiblesWithSalesFlag';
import { useQuotationMutations, type CreateQuotationInput } from '@/hooks/useQuotations';
import {
  computeQuotationTotals,
  type QuotationItemDraft,
  type Quotation,
  type QuotationItem,
} from '@/types/quotation';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string, quote_number: string) => void;
  /** Para edición: si se pasa, el modal precarga la cotización */
  editing?: {
    quotation: Quotation;
    items: QuotationItem[];
  } | null;
}

const NEW_RESPONSIBLE_VALUE = '__new__';

interface ItemRow extends QuotationItemDraft {
  // local id para keys (uuid corto)
  _key: string;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(daysFromIssue: number, issue: string): string {
  const base = new Date(issue + 'T00:00:00');
  base.setDate(base.getDate() + Math.max(1, daysFromIssue));
  return base.toISOString().slice(0, 10);
}

export default function NewQuoteModal({ open, onOpenChange, onCreated, editing }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = !!editing;

  // Catalog + responsibles
  const { data: catalog = [], isLoading: catLoading } = useAluminumCatalog({ onlyActive: true });
  const { data: responsibles = [], isLoading: respLoading } = useResponsiblesWithSalesFlag({
    onlyActive: true,
  });

  // User defaults from profiles
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);
  const [defaultLaborPct, setDefaultLaborPct] = useState<number>(0);
  const [defaultValidityDays, setDefaultValidityDays] = useState<number>(15);
  const [defaultTerms, setDefaultTerms] = useState<string>('');

  // Form state
  const [responsibleId, setResponsibleId] = useState<string>('');
  const [creatingResp, setCreatingResp] = useState(false);
  const [newRespName, setNewRespName] = useState('');
  const [newRespNit, setNewRespNit] = useState('');
  const [newRespEmail, setNewRespEmail] = useState('');
  const [newRespPhone, setNewRespPhone] = useState('');
  const [newRespAddress, setNewRespAddress] = useState('');
  const [savingResp, setSavingResp] = useState(false);

  const [issueDate, setIssueDate] = useState<string>(todayISO());
  const [validUntil, setValidUntil] = useState<string>('');
  const [laborPct, setLaborPct] = useState<string>('');
  const [profitPct, setProfitPct] = useState<string>('20');
  const [notes, setNotes] = useState<string>('');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Impuestos / retenciones (Fase D)
  const [applyIva, setApplyIva] = useState<boolean>(true);
  const [ivaRatePct, setIvaRatePct] = useState<string>('19');
  const [applyRetefuente, setApplyRetefuente] = useState<boolean>(false);
  const [retefuenteRatePct, setRetefuenteRatePct] = useState<string>('2.5');
  const [applyReteica, setApplyReteica] = useState<boolean>(false);
  const [reteicaRatePct, setReteicaRatePct] = useState<string>('0.4');

  const { create, update } = useQuotationMutations();
  const submitting = create.isPending || update.isPending || savingResp;

  // Cargar defaults del perfil + tax_settings (retef compra) + profile.reteica
  useEffect(() => {
    if (!user || !open || defaultsLoaded || isEditing) return;
    (async () => {
      try {
        const { data: profileData } = await (supabase
          .from('profiles')
          .select(
            'quote_labor_pct_default, quote_validity_days_default, quote_terms_default, reteica_rate',
          )
          .eq('user_id', user.id)
          .maybeSingle() as unknown as Promise<{
            data: {
              quote_labor_pct_default: number | null;
              quote_validity_days_default: number | null;
              quote_terms_default: string | null;
              reteica_rate: number | null;
            } | null;
          }>);
        const labor = Number(profileData?.quote_labor_pct_default ?? 0);
        const validity = Number(profileData?.quote_validity_days_default ?? 15);
        const terms = profileData?.quote_terms_default ?? '';
        setDefaultLaborPct(labor);
        setDefaultValidityDays(validity);
        setDefaultTerms(terms);
        setLaborPct(String(labor));
        setNotes(terms);
        setValidUntil(addDaysISO(validity, todayISO()));

        // Reteica default desde profile.reteica_rate (decimal, ej 0.004 = 0.4%)
        const reteicaPct = Number(profileData?.reteica_rate ?? 0) * 100;
        if (reteicaPct > 0) setReteicaRatePct(String(reteicaPct));

        // Retefuente default desde tax_settings.retefuente_compra_rate
        try {
          const { data: tax } = await (supabase
            .from('tax_settings')
            .select('retefuente_compra_rate')
            .maybeSingle() as unknown as Promise<{
              data: { retefuente_compra_rate: number | null } | null;
            }>);
          const retefPct = Number(tax?.retefuente_compra_rate ?? 0) * 100;
          if (retefPct > 0) setRetefuenteRatePct(String(retefPct));
        } catch {
          /* tax_settings es opcional */
        }
      } catch (err) {
        console.error('NewQuoteModal: failed to load defaults', err);
      } finally {
        setDefaultsLoaded(true);
      }
    })();
  }, [user, open, defaultsLoaded, isEditing]);

  // Cargar valores cuando es edición
  useEffect(() => {
    if (!open || !editing) return;
    const q = editing.quotation;
    setResponsibleId(q.responsible_id);
    setIssueDate(q.issue_date);
    setValidUntil(q.valid_until);
    setLaborPct(String(q.labor_pct));
    setProfitPct(String(q.profit_pct));
    setNotes(q.notes ?? '');
    setApplyIva(!!q.apply_iva);
    setIvaRatePct(String((Number(q.iva_rate) || 0) * 100));
    setApplyRetefuente(!!q.apply_retefuente);
    setRetefuenteRatePct(String((Number(q.retefuente_rate) || 0) * 100));
    setApplyReteica(!!q.apply_reteica);
    setReteicaRatePct(String((Number(q.reteica_rate) || 0) * 100));
    setItems(
      editing.items.map((it) => ({
        _key: uid(),
        description: it.description ?? '',
        system: it.system,
        color: it.color,
        width_m: Number(it.width_m),
        height_m: Number(it.height_m),
        quantity: Number(it.quantity),
        price_per_m2: Number(it.price_per_m2),
      })),
    );
    setDefaultsLoaded(true);
  }, [open, editing]);

  // Cuando cambia issueDate y NO estoy editando, recalcular validUntil con default
  useEffect(() => {
    if (!issueDate || isEditing) return;
    if (!defaultsLoaded) return;
    setValidUntil(addDaysISO(defaultValidityDays, issueDate));
  }, [issueDate, defaultValidityDays, defaultsLoaded, isEditing]);

  // Catalog options derived
  const systemsList = useMemo(() => {
    const set = new Set<string>();
    catalog.forEach((c) => set.add(c.system));
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }),
    );
  }, [catalog]);

  const colorsForSystem = (system: string) =>
    catalog
      .filter((c) => c.system === system)
      .map((c) => ({ color: c.color, price: Number(c.price_per_m2), id: c.id }))
      .sort((a, b) => a.color.localeCompare(b.color, 'es', { sensitivity: 'base' }));

  const reset = () => {
    setResponsibleId('');
    setCreatingResp(false);
    setNewRespName('');
    setNewRespNit('');
    setNewRespEmail('');
    setNewRespPhone('');
    setNewRespAddress('');
    setSavingResp(false);
    setIssueDate(todayISO());
    setValidUntil(addDaysISO(defaultValidityDays || 15, todayISO()));
    setLaborPct(String(defaultLaborPct));
    setProfitPct('20');
    setNotes(defaultTerms);
    setItems([]);
    setSubmitError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    onOpenChange(false);
    setTimeout(() => {
      if (!isEditing) reset();
      setDefaultsLoaded(false);
    }, 150);
  };

  // Items handlers
  const addItem = () => {
    const firstSystem = systemsList[0] ?? '';
    const firstColors = firstSystem ? colorsForSystem(firstSystem) : [];
    const firstColor = firstColors[0];
    setItems((prev) => [
      ...prev,
      {
        _key: uid(),
        system: firstSystem,
        color: firstColor?.color ?? '',
        width_m: 1,
        height_m: 1,
        quantity: 1,
        price_per_m2: firstColor?.price ?? 0,
        description: '',
      },
    ]);
  };

  const removeItem = (key: string) => {
    setItems((prev) => prev.filter((i) => i._key !== key));
  };

  const updateItem = (key: string, patch: Partial<ItemRow>) => {
    setItems((prev) => prev.map((it) => (it._key === key ? { ...it, ...patch } : it)));
  };

  const onSystemChange = (key: string, system: string) => {
    const colors = colorsForSystem(system);
    const first = colors[0];
    updateItem(key, {
      system,
      color: first?.color ?? '',
      price_per_m2: first?.price ?? 0,
    });
  };

  const onColorChange = (key: string, color: string) => {
    const item = items.find((i) => i._key === key);
    if (!item) return;
    const entry = catalog.find((c) => c.system === item.system && c.color === color);
    updateItem(key, {
      color,
      price_per_m2: entry ? Number(entry.price_per_m2) : item.price_per_m2,
    });
  };

  // Totals (live) — incluye IVA y retenciones
  const totals = useMemo(() => {
    const labor = Math.max(0, parseFloat(laborPct) || 0);
    const profit = Math.max(0, parseFloat(profitPct) || 0);
    const ivaRate = Math.max(0, parseFloat(ivaRatePct) || 0) / 100;
    const retefRate = Math.max(0, parseFloat(retefuenteRatePct) || 0) / 100;
    const reteicaRate = Math.max(0, parseFloat(reteicaRatePct) || 0) / 100;
    return computeQuotationTotals(items, labor, profit, {
      apply_iva: applyIva,
      iva_rate: ivaRate,
      apply_retefuente: applyRetefuente,
      retefuente_rate: retefRate,
      apply_reteica: applyReteica,
      reteica_rate: reteicaRate,
    });
  }, [
    items,
    laborPct,
    profitPct,
    applyIva,
    ivaRatePct,
    applyRetefuente,
    retefuenteRatePct,
    applyReteica,
    reteicaRatePct,
  ]);

  // Crear cliente on-the-fly
  const handleCreateResponsible = async () => {
    if (!user) return;
    const name = newRespName.trim();
    if (!name) {
      toast({ title: 'Falta el nombre del cliente', variant: 'destructive' });
      return;
    }
    setSavingResp(true);
    try {
      const { data, error } = await supabase
        .from('responsibles')
        .insert({
          user_id: user.id,
          name,
          nit: newRespNit.trim() || null,
          email: newRespEmail.trim() || null,
          phone: newRespPhone.trim() || null,
          address: newRespAddress.trim() || null,
          responsible_type: 'banking',
        } as never)
        .select('id, name')
        .single();
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['responsibles-with-sales-flag'] });
      await queryClient.invalidateQueries({ queryKey: ['responsibles-remisiones'] });
      setResponsibleId((data as any).id);
      setCreatingResp(false);
      setNewRespName('');
      setNewRespNit('');
      setNewRespEmail('');
      setNewRespPhone('');
      setNewRespAddress('');
      toast({ title: 'Cliente creado' });
    } catch (e: any) {
      toast({
        title: 'No se pudo crear el cliente',
        description: e?.message || 'Error desconocido',
        variant: 'destructive',
      });
    } finally {
      setSavingResp(false);
    }
  };

  // Validation + submit
  const handleSubmit = async () => {
    setSubmitError(null);
    if (!responsibleId) {
      setSubmitError('Seleccioná el cliente al que va dirigida la cotización.');
      return;
    }
    if (items.length === 0) {
      setSubmitError('Agregá al menos un ítem (sistema, color, dimensiones).');
      return;
    }
    for (const it of items) {
      if (!it.system || !it.color) {
        setSubmitError('Cada ítem necesita sistema y color del catálogo.');
        return;
      }
      if (!it.width_m || it.width_m <= 0 || !it.height_m || it.height_m <= 0) {
        setSubmitError('Las dimensiones (ancho y alto en metros) deben ser mayores a cero.');
        return;
      }
      if (!it.quantity || it.quantity <= 0) {
        setSubmitError('La cantidad debe ser un entero mayor a cero.');
        return;
      }
      if (it.price_per_m2 === null || it.price_per_m2 === undefined || it.price_per_m2 < 0) {
        setSubmitError('El precio por m² es inválido.');
        return;
      }
    }
    if (validUntil < issueDate) {
      setSubmitError('La fecha de vencimiento no puede ser anterior a la emisión.');
      return;
    }

    const payload: CreateQuotationInput = {
      responsible_id: responsibleId,
      issue_date: issueDate,
      valid_until: validUntil,
      labor_pct: Math.max(0, parseFloat(laborPct) || 0),
      profit_pct: Math.max(0, parseFloat(profitPct) || 0),
      apply_iva: applyIva,
      iva_rate: Math.max(0, parseFloat(ivaRatePct) || 0) / 100,
      apply_retefuente: applyRetefuente,
      retefuente_rate: Math.max(0, parseFloat(retefuenteRatePct) || 0) / 100,
      apply_reteica: applyReteica,
      reteica_rate: Math.max(0, parseFloat(reteicaRatePct) || 0) / 100,
      notes: notes.trim() || null,
      items: items.map((it) => ({
        description: it.description?.trim() || '',
        system: it.system,
        color: it.color,
        width_m: Number(it.width_m),
        height_m: Number(it.height_m),
        quantity: Number(it.quantity),
        price_per_m2: Number(it.price_per_m2),
      })),
    };

    try {
      if (isEditing && editing) {
        await update.mutateAsync({ ...payload, id: editing.quotation.id });
        toast({ title: 'Cotización actualizada' });
        handleClose();
      } else {
        const result = await create.mutateAsync(payload);
        toast({
          title: `Cotización ${result.quote_number} creada`,
          description: 'Quedó como borrador. Podés enviarla por email/WhatsApp desde el detalle.',
        });
        onCreated?.(result.id, result.quote_number);
        handleClose();
      }
    } catch (e: any) {
      const msg = e?.message ?? 'Error desconocido';
      setSubmitError(msg);
      toast({ title: 'No se pudo guardar', description: msg, variant: 'destructive' });
    }
  };

  const catalogEmpty = !catLoading && catalog.length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : handleClose())}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar cotización' : 'Nueva cotización'}</DialogTitle>
          <DialogDescription>
            Calculo en vivo: total = (m² × precio) × (1 + mano de obra%) × (1 + utilidad%).
          </DialogDescription>
        </DialogHeader>

        {catalogEmpty && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-start gap-2">
            <Sparkles className="h-4 w-4 text-amber-700 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-amber-900 dark:text-amber-100">
              <strong>Cargá tu catálogo primero.</strong> Necesitás al menos un sistema + color con
              precio por m² antes de armar una cotización. Cerrá este modal y abrí{' '}
              <em>Catálogo</em>.
            </div>
          </div>
        )}

        {/* ============= DATOS GENERALES ============= */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pb-3 border-b">
          <div className="md:col-span-6 space-y-1.5">
            <Label>Cliente *</Label>
            {creatingResp ? (
              <div className="space-y-2 rounded-md border border-border p-3 bg-muted/30">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px]">Nombre *</Label>
                    <Input
                      autoFocus
                      placeholder="Aluminios JH"
                      value={newRespName}
                      onChange={(e) => setNewRespName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">NIT / CC</Label>
                    <Input
                      placeholder="900123456-7"
                      value={newRespNit}
                      onChange={(e) => setNewRespNit(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Email</Label>
                    <Input
                      type="email"
                      placeholder="cliente@empresa.com"
                      value={newRespEmail}
                      onChange={(e) => setNewRespEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Teléfono / WhatsApp</Label>
                    <Input
                      type="tel"
                      placeholder="+57 300 123 4567"
                      value={newRespPhone}
                      onChange={(e) => setNewRespPhone(e.target.value)}
                    />
                  </div>
                  <div className="sm:col-span-2 space-y-1">
                    <Label className="text-[10px]">Dirección</Label>
                    <Input
                      placeholder="Cra 7 # 12-34, Bogotá"
                      value={newRespAddress}
                      onChange={(e) => setNewRespAddress(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setCreatingResp(false)}
                    disabled={savingResp}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleCreateResponsible}
                    disabled={savingResp || !newRespName.trim()}
                  >
                    {savingResp && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                    Crear cliente
                  </Button>
                </div>
              </div>
            ) : (
              <Select
                value={responsibleId}
                onValueChange={(v) => {
                  if (v === NEW_RESPONSIBLE_VALUE) {
                    setCreatingResp(true);
                    setResponsibleId('');
                  } else {
                    setResponsibleId(v);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      respLoading
                        ? 'Cargando…'
                        : responsibles.length === 0
                          ? 'Crear cliente nuevo'
                          : 'Seleccionar cliente'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {responsibles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      <span className="flex items-center gap-1.5">
                        <span>{r.name}</span>
                        {r.has_sales_history && (
                          <Badge variant="default" className="text-[9px] px-1 py-0 h-4">
                            Cliente
                          </Badge>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_RESPONSIBLE_VALUE} className="text-primary">
                    <span className="inline-flex items-center gap-1.5">
                      <UserPlus className="h-3.5 w-3.5" />
                      Crear cliente nuevo
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
            {!creatingResp && responsibleId && (
              <p className="text-[10px] text-muted-foreground">
                {(() => {
                  const r = responsibles.find((x) => x.id === responsibleId);
                  if (!r) return null;
                  const bits = [r.email, r.phone, r.nit ? `NIT ${r.nit}` : null].filter(Boolean);
                  return bits.length > 0
                    ? bits.join(' · ')
                    : 'Sin email/teléfono cargado — agregalo en Beneficiarios para enviar la cotización.';
                })()}
              </p>
            )}
          </div>

          <div className="md:col-span-3 space-y-1.5">
            <Label>Emisión *</Label>
            <Input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </div>
          <div className="md:col-span-3 space-y-1.5">
            <Label>Válida hasta *</Label>
            <Input
              type="date"
              value={validUntil}
              min={issueDate}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </div>
        </div>

        {/* ============= ITEMS ============= */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <Label className="text-base">Ítems</Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addItem}
              disabled={catalogEmpty}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Agregar ítem
            </Button>
          </div>

          {items.length === 0 ? (
            <div className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
              Sin ítems aún — usá <strong>Agregar ítem</strong> para sumar la primera ventana.
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((it, idx) => {
                const colors = colorsForSystem(it.system);
                const area = (Number(it.width_m) || 0) * (Number(it.height_m) || 0) * (Number(it.quantity) || 0);
                const lineTotal = area * (Number(it.price_per_m2) || 0);
                return (
                  <div
                    key={it._key}
                    className="rounded-md border border-border p-3 bg-muted/20 space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-muted-foreground">
                        Ítem #{idx + 1}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(it._key)}
                        className="h-6 px-2 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                      <div className="sm:col-span-3 space-y-1">
                        <Label className="text-[10px]">Sistema *</Label>
                        <Select
                          value={it.system}
                          onValueChange={(v) => onSystemChange(it._key, v)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Sistema" />
                          </SelectTrigger>
                          <SelectContent>
                            {systemsList.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="sm:col-span-3 space-y-1">
                        <Label className="text-[10px]">Color *</Label>
                        <Select
                          value={it.color}
                          onValueChange={(v) => onColorChange(it._key, v)}
                          disabled={!it.system || colors.length === 0}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Color" />
                          </SelectTrigger>
                          <SelectContent>
                            {colors.map((c) => (
                              <SelectItem key={c.id} value={c.color}>
                                <span className="flex items-center gap-1.5">
                                  {c.color}
                                  <span className="text-[10px] text-muted-foreground">
                                    {formatCurrency(c.price)}/m²
                                  </span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="sm:col-span-2 space-y-1">
                        <Label className="text-[10px]">Ancho (m) *</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min={0}
                          value={it.width_m}
                          onChange={(e) =>
                            updateItem(it._key, { width_m: Number(e.target.value) })
                          }
                          className="h-8 text-xs"
                        />
                      </div>

                      <div className="sm:col-span-2 space-y-1">
                        <Label className="text-[10px]">Alto (m) *</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min={0}
                          value={it.height_m}
                          onChange={(e) =>
                            updateItem(it._key, { height_m: Number(e.target.value) })
                          }
                          className="h-8 text-xs"
                        />
                      </div>

                      <div className="sm:col-span-2 space-y-1">
                        <Label className="text-[10px]">Cantidad *</Label>
                        <Input
                          type="number"
                          step="1"
                          min={1}
                          value={it.quantity}
                          onChange={(e) =>
                            updateItem(it._key, {
                              quantity: Math.max(1, parseInt(e.target.value, 10) || 1),
                            })
                          }
                          className="h-8 text-xs"
                        />
                      </div>

                      <div className="sm:col-span-9 space-y-1">
                        <Label className="text-[10px]">Descripción (opcional)</Label>
                        <Input
                          placeholder="Ej: Ventana corrediza de la sala"
                          value={it.description ?? ''}
                          onChange={(e) =>
                            updateItem(it._key, { description: e.target.value })
                          }
                          className="h-8 text-xs"
                        />
                      </div>

                      <div className="sm:col-span-3 space-y-1">
                        <Label className="text-[10px]">Subtotal del ítem</Label>
                        <div className="h-8 flex items-center px-2 rounded-md bg-background border border-border tabular-nums text-xs font-medium">
                          {formatCurrency(lineTotal)}
                        </div>
                        <p className="text-[9px] text-muted-foreground tabular-nums">
                          {area.toFixed(2)} m² · {formatCurrency(it.price_per_m2)}/m²
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ============= % Mano de obra + Utilidad + Notas ============= */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-3 border-t">
          <div className="md:col-span-3 space-y-1.5">
            <Label>% Mano de obra</Label>
            <Input
              type="number"
              step="0.1"
              min={0}
              value={laborPct}
              onChange={(e) => setLaborPct(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">Default del perfil</p>
          </div>
          <div className="md:col-span-3 space-y-1.5">
            <Label>% Utilidad</Label>
            <Input
              type="number"
              step="0.1"
              min={0}
              value={profitPct}
              onChange={(e) => setProfitPct(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">Variable por cotización</p>
          </div>
          <div className="md:col-span-6 space-y-1.5">
            <Label>Términos y condiciones</Label>
            <Textarea
              placeholder={defaultTerms || 'Anticipo, tiempo de fabricación, garantía…'}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        {/* ============= IMPUESTOS Y RETENCIONES ============= */}
        <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3 mt-3">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Impuestos y retenciones</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* IVA */}
            <div className="rounded-md border border-border bg-background p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">IVA</Label>
                <Switch checked={applyIva} onCheckedChange={setApplyIva} />
              </div>
              <Input
                type="number"
                step="0.1"
                min={0}
                value={ivaRatePct}
                onChange={(e) => setIvaRatePct(e.target.value)}
                disabled={!applyIva}
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                Porcentaje (default 19%). Se suma al total.
              </p>
            </div>

            {/* Retefuente */}
            <div className="rounded-md border border-border bg-background p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Retención en la fuente</Label>
                <Switch checked={applyRetefuente} onCheckedChange={setApplyRetefuente} />
              </div>
              <Input
                type="number"
                step="0.1"
                min={0}
                value={retefuenteRatePct}
                onChange={(e) => setRetefuenteRatePct(e.target.value)}
                disabled={!applyRetefuente}
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                Activá si el cliente es agente retenedor. Se resta del total con IVA.
              </p>
            </div>

            {/* Reteica */}
            <div className="rounded-md border border-border bg-background p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Reteica</Label>
                <Switch checked={applyReteica} onCheckedChange={setApplyReteica} />
              </div>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={reteicaRatePct}
                onChange={(e) => setReteicaRatePct(e.target.value)}
                disabled={!applyReteica}
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                Tarifa por mil de la ciudad. Se resta del total con IVA.
              </p>
            </div>
          </div>
        </div>

        {/* ============= TOTALES (resumen lateral) ============= */}
        <div className="rounded-md border border-border bg-muted/30 p-3 mt-3">
          <div className="flex items-center gap-2 mb-3">
            <CalculatorIcon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Resumen</span>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal m²</span>
              <span className="tabular-nums">{formatCurrency(totals.subtotal_base)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                + Mano de obra ({laborPct || 0}%)
              </span>
              <span className="tabular-nums">{formatCurrency(totals.labor_amount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                + Utilidad ({profitPct || 0}%)
              </span>
              <span className="tabular-nums">{formatCurrency(totals.profit_amount)}</span>
            </div>
            <div className="flex justify-between border-t border-border pt-1 mt-1 font-medium">
              <span>= Total sin IVA</span>
              <span className="tabular-nums">{formatCurrency(totals.total)}</span>
            </div>
            {applyIva && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">+ IVA ({ivaRatePct}%)</span>
                <span className="tabular-nums">{formatCurrency(totals.iva_amount)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-1 mt-1 font-semibold text-sm text-primary">
              <span>Total con IVA</span>
              <span className="tabular-nums">{formatCurrency(totals.total_with_iva)}</span>
            </div>
            {applyRetefuente && (
              <div className="flex justify-between text-muted-foreground">
                <span>− Retef. fuente ({retefuenteRatePct}%)</span>
                <span className="tabular-nums">
                  −{formatCurrency(totals.retefuente_amount)}
                </span>
              </div>
            )}
            {applyReteica && (
              <div className="flex justify-between text-muted-foreground">
                <span>− Reteica ({reteicaRatePct}%)</span>
                <span className="tabular-nums">−{formatCurrency(totals.reteica_amount)}</span>
              </div>
            )}
            {(applyRetefuente || applyReteica) && (
              <div className="flex justify-between border-t border-border pt-1 mt-1 font-medium text-sm">
                <span>Valor neto a recibir</span>
                <span className="tabular-nums">{formatCurrency(totals.total_net)}</span>
              </div>
            )}
          </div>
        </div>

        {submitError && (
          <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
            {submitError}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || catalogEmpty}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            {isEditing ? 'Guardar cambios' : 'Crear cotización'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
