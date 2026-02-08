import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// CRITICAL: Only ever render in development mode. NEVER in production.
const isDev = import.meta.env.DEV;

function formatSeconds(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export default function AuthDebugPanel() {
  // HARD GATE: never render in production, regardless of query params or roles
  if (!isDev) return null;

  return <AuthDebugPanelInner />;
}

function AuthDebugPanelInner() {
  const { user, session, loading, lastAuthEvent, lastAuthEventAt, sessionExpired, sessionExpiredReason } = useAuth();
  const location = useLocation();

  // In dev mode, always enabled (no admin check needed in dev)
  const enabled = true;

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);

  // CRITICAL: Never render in production without explicit admin + debug flag
  if (!enabled) return null;

  const expiresAtSec = session?.expires_at ?? null;
  const expiresAtMs = expiresAtSec ? expiresAtSec * 1000 : null;
  const secondsLeft = expiresAtMs ? Math.floor((expiresAtMs - now) / 1000) : null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[340px] max-w-[calc(100vw-2rem)]">
      <Card className="border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 shadow-lg">
        <CardHeader className="py-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm">Auth Debug</CardTitle>
            <Badge variant={sessionExpired ? 'destructive' : 'secondary'}>
              {sessionExpired ? 'EXPIRED' : 'OK'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <div className="grid grid-cols-3 gap-2">
            <div className="text-muted-foreground">loading</div>
            <div className="col-span-2 font-mono">{String(loading)}</div>

            <div className="text-muted-foreground">user</div>
            <div className="col-span-2 font-mono break-all">{user?.id ?? 'null'}</div>

            <div className="text-muted-foreground">email</div>
            <div className="col-span-2 font-mono break-all">{user?.email ?? 'null'}</div>

            <div className="text-muted-foreground">expires_at</div>
            <div className="col-span-2 font-mono break-all">
              {expiresAtSec ? `${expiresAtSec} (${new Date(expiresAtSec * 1000).toISOString()})` : 'null'}
            </div>

            <div className="text-muted-foreground">countdown</div>
            <div className="col-span-2 font-mono">
              {secondsLeft === null ? 'n/a' : `${formatSeconds(secondsLeft)} (${secondsLeft}s)`}
            </div>

            <div className="text-muted-foreground">refreshToken</div>
            <div className="col-span-2 font-mono">{String(!!session?.refresh_token)}</div>

            <div className="text-muted-foreground">lastEvent</div>
            <div className="col-span-2 font-mono break-all">{lastAuthEvent ?? 'null'}</div>

            <div className="text-muted-foreground">lastEventAt</div>
            <div className="col-span-2 font-mono">
              {lastAuthEventAt ? new Date(lastAuthEventAt).toISOString() : 'null'}
            </div>

            <div className="text-muted-foreground">route</div>
            <div className="col-span-2 font-mono break-all">
              {location.pathname}
              {location.search}
              {location.hash}
            </div>
          </div>

          {sessionExpired && (
            <div className="pt-2 text-muted-foreground">
              reason: <span className="font-mono">{sessionExpiredReason ?? 'unknown'}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
