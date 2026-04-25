import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Lock, Sparkles, Loader2 } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';

interface UpgradeLimitModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  message?: string;
}

export default function UpgradeLimitModal({
  open,
  onOpenChange,
  title = 'Límite alcanzado',
  message = 'Tu prueba gratuita terminó. Activa un plan para continuar usando AluminIA.',
}: UpgradeLimitModalProps) {
  const navigate = useNavigate();
  const { createWompiCheckout } = useSubscription();
  const [loading, setLoading] = useState(false);

  const handleSubscribe = async () => {
    setLoading(true);
    try {
      // Único plan de pago: Empresarial. (Plan Básico fue retirado.)
      const url = await createWompiCheckout('empresarial');
      if (url) {
        window.location.href = url;
      } else {
        navigate('/pricing');
      }
    } catch (error) {
      console.error('Error creating checkout:', error);
      navigate('/pricing');
    } finally {
      setLoading(false);
      onOpenChange(false);
    }
  };

  const handleViewPlans = () => {
    onOpenChange(false);
    navigate('/pricing');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center">
            <Lock className="h-6 w-6 text-warning" />
          </div>
          <DialogTitle className="text-center text-xl">{title}</DialogTitle>
          <DialogDescription className="text-center pt-2">
            {message}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <p className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Plan Empresarial — $500.000 COP / mes
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 ml-6">
              <li>• PDFs ilimitados</li>
              <li>• Conexión con Siigo y bancos</li>
              <li>• Módulo de Facturas DIAN + inventarios</li>
              <li>• Coach financiero con IA</li>
              <li>• Soporte prioritario</li>
            </ul>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button onClick={handleSubscribe} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Redirigiendo a Wompi...
              </>
            ) : (
              'Activar plan Empresarial'
            )}
          </Button>
          <Button variant="outline" onClick={handleViewPlans} className="w-full">
            Ver todos los planes
          </Button>
        </DialogFooter>

        <p className="text-xs text-center text-muted-foreground mt-2">
          🔒 Pago seguro con Wompi · Sin cargos automáticos
        </p>
      </DialogContent>
    </Dialog>
  );
}
