import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MODULE_KEYS, type ModuleKey, type AccessLevel } from '@/hooks/useCollaborators';
import { Loader2 } from 'lucide-react';

const ACCESS_LABELS: Record<AccessLevel, string> = {
  none: 'Sin acceso',
  view: 'Solo ver',
  edit: 'Editar',
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
    Object.fromEntries(MODULE_KEYS.map(m => [m.key, 'view'])) as Record<ModuleKey, AccessLevel>
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Invitar colaborador</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nombre</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre completo" />
            </div>
            <div className="space-y-1.5">
              <Label>Correo electrónico</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="correo@ejemplo.com" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Rol</Label>
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

          <div className="space-y-2">
            <Label>Permisos por módulo</Label>
            <div className="border rounded-md divide-y">
              {MODULE_KEYS.map(m => (
                <div key={m.key} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm">{m.label}</span>
                  <Select
                    value={permissions[m.key]}
                    onValueChange={(v) => setPermissions(prev => ({ ...prev, [m.key]: v as AccessLevel }))}
                  >
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{ACCESS_LABELS.none}</SelectItem>
                      <SelectItem value="view">{ACCESS_LABELS.view}</SelectItem>
                      <SelectItem value="edit">{ACCESS_LABELS.edit}</SelectItem>
                    </SelectContent>
                  </Select>
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
