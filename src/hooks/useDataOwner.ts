import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

/**
 * Devuelve el `user_id` con el que se deben filtrar/insertar los datos de
 * empresa. Para un owner es su propio auth.uid(). Para un colaborador
 * activo es el `owner_user_id` de la cuenta que lo invitó.
 *
 * Usar en queries del frontend que filtran por user_id en tablas categoría A
 * (invoices, transactions, petty_cash_movements, inventory_*, cash_movements,
 * remisiones, credits, etc.).
 *
 * El backend tiene defensa en profundidad: la función SQL
 * `public.current_data_owner()` y un trigger BEFORE INSERT que reescribe
 * NEW.user_id. Aunque el frontend mande user_id incorrecto, el RLS lo
 * rechaza y el trigger lo corrige. Pero filtrar en frontend con el id
 * correcto evita queries vacías y mejora UX.
 *
 * Mientras loading=true, dataOwnerId es null. Los hooks consumidores
 * deben respetar ese estado para no disparar queries con id incorrecto.
 */
export function useDataOwner() {
  const { user, loading: authLoading } = useAuth();
  const [dataOwnerId, setDataOwnerId] = useState<string | null>(null);
  const [isCollaborator, setIsCollaborator] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setDataOwnerId(null);
      setIsCollaborator(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        // Aceptamos active O pending. Misma allowlist que current_data_owner()
        // SQL. Antes solo aceptaba active y por eso useDataOwner reportaba
        // isCollaborator=false para colabs recién aceptados (la fila queda
        // 'pending' hasta que mark_collaborator_active la promueve), causando
        // que el frontend les pidiera datos con user.id propio en vez del
        // owner — UI vacía y el lado del owner los seguía viendo 'pending'.
        const { data, error } = await supabase
          .from('collaborators')
          .select('owner_user_id, status')
          .eq('collaborator_user_id', user.id)
          .in('status', ['active', 'pending'])
          .order('status', { ascending: true }) // active < pending alfabéticamente
          .limit(1)
          .maybeSingle();

        if (error) throw error;

        if (!cancelled) {
          if (data?.owner_user_id) {
            setDataOwnerId(data.owner_user_id);
            setIsCollaborator(true);

            // Si la fila quedó en 'pending' pero el usuario ya está autenticado
            // y operando, promover a 'active' automáticamente. Idempotente:
            // si ya está active, el RPC no hace nada. Esto resuelve casos
            // donde mark_collaborator_active no se llamó en su momento (p.ej.
            // setup completado antes de que existiera el RPC).
            if (data.status === 'pending') {
              try {
                await supabase.rpc('mark_collaborator_active' as never);
              } catch (rpcErr) {
                // No bloqueante — la app ya funciona con pending tras la
                // migración 20260515120000. Solo cosmético en el listado del
                // owner que la sigue viendo "pendiente".
                console.warn('[useDataOwner] mark_collaborator_active failed', rpcErr);
              }
            }
          } else {
            setDataOwnerId(user.id);
            setIsCollaborator(false);
          }
        }
      } catch (e) {
        console.error('[useDataOwner] error resolving data owner:', e);
        // Fallback seguro: usar user.id propio. Si es realmente colaborador,
        // el RLS de igual modo no le devolverá filas — pero al menos no rompe.
        if (!cancelled) {
          setDataOwnerId(user.id);
          setIsCollaborator(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  return { dataOwnerId, isCollaborator, loading };
}
