import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { supabase } from '@/integrations/supabase/client';
import type { ModuleKey, AccessLevel } from '@/hooks/useCollaborators';

type PermissionMap = Record<string, AccessLevel>;

interface UsePermissionsResult {
  isAdmin: boolean;
  loading: boolean;
  hasModule: (key: ModuleKey) => boolean;
  canEdit: (key: ModuleKey) => boolean;
  refetch: () => Promise<void>;
}

/**
 * Hook que expone los permisos del usuario actual sobre los módulos.
 *
 * - Admin / owner: hasModule y canEdit devuelven true para todo (bypass).
 * - Colaborador: lee collaborator_permissions y resuelve por module_key.
 *   - access_level 'view' o 'edit' → hasModule = true
 *   - access_level 'edit' → canEdit = true
 *   - access_level 'none' o sin fila → ambos false
 *
 * Mientras está cargando (loading=true) hasModule y canEdit devuelven false
 * por seguridad — el caller debe respetar el flag loading para no flickear.
 */
export function usePermissions(): UsePermissionsResult {
  const { user } = useAuth();
  const { isAdmin, loading: subLoading } = useSubscription();
  const [perms, setPerms] = useState<PermissionMap | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPerms = useCallback(async () => {
    if (!user) {
      setPerms({});
      setLoading(false);
      return;
    }
    if (isAdmin) {
      // Admin: bypass total. perms=null indica "ver todo".
      setPerms(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data: collab, error: collabErr } = await supabase
        .from('collaborators')
        .select('id')
        .eq('collaborator_user_id', user.id)
        .maybeSingle();

      if (collabErr) throw collabErr;

      if (!collab) {
        // Usuario logueado que no es admin ni colaborador linkeado.
        // Caso raro — sin permisos por defecto.
        setPerms({});
      } else {
        const { data: rows, error: permsErr } = await supabase
          .from('collaborator_permissions')
          .select('module_key, access_level')
          .eq('collaborator_id', collab.id);

        if (permsErr) throw permsErr;

        const map: PermissionMap = {};
        for (const r of rows || []) {
          map[r.module_key] = r.access_level as AccessLevel;
        }
        setPerms(map);
      }
    } catch (e) {
      console.error('[usePermissions] error fetching permissions:', e);
      setPerms({});
    } finally {
      setLoading(false);
    }
  }, [user, isAdmin]);

  useEffect(() => {
    if (subLoading) return;
    void fetchPerms();
  }, [fetchPerms, subLoading]);

  const hasModule = useCallback(
    (key: ModuleKey): boolean => {
      if (perms === null) return true; // admin bypass
      const level = perms[key];
      return level === 'view' || level === 'edit';
    },
    [perms],
  );

  const canEdit = useCallback(
    (key: ModuleKey): boolean => {
      if (perms === null) return true; // admin bypass
      return perms[key] === 'edit';
    },
    [perms],
  );

  return {
    isAdmin,
    loading: loading || subLoading,
    hasModule,
    canEdit,
    refetch: fetchPerms,
  };
}
