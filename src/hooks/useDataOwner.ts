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
        const { data, error } = await supabase
          .from('collaborators')
          .select('owner_user_id')
          .eq('collaborator_user_id', user.id)
          .eq('status', 'active')
          .maybeSingle();

        if (error) throw error;

        if (!cancelled) {
          if (data?.owner_user_id) {
            setDataOwnerId(data.owner_user_id);
            setIsCollaborator(true);
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
