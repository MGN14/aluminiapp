import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus, Pencil, Trash2, Lock, Search, Upload, Download, FileSpreadsheet, X } from 'lucide-react';
import { usePersistedFormState, usePersistedDialogOpen } from '@/hooks/usePersistedFormState';

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
  /** Sistema/línea al que pertenece la referencia (ej: "744", "8025"). */
  system: string | null;
  active: boolean;
}

const EMPTY: Omit<ProductMaster, 'id' | 'active'> = {
  ref_siigo: '', description: '', ref_local: '', ref_proveedor_a: '', ref_proveedor_b: '', ref_proveedor_c: '', unit: 'und', system: '',
};

export default function MaestroProductos() {
  const { user } = useAuth();
  const { isAdmin, isFounder } = useSubscription();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = isAdmin || isFounder;

  // Fetch inventory products para la plantilla — incluye system para que
  // la plantilla descargada arranque con el sistema preseteado de cada ref.
  const { data: inventoryProducts = [] } = useQuery({
    queryKey: ['inventory-for-template', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('inventory_products')
        .select('reference, name, unit, system')
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
          'Sistema': p.system || '',
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
        'Sistema': p.system || '',
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
        'Sistema': '744',
        'Ref_Local': 'PC635-MATE',
        'Ref_Proveedor_A': 'PISAVIDRIO CURVO 635',
        'Ref_Proveedor_B': 'PV-635M',
        'Ref_Proveedor_C': '',
        'Unidad': 'und',
      });
    }

    const ws = XLSX.utils.json_to_sheet(rows);

    // Ajustar anchos de columna (Ref, Desc, Sistema, Ref_Local, Prov A/B/C, Unidad)
    ws['!cols'] = [
      { wch: 22 }, { wch: 35 }, { wch: 14 }, { wch: 18 },
      { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 10 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Maestro');
    XLSX.writeFile(wb, 'Maestro_Productos_AluminIA.xlsx');
  };

  // Persistido: la búsqueda del maestro sobrevive si cambia de tab/pestaña.
  const [search, setSearch] = usePersistedFormState<string>('maestro-productos:search:v1', '');
  // El modal de agregar/editar producto también se reabre solo si Nico
  // estaba en medio de tipear y se refresca / cambia de tab.
  const [modalOpen, setModalOpen] = usePersistedDialogOpen('maestro-productos:form:open');
  const [editId, setEditId] = useState<string | null>(null);
  // Persistencia del form Add/Edit. Si Nico tipea una ficha entera y cambia
  // de pestaña / tab discard, al volver el form sigue. Se limpia al guardar
  // exitoso o al cerrar manualmente.
  const [form, setForm, clearForm] = usePersistedFormState(
    'maestro-productos:form:v1',
    { ...EMPTY },
  );
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<{ rows: number; sample: Array<Record<string, string>> } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: productos = [], isLoading } = useQuery({
    queryKey: ['product-master', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await (supabase
        .from('product_master') as any)
        .select('*')
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
    // No reseteo aquí: si el usuario estaba en medio de tipear una ficha y
    // cerró sin querer, al abrir "Agregar" recuperamos lo que dejó vía
    // sessionStorage. Si quiere arrancar limpio, el botón "Cancelar" del
    // modal limpia el storage.
    setModalOpen(true);
  };

  const openEdit = (p: ProductMaster) => {
    setEditId(p.id);
    // En edición sí pisamos siempre con los datos del producto — no tiene
    // sentido recuperar un form anterior cuando el usuario clickeó editar
    // una fila distinta.
    setForm({
      ref_siigo: p.ref_siigo,
      description: p.description,
      ref_local: p.ref_local || '',
      ref_proveedor_a: p.ref_proveedor_a || '',
      ref_proveedor_b: p.ref_proveedor_b || '',
      ref_proveedor_c: p.ref_proveedor_c || '',
      unit: p.unit,
      system: p.system || '',
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
        system: form.system?.trim() || null,
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
      // Reset + clear sessionStorage tras guardado exitoso.
      setForm({ ...EMPTY });
      clearForm();
      setEditId(null);
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

  // Lee el archivo (xlsx/xls/csv) y devuelve un array de objects con keys
  // tomadas del header de la primera fila. Tolera headers con mayús/minús,
  // espacios, acentos.
  const parseImportFile = async (file: File): Promise<Array<Record<string, string>>> => {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' as string) as any;

    let workbook: any;
    if (ext === 'csv' || ext === 'txt') {
      const text = await file.text();
      workbook = XLSX.read(text, { type: 'string' });
    } else {
      // xlsx, xls, xlsb, ods
      const buf = await file.arrayBuffer();
      workbook = XLSX.read(buf, { type: 'array' });
    }
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const sheet = workbook.Sheets[sheetName];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    return rows;
  };

  // Normaliza headers: minúsculas, sin acentos, sin paréntesis ni notas.
  const normalizeKey = (k: string): string =>
    k.toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .replace(/\s*\(.*?\)\s*/g, '') // quita "(NO EDITAR)" etc
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

  const pickField = (row: Record<string, string>, ...candidates: string[]): string => {
    const norm: Record<string, string> = {};
    for (const k of Object.keys(row)) norm[normalizeKey(k)] = String(row[k] ?? '').trim();
    for (const c of candidates) {
      const v = norm[normalizeKey(c)];
      if (v) return v;
    }
    return '';
  };

  const handleFileSelected = async (file: File) => {
    setImportFile(file);
    setImportPreview(null);
    try {
      const rows = await parseImportFile(file);
      const valid = rows.filter(r => pickField(r, 'ref_siigo', 'ref siigo', 'referencia', 'codigo'));
      setImportPreview({ rows: valid.length, sample: valid.slice(0, 3) });
    } catch (err: any) {
      toast({ title: 'No pude leer el archivo', description: err.message, variant: 'destructive' });
    }
  };

  // Importar desde archivo Excel/CSV. Mapea headers tolerando variantes.
  const handleImport = async () => {
    if (!user?.id || !importFile) return;
    setSaving(true);
    try {
      const parsed = await parseImportFile(importFile);
      const rows = parsed.map(r => ({
        user_id: user.id,
        ref_siigo: pickField(r, 'ref_siigo', 'ref siigo', 'referencia', 'codigo').toUpperCase(),
        description: pickField(r, 'descripcion', 'description', 'nombre', 'producto'),
        system: pickField(r, 'sistema', 'system', 'linea') || null,
        ref_local: pickField(r, 'ref_local', 'ref local', 'referencia_local') || null,
        ref_proveedor_a: pickField(r, 'ref_proveedor_a', 'ref proveedor a', 'proveedor_a', 'prov_a') || null,
        ref_proveedor_b: pickField(r, 'ref_proveedor_b', 'ref proveedor b', 'proveedor_b', 'prov_b') || null,
        ref_proveedor_c: pickField(r, 'ref_proveedor_c', 'ref proveedor c', 'proveedor_c', 'prov_c') || null,
        unit: pickField(r, 'unidad', 'unit', 'u') || 'und',
        active: true,
        updated_at: new Date().toISOString(),
      })).filter(r => r.ref_siigo && r.description);

      if (rows.length === 0) {
        toast({ title: 'No se encontraron filas válidas', description: 'Asegurate que la primera fila sean los headers (Ref_Siigo, Descripcion, Sistema, ...).', variant: 'destructive' });
        setSaving(false);
        return;
      }
      const { error } = await (supabase.from('product_master') as any).upsert(rows, { onConflict: 'user_id,ref_siigo' });
      if (error) throw error;
      toast({ title: `${rows.length} productos importados al maestro` });
      queryClient.invalidateQueries({ queryKey: ['product-master'] });
      setImportOpen(false);
      setImportFile(null);
      setImportPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      toast({ title: 'Error al importar', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
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
                <th className="text-left px-3 py-2.5 font-semibold">Sistema</th>
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
                  <td className="px-3 py-2 text-muted-foreground">
                    {p.system ? (
                      <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium">{p.system}</span>
                    ) : '—'}
                  </td>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Sistema <span className="text-muted-foreground">(línea / familia)</span></Label>
                <Input value={form.system || ''} onChange={e => setForm(f => ({ ...f, system: e.target.value }))} placeholder="744, 8025, proyectante..." />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Ref. Local <span className="text-muted-foreground">(inventario físico)</span></Label>
                <Input value={form.ref_local || ''} onChange={e => setForm(f => ({ ...f, ref_local: e.target.value }))} placeholder="PC635-MATE" className="font-mono" />
              </div>
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
            <Button
              variant="outline"
              onClick={() => {
                // Cancelar = arrancar limpio la próxima vez. Sin esto, el
                // sessionStorage retendría lo tipeado.
                setForm({ ...EMPTY });
                clearForm();
                setEditId(null);
                setModalOpen(false);
              }}
            >
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.ref_siigo || !form.description}>
              {saving ? 'Guardando...' : editId ? 'Actualizar' : 'Agregar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal importar — sube archivo Excel o CSV */}
      <Dialog
        open={importOpen}
        onOpenChange={(o) => {
          setImportOpen(o);
          if (!o) {
            setImportFile(null);
            setImportPreview(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Importar maestro de productos</DialogTitle>
            <DialogDescription>
              Subí un Excel (.xlsx) o CSV con los productos. Si descargaste la plantilla, ya tiene los headers correctos.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFileSelected(f);
              }}
            />

            {!importFile ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-muted-foreground/30 rounded-xl py-8 px-4 flex flex-col items-center gap-2 hover:border-primary/50 hover:bg-muted/30 transition-colors"
              >
                <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm font-medium">Click para seleccionar archivo</span>
                <span className="text-[11px] text-muted-foreground">Excel (.xlsx, .xls) o CSV</span>
              </button>
            ) : (
              <div className="rounded-lg border bg-muted/30 p-3 flex items-center gap-3">
                <FileSpreadsheet className="h-6 w-6 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{importFile.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {importPreview ? `${importPreview.rows} fila${importPreview.rows === 1 ? '' : 's'} válida${importPreview.rows === 1 ? '' : 's'}` : 'Leyendo…'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    setImportFile(null);
                    setImportPreview(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}

            {importPreview && importPreview.rows > 0 && (
              <div className="rounded-lg border bg-success/5 border-success/30 p-3 space-y-1">
                <p className="text-xs font-semibold text-success">
                  ✓ Se van a importar {importPreview.rows} producto{importPreview.rows === 1 ? '' : 's'}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Si una referencia ya existe en el maestro, se actualizará. No se borran las existentes.
                </p>
              </div>
            )}

            <div className="text-[11px] text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground">Columnas esperadas (la primera fila):</p>
              <p className="font-mono">Ref_Siigo · Descripcion · Sistema · Ref_Local · Ref_Proveedor_A · Ref_Proveedor_B · Ref_Proveedor_C · Unidad</p>
              <p>Mayúsculas/minúsculas y acentos no importan. Solo Ref_Siigo y Descripción son obligatorios.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={handleImport} disabled={saving || !importFile || !importPreview || importPreview.rows === 0}>
              {saving ? 'Importando...' : importPreview ? `Importar ${importPreview.rows}` : 'Importar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
