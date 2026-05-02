import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

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
  const { user } = useAuth();
  const [shouldShow, setShouldShow] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!user?.id) {
        if (!cancelled) {
          setShouldShow(false);
          setLoading(false);
        }
        return;
      }

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
  }, [user?.id, user?.created_at]);

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
