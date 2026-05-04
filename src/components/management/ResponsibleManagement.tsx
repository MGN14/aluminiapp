import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Responsible } from '@/types/transaction';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Settings, EyeOff, Loader2, Link2, GitMerge, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Props {
  onUpdate?: () => void;
}

const NO_LINK = '__none__';

export default function ResponsibleManagement({ onUpdate }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [responsibles, setResponsibles] = useState<Responsible[]>([]);
  const [aliasesByResp, setAliasesByResp] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [linkToResponsibleId, setLinkToResponsibleId] = useState<string>(NO_LINK);
  const [adding, setAdding] = useState(false);
  const [mergingFrom, setMergingFrom] = useState<Responsible | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string>('');
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    if (open) fetchResponsibles();
  }, [open]);

  const fetchResponsibles = async () => {
    setLoading(true);
    const [respRes, aliasRes] = await Promise.all([
      supabase.from('responsibles').select('*').order('name'),
      supabase.from('responsible_aliases' as never).select('responsible_id, alias') as any,
    ]);
    setResponsibles((respRes.data as Responsible[]) || []);
    const map = new Map<string, string[]>();
    for (const a of (aliasRes.data ?? []) as Array<{ responsible_id: string; alias: string }>) {
      const arr = map.get(a.responsible_id) ?? [];
      arr.push(a.alias);
      map.set(a.responsible_id, arr);
    }
    setAliasesByResp(map);
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!newName.trim() || !user) return;
    setAdding(true);

    try {
      if (linkToResponsibleId !== NO_LINK) {
        // Modo "alias de un beneficiario existente":
        // crea una entrada en responsible_aliases en vez de un nuevo responsible.
        const { error } = await supabase
          .from('responsible_aliases' as never)
          .insert({
            user_id: user.id,
            responsible_id: linkToResponsibleId,
            alias: newName.trim(),
            source: 'manual',
          } as never);
        if (error) {
          toast({
            title: 'Error',
            description: error.message?.includes('duplicate')
              ? 'Ya existe un alias con ese nombre.'
              : 'No se pudo crear el alias.',
            variant: 'destructive',
          });
        } else {
          const target = responsibles.find(r => r.id === linkToResponsibleId);
          toast({
            title: 'Alias creado',
            description: `"${newName.trim()}" ahora es el mismo beneficiario que "${target?.name ?? ''}".`,
          });
          setNewName('');
          setLinkToResponsibleId(NO_LINK);
          fetchResponsibles();
          onUpdate?.();
        }
      } else {
        // Modo "nuevo beneficiario": crea un responsible nuevo.
        const { data, error } = await supabase
          .from('responsibles')
          .insert({ user_id: user.id, name: newName.trim() })
          .select('id')
          .single();
        if (error) {
          toast({ title: 'Error', description: 'No se pudo crear el beneficiario.', variant: 'destructive' });
        } else if (data) {
          // Crear alias canónico (= nombre) para que matching futuro lo encuentre
          await supabase
            .from('responsible_aliases' as never)
            .insert({
              user_id: user.id,
              responsible_id: data.id,
              alias: newName.trim(),
              source: 'manual',
            } as never);
          setNewName('');
          fetchResponsibles();
          onUpdate?.();
        }
      }
    } finally {
      setAdding(false);
    }
  };

  const handleToggleActive = async (id: string, active: boolean) => {
    await supabase.from('responsibles').update({ active }).eq('id', id);
    fetchResponsibles();
    onUpdate?.();
  };

  // Soft delete: NO borra el responsible, solo lo desactiva (active=false).
  // El usuario puede reactivarlo después con el switch. Esto evita perder
  // datos por click accidental — borrar permanentemente requiere SQL.
  const handleDelete = async (id: string) => {
    const target = responsibles.find(r => r.id === id);
    const { error } = await supabase
      .from('responsibles')
      .update({ active: false })
      .eq('id', id);
    if (error) {
      console.error('Soft delete responsible error:', error);
      toast({
        title: 'No se pudo desactivar',
        description: error.message || 'Error desconocido.',
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Sacado de la lista activa',
        description: `"${target?.name ?? 'El beneficiario'}" sigue en la base, pero no aparecerá en selectores. Reactivalo con el switch cuando quieras.`,
      });
      fetchResponsibles();
      onUpdate?.();
    }
  };

  const handleMerge = async () => {
    if (!mergingFrom || !mergeTargetId || mergeTargetId === mergingFrom.id) return;
    setMerging(true);
    try {
      const { error } = await supabase.rpc(
        'merge_responsibles' as never,
        { p_legacy_id: mergingFrom.id, p_canonical_id: mergeTargetId } as never,
      );
      if (error) {
        toast({ title: 'Error al vincular', description: error.message, variant: 'destructive' });
        return;
      }
      const target = responsibles.find(r => r.id === mergeTargetId);
      toast({
        title: 'Beneficiario absorbido',
        description: `"${mergingFrom.name}" ahora es alias de "${target?.name ?? ''}". Todas sus referencias fueron reasignadas.`,
      });
      setMergingFrom(null);
      setMergeTargetId('');
      fetchResponsibles();
      onUpdate?.();
    } finally {
      setMerging(false);
    }
  };

  const handleDeleteAlias = async (alias: string) => {
    if (!user) return;
    if (!confirm(`¿Eliminar el alias "${alias}"?`)) return;
    const { error } = await supabase
      .from('responsible_aliases' as never)
      .delete()
      .eq('alias', alias);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      fetchResponsibles();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-xs">
          <Settings className="h-3 w-3 mr-1" />
          Gestionar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>A quién le pagas</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Form: nuevo beneficiario o nuevo alias */}
          <div className="space-y-2 p-3 rounded-lg border border-border bg-muted/30">
            <div className="space-y-1.5">
              <Label className="text-xs">Nombre</Label>
              <Input
                placeholder="Ej: ALUMINIOS DEL EJE"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !adding && handleAdd()}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">¿Es alias de un beneficiario existente? (opcional)</Label>
              <Select value={linkToResponsibleId} onValueChange={setLinkToResponsibleId}>
                <SelectTrigger>
                  <SelectValue placeholder="No, crear como nuevo beneficiario" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LINK}>No, crear como nuevo beneficiario</SelectItem>
                  {responsibles.filter(r => r.active).map(r => (
                    <SelectItem key={r.id} value={r.id}>
                      <span className="flex items-center gap-1.5">
                        <Link2 className="h-3 w-3" />
                        Es el mismo que: {r.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Útil cuando un mismo cliente aparece con nombres distintos en facturas o en banco.
              </p>
            </div>
            <Button onClick={handleAdd} disabled={adding || !newName.trim()} className="w-full" size="sm">
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                <>
                  <Plus className="h-4 w-4 mr-1.5" />
                  {linkToResponsibleId !== NO_LINK ? 'Agregar alias' : 'Crear beneficiario'}
                </>
              )}
            </Button>
          </div>

          {/* Lista de beneficiarios + sus aliases */}
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {responsibles.map((r) => {
                const aliases = (aliasesByResp.get(r.id) ?? []).filter(a => a.toLowerCase() !== r.name.toLowerCase());
                return (
                  <div key={r.id} className="rounded-lg border border-border">
                    <div className="flex items-center justify-between p-2">
                      <span className={`text-sm ${!r.active ? 'text-muted-foreground line-through' : ''}`}>
                        {r.name}
                      </span>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={r.active}
                          onCheckedChange={(checked) => handleToggleActive(r.id, checked)}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setMergingFrom(r); setMergeTargetId(''); }}
                          title="Vincular como alias de otro beneficiario (absorber)"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <GitMerge className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(r.id)}
                          title="Sacar de la lista activa (no se elimina, solo se desactiva)"
                          className="text-muted-foreground hover:text-foreground"
                          disabled={!r.active}
                        >
                          <EyeOff className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {aliases.length > 0 && (
                      <div className="px-2 pb-2 flex flex-wrap gap-1">
                        {aliases.map(a => (
                          <span key={a} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-muted border border-border">
                            <Link2 className="h-2.5 w-2.5 text-muted-foreground" />
                            {a}
                            <button
                              type="button"
                              onClick={() => handleDeleteAlias(a)}
                              className="text-muted-foreground hover:text-destructive ml-0.5"
                              title="Eliminar este alias"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {responsibles.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-4">
                  No hay beneficiarios creados
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>

      <AlertDialog open={!!mergingFrom} onOpenChange={(o) => { if (!o) { setMergingFrom(null); setMergeTargetId(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Vincular como alias de otro beneficiario</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <div className="text-sm">
                  Vas a absorber <strong>"{mergingFrom?.name}"</strong> dentro de otro beneficiario.
                  Todas sus facturas, transacciones, deudas, pagos y aliases se reasignarán al
                  beneficiario que elijas, y este nombre quedará como un alias del otro.
                </div>
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 flex gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-900 dark:text-amber-100">
                    Esta acción no se puede deshacer fácilmente. El beneficiario original se borra
                    al final.
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="merge-target">Vincular dentro de:</Label>
                  <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
                    <SelectTrigger id="merge-target">
                      <SelectValue placeholder="Seleccioná el beneficiario canónico" />
                    </SelectTrigger>
                    <SelectContent>
                      {responsibles
                        .filter(r => r.id !== mergingFrom?.id && r.active)
                        .map(r => (
                          <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={merging}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleMerge} disabled={merging || !mergeTargetId}>
              {merging && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Vincular y absorber
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
