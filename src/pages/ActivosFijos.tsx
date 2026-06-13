import { useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Building2, Plus, Trash2, Info, Pencil } from 'lucide-react';
import { useFixedAssets, type FixedAssetWithDep, type NewFixedAsset } from '@/hooks/useFixedAssets';
import { usePermissions } from '@/hooks/usePermissions';
import { CATEGORY_LABEL, VIDA_UTIL_DEFAULT, type AssetCategory } from '@/lib/depreciation';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';

const fmt = (v: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Math.round(v));
const todayIso = () => new Date().toISOString().split('T')[0];

const EMPTY: NewFixedAsset = {
  nombre: '', categoria: 'maquinaria', valor_compra: 0, fecha_compra: todayIso(),
  vida_util_meses: VIDA_UTIL_DEFAULT.maquinaria, valor_residual: 0, activo: true, notas: null,
};

function AssetModal({ open, onOpenChange, editing, onSave }: {
  open: boolean; onOpenChange: (v: boolean) => void; editing: FixedAssetWithDep | null;
  onSave: (a: NewFixedAsset & { id?: string }) => void;
}) {
  const [form, setForm] = useState<NewFixedAsset>(EMPTY);
  const [id, setId] = useState<string | undefined>();

  // Reinit al abrir.
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      if (editing) { const { id: eid, dep: _d, ...rest } = editing; setId(eid); setForm(rest); }
      else { setId(undefined); setForm({ ...EMPTY, fecha_compra: todayIso() }); }
    }
  }

  const set = (patch: Partial<NewFixedAsset>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{id ? 'Editar activo' : 'Nuevo activo fijo'}</DialogTitle>
          <DialogDescription className="text-xs">Cargá el costo y la fecha; la vida útil viene por defecto según la categoría (editable).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Nombre *</Label>
            <Input value={form.nombre} onChange={(e) => set({ nombre: e.target.value })} placeholder="Ej: Extrusora de aluminio" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Categoría</Label>
              <Select value={form.categoria} onValueChange={(v) => {
                // Solo pisar la vida útil con el default de la nueva categoría
                // si el usuario no la había personalizado (sigue en un default).
                const esDefault = (Object.values(VIDA_UTIL_DEFAULT) as number[]).includes(form.vida_util_meses);
                set({ categoria: v as AssetCategory, ...(esDefault ? { vida_util_meses: VIDA_UTIL_DEFAULT[v as AssetCategory] } : {}) });
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CATEGORY_LABEL) as AssetCategory[]).map((c) => <SelectItem key={c} value={c} className="text-xs">{CATEGORY_LABEL[c]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Fecha de compra *</Label>
              <Input type="date" value={form.fecha_compra} onChange={(e) => set({ fecha_compra: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Valor de compra *</Label>
              <Input type="number" min={0} value={form.valor_compra || ''} onChange={(e) => set({ valor_compra: Number(e.target.value) || 0 })} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Valor residual</Label>
              <Input type="number" min={0} value={form.valor_residual || ''} onChange={(e) => set({ valor_residual: Number(e.target.value) || 0 })} className="font-mono" placeholder="0" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Vida útil (meses)</Label>
              <Input type="number" min={1} value={form.vida_util_meses} onChange={(e) => set({ vida_util_meses: Number(e.target.value) || 1 })} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Estado</Label>
              <Select value={form.activo ? 'activo' : 'baja'} onValueChange={(v) => set({ activo: v === 'activo' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="activo" className="text-xs">En uso</SelectItem>
                  <SelectItem value="baja" className="text-xs">Dado de baja</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {form.valor_residual > form.valor_compra && (
            <p className="text-[11px] text-destructive">El valor residual no puede ser mayor al valor de compra.</p>
          )}
          <Button className="w-full" disabled={!form.nombre.trim() || form.valor_compra <= 0 || form.valor_residual > form.valor_compra}
            onClick={() => { onSave({ ...form, id }); onOpenChange(false); }}>
            {id ? 'Guardar cambios' : 'Agregar activo'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ActivosFijos() {
  const { data, isLoading, save, remove } = useFixedAssets();
  const { canEdit } = usePermissions();
  const editable = canEdit('activos_fijos');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FixedAssetWithDep | null>(null);

  const openNew = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (a: FixedAssetWithDep) => { setEditing(a); setModalOpen(true); };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center"><Building2 className="h-5 w-5 text-primary" /></div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Activos fijos</h1>
              <p className="text-sm text-muted-foreground">Maquinaria, vehículos y equipo con depreciación. Alimentan el Balance General.</p>
            </div>
          </div>
          {editable && <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" /> Nuevo activo</Button>}
        </div>

        {isLoading || !data ? (
          <div className="text-center py-12 text-muted-foreground text-sm">Cargando…</div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-[11px] text-muted-foreground">Valor de compra</p><p className="text-lg font-bold tabular-nums mt-1">{fmt(data.totalCompra)}</p></CardContent></Card>
              <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-[11px] text-muted-foreground">Depreciación acumulada</p><p className="text-lg font-bold tabular-nums mt-1 text-muted-foreground">{fmt(data.totalDepAcumulada)}</p></CardContent></Card>
              <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-[11px] text-muted-foreground">Valor en libros</p><p className="text-lg font-bold tabular-nums mt-1 text-primary">{fmt(data.totalEnLibros)}</p></CardContent></Card>
              <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-[11px] text-muted-foreground">Depreciación del año</p><p className="text-lg font-bold tabular-nums mt-1">{fmt(data.totalDepAnio)}</p></CardContent></Card>
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Activos ({data.assets.length})</CardTitle></CardHeader>
              <CardContent className="p-0">
                {data.assets.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-10">
                    Sin activos cargados. {editable ? 'Agregá tu maquinaria, vehículos y equipo para que aparezcan en el balance.' : ''}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/60">
                          <TableHead className="text-xs">Activo</TableHead>
                          <TableHead className="text-xs">Compra</TableHead>
                          <TableHead className="text-xs text-right">Valor compra</TableHead>
                          <TableHead className="text-xs text-right">Dep. acum.</TableHead>
                          <TableHead className="text-xs text-right">Valor en libros</TableHead>
                          <TableHead className="w-8" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.assets.map((a) => (
                          <TableRow key={a.id} className={a.activo ? '' : 'opacity-50'}>
                            <TableCell className="text-sm py-2">
                              {a.nombre}
                              <span className="block text-[10px] text-muted-foreground">
                                {CATEGORY_LABEL[a.categoria]}{!a.activo && ' · dado de baja'}{a.dep.totalmenteDepreciado && a.activo && ' · totalmente depreciado'}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs py-2">{a.fecha_compra ? format(parseLocalDate(a.fecha_compra), 'dd MMM yyyy', { locale: es }) : '—'}</TableCell>
                            <TableCell className="text-sm text-right font-mono py-2">{fmt(a.valor_compra)}</TableCell>
                            <TableCell className="text-sm text-right font-mono py-2 text-muted-foreground">{fmt(a.dep.depAcumulada)}</TableCell>
                            <TableCell className="text-sm text-right font-mono py-2 font-semibold">{fmt(a.dep.valorEnLibros)}</TableCell>
                            <TableCell className="py-1">
                              {editable && (
                                <div className="flex gap-0.5">
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(a)}><Pencil className="h-3.5 w-3.5" /></Button>
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    onClick={() => { if (window.confirm(`¿Eliminar "${a.nombre}"?`)) remove.mutate(a.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Depreciación lineal: (valor − residual) ÷ vida útil. El valor en libros suma al rubro "Activos fijos" del Balance General. La depreciación del año es un gasto deducible — pasásela a tu contador (la app no la postea sola al Estado de Resultados).
            </p>
          </>
        )}
      </div>
      <AssetModal open={modalOpen} onOpenChange={setModalOpen} editing={editing} onSave={(a) => save.mutate(a)} />
    </AppLayout>
  );
}
