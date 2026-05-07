import { useState } from 'react';
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
import { Switch } from '@/components/ui/switch';
import { Loader2, Plus, Pencil, Trash2, Upload, Check, X as XIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAluminumCatalog } from '@/hooks/useAluminumCatalog';
import type { AluminumCatalogEntry } from '@/types/quotation';
import BulkUploadCatalogModal from './BulkUploadCatalogModal';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AluminumCatalogModal({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const { data, isLoading, createOne, updateOne, deleteOne, refetch } = useAluminumCatalog();
  const [showBulk, setShowBulk] = useState(false);

  // Add form state
  const [system, setSystem] = useState('');
  const [color, setColor] = useState('');
  const [pricePerM2, setPricePerM2] = useState('');
  const [description, setDescription] = useState('');

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSystem, setEditSystem] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const resetAddForm = () => {
    setSystem('');
    setColor('');
    setPricePerM2('');
    setDescription('');
  };

  const handleAdd = async () => {
    if (!system.trim() || !color.trim()) {
      toast({ title: 'Falta sistema o color', variant: 'destructive' });
      return;
    }
    const price = Number(pricePerM2);
    if (!Number.isFinite(price) || price <= 0) {
      toast({ title: 'Precio por m² inválido', variant: 'destructive' });
      return;
    }
    try {
      await createOne.mutateAsync({
        system: system.trim(),
        color: color.trim(),
        price_per_m2: price,
        description: description.trim() || null,
      });
      resetAddForm();
      toast({ title: 'Producto agregado al catálogo' });
    } catch (e: any) {
      const msg = e?.message?.includes('duplicate')
        ? 'Ya existe un producto con ese sistema y color.'
        : e?.message || 'No se pudo agregar.';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    }
  };

  const startEdit = (entry: AluminumCatalogEntry) => {
    setEditingId(entry.id);
    setEditSystem(entry.system);
    setEditColor(entry.color);
    setEditPrice(String(entry.price_per_m2));
    setEditDescription(entry.description ?? '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditSystem('');
    setEditColor('');
    setEditPrice('');
    setEditDescription('');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    if (!editSystem.trim() || !editColor.trim()) {
      toast({ title: 'Falta sistema o color', variant: 'destructive' });
      return;
    }
    const price = Number(editPrice);
    if (!Number.isFinite(price) || price <= 0) {
      toast({ title: 'Precio por m² inválido', variant: 'destructive' });
      return;
    }
    try {
      await updateOne.mutateAsync({
        id: editingId,
        patch: {
          system: editSystem.trim(),
          color: editColor.trim(),
          price_per_m2: price,
          description: editDescription.trim() || null,
        },
      });
      cancelEdit();
      toast({ title: 'Producto actualizado' });
    } catch (e: any) {
      toast({
        title: 'Error',
        description: e?.message || 'No se pudo actualizar.',
        variant: 'destructive',
      });
    }
  };

  const handleToggleActive = async (entry: AluminumCatalogEntry) => {
    try {
      await updateOne.mutateAsync({ id: entry.id, patch: { active: !entry.active } });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (entry: AluminumCatalogEntry) => {
    if (!confirm(`¿Eliminar "${entry.system} ${entry.color}" del catálogo?`)) return;
    try {
      await deleteOne.mutateAsync(entry.id);
      toast({ title: 'Producto eliminado' });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message, variant: 'destructive' });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Catálogo de productos</DialogTitle>
            <DialogDescription>
              Sistema + color + precio por m². Lo usás como fuente de precios al cotizar.
            </DialogDescription>
          </DialogHeader>

          {/* Bulk upload trigger */}
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowBulk(true)}>
              <Upload className="h-4 w-4 mr-1.5" />
              Carga masiva (CSV/Excel)
            </Button>
          </div>

          {/* Add form */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Sistema</Label>
                <Input
                  placeholder="744"
                  value={system}
                  onChange={(e) => setSystem(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Color</Label>
                <Input
                  placeholder="Blanco"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Precio por m² (COP)</Label>
                <Input
                  type="number"
                  placeholder="180000"
                  value={pricePerM2}
                  onChange={(e) => setPricePerM2(e.target.value)}
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
            <Button
              onClick={handleAdd}
              disabled={createOne.isPending}
              size="sm"
              className="w-full sm:w-auto"
            >
              {createOne.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Agregar al catálogo
                </>
              )}
            </Button>
          </div>

          {/* List */}
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : data.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">
              Tu catálogo está vacío. Agregá productos arriba o usá la carga masiva.
            </p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {data.map((entry) => {
                const editing = entry.id === editingId;
                return (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-border p-2 grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_1fr_auto_auto] gap-2 items-center"
                  >
                    {editing ? (
                      <>
                        <Input
                          value={editSystem}
                          onChange={(e) => setEditSystem(e.target.value)}
                          className="h-8"
                        />
                        <Input
                          value={editColor}
                          onChange={(e) => setEditColor(e.target.value)}
                          className="h-8"
                        />
                        <Input
                          type="number"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          className="h-8"
                        />
                        <Input
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          className="h-8"
                          placeholder="Descripción"
                        />
                        <div className="flex gap-1 justify-end">
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
                        <div />
                      </>
                    ) : (
                      <>
                        <span className={`text-sm font-medium ${!entry.active ? 'text-muted-foreground line-through' : ''}`}>
                          {entry.system}
                        </span>
                        <span className={`text-sm ${!entry.active ? 'text-muted-foreground line-through' : ''}`}>
                          {entry.color}
                        </span>
                        <span className={`text-sm tabular-nums ${!entry.active ? 'text-muted-foreground line-through' : ''}`}>
                          {entry.price_per_m2.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}
                          <span className="text-[10px] text-muted-foreground"> /m²</span>
                        </span>
                        <span className="text-xs text-muted-foreground truncate" title={entry.description ?? ''}>
                          {entry.description ?? '—'}
                        </span>
                        <div className="flex items-center justify-end gap-1">
                          <Switch
                            checked={entry.active}
                            onCheckedChange={() => handleToggleActive(entry)}
                          />
                          <Button variant="ghost" size="sm" onClick={() => startEdit(entry)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(entry)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <BulkUploadCatalogModal
        open={showBulk}
        onOpenChange={setShowBulk}
        onComplete={() => {
          refetch();
          setShowBulk(false);
        }}
      />
    </>
  );
}
