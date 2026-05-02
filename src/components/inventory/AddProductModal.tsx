import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { reference: string; name: string; unit: string; stock_system: number; cost_per_unit: number; sale_price: number; min_stock: number; system: string | null }) => Promise<boolean | undefined>;
  /** Sistemas existentes del usuario, para datalist autocomplete */
  existingSystems?: string[];
}

export default function AddProductModal({ open, onOpenChange, onSubmit, existingSystems = [] }: Props) {
  const [form, setForm] = useState({ reference: '', name: '', unit: 'unidad', stock_system: 0, cost_per_unit: 0, sale_price: 0, min_stock: 0, system: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const ok = await onSubmit({ ...form, system: form.system.trim() || null });
    setSaving(false);
    if (ok) {
      setForm({ reference: '', name: '', unit: 'unidad', stock_system: 0, cost_per_unit: 0, sale_price: 0, min_stock: 0, system: '' });
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Agregar producto</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Referencia</Label>
              <Input required value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="REF-001" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Nombre</Label>
              <Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Perfil T6" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Unidad</Label>
              <Input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="unidad" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Stock Inicial</Label>
              <Input type="number" min={0} value={form.stock_system} onChange={e => setForm({ ...form, stock_system: +e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Stock Mínimo</Label>
              <Input type="number" min={0} value={form.min_stock} onChange={e => setForm({ ...form, min_stock: +e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Costo Unitario</Label>
              <Input type="number" min={0} value={form.cost_per_unit} onChange={e => setForm({ ...form, cost_per_unit: +e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Precio de Venta</Label>
              <Input type="number" min={0} value={form.sale_price} onChange={e => setForm({ ...form, sale_price: +e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Sistema / Grupo (opcional)</Label>
            <Input
              value={form.system}
              onChange={e => setForm({ ...form, system: e.target.value })}
              placeholder='Ej: "744", "8025", "proyectante"'
              list="existing-systems"
            />
            <datalist id="existing-systems">
              {existingSystems.map(s => <option key={s} value={s} />)}
            </datalist>
            <p className="text-[10px] text-muted-foreground">
              Agrupa referencias por sistema para filtrar y comparar después.
            </p>
          </div>
          <Button type="submit" disabled={saving} className="w-full">
            {saving ? 'Guardando...' : 'Agregar producto'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
