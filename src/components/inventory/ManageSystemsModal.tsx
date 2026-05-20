import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2, Check, X, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { ProductWithMetrics } from '@/hooks/useInventoryData';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: ProductWithMetrics[];
  onComplete: () => void | Promise<void>;
}

interface SystemEntry {
  name: string;
  productCount: number;
}

export default function ManageSystemsModal({ open, onOpenChange, products, onComplete }: Props) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [busy, setBusy] = useState(false);

  const systems = useMemo<SystemEntry[]>(() => {
    const counts = new Map<string, number>();
    for (const p of products) {
      const s = (p.system ?? '').trim();
      if (!s) continue;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, productCount]) => ({ name, productCount }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  }, [products]);

  const startEdit = (sys: string) => {
    setEditing(sys);
    setEditValue(sys);
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditValue('');
  };

  // Renombra (o fusiona) todos los productos con sistema=old a sistema=new.
  // Si "new" ya existe entre los sistemas, se fusionan — caso típico:
  // "8025 recto" → "8025".
  const handleRename = async (oldName: string) => {
    const newName = editValue.trim();
    if (!newName) {
      toast({ title: 'Nombre vacío', description: 'Usá "Borrar" si querés limpiar el sistema.', variant: 'destructive' });
      return;
    }
    if (newName === oldName) {
      cancelEdit();
      return;
    }
    const willMerge = systems.some(s => s.name.toLowerCase() === newName.toLowerCase() && s.name !== oldName);
    const ok = window.confirm(
      willMerge
        ? `Fusionar "${oldName}" en "${newName}".\n\nTodos los productos con sistema "${oldName}" pasarán a "${newName}". ¿Continuar?`
        : `Renombrar "${oldName}" → "${newName}".\n\nSe aplicará a todos los productos con ese sistema. ¿Continuar?`,
    );
    if (!ok) return;

    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No autenticado');
      // `system` está en DB (migración 20260503160000_inventory_systems.sql)
      // pero no en types generados — castear el payload evita el TS error.
      const { error } = await supabase
        .from('inventory_products')
        .update({ system: newName } as never)
        .eq('user_id', user.id)
        .eq('system' as never, oldName);
      if (error) throw error;
      await onComplete();
      cancelEdit();
      toast({
        title: willMerge ? 'Sistemas fusionados' : 'Sistema renombrado',
        description: willMerge
          ? `Los productos de "${oldName}" pasaron a "${newName}".`
          : `"${oldName}" ahora se llama "${newName}".`,
      });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  // Quita el sistema de todos los productos que lo tengan (system → null).
  // No borra los productos — sólo el campo "sistema".
  const handleDelete = async (sys: string, count: number) => {
    const ok = window.confirm(
      `Borrar el sistema "${sys}".\n\n` +
      `Se quitará de ${count} producto${count === 1 ? '' : 's'} (quedarán "sin sistema"). ` +
      `Los productos no se eliminan. ¿Continuar?`,
    );
    if (!ok) return;

    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No autenticado');
      const { error } = await supabase
        .from('inventory_products')
        .update({ system: null } as never)
        .eq('user_id', user.id)
        .eq('system' as never, sys);
      if (error) throw error;
      await onComplete();
      toast({ title: 'Sistema borrado', description: `${count} producto${count === 1 ? '' : 's'} ahora sin sistema.` });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Gestionar sistemas</DialogTitle>
          <DialogDescription>
            Renombrá o borrá sistemas en bloque. Si renombrás a uno que ya existe, se fusionan
            (útil para limpiar duplicados tipo "8025", "8025 curvo", "8025 recto").
          </DialogDescription>
        </DialogHeader>

        {systems.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            No hay sistemas creados todavía.
          </div>
        ) : (
          <div className="max-h-[420px] overflow-y-auto -mx-2">
            <div className="space-y-1 px-2">
              {systems.map((s) => {
                const isEditing = editing === s.name;
                return (
                  <div
                    key={s.name}
                    className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-muted/50 transition-colors"
                  >
                    {isEditing ? (
                      <>
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRename(s.name);
                            else if (e.key === 'Escape') cancelEdit();
                          }}
                          className="h-8 text-sm flex-1"
                          autoFocus
                          disabled={busy}
                        />
                        <Button
                          size="sm"
                          variant="default"
                          className="h-8 w-8 p-0"
                          onClick={() => handleRename(s.name)}
                          disabled={busy}
                          title="Guardar"
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={cancelEdit}
                          disabled={busy}
                          title="Cancelar"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{s.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {s.productCount} producto{s.productCount === 1 ? '' : 's'}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => startEdit(s.name)}
                          disabled={busy}
                          title="Renombrar / fusionar"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDelete(s.name, s.productCount)}
                          disabled={busy}
                          title="Borrar sistema (los productos quedan sin sistema)"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
