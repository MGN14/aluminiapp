import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus, Pencil, Trash2, Lock, Search, Upload, Download } from 'lucide-react';

const UNIDADES = ['und', 'm', 'm²', 'm³', 'kg', 'lb', 'ton', 'l', 'ml', 'caja', 'par', 'rollo', 'paquete', 'juego', 'kit', 'otro'];

interface ProductMaster {
  id: string;
  ref_siigo: string;
  description: string;
  ref_local: string | null;
  ref_proveedor_a: string | null;
  ref_proveedor_b: string | null;
  ref_proveedor_c: string | null;
  unit: string;
  active: boolean;
}

const EMPTY: Omit<ProductMaster, 'id' | 'active'> = {
  ref_siigo: '', description: '', ref_local: '', ref_proveedor_a: '', ref_proveedor_b: '', ref_proveedor_c: '', unit: 'und',
};

export default function MaestroProductos() {
  const { user } = useAuth();
  const { isAdmin, isFounder } = useSubscription();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = isAdmin || isFounder;

  // Fetch inventory products para la plantilla
  const { data: inventoryProducts = [] } = useQuery({
    queryKey: ['inventory-for-template', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('inventory_products')
        .select('reference, name, unit')
        .eq('user_id', user.id)
        .eq('active', true)
        .order('reference');
      return data || [];
    },
    enabled: !!user?.id,
  });

  const downloadTemplate = async () => {
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' as string) as any;

    const maestroRefs = new Set(productos.map(p => p.ref_siigo));

    const rows: any[] = [];

    // Refs del inventario que aún no están en el maestro
    inventoryProducts.forEach((p: any) => {
      if (!maestroRefs.has(p.reference)) {
        rows.push({
          'Ref_Siigo (NO EDITAR)': p.reference,
          'Descripcion': p.name,
          'Ref_Local': '',
          'Ref_Proveedor_A': '',
          'Ref_Proveedor_B': '',
          'Ref_Proveedor_C': '',
          'Unidad': p.unit || 'und',
        });
      }
    });

    // Refs ya en el maestro
    productos.forEach(p => {
      rows.push({
        'Ref_Siigo (NO EDITAR)': p.ref_siigo,
        'Descripcion': p.description,
        'Ref_Local': p.ref_local || '',
        'Ref_Proveedor_A': p.ref_proveedor_a || '',
        'Ref_Proveedor_B': p.ref_proveedor_b || '',
        'Ref_Proveedor_C': p.ref_proveedor_c || '',
        'Unidad': p.unit,
      });
    });

    if (rows.length === 0) {
      rows.push({
        'Ref_Siigo (NO EDITAR)': 'PC635',
        'Descripcion': 'Ejemplo: Pisavidrio Curvo Liviano',
        'Ref_Local': 'PC635-MATE',
        'Ref_Proveedor_A': 'PISAVIDRIO CURVO 635',
        'Ref_Proveedor_B': 'PV-635M',
        'Ref_Proveedor_C': '',
        'Unidad': 'und',
      });
    }

    const ws = XLSX.utils.json_to_sheet(rows);

    // Ajustar anchos de columna
    ws['!cols'] = [
      { wch: 22 }, { wch: 35 }, { wch: 18 },
      { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 10 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Maestro');
    XLSX.writeFile(wb, 'Maestro_Productos_AluminIA.xlsx');
  };

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');

  const { data: productos = [], isLoading } = useQuery({
    queryKey: ['product-master', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await (supabase
        .from('product_master') as any)
        .select('*')
        .eq('user_id', user.id)
        .eq('active', true)
        .order('ref_siigo');
      if (error) throw error;
      return (data ?? []) as ProductMaster[];
    },
    enabled: !!user?.id,
  });

  const filtered = productos.filter(p => {
    const q = search.toLowerCase();
    return (
      (p.ref_siigo || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.ref_local || '').toLowerCase().includes(q) ||
      (p.ref_proveedor_a || '').toLowerCase().includes(q)
    );
  });

  const openNew = () => {
    setEditId(null);
    setForm({ ...EMPTY });
    setModalOpen(true);
  };

  const openEdit = (p: ProductMaster) => {
    setEditId(p.id);
    setForm({
      ref_siigo: p.ref_siigo,
      description: p.description,
      ref_local: p.ref_local || '',
      ref_proveedor_a: p.ref_proveedor_a || '',
      ref_proveedor_b: p.ref_proveedor_b || '',
      ref_proveedor_c: p.ref_proveedor_c || '',
      unit: p.unit,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.ref_siigo || !form.description || !user?.id) return;
    setSaving(true);
    try {
      const payload = {
        user_id: user.id,
        ref_siigo: form.ref_siigo.trim().toUpperCase(),
        description: form.description.trim(),
        ref_local: form.ref_local?.trim() || null,
        ref_proveedor_a: form.ref_proveedor_a?.trim() || null,
        ref_proveedor_b: form.ref_proveedor_b?.trim() || null,
        ref_proveedor_c: form.ref_proveedor_c?.trim() || null,
        unit: form.unit,
        updated_at: new Date().toISOString(),
      };
      if (editId) {
        await (supabase.from('product_master') as any).update(payload).eq('id', editId);
        toast({ title: 'Producto actualizado' });
      } else {
        await (supabase.from('product_master') as any).insert({ ...payload, active: true });
        toast({ title: 'Producto agregado al maestro' });
      }
      queryClient.invalidateQueries({ queryKey: ['product-master'] });
      setModalOpen(false);
    } catch (e: any) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, ref: string) => {
    if (!confirm(`¿Eliminar "${ref}" del maestro?`)) return;
    await (supabase.from('product_master') as any).update({ active: false }).eq('id', id);
    queryClient.invalidateQueries({ queryKey: ['product-master'] });
    toast({ title: `${ref} eliminado del maestro` });
  };

  // Importar desde texto (CSV simple: ref_siigo, description, ref_local, unidad)
  const handleImport = async () => {
    if (!user?.id || !importText.trim()) return;
    const lines = importText.trim().split('\n').filter(l => l.trim());
    const rows = lines.map(l => {
      const cols = l.split('\t').length > 1 ? l.split('\t') : l.split(',');
      return {
        user_id: user.id,
        ref_siigo: (cols[0] || '').trim().toUpperCase(),
        description: (cols[1] || '').trim(),
        ref_local: (cols[2] || '').trim() || null,
        unit: (cols[3] || 'und').trim(),
        active: true,
        updated_at: new Date().toISOString(),
      };
    }).filter(r => r.ref_siigo && r.description);

    if (rows.length === 0) { toast({ title: 'No se encontraron filas válidas', variant: 'destructive' }); return; }
    setSaving(true);
    const { error } = await (supabase.from('product_master') as any).upsert(rows, { onConflict: 'user_id,ref_siigo' });
    setSaving(false);
    if (error) { toast({ title: 'Error al importar', description: error.message, variant: 'destructive' }); return; }
    toast({ title: `${rows.length} productos importados al maestro` });
    queryClient.invalidateQueries({ queryKey: ['product-master'] });
    setImportOpen(false);
    setImportText('');
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por referencia o descripción..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        {canEdit && (
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-2">
              <Download className="h-4 w-4" />
              Descargar plantilla
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} className="gap-2">
              <Upload className="h-4 w-4" />
              Importar
            </Button>
            <Button size="sm" onClick={openNew} className="gap-2">
              <Plus className="h-4 w-4" />
              Agregar
            </Button>
          </div>
        )}
        {!canEdit && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            Solo el administrador puede editar el maestro
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="text-xs text-muted-foreground">
        {filtered.length} de {productos.length} referencias
      </div>

      {/* Tabla */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Cargando maestro...</div>
      ) : productos.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <p className="mb-3">El maestro de productos está vacío.</p>
          {canEdit && <Button size="sm" onClick={openNew} className="gap-2"><Plus className="h-4 w-4" />Agregar primer producto</Button>}
        </div>
      ) : (
        <div className="rounded-xl border overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-3 py-2.5 font-semibold">Ref. Siigo *</th>
                <th className="text-left px-3 py-2.5 font-semibold">Descripción</th>
                <th className="text-left px-3 py-2.5 font-semibold">Ref. Local</th>
                <th className="text-left px-3 py-2.5 font-semibold">Prov. A</th>
                <th className="text-left px-3 py-2.5 font-semibold">Prov. B</th>
                <th className="text-left px-3 py-2.5 font-semibold">Prov. C</th>
                <th className="text-center px-3 py-2.5 font-semibold">Unidad</th>
                {canEdit && <th className="px-3 py-2.5"></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2 font-mono font-semibold text-foreground">{p.ref_siigo}</td>
                  <td className="px-3 py-2 text-foreground max-w-48 truncate">{p.description}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{p.ref_local || '—'}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{p.ref_proveedor_a || '—'}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{p.ref_proveedor_b || '—'}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{p.ref_proveedor_c || '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium">{p.unit}</span>
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(p)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDelete(p.id, p.ref_siigo)}>
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal agregar/editar */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? 'Editar producto' : 'Nuevo producto en Maestro'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Ref. Siigo * <span className="text-muted-foreground font-normal">(principal)</span></Label>
                <Input value={form.ref_siigo} onChange={e => setForm(f => ({ ...f, ref_siigo: e.target.value }))} placeholder="PC635" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Unidad de medida *</Label>
                <Select value={form.unit} onValueChange={v => setForm(f => ({ ...f, unit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNIDADES.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Descripción *</Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Pisavidrio Curvo Liviano Mate" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Ref. Local <span className="text-muted-foreground">(para inventario físico)</span></Label>
              <Input value={form.ref_local || ''} onChange={e => setForm(f => ({ ...f, ref_local: e.target.value }))} placeholder="PC635-MATE" className="font-mono" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Ref. Proveedor A</Label>
                <Input value={form.ref_proveedor_a || ''} onChange={e => setForm(f => ({ ...f, ref_proveedor_a: e.target.value }))} placeholder="PISAVIDRIO 635" className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Ref. Proveedor B</Label>
                <Input value={form.ref_proveedor_b || ''} onChange={e => setForm(f => ({ ...f, ref_proveedor_b: e.target.value }))} placeholder="PV-635M" className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Ref. Proveedor C</Label>
                <Input value={form.ref_proveedor_c || ''} onChange={e => setForm(f => ({ ...f, ref_proveedor_c: e.target.value }))} placeholder="" className="font-mono text-xs" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !form.ref_siigo || !form.description}>
              {saving ? 'Guardando...' : editId ? 'Actualizar' : 'Agregar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal importar */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Importar desde Excel / Siigo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Copiá y pegá desde Excel. Columnas esperadas (separadas por tab o coma):<br />
              <span className="font-mono font-semibold">Ref Siigo, Descripción, Ref Local, Unidad</span>
            </p>
            <textarea
              className="w-full h-48 font-mono text-xs border rounded-lg p-3 bg-background resize-none"
              placeholder={"PC635\tPisavidrio Curvo Liviano\tPC635-MATE\tund\nLIV-35\tCabezal Liviano 744\tLIV-35\tund"}
              value={importText}
              onChange={e => setImportText(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Si Ref Siigo ya existe, se actualizará. No se borrarán registros existentes.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancelar</Button>
            <Button onClick={handleImport} disabled={saving || !importText.trim()}>
              {saving ? 'Importando...' : 'Importar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
