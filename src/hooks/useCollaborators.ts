import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { invokeFunctionWithAuthRetry } from '@/lib/authRetry';

export type ModuleGroup = 'general' | 'documentos' | 'movimientos' | 'reportes' | 'ia';

export const MODULE_KEYS = [
  // General
  { key: 'dashboard', label: 'Dashboard', group: 'general' as ModuleGroup, description: 'Pantalla principal con KPIs' },
  // Documentos
  { key: 'extractos', label: 'Extractos Bancarios', group: 'documentos' as ModuleGroup, description: 'Subir y revisar extractos del banco' },
  { key: 'facturas_venta', label: 'Facturas de Venta', group: 'documentos' as ModuleGroup, description: 'Facturas emitidas a clientes' },
  { key: 'facturas_compra', label: 'Facturas de Compra', group: 'documentos' as ModuleGroup, description: 'Facturas recibidas de proveedores' },
  // Movimientos
  { key: 'conciliacion', label: 'Conciliación bancaria', group: 'movimientos' as ModuleGroup, description: 'Vincular pagos con facturas' },
  { key: 'caja_menor', label: 'Caja Menor', group: 'movimientos' as ModuleGroup, description: 'Gastos en efectivo y cuentas de cobro' },
  { key: 'inventarios', label: 'Inventarios', group: 'movimientos' as ModuleGroup, description: 'Productos, stock y movimientos' },
  { key: 'remisiones', label: 'Remisiones', group: 'movimientos' as ModuleGroup, description: 'Notas de despacho a clientes' },
  { key: 'creditos', label: 'Créditos', group: 'movimientos' as ModuleGroup, description: 'Préstamos bancarios y amortización' },
  // Reportes
  { key: 'reportes', label: 'Reportes', group: 'reportes' as ModuleGroup, description: 'PYG, anticipos, lo que me deben/debo, flujo de caja' },
  { key: 'informe_dian', label: 'Visita / Informe DIAN', group: 'reportes' as ModuleGroup, description: 'Calendario tributario y informe de cumplimiento' },
  { key: 'informe_banco', label: 'Informe para Banco', group: 'reportes' as ModuleGroup, description: 'Reporte para solicitar crédito' },
  { key: 'exportar', label: 'Exportar', group: 'reportes' as ModuleGroup, description: 'Descargar datos a Excel/PDF' },
  // IA
  { key: 'nico_ia', label: 'Nico IA', group: 'ia' as ModuleGroup, description: 'Asistente conversacional' },
] as const;

export const MODULE_GROUP_LABELS: Record<ModuleGroup, string> = {
  general: 'General',
  documentos: 'Documentos',
  movimientos: 'Movimientos',
  reportes: 'Reportes & Análisis',
  ia: 'Asistente IA',
};

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
  caja_menor: 'none',
  inventarios: 'none',
  remisiones: 'none',
  creditos: 'none',
  reportes: 'none',
  informe_dian: 'none',
  informe_banco: 'none',
  exportar: 'none',
  nico_ia: 'view',
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

      // Bulk fetch de permisos (1 query) en lugar de N queries (uno por colaborador).
      const collaboratorIds = (collabs || []).map(c => c.id);
      let permsAll: { collaborator_id: string; module_key: string; access_level: string }[] = [];
      if (collaboratorIds.length > 0) {
        const { data: permsData, error: permsErr } = await supabase
          .from('collaborator_permissions')
          .select('collaborator_id, module_key, access_level')
          .in('collaborator_id', collaboratorIds);
        if (permsErr) throw permsErr;
        permsAll = permsData || [];
      }

      const withPerms: Collaborator[] = (collabs || []).map(c => {
        const myPerms = permsAll.filter(p => p.collaborator_id === c.id);
        const permissions = { ...DEFAULT_PERMISSIONS };
        for (const p of myPerms) {
          if (p.module_key in permissions) {
            permissions[p.module_key as ModuleKey] = p.access_level as AccessLevel;
          }
        }
        return { ...c, permissions } as Collaborator;
      });
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
      // upsert para soportar module_keys que aún no tienen fila (nuevos módulos)
      const { error } = await supabase
        .from('collaborator_permissions')
        .upsert(
          { collaborator_id: collaboratorId, module_key: moduleKey, access_level: level },
          { onConflict: 'collaborator_id,module_key' },
        );

      if (error) throw error;
      await fetchCollaborators();
    } catch {
      toast({ title: 'Error', description: 'No se pudo actualizar el permiso.', variant: 'destructive' });
    }
  };

  const updateAllPermissions = async (collaboratorId: string, level: AccessLevel) => {
    try {
      const rows = MODULE_KEYS.map((m) => ({
        collaborator_id: collaboratorId,
        module_key: m.key,
        access_level: level,
      }));
      const { error } = await supabase
        .from('collaborator_permissions')
        .upsert(rows, { onConflict: 'collaborator_id,module_key' });

      if (error) throw error;
      await fetchCollaborators();
    } catch {
      toast({ title: 'Error', description: 'No se pudieron actualizar los permisos.', variant: 'destructive' });
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
    updateAllPermissions,
    deleteCollaborator,
    canInvite,
    hasRoleAvailable,
    refetch: fetchCollaborators,
  };
}
