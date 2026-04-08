import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { ProductWithMetrics } from '@/hooks/useInventoryData';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductWithMetrics | null;
  mode: 'adjust' | 'entrada' | 'salida';
  onSubmitMovement: (data: { product_id: string; movement_type: string; quantity: number; unit_cost: number; notes?: string }) => Promise<boolean | undefined>;
}

export default function AdjustStockModal({ open, onOpenChange, product, mode, onSubmitMovement }: Props) {
  const [quantity, setQuantity] = useState(0);
  const [unitCost, setUnitCost] = useState(0);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  if (!product) return null;

  const title = mode === 'adjust' ? `Ajustar: ${product.reference}` : mode === 'entrada' ? `Entrada: ${product.reference}` : `Salida: ${product.reference}`;
  const movementType = mode === 'adjust' ? 'ajuste' : mode;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const ok = await onSubmitMovement({
      product_id: product.id,
      movement_type: movementType,
      quantity,
      unit_cost: unitCost || product.cost_per_unit,
      notes: notes || undefined,
    });
    setSaving(false);
    if (ok) {
      setQuantity(0);
      setUnitCost(0);
      setNotes('');
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground mb-2">
          Stock actual: <span className="font-mono font-medium text-foreground">{product.stock_system} {product.unit}</span>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">{mode === 'adjust' ? 'Nuevo stock' : 'Cantidad'}</Label>
            <Input type="number" min={0} required value={quantity} onChange={e => setQuantity(+e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Costo unitario</Label>
            <Input type="number" min={0} value={unitCost} onChange={e => setUnitCost(+e.target.value)} placeholder={`${product.cost_per_unit}`} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notas (opcional)</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Razón del movimiento..." />
          </div>
          <Button type="submit" disabled={saving} className="w-full">
            {saving ? 'Guardando...' : 'Confirmar'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
