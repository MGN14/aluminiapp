import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Hook para trackear eventos de producto en app_events.
 *
 * Uso:
 *   const track = useTrackEvent();
 *   track('statement_uploaded', { source: 'pdf', period: 'weekly' });
 *
 * El hook hace fire-and-forget: no bloquea, no retorna promise.
 * Si el insert falla, solo loggea — un evento perdido no rompe UX.
 *
 * Auto-incluye: pathname actual.
 */
export function useTrackEvent() {
  const { user } = useAuth();
  const location = useLocation();

  return useCallback((eventType: string, props: Record<string, unknown> = {}) => {
    if (!user?.id) return;
    void (async () => {
      try {
        await supabase.from('app_events' as never).insert({
          user_id: user.id,
          event_type: eventType,
          props: { ...props, pathname: location.pathname },
        } as never);
      } catch (err) {
        console.debug('[track] insert failed:', err);
      }
    })();
  }, [user?.id, location.pathname]);
}

/**
 * Auto-dispara `page_view` cada vez que cambia la ruta. Montar UNA sola
 * vez en el layout/App.tsx.
 *
 * Skipea el primer render del path inicial si el user todavía no está
 * cargado, y evita disparar el mismo path dos veces seguidas (Strict Mode).
 */
export function usePageViewTracking() {
  const { user } = useAuth();
  const location = useLocation();
  const lastTrackedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    const fullPath = location.pathname + location.search;
    if (lastTrackedRef.current === fullPath) return;
    lastTrackedRef.current = fullPath;

    void supabase
      .from('app_events' as never)
      .insert({
        user_id: user.id,
        event_type: 'page_view',
        props: { pathname: location.pathname, search: location.search || null },
      } as never)
      .then(({ error }) => {
        if (error) console.debug('[page_view] insert failed:', error);
      });
  }, [user?.id, location.pathname, location.search]);
}
