import { supabase } from '@/integrations/supabase/client';
import type { FunctionInvokeOptions } from '@supabase/supabase-js';
import { emitSessionExpired } from '@/lib/authSessionEvents';

const isDev = import.meta.env.DEV;

const authLog = (message: string, data?: unknown) => {
  if (isDev) {
    console.log(`[AUTH] ${message}`, data ?? '');
  }
};

const isUnauthorized = (err: unknown) => {
  const anyErr = err as any;
  const status = anyErr?.status ?? anyErr?.context?.status;
  const msg = String(anyErr?.message ?? '').toLowerCase();

  if (status === 401 || status === 403) return true;

  return (
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('unauthorized') ||
    msg.includes('session_not_found') ||
    msg.includes('auth session missing')
  );
};

let refreshInFlight: Promise<string | null> | null = null;

export async function refreshAccessTokenOnce(reason: string): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    authLog('refresh_attempt', { reason });

    const { data, error } = await supabase.auth.refreshSession();

    if (error) {
      authLog('refresh_failed', { reason, message: error.message });
      return null;
    }

    authLog('refresh_success', {
      reason,
      expires_at: data.session?.expires_at,
      user_id: data.session?.user?.id,
    });

    return data.session?.access_token ?? null;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function invokeFunctionWithAuthRetry<T = unknown>(
  functionName: string,
  options: FunctionInvokeOptions = {},
  debugLabel?: string
): Promise<{ data: T | null; error: unknown | null }> {
  const label = debugLabel ?? `invoke:${functionName}`;

  const invoke = async (accessToken?: string) => {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> | undefined),
    };

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    return supabase.functions.invoke(functionName, {
      ...options,
      headers,
    });
  };

  // Attempt 1 with current token (if any)
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  const attempt1 = await invoke(accessToken);
  if (!attempt1.error) return { data: attempt1.data as T, error: null };

  if (!isUnauthorized(attempt1.error)) {
    authLog('invoke_error', { label, error: attempt1.error });
    return { data: null, error: attempt1.error };
  }

  authLog('invoke_unauthorized', { label, error: attempt1.error });

  // Refresh once, then retry
  const refreshedToken = await refreshAccessTokenOnce(label);
  if (!refreshedToken) {
    emitSessionExpired({ reason: `${label}:refresh_failed` });
    return { data: null, error: attempt1.error };
  }

  const attempt2 = await invoke(refreshedToken);
  if (!attempt2.error) return { data: attempt2.data as T, error: null };

  if (isUnauthorized(attempt2.error)) {
    emitSessionExpired({ reason: `${label}:unauthorized_after_retry` });
  }

  authLog('invoke_error_after_retry', { label, error: attempt2.error });
  return { data: null, error: attempt2.error };
}

export async function fetchWithAuthRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  debugLabel = 'fetch'
): Promise<Response> {
  const doFetch = async (accessToken?: string, retried?: boolean) => {
    const headers = new Headers(init.headers);

    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }

    // mark to avoid accidental loops if callers pass our own fetch again
    if (retried) headers.set('x-auth-retry', '1');

    return fetch(input, { ...init, headers });
  };

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  const res1 = await doFetch(accessToken);
  if (res1.status !== 401 && res1.status !== 403) return res1;

  authLog('http_unauthorized', {
    label: debugLabel,
    status: res1.status,
    url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url,
  });

  const refreshedToken = await refreshAccessTokenOnce(`fetch:${debugLabel}`);
  if (!refreshedToken) {
    emitSessionExpired({ reason: `fetch:${debugLabel}:refresh_failed`, status: res1.status });
    return res1;
  }

  const res2 = await doFetch(refreshedToken, true);
  if (res2.status === 401 || res2.status === 403) {
    emitSessionExpired({
      reason: `fetch:${debugLabel}:unauthorized_after_retry`,
      status: res2.status,
    });
  }

  return res2;
}
