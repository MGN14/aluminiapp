import { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Plus,
  Trash2,
  Package,
  AlertCircle,
  Settings,
  Save,
  Pencil,
  Check,
  X as XIcon,
  ChevronDown,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useToast } from '@/hooks/use-toast';
import { useAluminumCatalog } from '@/hooks/useAluminumCatalog';
import {
  useCatalogComponents,
  useInventoryBySystem,
  useCatalogComponentMutations,
} from '@/hooks/useCatalogComponents';
import type { AluminumCatalogEntry } from '@/types/quotation';
import BulkUploadCatalogModal from '@/components/quotes/BulkUploadCatalogModal';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
  }).format(value);
}

// ════════════════════════════════════════════════════════════════════════════
// Panel de configuración INLINE de un producto terminado.
// Se expande dentro de la fila de la lista. Sin modales anidados.
// ════════════════════════════════════════════════════════════════════════════
function ConfigPanel({ entry }: { entry: AluminumCatalogEntry }) {
  const { toast } = useToast();
  const [filterAll, setFilterAll] = useState(false);

  const { data: components = [], isLoading: compLoading } = useCatalogComponents(entry.id);
  const { data: inventory = [], isLoading: invLoading } = useInventoryBySystem(
    filterAll ? undefined : entry.system,
  );
  const { add, update, remove } = useCatalogComponentMutations();
  const { updateOne } = useAluminumCatalog();

  const [llevaVidrio, setLlevaVidrio] = useState(entry.lleva_vidrio ?? true);
  const [tipoVidrio, setTipoVidrio] = useState(entry.tipo_vidrio ?? '');
  const [tiempoEntregaDias, setTiempoEntregaDias] = useState(
    String(entry.tiempo_entrega_dias ?? 0),
  );
  const [condiciones, setCondiciones] = useState(entry.condiciones ?? '');
  const [manoObraPct, setManoObraPct] = useState(
    entry.mano_obra_pct != null ? String(entry.mano_obra_pct) : '',
  );
  const [pricePerM2, setPricePerM2] = useState(String(entry.price_per_m2 ?? 0));
  const [productDirty, setProductDirty] = useState(false);

  // Sync state si entry cambia (ej: backfill del costo desde el server tras
  // agregar un componente, que recalcula costo_calculado_m2 vía trigger).
  useEffect(() => {
    setLlevaVidrio(entry.lleva_vidrio ?? true);
    setTipoVidrio(entry.tipo_vidrio ?? '');
    setTiempoEntregaDias(String(entry.tiempo_entrega_dias ?? 0));
    setCondiciones(entry.condiciones ?? '');
    setManoObraPct(entry.mano_obra_pct != null ? String(entry.mano_obra_pct) : '');
    setPricePerM2(String(entry.price_per_m2 ?? 0));
    setProductDirty(false);
  }, [entry.id]);

  const [pickedProductId, setPickedProductId] = useState<string>('');
  const [qtyPerM2, setQtyPerM2] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const usedIds = useMemo(() => new Set(components.map((c) => c.product_id)), [components]);
  const pickable = useMemo(
    () => inventory.filter((p) => !usedIds.has(p.id)),
    [inventory, usedIds],
  );

  const totalCostPerM2 = useMemo(
    () =>
      components.reduce(
        (acc, c) => acc + Number(c.quantity_per_m2) * Number(c.product?.cost_per_unit ?? 0),
        0,
      ),
    [components],
  );

  const manoObraNum = Number(manoObraPct) || 0;
  const priceNum = Number(pricePerM2) || 0;
  const costoConMO = totalCostPerM2 * (1 + manoObraNum / 100);
  const margen = priceNum > 0 && costoConMO > 0 ? ((priceNum - costoConMO) / priceNum) * 100 : 0;

  const handleSaveProduct = async () => {
    const price = Number(pricePerM2);
    if (!Number.isFinite(price) || price < 0) {
      toast({ title: 'Precio por m² inválido', variant: 'destructive' });
      return;
    }
    const tiempo = Number(tiempoEntregaDias);
    const mo = manoObraPct.trim() === '' ? null : Number(manoObraPct);
    if (mo !== null && (!Number.isFinite(mo) || mo < 0)) {
      toast({ title: 'Mano de obra % inválida', variant: 'destructive' });
      return;
    }
    try {
      await updateOne.mutateAsync({
        id: entry.id,
        patch: {
          price_per_m2: price,
          lleva_vidrio: llevaVidrio,
          tipo_vidrio: llevaVidrio ? tipoVidrio : null,
          tiempo_entrega_dias: Number.isFinite(tiempo) && tiempo >= 0 ? tiempo : 0,
          condiciones,
          mano_obra_pct: mo,
        },
      });
      setProductDirty(false);
      toast({ title: 'Producto actualizado' });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message, variant: 'destructive' });
    }
  };

  const handleAdd = async () => {
    if (!pickedProductId) {
      toast({ title: 'Elegí un producto del inventario', variant: 'destructive' });
      return;
    }
    const qty = Number(qtyPerM2);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast({ title: 'Cantidad por m² inválida', variant: 'destructive' });
      return;
    }
    try {
      await add.mutateAsync({
        catalog_id: entry.id,
        product_id: pickedProductId,
        quantity_per_m2: qty,
        notes: notes.trim() || null,
      });
      setPickedProductId('');
      setQtyPerM2('');
      setNotes('');
      toast({ title: 'Componente agregado' });
    } catch (e: any) {
      toast({
        title: 'No se pudo agregar',
        description: e?.message || 'Error desconocido',
        variant: 'destructive',
      });
    }
  };

  const handleUpdateQty = async (id: string, raw: string) => {
    const qty = Number(raw);
    if (!Number.isFinite(qty) || qty < 0) return;
    try {
      await update.mutateAsync({ id, patch: { quantity_per_m2: qty } });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message, variant: 'destructive' });
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await remove.mutateAsync(id);
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4 pt-2">
      {/* ════════ Datos del producto ════════ */}
      <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Datos del producto</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Lleva vidrio</Label>
              <Switch
                checked={llevaVidrio}
                onCheckedChange={(v) => {
                  setLlevaVidrio(v);
                  setProductDirty(true);
                }}
              />
            </div>
            {llevaVidrio && (
              <Input
                placeholder="Templado 6mm"
                value={tipoVidrio}
                onChange={(e) => {
                  setTipoVidrio(e.target.value);
                  setProductDirty(true);
                }}
                className="h-8 text-xs"
              />
            )}
          </div>

          <div className="sm:col-span-2 space-y-1.5">
            <Label className="text-xs">Entrega (días)</Label>
            <Input
              type="number"
              min={0}
              step={1}
              placeholder="15"
              value={tiempoEntregaDias}
              onChange={(e) => {
                setTiempoEntregaDias(e.target.value);
                setProductDirty(true);
              }}
              className="h-8 text-xs"
            />
          </div>

          <div className="sm:col-span-2 space-y-1.5">
            <Label className="text-xs">Mano de obra %</Label>
            <Input
              type="number"
              min={0}
              step={0.1}
              placeholder="(default)"
              value={manoObraPct}
              onChange={(e) => {
                setManoObraPct(e.target.value);
                setProductDirty(true);
              }}
              className="h-8 text-xs"
            />
            <p className="text-[9px] text-muted-foreground">Vacío = usa el global del perfil.</p>
          </div>

          <div className="sm:col-span-3 space-y-1.5">
            <Label className="text-xs">Precio venta /m² (COP)</Label>
            <Input
              type="number"
              min={0}
              step={1000}
              placeholder="180000"
              value={pricePerM2}
              onChange={(e) => {
                setPricePerM2(e.target.value);
                setProductDirty(true);
              }}
              className="h-8 text-xs"
            />
            <p className="text-[9px] text-muted-foreground">Lo que cobrás al cliente.</p>
          </div>

          <div className="sm:col-span-2 space-y-1.5">
            <Label className="text-xs">Costo real /m²</Label>
            <div className="h-8 flex items-center px-2 rounded-md bg-background border border-border tabular-nums text-xs font-medium">
              {formatCurrency(totalCostPerM2)}
            </div>
            <p className="text-[9px] text-muted-foreground">Auto desde componentes</p>
          </div>

          <div className="sm:col-span-12 space-y-1.5">
            <Label className="text-xs">Condiciones / términos</Label>
            <Textarea
              placeholder="Ej: Anticipo 50%, instalación incluida, garantía 1 año por defectos de fabricación."
              value={condiciones}
              onChange={(e) => {
                setCondiciones(e.target.value);
                setProductDirty(true);
              }}
              rows={2}
              className="text-xs"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
          <div className="text-xs text-muted-foreground">
            {totalCostPerM2 > 0 && priceNum > 0 ? (
              <>
                Costo + mano de obra:{' '}
                <span className="tabular-nums font-medium text-foreground">
                  {formatCurrency(costoConMO)}/m²
                </span>
                {' · '}
                Margen vs. precio venta:{' '}
                <span
                  className={`tabular-nums font-medium ${
                    margen >= 30
                      ? 'text-success'
                      : margen >= 15
                        ? 'text-warning'
                        : 'text-destructive'
                  }`}
                >
                  {margen.toFixed(1)}%
                </span>
              </>
            ) : (
              'Cargá componentes para ver el costo real.'
            )}
          </div>
          <Button
            size="sm"
            onClick={handleSaveProduct}
            disabled={!productDirty || updateOne.isPending}
          >
            {updateOne.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-1.5" />
            )}
            Guardar datos
          </Button>
        </div>
      </div>

      {/* ════════ Componentes (BOM) ════════ */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Componentes por m²</span>
          <span className="text-[11px] text-muted-foreground ml-auto">
            Ej: 1m cabezal · 1m sillar · 1m jamba · 2m enganche · 2m traslape · 4 rodachinas · 1m²
            vidrio · silicona
          </span>
        </div>

        {compLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : components.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            Sin componentes aún. Agregá productos del inventario abajo.
          </div>
        ) : (
          <div className="space-y-2">
            {components.map((c) => {
              const unitCost = Number(c.product?.cost_per_unit ?? 0);
              const lineCost = Number(c.quantity_per_m2) * unitCost;
              return (
                <div
                  key={c.id}
                  className="rounded-md border border-border p-2.5 grid grid-cols-1 sm:grid-cols-[1fr_120px_120px_40px] gap-2 items-center"
                >
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      <Package className="h-3 w-3 text-muted-foreground" />
                      {c.product?.name ?? '—'}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Ref: {c.product?.reference ?? '—'} · Costo unit:{' '}
                      {formatCurrency(unitCost)}
                      {c.product?.unit ? ` / ${c.product.unit}` : ''}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-[10px]">Cant / m²</Label>
                    <Input
                      type="number"
                      step="0.0001"
                      min={0}
                      defaultValue={String(c.quantity_per_m2)}
                      onBlur={(e) => {
                        if (Number(e.target.value) !== Number(c.quantity_per_m2)) {
                          handleUpdateQty(c.id, e.target.value);
                        }
                      }}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-0.5">
                    <Label className="text-[10px]">Costo línea</Label>
                    <div className="h-8 flex items-center px-2 rounded-md bg-muted/40 border border-border tabular-nums text-xs">
                      {formatCurrency(lineCost)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(c.id)}
                    className="text-muted-foreground hover:text-destructive justify-center"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}

            <div className="rounded-md border border-border bg-muted/30 p-2.5 flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                Costo real por m² (Σ componentes × costo unitario)
              </div>
              <div className="text-sm font-medium tabular-nums">
                {formatCurrency(totalCostPerM2)}
              </div>
            </div>
            {totalCostPerM2 > priceNum && priceNum > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-2.5 flex gap-2 text-xs">
                <AlertCircle className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <span className="text-amber-900 dark:text-amber-100">
                  El costo real ({formatCurrency(totalCostPerM2)}) supera el precio de venta (
                  {formatCurrency(priceNum)}). Estás vendiendo a pérdida — ajustá el precio o
                  revisá los componentes.
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ════════ Add component form ════════ */}
      <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium">Agregar componente desde inventario</div>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={filterAll}
              onChange={(e) => setFilterAll(e.target.checked)}
            />
            Mostrar todos los productos (no solo del sistema "{entry.system}")
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
          <div className="sm:col-span-6 space-y-1">
            <Label className="text-[10px]">Producto del inventario</Label>
            <Select value={pickedProductId} onValueChange={setPickedProductId}>
              <SelectTrigger className="h-9">
                <SelectValue
                  placeholder={
                    invLoading
                      ? 'Cargando…'
                      : pickable.length === 0
                        ? `No hay productos del sistema "${entry.system}"${filterAll ? '' : ' (probá con todos)'}`
                        : 'Elegir producto'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {pickable.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {p.reference}
                      </span>
                      <span>{p.name}</span>
                      {p.system && (
                        <span className="text-[9px] text-muted-foreground">[{p.system}]</span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-3 space-y-1">
            <Label className="text-[10px]">Cantidad por m²</Label>
            <Input
              type="number"
              step="0.0001"
              min={0}
              value={qtyPerM2}
              onChange={(e) => setQtyPerM2(e.target.value)}
              placeholder="2.5"
              className="h-9"
            />
          </div>
          <div className="sm:col-span-3 space-y-1">
            <Label className="text-[10px]">Notas (opcional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: cortado a 6m"
              className="h-9"
            />
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={handleAdd}
          disabled={add.isPending || !pickedProductId || !qtyPerM2}
        >
          {add.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
          ) : (
            <Plus className="h-4 w-4 mr-1.5" />
          )}
          Agregar componente
        </Button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Página completa: Productos terminados
// ════════════════════════════════════════════════════════════════════════════
export default function ConfiguracionView() {
  const { toast } = useToast();
  const { data, isLoading, createOne, updateOne, deleteOne, refetch } = useAluminumCatalog();
  const [showBulk, setShowBulk] = useState(false);
  const [openIds, setOpenIds] = useState<string[]>([]);

  const [system, setSystem] = useState('');
  const [color, setColor] = useState('');
  const [description, setDescription] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSystem, setEditSystem] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const handleAdd = async () => {
    if (!system.trim() || !color.trim()) {
      toast({ title: 'Falta sistema o color', variant: 'destructive' });
      return;
    }
    try {
      const created = await createOne.mutateAsync({
        system: system.trim(),
        color: color.trim(),
        price_per_m2: 0,
        description: description.trim() || null,
      });
      setSystem('');
      setColor('');
      setDescription('');
      toast({ title: 'Producto creado — configurálo abajo' });
      // Expandir el nuevo producto en el accordion
      setOpenIds((prev) => [...prev, created.id]);
    } catch (e: any) {
      const msg = e?.message?.includes('duplicate')
        ? 'Ya existe un producto con ese sistema y color.'
        : e?.message || 'No se pudo agregar.';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    }
  };

  const startEdit = (entry: AluminumCatalogEntry, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingId(entry.id);
    setEditSystem(entry.system);
    setEditColor(entry.color);
    setEditDescription(entry.description ?? '');
  };
  const cancelEdit = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingId(null);
  };
  const saveEdit = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!editingId || !editSystem.trim() || !editColor.trim()) {
      toast({ title: 'Falta sistema o color', variant: 'destructive' });
      return;
    }
    try {
      await updateOne.mutateAsync({
        id: editingId,
        patch: {
          system: editSystem.trim(),
          color: editColor.trim(),
          description: editDescription.trim() || null,
        },
      });
      setEditingId(null);
      toast({ title: 'Producto actualizado' });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message, variant: 'destructive' });
    }
  };

  const handleToggleActive = async (entry: AluminumCatalogEntry, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await updateOne.mutateAsync({ id: entry.id, patch: { active: !entry.active } });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (entry: AluminumCatalogEntry, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!confirm(`¿Eliminar "${entry.system} ${entry.color}"? Esto borra también sus componentes.`)) return;
    try {
      await deleteOne.mutateAsync(entry.id);
      toast({ title: 'Producto eliminado' });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-muted-foreground">
          Configurá cada sistema/color con sus componentes (cabezal, sillar, jamba, vidrio,
          accesorios) por m². La app calcula el costo real desde tu inventario y se actualiza
          automáticamente cuando cambia el costo unitario.
        </p>
        <Button variant="outline" size="sm" onClick={() => setShowBulk(true)}>
          <Upload className="h-4 w-4 mr-1.5" />
          Carga masiva
        </Button>
      </div>

        {/* Form crear */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="text-sm font-medium">Nuevo producto terminado</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Sistema *</Label>
              <Input
                placeholder="744"
                value={system}
                onChange={(e) => setSystem(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Color *</Label>
              <Input
                placeholder="Mate"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Descripción (opcional)</Label>
              <Input
                placeholder="Línea económica"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Después de crear, abrí el panel del producto abajo y configurá: vidrio, mano de obra,
            tiempo de entrega, condiciones, precio venta, y los componentes que lleva 1 m² desde
            tu inventario.
          </p>
          <Button onClick={handleAdd} disabled={createOne.isPending} size="sm">
            {createOne.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : (
              <Plus className="h-4 w-4 mr-1.5" />
            )}
            Crear producto
          </Button>
        </div>

        {/* Lista */}
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : data.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <Package className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-sm font-medium">Sin productos terminados aún</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Creá uno arriba (Sistema + Color) y luego configurá sus componentes.
            </p>
          </div>
        ) : (
          <Accordion
            type="multiple"
            value={openIds}
            onValueChange={setOpenIds}
            className="space-y-2"
          >
            {data.map((entry) => {
              const editing = entry.id === editingId;
              const costo = entry.costo_calculado_m2 ?? 0;
              const precio = entry.price_per_m2 ?? 0;
              const sinConfigurar = costo === 0 && precio === 0;
              return (
                <AccordionItem
                  key={entry.id}
                  value={entry.id}
                  className={`rounded-lg border overflow-hidden ${
                    sinConfigurar
                      ? 'border-amber-300 bg-amber-50/40 dark:bg-amber-950/20'
                      : 'border-border bg-card'
                  }`}
                >
                  <AccordionTrigger className="px-4 py-3 hover:no-underline [&[data-state=open]>div>svg.chevron]:rotate-180">
                    {editing ? (
                      <div
                        className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_1fr_2fr_auto] gap-2 items-center mr-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Input
                          value={editSystem}
                          onChange={(e) => setEditSystem(e.target.value)}
                          className="h-8"
                          placeholder="Sistema"
                        />
                        <Input
                          value={editColor}
                          onChange={(e) => setEditColor(e.target.value)}
                          className="h-8"
                          placeholder="Color"
                        />
                        <Input
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          className="h-8"
                          placeholder="Descripción"
                        />
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={saveEdit}
                            disabled={updateOne.isPending}
                          >
                            <Check className="h-4 w-4 text-green-600" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={cancelEdit}>
                            <XIcon className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center gap-3 flex-wrap mr-2">
                        <div
                          className={`flex-1 min-w-[150px] text-left ${
                            !entry.active ? 'text-muted-foreground line-through' : ''
                          }`}
                        >
                          <div className="text-sm font-medium">
                            {entry.system} · {entry.color}
                          </div>
                          {entry.description && (
                            <div className="text-[11px] text-muted-foreground truncate">
                              {entry.description}
                            </div>
                          )}
                        </div>
                        <div className="text-xs tabular-nums text-right min-w-[150px]">
                          {sinConfigurar ? (
                            <span className="text-amber-700 dark:text-amber-400 font-medium">
                              Sin configurar
                            </span>
                          ) : (
                            <>
                              <div className="text-muted-foreground">
                                Costo: {formatCurrency(costo)}/m²
                              </div>
                              <div className="font-medium">
                                Venta: {formatCurrency(precio)}/m²
                              </div>
                            </>
                          )}
                        </div>
                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Switch
                            checked={entry.active}
                            onCheckedChange={() => handleToggleActive(entry)}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => startEdit(entry, e)}
                            title="Renombrar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => handleDelete(entry, e)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <ChevronDown className="chevron h-4 w-4 text-muted-foreground transition-transform" />
                      </div>
                    )}
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4 border-t border-border">
                    <ConfigPanel entry={entry} />
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}

      <BulkUploadCatalogModal
        open={showBulk}
        onOpenChange={setShowBulk}
        onComplete={() => {
          refetch();
          setShowBulk(false);
        }}
      />
    </div>
  );
}
