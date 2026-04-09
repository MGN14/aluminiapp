import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { invokeFunctionWithAuthRetry } from '@/lib/authRetry';

export const MODULE_KEYS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'extractos', label: 'Extractos Bancarios' },
  { key: 'facturas_venta', label: 'Facturas de Venta' },
  { key: 'facturas_compra', label: 'Facturas de Compra' },
  { key: 'conciliacion', label: 'Conciliación Bancaria' },
  { key: 'inventarios', label: 'Inventarios' },
  { key: 'reportes', label: 'Reportes' },
  { key: 'exportar', label: 'Exportar' },
] as const;

export type ModuleKey = typeof MODULE_KEYS[number]['key'];
export type AccessLevel = 'none' | 'view' | 'edit';

export interface Collaborator {
  id: string;
  owner_user_id: string;
  collaborator_email: string;
  collaborator_user_id: string | null;
  role: 'contadora' | 'colaborador';
  name: string;
  status: string;
  invited_at: string;
  permissions: Record<ModuleKey, AccessLevel>;
}

const DEFAULT_PERMISSIONS: Record<ModuleKey, AccessLevel> = {
  dashboard: 'view',
  extractos: 'none',
  facturas_venta: 'none',
  facturas_compra: 'none',
  conciliacion: 'none',
  inventarios: 'none',
  reportes: 'none',
  exportar: 'none',
};

export function useCollaborators() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCollaborators = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: collabs, error } = await supabase
        .from('collaborators')
        .select('*')
        .eq('owner_user_id', user.id)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const withPerms: Collaborator[] = [];
      for (const c of collabs || []) {
        const { data: perms } = await supabase
          .from('collaborator_permissions')
          .select('module_key, access_level')
          .eq('collaborator_id', c.id);

        const permissions = { ...DEFAULT_PERMISSIONS };
        for (const p of perms || []) {
          if (p.module_key in permissions) {
            permissions[p.module_key as ModuleKey] = p.access_level as AccessLevel;
          }
        }
        withPerms.push({ ...c, permissions } as Collaborator);
      }
      setCollaborators(withPerms);
    } catch (e) {
      console.error('Error fetching collaborators:', e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchCollaborators(); }, [fetchCollaborators]);

  const inviteCollaborator = async (
    email: string,
    name: string,
    role: 'contadora' | 'colaborador',
    permissions: Record<ModuleKey, AccessLevel>
  ) => {
    if (!user) return false;

    // Check role uniqueness client-side for fast feedback
    const existingWithRole = collaborators.find(c => c.role === role);
    if (existingWithRole) {
      toast({ title: 'Error', description: `Ya existe un usuario con el rol "${role}".`, variant: 'destructive' });
      return false;
    }

    try {
      const { data, error } = await invokeFunctionWithAuthRetry<{ success: boolean; error?: string }>(
        'invite-collaborator',
        {
          body: { email, name, role, permissions },
        },
        'invite-collaborator'
      );

      if (error || !data?.success) {
        const msg = (data as any)?.error || (error as any)?.message || 'No se pudo enviar la invitación.';
        toast({ title: 'Error', description: msg, variant: 'destructive' });
        return false;
      }

      toast({ title: 'Invitación enviada', description: `Se invitó a ${email} como ${role}. Recibirá un correo para aceptar.` });
      await fetchCollaborators();
      return true;
    } catch (e: any) {
      toast({ title: 'Error', description: 'No se pudo enviar la invitación.', variant: 'destructive' });
      return false;
    }
  };

  const updatePermission = async (collaboratorId: string, moduleKey: ModuleKey, level: AccessLevel) => {
    try {
      const { error } = await supabase
        .from('collaborator_permissions')
        .update({ access_level: level })
        .eq('collaborator_id', collaboratorId)
        .eq('module_key', moduleKey);

      if (error) throw error;
      await fetchCollaborators();
    } catch {
      toast({ title: 'Error', description: 'No se pudo actualizar el permiso.', variant: 'destructive' });
    }
  };

  const deleteCollaborator = async (collaboratorId: string) => {
    try {
      const { error } = await supabase
        .from('collaborators')
        .delete()
        .eq('id', collaboratorId);

      if (error) throw error;
      toast({ title: 'Colaborador eliminado' });
      await fetchCollaborators();
    } catch {
      toast({ title: 'Error', description: 'No se pudo eliminar el colaborador.', variant: 'destructive' });
    }
  };

  const canInvite = collaborators.length < 2;
  const hasRoleAvailable = (role: 'contadora' | 'colaborador') => !collaborators.some(c => c.role === role);

  return {
    collaborators,
    loading,
    inviteCollaborator,
    updatePermission,
    deleteCollaborator,
    canInvite,
    hasRoleAvailable,
    refetch: fetchCollaborators,
  };
}
