import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Plus, Trash2, Package, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  useCatalogComponents,
  useInventoryBySystem,
  useCatalogComponentMutations,
} from '@/hooks/useCatalogComponents';
import type { AluminumCatalogEntry } from '@/types/quotation';

interface Props {
  entry: AluminumCatalogEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
  }).format(value);
}

export default function CatalogComponentsDialog({ entry, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const [filterAll, setFilterAll] = useState(false);

  const { data: components = [], isLoading: compLoading } = useCatalogComponents(entry?.id ?? null);
  const { data: inventory = [], isLoading: invLoading } = useInventoryBySystem(
    filterAll ? undefined : entry?.system,
  );
  const { add, update, remove } = useCatalogComponentMutations();

  // Add form
  const [pickedProductId, setPickedProductId] = useState<string>('');
  const [qtyPerM2, setQtyPerM2] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // IDs ya usados (para no ofrecerlos en el select)
  const usedIds = useMemo(
    () => new Set(components.map((c) => c.product_id)),
    [components],
  );
  const pickable = useMemo(
    () => inventory.filter((p) => !usedIds.has(p.id)),
    [inventory, usedIds],
  );

  // Costo total estimado por m² (sumando componentes × costo unitario)
  const totalCostPerM2 = useMemo(
    () =>
      components.reduce(
        (acc, c) => acc + Number(c.quantity_per_m2) * Number(c.product?.cost_per_unit ?? 0),
        0,
      ),
    [components],
  );

  const handleAdd = async () => {
    if (!entry) return;
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

  if (!entry) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Componentes por m² — {entry.system} · {entry.color}
          </DialogTitle>
          <DialogDescription>
            Definí qué lleva un m² de este producto terminado. Ej: 1m de cabezal, 1m de sillar, 1m de jamba, 2m de enganche, 2m de traslape, 4 rodachinas, vidrio templado/crudo/reflectivo, silicona. La app suma costos × cantidad/m² y te da el costo real por m². Hoy el precio del catálogo sigue siendo manual ({formatCurrency(Number(entry.price_per_m2))}); pronto pasa a calcularse automático con + mano de obra + utilidad.
          </DialogDescription>
        </DialogHeader>

        {/* Lista actual de componentes */}
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

            {/* Resumen costo */}
            <div className="rounded-md border border-border bg-muted/30 p-2.5 flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                Costo estimado por m² (suma componentes × costo unitario)
              </div>
              <div className="text-sm font-medium tabular-nums">
                {formatCurrency(totalCostPerM2)}
              </div>
            </div>
            {totalCostPerM2 > Number(entry.price_per_m2) && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-2.5 flex gap-2 text-xs">
                <AlertCircle className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <span className="text-amber-900 dark:text-amber-100">
                  El costo estimado supera el precio de venta del catálogo (
                  {formatCurrency(Number(entry.price_per_m2))}). Considerá ajustar el precio o
                  los componentes.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Add form */}
        <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium">Agregar componente</div>
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
            className="w-full sm:w-auto"
          >
            {add.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : (
              <Plus className="h-4 w-4 mr-1.5" />
            )}
            Agregar componente
          </Button>
          {!filterAll && pickable.length === 0 && inventory.length === 0 && (
            <p className="text-[10px] text-muted-foreground">
              No hay productos en tu inventario con sistema "{entry.system}". Cargá productos al
              inventario y asignales este sistema, o activá "Mostrar todos".
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
