import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type DIANConnectionStatus = 'pending' | 'connected' | 'error' | 'revoked';

export interface DIANConnection {
  nit: string;
  rl_doc_type: string;
  rl_doc_number: string;
  connection_status: DIANConnectionStatus;
  last_error: string | null;
  last_login_at: string | null;
  last_verification_at: string | null;
  proactive_alerts_enabled: boolean;
  consent_signed_at: string | null;
}

export function useDIANConnection() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['dian-connection', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (cols: string) => {
            eq: (col: string, v: string) => {
              maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
            };
          };
        };
      })
        .from('user_dian_credentials')
        .select(
          'nit, rl_doc_type, rl_doc_number, connection_status, last_error, last_login_at, last_verification_at, proactive_alerts_enabled, consent_signed_at',
        )
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as DIANConnection | null;
    },
  });
}
