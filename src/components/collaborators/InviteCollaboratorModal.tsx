import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MODULE_KEYS, MODULE_GROUP_LABELS, type ModuleKey, type AccessLevel, type ModuleGroup } from '@/hooks/useCollaborators';
import { Loader2, Eye, EyeOff, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';

const ACCESS_LABELS: Record<AccessLevel, string> = {
  none: 'Sin acceso',
  view: 'Solo ver',
  edit: 'Editar',
};

const GROUP_ORDER: ModuleGroup[] = ['general', 'documentos', 'movimientos', 'reportes', 'ia'];

const PRESETS: Record<string, { label: string; description: string; build: () => Record<ModuleKey, AccessLevel> }> = {
  view_all: {
    label: 'Solo lectura',
    description: 'Ve todo, no puede modificar',
    build: () => Object.fromEntries(MODULE_KEYS.map(m => [m.key, 'view'])) as Record<ModuleKey, AccessLevel>,
  },
  contadora: {
    label: 'Contadora',
    description: 'Puede subir/editar facturas y extractos, ver reportes',
    build: () => {
      const editKeys: ModuleKey[] = ['extractos', 'facturas_venta', 'facturas_compra', 'conciliacion'];
      const viewKeys: ModuleKey[] = ['dashboard', 'caja_menor', 'estado_resultados', 'anticipos', 'cuentas_por_cobrar', 'cuentas_por_pagar', 'flujo_caja', 'relacion_pagos', 'informe_dian', 'exportar', 'nico_ia'];
      const result = Object.fromEntries(MODULE_KEYS.map(m => [m.key, 'none'])) as Record<ModuleKey, AccessLevel>;
      editKeys.forEach(k => { result[k] = 'edit'; });
      viewKeys.forEach(k => { result[k] = 'view'; });
      return result;
    },
  },
  ventas: {
    label: 'Ventas',
    description: 'Ve facturas/inventario/remisiones, edita remisiones',
    build: () => {
      const editKeys: ModuleKey[] = ['remisiones', 'facturas_venta'];
      const viewKeys: ModuleKey[] = ['dashboard', 'inventarios', 'nico_ia'];
      const result = Object.fromEntries(MODULE_KEYS.map(m => [m.key, 'none'])) as Record<ModuleKey, AccessLevel>;
      editKeys.forEach(k => { result[k] = 'edit'; });
      viewKeys.forEach(k => { result[k] = 'view'; });
      return result;
    },
  },
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvite: (email: string, name: string, role: 'contadora' | 'colaborador', permissions: Record<ModuleKey, AccessLevel>) => Promise<boolean>;
  hasRoleAvailable: (role: 'contadora' | 'colaborador') => boolean;
}

export default function InviteCollaboratorModal({ open, onOpenChange, onInvite, hasRoleAvailable }: Props) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'contadora' | 'colaborador' | ''>('');
  const [permissions, setPermissions] = useState<Record<ModuleKey, AccessLevel>>(
    () => Object.fromEntries(MODULE_KEYS.map(m => [m.key, 'view'])) as Record<ModuleKey, AccessLevel>,
  );
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!email || !name || !role) return;
    setSaving(true);
    const ok = await onInvite(email, name, role, permissions);
    setSaving(false);
    if (ok) {
      setEmail('');
      setName('');
      setRole('');
      setPermissions(Object.fromEntries(MODULE_KEYS.map(m => [m.key, 'view'])) as Record<ModuleKey, AccessLevel>);
      onOpenChange(false);
    }
  };

  const applyPreset = (presetKey: string) => {
    const preset = PRESETS[presetKey];
    if (preset) setPermissions(preset.build());
  };

  const setAll = (level: AccessLevel) => {
    setPermissions(Object.fromEntries(MODULE_KEYS.map(m => [m.key, level])) as Record<ModuleKey, AccessLevel>);
  };

  const modulesByGroup = MODULE_KEYS.reduce<Record<ModuleGroup, typeof MODULE_KEYS[number][]>>((acc, m) => {
    if (!acc[m.group]) acc[m.group] = [];
    acc[m.group].push(m);
    return acc;
  }, {} as Record<ModuleGroup, typeof MODULE_KEYS[number][]>);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Invitar colaborador</DialogTitle>
          <DialogDescription>Configurá sus datos y los permisos por módulo.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-5 -mx-1 px-1 pr-2">
          {/* Datos básicos */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Nombre</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre completo" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Correo electrónico</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="correo@ejemplo.com" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Rol</Label>
            <Select value={role} onValueChange={(v) => setRole(v as 'contadora' | 'colaborador')}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un rol" />
              </SelectTrigger>
              <SelectContent>
                {hasRoleAvailable('contadora') && <SelectItem value="contadora">Contadora</SelectItem>}
                {hasRoleAvailable('colaborador') && <SelectItem value="colaborador">Colaborador</SelectItem>}
              </SelectContent>
            </Select>
          </div>

          {/* Presets rápidos */}
          <div className="space-y-2">
            <Label className="text-xs">Plantillas rápidas</Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {Object.entries(PRESETS).map(([key, p]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyPreset(key)}
                  className="text-left rounded-md border border-border hover:border-primary/50 hover:bg-muted/40 p-2.5 transition-colors"
                >
                  <p className="text-xs font-medium">{p.label}</p>
                  <p className="text-[10px] text-muted-foreground leading-snug">{p.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Permisos por módulo */}
          <div className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <Label className="text-xs">Permisos por módulo</Label>
              <div className="flex items-center gap-1.5">
                <Button type="button" size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => setAll('none')}>
                  <EyeOff className="h-2.5 w-2.5" />Sin acceso
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => setAll('view')}>
                  <Eye className="h-2.5 w-2.5" />Solo ver
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => setAll('edit')}>
                  <Pencil className="h-2.5 w-2.5" />Editar
                </Button>
              </div>
            </div>

            <div className="rounded-md border bg-muted/10 p-3 grid sm:grid-cols-2 gap-x-5 gap-y-4">
              {GROUP_ORDER.filter((g) => modulesByGroup[g]?.length).map((group) => (
                <div key={group} className="space-y-1.5">
                  <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    {MODULE_GROUP_LABELS[group]}
                  </h4>
                  <div className="space-y-1">
                    {modulesByGroup[group].map((m) => {
                      const level = permissions[m.key];
                      return (
                        <div key={m.key} className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate flex-1">{m.label}</span>
                          <Select
                            value={level}
                            onValueChange={(v) => setPermissions(prev => ({ ...prev, [m.key]: v as AccessLevel }))}
                          >
                            <SelectTrigger
                              className={cn(
                                'h-7 text-xs w-[110px]',
                                level === 'none' && 'text-muted-foreground',
                                level === 'view' && 'text-primary border-primary/30',
                                level === 'edit' && 'text-success border-success/30',
                              )}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">{ACCESS_LABELS.none}</SelectItem>
                              <SelectItem value="view">{ACCESS_LABELS.view}</SelectItem>
                              <SelectItem value="edit">{ACCESS_LABELS.edit}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={saving || !email || !name || !role}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Enviar invitación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
