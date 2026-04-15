import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { ProductWithMetrics } from '@/hooks/useInventoryData';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductWithMetrics | null;
  mode: 'adjust' | 'entrada' | 'salida';
  onSubmitMovement: (data: { product_id: string; movement_type: string; quantity: number; unit_cost: number; notes?: string }) => Promise<boolean | undefined>;
}

// Motivos de ajuste organizados por tipo
const MOTIVOS_AJUSTE = [
  { value: 'robo', label: '🔓 Robo o hurto', tipo: 'negativo' },
  { value: 'dano', label: '💥 Daño o deterioro', tipo: 'negativo' },
  { value: 'muestra', label: '🎁 Muestra o regalo', tipo: 'negativo' },
  { value: 'consumo_interno', label: '🏭 Consumo interno', tipo: 'negativo' },
  { value: 'devolucion_proveedor', label: '↩️ Devolución a proveedor', tipo: 'negativo' },
  { value: 'vencimiento', label: '⏰ Vencimiento / caducidad', tipo: 'negativo' },
  { value: 'perdida_transporte', label: '🚛 Pérdida en transporte', tipo: 'negativo' },
  { value: 'correccion_conteo', label: '📊 Corrección de conteo', tipo: 'neutro' },
  { value: 'devolucion_cliente', label: '↪️ Devolución de cliente', tipo: 'positivo' },
  { value: 'bonificacion_proveedor', label: '➕ Bonificación de proveedor', tipo: 'positivo' },
  { value: 'otro', label: '📝 Otro (especificar en notas)', tipo: 'neutro' },
];

const MOTIVOS_ENTRADA = [
  { value: 'compra', label: '🛒 Compra a proveedor' },
  { value: 'devolucion_cliente', label: '↪️ Devolución de cliente' },
  { value: 'bonificacion', label: '➕ Bonificación / regalo proveedor' },
  { value: 'traslado_bodega', label: '🏢 Traslado entre bodegas' },
  { value: 'otro', label: '📝 Otro' },
];

const MOTIVOS_SALIDA = [
  { value: 'venta', label: '💰 Venta (sin factura)' },
  { value: 'muestra', label: '🎁 Muestra o regalo' },
  { value: 'consumo_interno', label: '🏭 Consumo interno' },
  { value: 'robo', label: '🔓 Robo o hurto' },
  { value: 'dano', label: '💥 Daño o deterioro' },
  { value: 'devolucion_proveedor', label: '↩️ Devolución a proveedor' },
  { value: 'traslado_bodega', label: '🏢 Traslado entre bodegas' },
  { value: 'otro', label: '📝 Otro' },
];

export default function AdjustStockModal({ open, onOpenChange, product, mode, onSubmitMovement }: Props) {
  const [quantity, setQuantity] = useState(0);
  const [unitCost, setUnitCost] = useState(0);
  const [motivo, setMotivo] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  if (!product) return null;

  const title = mode === 'adjust'
    ? `Ajuste de inventario: ${product.reference}`
    : mode === 'entrada'
    ? `Entrada: ${product.reference}`
    : `Salida: ${product.reference}`;

  const movementType = mode === 'adjust' ? 'ajuste' : mode;
  const motivos = mode === 'adjust' ? MOTIVOS_AJUSTE : mode === 'entrada' ? MOTIVOS_ENTRADA : MOTIVOS_SALIDA;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!motivo) return;
    setSaving(true);
    const motivoLabel = motivos.find(m => m.value === motivo)?.label || motivo;
    const notaCompleta = `[${motivoLabel}]${notes ? ` — ${notes}` : ''}`;
    const ok = await onSubmitMovement({
      product_id: product.id,
      movement_type: movementType,
      quantity,
      unit_cost: unitCost || product.cost_per_unit,
      notes: notaCompleta,
    });
    setSaving(false);
    if (ok) {
      setQuantity(0);
      setUnitCost(0);
      setMotivo('');
      setNotes('');
      onOpenChange(false);
    }
  };

  const diferencia = mode === 'adjust'
    ? quantity - product.stock_system
    : mode === 'salida'
    ? -quantity
    : quantity;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 p-3 bg-muted/40 rounded-lg text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Producto</p>
            <p className="font-medium">{product.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Stock actual</p>
            <p className="font-mono font-bold text-lg">{product.stock_system} <span className="text-xs font-normal text-muted-foreground">{product.unit}</span></p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Motivo — campo más importante */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Motivo del ajuste *</Label>
            <Select value={motivo} onValueChange={setMotivo} required>
              <SelectTrigger>
                <SelectValue placeholder="Seleccioná el motivo..." />
              </SelectTrigger>
              <SelectContent>
                {motivos.map(m => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Cantidad */}
          <div className="space-y-1.5">
            <Label className="text-sm">
              {mode === 'adjust' ? 'Nuevo stock total' : 'Cantidad'}
              {mode !== 'adjust' && <span className="text-muted-foreground text-xs ml-1">(unidades)</span>}
            </Label>
            <Input
              type="number"
              min={0}
              required
              value={quantity || ''}
              onChange={e => setQuantity(+e.target.value)}
              autoFocus
              className="text-lg font-mono"
            />
            {quantity > 0 && (
              <p className={`text-xs font-medium ${diferencia > 0 ? 'text-green-600' : diferencia < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                {diferencia > 0 ? `+${diferencia}` : diferencia} unidades vs stock actual
              </p>
            )}
          </div>

          {/* Costo unitario */}
          <div className="space-y-1.5">
            <Label className="text-sm">Costo unitario <span className="text-muted-foreground text-xs">(opcional)</span></Label>
            <Input
              type="number"
              min={0}
              value={unitCost || ''}
              onChange={e => setUnitCost(+e.target.value)}
              placeholder={`$${product.cost_per_unit.toLocaleString('es-CO')}`}
            />
          </div>

          {/* Notas adicionales */}
          <div className="space-y-1.5">
            <Label className="text-sm">Notas adicionales <span className="text-muted-foreground text-xs">(opcional)</span></Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Detalles adicionales del ajuste..."
              rows={2}
              className="text-sm"
            />
          </div>

          <Button type="submit" disabled={saving || !motivo || !quantity} className="w-full">
            {saving ? 'Guardando...' : 'Confirmar ajuste'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
