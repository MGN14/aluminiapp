import { supabase } from '@/integrations/supabase/client';
import type { FunctionInvokeOptions } from '@supabase/supabase-js';
import { emitSessionExpired } from '@/lib/authSessionEvents';

const isDev = import.meta.env.MODE === 'development';

const authLog = (message: string, data?: unknown) => {
  if (isDev) {
    console.log(`[AUTH] ${message}`, data ?? '');
  }
};

const authError = (message: string, data?: unknown) => {
  // In production, keep logs minimal and never include tokens.
  if (isDev) {
    console.error(`[AUTH] ${message}`, data ?? '');
  } else {
    const suffix = data ? ` ${safeStringify(data)}` : '';
    console.error(`[AUTH] ${message}${suffix}`);
  }
};

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attemptIndex: number) {
  // attemptIndex: 0,1,2...
  const base = 500;
  const jitter = Math.floor(Math.random() * 150);
  return base * Math.pow(2, attemptIndex) + jitter;
}

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
    const maxAttempts = 3; // 1 initial + 2 retries

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      authLog('refresh_attempt', { reason, attempt, maxAttempts });

      const { data, error } = await supabase.auth.refreshSession();

      if (!error) {
        authLog('refresh_success', {
          reason,
          attempt,
          expires_at: data.session?.expires_at,
          user_id: data.session?.user?.id,
        });
        return data.session?.access_token ?? null;
      }

      // Failure: log, then backoff and retry (transient network/storage issues happen)
      authError('refresh_failed', { reason, attempt, message: error.message });

      if (attempt < maxAttempts) {
        await sleep(backoffMs(attempt - 1));
        continue;
      }

      return null;
    }

    return null;
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
  const session = sessionData.session;
  let tokenToUse = session?.access_token;

  // Proactively refresh if token is missing or about to expire (within 60s)
  const needsRefresh = !tokenToUse || (session?.expires_at && session.expires_at * 1000 - Date.now() < 60_000);

  if (needsRefresh) {
    authLog('invoke_proactive_refresh', { label, reason: tokenToUse ? 'token_expiring_soon' : 'no_token' });
    const refreshed = await refreshAccessTokenOnce(`${label}:proactive`);
    if (refreshed) {
      tokenToUse = refreshed;
    } else if (!tokenToUse) {
      authError('invoke_no_token_after_refresh', { label });
      return { data: null, error: new Error('No active session') };
    }
    // If refresh failed but we still have a token, try with it anyway
  }

  const attempt1 = await invoke(tokenToUse);
  if (!attempt1.error) return { data: attempt1.data as T, error: null };

  if (!isUnauthorized(attempt1.error)) {
    authError('invoke_error', {
      label,
      status: (attempt1.error as any)?.status ?? (attempt1.error as any)?.context?.status,
      message: (attempt1.error as any)?.message,
    });
    return { data: null, error: attempt1.error };
  }

  authLog('invoke_unauthorized', { label, error: attempt1.error });

  // Refresh once, then retry
  const refreshedToken = await refreshAccessTokenOnce(label);

  if (!refreshedToken) {
    authError('refresh_failed', { label }); emitSessionExpired({ reason: `${label}:refresh_failed` });
    return { data: null, error: attempt1.error };
  }

  const attempt2 = await invoke(refreshedToken);
  if (!attempt2.error) return { data: attempt2.data as T, error: null };

  if (isUnauthorized(attempt2.error)) {
    emitSessionExpired({ reason: `${label}:unauthorized_after_retry` });
  }

  authError('invoke_error_after_retry', {
    label,
    status: (attempt2.error as any)?.status ?? (attempt2.error as any)?.context?.status,
    message: (attempt2.error as any)?.message,
  });
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
    authError('fetch_refresh_failed', { label: debugLabel, status: res1.status }); emitSessionExpired({ reason: `fetch:${debugLabel}:refresh_failed`, status: res1.status });
    return res1;
  }

  const res2 = await doFetch(refreshedToken, true);
  if (res2.status === 401 || res2.status === 403) {
    authError('fetch_unauthorized_after_retry', { label: debugLabel, status: res2.status });
    emitSessionExpired({
      reason: `fetch:${debugLabel}:unauthorized_after_retry`,
      status: res2.status,
    });
  }

  return res2;
}
