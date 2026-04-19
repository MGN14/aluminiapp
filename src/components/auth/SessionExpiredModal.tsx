import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { LogIn, Clock } from 'lucide-react';

const isDevelopment = import.meta.env.MODE === 'development';

// Public routes where we should NOT auto-redirect on session expiry.
const PUBLIC_ROUTES = new Set<string>([
  '/',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/terms',
  '/privacy',
  '/pricing',
  '/contact',
]);

export default function SessionExpiredModal() {
  const { sessionExpired, sessionExpiredReason, clearSessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // When the session expires (e.g. inactivity timeout), auto-redirect to /login
  // from protected routes so the user lands on the auth screen directly.
  useEffect(() => {
    if (!sessionExpired) return;
    if (PUBLIC_ROUTES.has(location.pathname)) return;

    const from = `${location.pathname}${location.search}${location.hash}`;
    navigate('/login', { state: { from }, replace: true });
  }, [sessionExpired, location.pathname, location.search, location.hash, navigate]);

  const debugEnabled =
    isDevelopment && new URLSearchParams(location.search).get('debug') === '1';

  const handleLogin = () => {
    const from = `${location.pathname}${location.search}${location.hash}`;

    if (isDevelopment) {
      console.log('[AUTH] session_expired_modal_login', { from });
    }

    clearSessionExpired();

    // If we're already on /login, don't navigate again.
    if (location.pathname === '/login') return;

    navigate('/login', { state: { from }, replace: true });
  };

  return (
    <Dialog open={sessionExpired} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/20">
            <Clock className="h-6 w-6 text-accent" />
          </div>
          <DialogTitle className="text-center">Tu sesión ha expirado</DialogTitle>
          <DialogDescription className="text-center">
            Por seguridad, tu sesión ha expirado. Por favor, vuelve a iniciar sesión para continuar.
            {debugEnabled && sessionExpiredReason ? (
              <span className="mt-2 block text-xs text-muted-foreground">
                Debug: <span className="font-mono">{sessionExpiredReason}</span>
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center">
          <Button onClick={handleLogin} className="gap-2">
            <LogIn className="h-4 w-4" />
            Iniciar sesión
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
