export const AUTH_SESSION_EXPIRED_EVENT = 'auth:session-expired';

export type SessionExpiredDetail = {
  at: number;
  reason: string;
  status?: number;
  url?: string;
};

export function emitSessionExpired(detail: Omit<SessionExpiredDetail, 'at'> & { at?: number }) {
  if (typeof window === 'undefined') return;

  const payload: SessionExpiredDetail = {
    at: detail.at ?? Date.now(),
    reason: detail.reason,
    status: detail.status,
    url: detail.url,
  };

  window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT, { detail: payload }));
}
