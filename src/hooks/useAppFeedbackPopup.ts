import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

// Cache module-level: el AppFeedbackPopupHost vive dentro de AppLayout y se
// remonta en cada navegación. Sin este cache, la query a app_feedback se
// dispara en cada cambio de página. El cache es por user.id (si cambia el
// user, se re-evalúa).
const checkedUsers = new Set<string>();

const MIN_DAYS_USING_APP = 7;
const DAYS_BETWEEN_PROMPTS = 30;

interface PopupState {
  shouldShow: boolean;
  loading: boolean;
}

/**
 * Decide si mostrar el modal de encuesta mensual de la app.
 * Muestra si:
 *   - El user tiene >7 días desde su signup (no acosamos a recién llegados)
 *   - No respondió la encuesta en los últimos 30 días
 *   - No clickeó "Más tarde" recientemente (postpone vigente)
 */
export function useAppFeedbackPopup(): PopupState & {
  dismissForNow: () => Promise<void>;
  markSubmitted: () => void;
} {
  const { user, session, sessionExpired } = useAuth();
  const [shouldShow, setShouldShow] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      // Triple guard: requerimos user, session activa y NO expirada antes de
      // tocar Supabase. Sin esto, en un re-mount muy temprano de AppLayout
      // (o durante refresh de token) el cliente puede mandar la query SIN
      // bearer token → la RLS evalúa auth.uid()=NULL y devuelve 403.
      if (!user?.id || !session?.access_token || sessionExpired) {
        if (!cancelled) {
          setShouldShow(false);
          setLoading(false);
        }
        return;
      }
      // Si ya chequeamos este user en esta sesión de browser, no repetir
      // (evita 3+ queries en cada navegación de páginas con AppLayout).
      if (checkedUsers.has(user.id)) {
        if (!cancelled) {
          setShouldShow(false);
          setLoading(false);
        }
        return;
      }
      checkedUsers.add(user.id);

      // 1. Días de uso: usamos created_at del user de auth como proxy
      const createdAt = new Date(user.created_at);
      const daysSinceSignup = (Date.now() - createdAt.getTime()) / 86_400_000;
      if (daysSinceSignup < MIN_DAYS_USING_APP) {
        if (!cancelled) {
          setShouldShow(false);
          setLoading(false);
        }
        return;
      }

      // 2. Última encuesta + postpone — en paralelo
      const [lastFeedbackRes, postponeRes] = await Promise.all([
        supabase
          .from('app_feedback' as never)
          .select('submitted_at')
          .eq('user_id', user.id)
          .order('submitted_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('app_feedback_postponed' as never)
          .select('postponed_until')
          .eq('user_id', user.id)
          .maybeSingle(),
      ]);

      const lastSubmittedAt = (lastFeedbackRes.data as { submitted_at?: string } | null)?.submitted_at;
      if (lastSubmittedAt) {
        const daysSinceLast = (Date.now() - new Date(lastSubmittedAt).getTime()) / 86_400_000;
        if (daysSinceLast < DAYS_BETWEEN_PROMPTS) {
          if (!cancelled) {
            setShouldShow(false);
            setLoading(false);
          }
          return;
        }
      }

      const postponedUntil = (postponeRes.data as { postponed_until?: string } | null)?.postponed_until;
      if (postponedUntil && new Date(postponedUntil).getTime() > Date.now()) {
        if (!cancelled) {
          setShouldShow(false);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setShouldShow(true);
        setLoading(false);
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.created_at, session?.access_token, sessionExpired]);

  const dismissForNow = async () => {
    if (!user?.id) return;
    setShouldShow(false);
    const postponedUntil = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await supabase
      .from('app_feedback_postponed' as never)
      .upsert(
        { user_id: user.id, postponed_until: postponedUntil, updated_at: new Date().toISOString() } as never,
        { onConflict: 'user_id' } as never,
      );
  };

  const markSubmitted = () => setShouldShow(false);

  return { shouldShow, loading, dismissForNow, markSubmitted };
}
