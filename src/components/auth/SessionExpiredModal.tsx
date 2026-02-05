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

export default function SessionExpiredModal() {
  const { sessionExpired, clearSessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogin = () => {
    clearSessionExpired();
    // Pass current location so user can be redirected back after login
    navigate('/login', { state: { from: location.pathname } });
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
