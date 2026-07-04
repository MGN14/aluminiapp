import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Plus, Ruler, Trash2, UserPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useDataOwner } from '@/hooks/useDataOwner';
import { supabase } from '@/integrations/supabase/client';
import { useResponsiblesWithSalesFlag } from '@/hooks/useResponsiblesWithSalesFlag';
import { useQuotationMutations } from '@/hooks/useQuotations';
import { useInventoryByIds, useProductTemplates } from '@/hooks/useProductTemplates';
import {
  buildTemplateSnapshot,
  computeDespiece,
  TIPO_LABELS,
  type ProductTemplate,
} from '@/types/productTemplate';
import type { QuotationItemDraft } from '@/types/quotation';
import ProductDrawing from './ProductDrawing';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string, quote_number: string) => void;
}

interface LineRow {
  _key: string;
  template_id: string;
  width_m: number;
  height_m: number;
  quantity: number;
  description: string;
}

const NEW_RESPONSIBLE_VALUE = '__new__';

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

function addDaysISO(days: number, issue: string): string {
  const base = new Date(issue + 'T00:00:00');
  base.setDate(base.getDate() + Math.max(1, days));
  return base.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export default function TemplateQuoteModal({ open, onOpenChange, onCreated }: Props) {
  const { user } = useAuth();
  const { dataOwnerId } = useDataOwner();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: allTemplates = [], isLoading: tplLoading } = useProductTemplates({
    onlyActive: true,
  });
  const templates = useMemo(
    () => allTemplates.filter((t) => t.piezas.length > 0),
    [allTemplates],
  );
  const templatesById = useMemo(() => {
    const m = new Map<string, ProductTemplate>();
    templates.forEach((t) => m.set(t.id, t));
    return m;
  }, [templates]);

  // Costos en vivo de todas las piezas referenciadas por las plantillas activas
  const allProductIds = useMemo(
    () => templates.flatMap((t) => t.piezas.map((p) => p.product_id)),
    [templates],
  );
  const { byId: productsById } = useInventoryByIds(allProductIds);

  const { data: responsibles = [], isLoading: respLoading } = useResponsiblesWithSalesFlag({
    onlyActive: true,
  });

  // ── Form ──
  const [responsibleId, setResponsibleId] = useState('');
  const [creatingResp, setCreatingResp] = useState(false);
  const [newRespName, setNewRespName] = useState('');
  const [newRespEmail, setNewRespEmail] = useState('');
  const [newRespPhone, setNewRespPhone] = useState('');
  const [savingResp, setSavingResp] = useState(false);

  const [issueDate, setIssueDate] = useState(todayISO());
  const [validUntil, setValidUntil] = useState(addDaysISO(15, todayISO()));
  const [applyIva, setApplyIva] = useState(true);
  const [ivaRatePct, setIvaRatePct] = useState('19');
  const [notes, setNotes] = useState('');
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { create } = useQuotationMutations();

  // Defaults del perfil del owner (validez + términos), best-effort
  useEffect(() => {
    if (!open || defaultsLoaded || !dataOwnerId) return;
    (async () => {
      try {
        const { data } = await (supabase
          .from('profiles')
          .select('quote_validity_days_default, quote_terms_default')
          .eq('user_id', dataOwnerId)
          .maybeSingle() as unknown as Promise<{
            data: {
              quote_validity_days_default: number | null;
              quote_terms_default: string | null;
            } | null;
          }>);
        const validity = Number(data?.quote_validity_days_default ?? 15);
        setValidUntil(addDaysISO(validity, todayISO()));
        if (data?.quote_terms_default) setNotes(data.quote_terms_default);
      } catch {
        /* defaults opcionales */
      } finally {
        setDefaultsLoaded(true);
      }
    })();
  }, [open, defaultsLoaded, dataOwnerId]);

  const reset = () => {
    setResponsibleId('');
    setCreatingResp(false);
    setNewRespName('');
    setNewRespEmail('');
    setNewRespPhone('');
    setIssueDate(todayISO());
    setValidUntil(addDaysISO(15, todayISO()));
    setApplyIva(true);
    setIvaRatePct('19');
    setNotes('');
    setLines([]);
    setSubmitError(null);
    setDefaultsLoaded(false);
  };

  const handleClose = () => {
    if (create.isPending || savingResp) return;
    onOpenChange(false);
    setTimeout(reset, 150);
  };

  const addLine = () => {
    const first = templates[0];
    if (!first) return;
    setLines((prev) => [
      ...prev,
      {
        _key: uid(),
        template_id: first.id,
        width_m: 1.2,
        height_m: 1.5,
        quantity: 1,
        description: '',
      },
    ]);
  };

  const updateLine = (key: string, patch: Partial<LineRow>) => {
    setLines((prev) => prev.map((l) => (l._key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l._key !== key));
  };

  // Despiece + precio por línea (en vivo)
  const computedLines = useMemo(
    () =>
      lines.map((line) => {
        const tpl = templatesById.get(line.template_id) ?? null;
        const despiece = tpl
          ? computeDespiece(tpl, line.width_m, line.height_m, productsById)
          : null;
        const subtotal = despiece ? round2(despiece.priceUnit * (line.quantity || 0)) : 0;
        return { line, tpl, despiece, subtotal };
      }),
    [lines, templatesById, productsById],
  );

  const subtotal = useMemo(
    () => round2(computedLines.reduce((acc, c) => acc + c.subtotal, 0)),
    [computedLines],
  );
  const ivaRate = Math.max(0, parseFloat(ivaRatePct) || 0) / 100;
  const ivaAmount = applyIva ? round2(subtotal * ivaRate) : 0;
  const totalConIva = round2(subtotal + ivaAmount);

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
          email: newRespEmail.trim() || null,
          phone: newRespPhone.trim() || null,
          responsible_type: 'banking',
        } as never)
        .select('id')
        .single();
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['responsibles-with-sales-flag'] });
      setResponsibleId((data as any).id);
      setCreatingResp(false);
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

  const handleSubmit = async () => {
    setSubmitError(null);
    if (!responsibleId) {
      setSubmitError('Seleccioná el cliente al que va dirigida la cotización.');
      return;
    }
    if (lines.length === 0) {
      setSubmitError('Agregá al menos una línea (plantilla + medidas).');
      return;
    }
    for (const c of computedLines) {
      if (!c.tpl || !c.despiece) {
        setSubmitError('Hay una línea sin plantilla válida.');
        return;
      }
      if (c.line.width_m <= 0 || c.line.height_m <= 0) {
        setSubmitError('Ancho y alto deben ser mayores a cero.');
        return;
      }
      if (c.line.quantity <= 0) {
        setSubmitError('La cantidad debe ser mayor a cero.');
        return;
      }
      if (c.despiece.missingCount > 0) {
        setSubmitError(
          `La plantilla "${c.tpl.name}" tiene piezas con producto eliminado del inventario. Corregila en Configuración → Plantillas.`,
        );
        return;
      }
    }
    if (validUntil < issueDate) {
      setSubmitError('La fecha de vencimiento no puede ser anterior a la emisión.');
      return;
    }

    const items: QuotationItemDraft[] = computedLines.map((c) => {
      const tpl = c.tpl!;
      const despiece = c.despiece!;
      const area = c.line.width_m * c.line.height_m;
      return {
        description: c.line.description.trim() || tpl.name,
        system: tpl.system || tpl.name,
        color: tpl.color || TIPO_LABELS[tpl.tipo],
        width_m: c.line.width_m,
        height_m: c.line.height_m,
        quantity: c.line.quantity,
        // El margen ya está embebido en el precio de la plantilla; se mapea a
        // precio/m² para encajar en el modelo de quotation_items.
        price_per_m2: area > 0 ? round2(despiece.priceUnit / area) : 0,
        template_id: tpl.id,
        template_snapshot: buildTemplateSnapshot(tpl, despiece),
      };
    });

    try {
      const result = await create.mutateAsync({
        responsible_id: responsibleId,
        issue_date: issueDate,
        valid_until: validUntil,
        // Margen por plantilla ya incluido en el precio — no volver a recargar
        labor_pct: 0,
        profit_pct: 0,
        apply_iva: applyIva,
        iva_rate: ivaRate,
        apply_retefuente: false,
        retefuente_rate: 0,
        apply_reteica: false,
        reteica_rate: 0,
        notes: notes.trim() || null,
        items,
      });
      toast({
        title: `Cotización ${result.quote_number} creada`,
        description: 'Quedó como borrador. Podés enviarla por email/WhatsApp desde el detalle.',
      });
      onCreated?.(result.id, result.quote_number);
      handleClose();
    } catch (e: any) {
      const msg = e?.message ?? 'Error desconocido';
      setSubmitError(msg);
      toast({ title: 'No se pudo guardar', description: msg, variant: 'destructive' });
    }
  };

  const noTemplates = !tplLoading && templates.length === 0;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : handleClose())}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ruler className="h-5 w-5 text-muted-foreground" />
            Cotización desde plantillas
          </DialogTitle>
          <DialogDescription>
            Elegí plantilla + medidas y la app arma despiece, costo y precio al instante.
          </DialogDescription>
        </DialogHeader>

        {noTemplates && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-100">
            <strong>No tenés plantillas con piezas todavía.</strong> Configuralas primero en{' '}
            <em>Configuración → Plantillas de producto</em>.
          </div>
        )}

        {/* ── Cliente + fechas ── */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pb-3 border-b">
          <div className="md:col-span-6 space-y-1.5">
            <Label>Cliente *</Label>
            {creatingResp ? (
              <div className="space-y-2 rounded-md border border-border p-3 bg-muted/30">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Input
                    autoFocus
                    placeholder="Nombre *"
                    value={newRespName}
                    onChange={(e) => setNewRespName(e.target.value)}
                  />
                  <Input
                    type="email"
                    placeholder="Email"
                    value={newRespEmail}
                    onChange={(e) => setNewRespEmail(e.target.value)}
                  />
                  <Input
                    type="tel"
                    placeholder="WhatsApp"
                    value={newRespPhone}
                    onChange={(e) => setNewRespPhone(e.target.value)}
                  />
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
                    placeholder={respLoading ? 'Cargando…' : 'Seleccionar cliente'}
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
          </div>
          <div className="md:col-span-3 space-y-1.5">
            <Label>Emisión *</Label>
            <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
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

        {/* ── Líneas ── */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <Label className="text-base">Productos</Label>
            <Button type="button" size="sm" variant="outline" onClick={addLine} disabled={noTemplates}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Agregar producto
            </Button>
          </div>

          {lines.length === 0 ? (
            <div className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
              Sin productos aún — usá <strong>Agregar producto</strong> para sumar la primera
              ventana o puerta.
            </div>
          ) : (
            <div className="space-y-3">
              {computedLines.map((c, idx) => {
                const { line, tpl, despiece } = c;
                return (
                  <div
                    key={line._key}
                    className="rounded-md border border-border p-3 bg-muted/20 space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-muted-foreground">Producto #{idx + 1}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeLine(line._key)}
                        className="h-6 px-2 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-[130px_1fr] gap-3">
                      {/* Dibujo en vivo */}
                      <div className="hidden sm:flex items-center justify-center rounded-md border border-border bg-background p-1.5">
                        {tpl ? (
                          <ProductDrawing
                            tipo={tpl.tipo}
                            naves={tpl.naves}
                            apertura={tpl.apertura}
                            widthM={line.width_m}
                            heightM={line.height_m}
                            showDims
                            className="h-28 w-full"
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-12 gap-2 content-start">
                        <div className="col-span-2 sm:col-span-5 space-y-1">
                          <Label className="text-[10px]">Plantilla *</Label>
                          <Select
                            value={line.template_id}
                            onValueChange={(v) => updateLine(line._key, { template_id: v })}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Plantilla" />
                            </SelectTrigger>
                            <SelectContent>
                              {templates.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.name}
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
                            value={line.width_m}
                            onChange={(e) =>
                              updateLine(line._key, { width_m: Number(e.target.value) })
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
                            value={line.height_m}
                            onChange={(e) =>
                              updateLine(line._key, { height_m: Number(e.target.value) })
                            }
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="sm:col-span-3 space-y-1">
                          <Label className="text-[10px]">Cantidad *</Label>
                          <Input
                            type="number"
                            step="1"
                            min={1}
                            value={line.quantity}
                            onChange={(e) =>
                              updateLine(line._key, {
                                quantity: Math.max(1, parseInt(e.target.value, 10) || 1),
                              })
                            }
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="col-span-2 sm:col-span-7 space-y-1">
                          <Label className="text-[10px]">Descripción (opcional)</Label>
                          <Input
                            placeholder="Ej: Ventana de la sala"
                            value={line.description}
                            onChange={(e) =>
                              updateLine(line._key, { description: e.target.value })
                            }
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="col-span-2 sm:col-span-5 space-y-1">
                          <Label className="text-[10px]">Subtotal ({line.quantity} und)</Label>
                          <div className="h-8 flex items-center px-2 rounded-md bg-background border border-border tabular-nums text-xs font-medium">
                            {formatCurrency(c.subtotal)}
                          </div>
                        </div>

                        {despiece && (
                          <details className="col-span-2 sm:col-span-12 text-xs">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                              Despiece: {despiece.lines.length} piezas · Costo{' '}
                              <span className="tabular-nums">
                                {formatCurrency(despiece.costTotal)}
                              </span>{' '}
                              · Precio unit{' '}
                              <span className="tabular-nums font-medium text-foreground">
                                {formatCurrency(despiece.priceUnit)}
                              </span>
                              {despiece.missingCount > 0 && (
                                <span className="text-destructive ml-1.5">
                                  ⚠ {despiece.missingCount} pieza(s) sin producto
                                </span>
                              )}
                            </summary>
                            <div className="mt-2 rounded-md border border-border bg-background p-2 space-y-1">
                              {despiece.lines.map((dl) => (
                                <div
                                  key={dl.piece.key}
                                  className="flex justify-between gap-2 tabular-nums"
                                >
                                  <span>
                                    {dl.piece.label}
                                    {dl.product?.reference ? (
                                      <span className="text-muted-foreground font-mono text-[10px] ml-1.5">
                                        {dl.product.reference}
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {dl.qty} {dl.unidad} × {formatCurrency(dl.unitCost)} ={' '}
                                    <span className="text-foreground">
                                      {formatCurrency(dl.lineCost)}
                                    </span>
                                  </span>
                                </div>
                              ))}
                              <div className="flex justify-between gap-2 border-t border-border pt-1 text-muted-foreground">
                                <span>+ Desperdicio</span>
                                <span className="tabular-nums">
                                  {formatCurrency(despiece.wasteAmount)}
                                </span>
                              </div>
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── IVA + notas + total ── */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-3 border-t">
          <div className="md:col-span-7 space-y-1.5">
            <Label>Términos y condiciones</Label>
            <Textarea
              placeholder="Anticipo, tiempo de fabricación, garantía…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
          <div className="md:col-span-5 space-y-2">
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5 text-sm">
              <div className="flex justify-between text-muted-foreground text-xs">
                <span>Subtotal (margen incluido)</span>
                <span className="tabular-nums">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Switch checked={applyIva} onCheckedChange={setApplyIva} />
                  IVA
                  <Input
                    type="number"
                    step="0.1"
                    min={0}
                    value={ivaRatePct}
                    onChange={(e) => setIvaRatePct(e.target.value)}
                    disabled={!applyIva}
                    className="h-6 w-14 text-xs"
                  />
                  %
                </span>
                <span className="tabular-nums">{formatCurrency(ivaAmount)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                <span>Total{applyIva ? ' con IVA' : ''}</span>
                <span className="tabular-nums text-primary">{formatCurrency(totalConIva)}</span>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              El precio de cada línea ya incluye el margen de su plantilla. Retenciones y ajustes
              finos: editá la cotización después de crearla.
            </p>
          </div>
        </div>

        {submitError && (
          <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
            {submitError}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={create.isPending || noTemplates}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Crear cotización
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
