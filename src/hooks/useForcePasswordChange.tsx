import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface ForcePasswordChangeState {
  /** Whether we are still resolving the flag. Consumers should wait before routing. */
  loading: boolean;
  /** True when profiles.force_password_change is true for the current user. */
  required: boolean;
  /** Force a refetch — use after the user completes the flow. */
  refresh: () => Promise<void>;
}

/**
 * Reads `public.profiles.force_password_change` for the current user.
 * Returns a flag the router uses to gate protected routes and redirect
 * to /change-password.
 */
export function useForcePasswordChange(): ForcePasswordChangeState {
  const { user, loading: authLoading } = useAuth();
  const [required, setRequired] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchFlag = async (userId: string) => {
    setLoading(true);
    // Retry una vez si la primera lectura falla — cubre network blips
    // sin caer a la lógica de fail-closed.
    let data: any = null;
    let error: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await supabase
        .from('profiles')
        .select('force_password_change' as never)
        .eq('user_id', userId)
        .maybeSingle();
      data = res.data;
      error = res.error;
      if (!error) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    if (error) {
      // Fail-CLOSED: si después de 2 intentos seguimos sin poder leer el
      // flag, asumimos lo peor y bloqueamos. Caso real: una colaboradora
      // entró a la app sin completar el setup de password porque el query
      // falló transitorio y el fail-open la dejó pasar. Mejor falso
      // positivo (mandarla a /change-password y que pase) que falso
      // negativo (acceso sin password). El componente OAuth-only ya
      // bypasea esto arriba.
      console.error('[force_password_change] fetch error (fail-closed)', error);
      setRequired(true);
    } else {
      setRequired(!!(data as { force_password_change?: boolean } | null)?.force_password_change);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setRequired(false);
      setLoading(false);
      return;
    }

    // OAuth-only users (Google sign-in, etc.) no tienen contraseña — el flag
    // force_password_change los mandaría a un flow de "contraseña actual"
    // que no tiene sentido. Caso real: Yolycale entró con Google, fue borrada
    // y re-invitada; el flag quedó true y la app le pedía contraseña actual
    // que nunca creó. Detectamos provider OAuth-only y saltamos el gate.
    const identities = (user as { identities?: Array<{ provider?: string }> }).identities ?? [];
    const hasEmailIdentity = identities.some((i) => i.provider === 'email');
    if (identities.length > 0 && !hasEmailIdentity) {
      setRequired(false);
      setLoading(false);
      return;
    }

    void fetchFlag(user.id);
  }, [authLoading, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    loading,
    required,
    refresh: async () => {
      if (user?.id) await fetchFlag(user.id);
    },
  };
}
