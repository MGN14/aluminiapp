// Client helper for the check-rate-limit edge function.
// Gates login attempts by (email, ip) before calling supabase.auth.*.

const FUNCTION_URL = (() => {
  const base =
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
    "https://flmelenvmvhsogtzjjow.supabase.co";
  return `${base.replace(/\/$/, "")}/functions/v1/check-rate-limit`;
})();

const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

interface CheckResponse {
  allowed: boolean;
  remainingSeconds?: number;
  attemptsInWindow?: number;
}

async function postJson<T>(body: unknown): Promise<T> {
  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ANON_KEY ? { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`rate-limit ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export async function checkRateLimit(email: string): Promise<CheckResponse> {
  try {
    return await postJson<CheckResponse>({ action: "check", email });
  } catch (err) {
    // Fail open (allow login) if the rate-limit check itself is broken.
    // Otherwise a bug here would lock everyone out.
    console.error("[rateLimit] check failed, allowing request", err);
    return { allowed: true };
  }
}

export async function recordFailure(email: string, reason?: string): Promise<void> {
  try {
    await postJson({ action: "record_failure", email, reason });
  } catch (err) {
    console.error("[rateLimit] record_failure failed", err);
  }
}

export async function recordSuccess(email: string): Promise<void> {
  try {
    await postJson({ action: "record_success", email });
  } catch (err) {
    console.error("[rateLimit] record_success failed", err);
  }
}

export function formatRemaining(seconds: number): string {
  if (seconds < 60) return `${seconds} segundo${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minuto${minutes === 1 ? "" : "s"}`;
}
