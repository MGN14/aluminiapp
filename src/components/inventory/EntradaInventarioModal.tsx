import { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ProductWithMetrics } from '@/hooks/useInventoryData';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: ProductWithMetrics[];
  onSubmit: (data: {
    product_id: string;
    quantity: number;
    unit_cost: number;
    movement_date?: string;
    notes?: string;
  }) => Promise<boolean | undefined>;
}

const todayIso = () => new Date().toISOString().split('T')[0];

// Entrada manual de inventario para el teórico gerencial. Suma al "lo que
// debería haber en bodega" sin tocar Siigo ni el conteo físico.
export default function EntradaInventarioModal({ open, onOpenChange, products, onSubmit }: Props) {
  const [refInput, setRefInput] = useState('');
  const [quantity, setQuantity] = useState(0);
  const [unitCost, setUnitCost] = useState(0);
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Resuelve la referencia escrita a un producto del catálogo (case-insensitive).
  const product = useMemo(() => {
    const q = refInput.trim().toLowerCase();
    if (!q) return null;
    return products.find(p => (p.reference ?? '').trim().toLowerCase() === q) ?? null;
  }, [refInput, products]);

  useEffect(() => {
    if (open) {
      setRefInput('');
      setQuantity(0);
      setUnitCost(0);
      setDate(todayIso());
      setNotes('');
    }
  }, [open]);

  // Prellena el costo unitario con el del producto cuando se resuelve.
  useEffect(() => {
    if (product && unitCost === 0) setUnitCost(product.cost_per_unit ?? 0);
  }, [product]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product || quantity <= 0) return;
    setSaving(true);
    const ok = await onSubmit({
      product_id: product.id,
      quantity,
      unit_cost: unitCost || product.cost_per_unit || 0,
      movement_date: date,
      notes: notes.trim() || undefined,
    });
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Registrar entrada de inventario</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground -mt-1">
          Suma unidades al inventario teórico (lo que debería haber en bodega).
          No modifica Siigo ni el conteo físico.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-sm">Referencia *</Label>
            <Input
              required
              value={refInput}
              onChange={e => setRefInput(e.target.value)}
              placeholder="Buscá la referencia..."
              list="entrada-inventario-refs"
              autoFocus
            />
            <datalist id="entrada-inventario-refs">
              {products.map(p => (
                <option key={p.id} value={p.reference}>{p.name}</option>
              ))}
            </datalist>
            {refInput.trim() && (
              product
                ? <p className="text-xs text-green-600 font-medium">{product.name}</p>
                : <p className="text-xs text-red-500">No existe esa referencia en el catálogo.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm">Cantidad *</Label>
              <Input
                type="number"
                min={0}
                required
                value={quantity || ''}
                onChange={e => setQuantity(+e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Costo unitario</Label>
              <Input
                type="number"
                min={0}
                value={unitCost || ''}
                onChange={e => setUnitCost(+e.target.value)}
                placeholder={product ? `$${(product.cost_per_unit ?? 0).toLocaleString('es-CO')}` : '$0'}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Fecha</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Nota <span className="text-muted-foreground text-xs">(opcional)</span></Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Ej: compra a proveedor, traslado de bodega..."
              rows={2}
              className="text-sm"
            />
          </div>

          <Button type="submit" disabled={saving || !product || quantity <= 0} className="w-full">
            {saving ? 'Guardando...' : 'Registrar entrada'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
