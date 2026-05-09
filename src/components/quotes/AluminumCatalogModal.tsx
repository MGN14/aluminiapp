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
import { Loader2, Plus, Pencil, Trash2, Upload, Check, X as XIcon, Package } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAluminumCatalog } from '@/hooks/useAluminumCatalog';
import type { AluminumCatalogEntry } from '@/types/quotation';
import BulkUploadCatalogModal from './BulkUploadCatalogModal';
import CatalogComponentsDialog from './CatalogComponentsDialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AluminumCatalogModal({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const { data, isLoading, createOne, updateOne, deleteOne, refetch } = useAluminumCatalog();
  const [showBulk, setShowBulk] = useState(false);
  const [componentsForEntry, setComponentsForEntry] = useState<AluminumCatalogEntry | null>(null);

  // Add form state — solo lo mínimo para crear, después se configura todo en el editor
  const [system, setSystem] = useState('');
  const [color, setColor] = useState('');
  const [description, setDescription] = useState('');

  // Edit state — edición rápida solo de sistema/color/descripción (el precio se calcula auto)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSystem, setEditSystem] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const resetAddForm = () => {
    setSystem('');
    setColor('');
    setDescription('');
  };

  const handleAdd = async () => {
    if (!system.trim() || !color.trim()) {
      toast({ title: 'Falta sistema o color', variant: 'destructive' });
      return;
    }
    try {
      // Crear con price_per_m2 = 0. Se calcula desde los componentes en el editor.
      const created = await createOne.mutateAsync({
        system: system.trim(),
        color: color.trim(),
        price_per_m2: 0,
        description: description.trim() || null,
      });
      resetAddForm();
      toast({ title: 'Producto creado — configurá los componentes' });
      // Abrir directamente el editor para que el usuario arme el BOM y los datos
      setComponentsForEntry(created);
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
    setEditDescription(entry.description ?? '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditSystem('');
    setEditColor('');
    setEditDescription('');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    if (!editSystem.trim() || !editColor.trim()) {
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
            <DialogTitle>Productos terminados</DialogTitle>
            <DialogDescription>
              Creá un producto (sistema + color), después configurá sus componentes (cabezal, sillar, jamba, vidrio, accesorios) con cantidad por m². La app calcula el costo real automáticamente desde tu inventario y lo usa al cotizar.
            </DialogDescription>
          </DialogHeader>

          {/* Bulk upload trigger */}
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowBulk(true)}>
              <Upload className="h-4 w-4 mr-1.5" />
              Carga masiva (CSV/Excel)
            </Button>
          </div>

          {/* Add form — solo lo mínimo. Precio, vidrio, mano de obra, etc. se configura después. */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
            <div className="text-xs font-medium text-muted-foreground">Nuevo producto</div>
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
                  placeholder="Blanco"
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
              Después de crear, abriremos el configurador para que armes los componentes (cabezal, sillar, jamba, vidrio, accesorios), tiempo de entrega, mano de obra y precio.
            </p>
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
                  Crear y configurar
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
              Sin productos terminados aún. Creá uno arriba o usá la carga masiva.
            </p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {data.map((entry) => {
                const editing = entry.id === editingId;
                const costo = entry.costo_calculado_m2 ?? 0;
                const precio = entry.price_per_m2 ?? 0;
                const sinConfigurar = costo === 0 && precio === 0;
                return (
                  <div
                    key={entry.id}
                    className={`rounded-lg border p-3 ${
                      sinConfigurar ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20' : 'border-border'
                    }`}
                  >
                    {editing ? (
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_2fr_auto] gap-2 items-center">
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
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className={`flex-1 min-w-[150px] ${!entry.active ? 'text-muted-foreground line-through' : ''}`}>
                          <div className="text-sm font-medium">{entry.system} · {entry.color}</div>
                          {entry.description && (
                            <div className="text-[11px] text-muted-foreground truncate">{entry.description}</div>
                          )}
                        </div>
                        <div className="text-xs tabular-nums text-right min-w-[140px]">
                          {sinConfigurar ? (
                            <span className="text-amber-700 dark:text-amber-400 font-medium">Sin configurar</span>
                          ) : (
                            <>
                              <div className="text-muted-foreground">
                                Costo: {costo.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}/m²
                              </div>
                              <div className="font-medium">
                                Venta: {precio.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}/m²
                              </div>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant={sinConfigurar ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setComponentsForEntry(entry)}
                            className="h-8"
                          >
                            <Package className="h-3.5 w-3.5 mr-1.5" />
                            {sinConfigurar ? 'Configurar' : 'Editar config'}
                          </Button>
                          <Switch
                            checked={entry.active}
                            onCheckedChange={() => handleToggleActive(entry)}
                          />
                          <Button variant="ghost" size="sm" onClick={() => startEdit(entry)} title="Renombrar">
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
                      </div>
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

      <CatalogComponentsDialog
        entry={componentsForEntry}
        open={!!componentsForEntry}
        onOpenChange={(o) => {
          if (!o) setComponentsForEntry(null);
        }}
      />
    </>
  );
}
