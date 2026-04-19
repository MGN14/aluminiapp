// Sliding session inactivity tracker.
// If no user activity (mousemove, keydown, click, scroll, touchstart) for
// INACTIVITY_TIMEOUT_MS, the session is considered expired.
// `last_active_at` is persisted in localStorage so inactivity is respected
// across tab reloads and browser restarts (no auto-login from stale cache).

export const INACTIVITY_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours
export const LAST_ACTIVE_STORAGE_KEY = 'aluminia:last_active_at';
// Throttle how often we touch localStorage — no need to write on every mousemove.
const ACTIVITY_PERSIST_THROTTLE_MS = 30 * 1000; // 30s

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'click',
  'visibilitychange',
];

export function readLastActiveAt(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_ACTIVE_STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writeLastActiveAt(ts: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_ACTIVE_STORAGE_KEY, String(ts));
  } catch {
    // ignore storage failures (private mode, quota, etc.)
  }
}

export function clearLastActiveAt(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LAST_ACTIVE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function isSessionInactive(now: number = Date.now()): boolean {
  const last = readLastActiveAt();
  if (last == null) return false; // no record yet → not inactive
  return now - last >= INACTIVITY_TIMEOUT_MS;
}

export interface InactivityTrackerOptions {
  onExpire: () => void;
  timeoutMs?: number;
}

/**
 * Starts tracking activity. Calls `onExpire` exactly once when the inactivity
 * threshold is reached. Returns a cleanup function.
 */
export function startInactivityTracker({
  onExpire,
  timeoutMs = INACTIVITY_TIMEOUT_MS,
}: InactivityTrackerOptions): () => void {
  if (typeof window === 'undefined') return () => {};

  let expiredFired = false;
  let lastPersistAt = 0;
  let timer: number | null = null;

  const fireExpire = () => {
    if (expiredFired) return;
    expiredFired = true;
    onExpire();
  };

  const scheduleTimer = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(fireExpire, timeoutMs);
  };

  const onActivity = () => {
    if (expiredFired) return;
    const now = Date.now();
    // Persist throttled
    if (now - lastPersistAt >= ACTIVITY_PERSIST_THROTTLE_MS) {
      writeLastActiveAt(now);
      lastPersistAt = now;
    }
    scheduleTimer();
  };

  // Seed baseline immediately
  writeLastActiveAt(Date.now());
  lastPersistAt = Date.now();
  scheduleTimer();

  ACTIVITY_EVENTS.forEach((evt) => {
    window.addEventListener(evt, onActivity, { passive: true });
  });

  return () => {
    if (timer !== null) window.clearTimeout(timer);
    ACTIVITY_EVENTS.forEach((evt) => {
      window.removeEventListener(evt, onActivity);
    });
  };
}
