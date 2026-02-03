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
  message = 'Ya usaste el extracto gratuito. Para seguir usando AluminIA, suscríbete al plan Básico.',
}: UpgradeLimitModalProps) {
  const navigate = useNavigate();
  const { createCheckout } = useSubscription();
  const [loading, setLoading] = useState(false);

  const handleSubscribe = async () => {
    setLoading(true);
    try {
      const url = await createCheckout('basico');
      if (url) {
        window.open(url, '_blank');
      } else {
        // Fallback to pricing page
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
              Plan Básico - $399.000 COP/mes
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 ml-6">
              <li>• Hasta 10 PDFs por mes</li>
              <li>• Dashboard completo</li>
              <li>• IVA y retenciones automáticas</li>
              <li>• Exportación a Excel</li>
            </ul>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button onClick={handleSubscribe} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cargando...
              </>
            ) : (
              'Suscribirme al plan Básico'
            )}
          </Button>
          <Button variant="outline" onClick={handleViewPlans} className="w-full">
            Ver todos los planes
          </Button>
        </DialogFooter>

        <p className="text-xs text-center text-muted-foreground mt-2">
          🔒 Pagos seguros · Cancelas cuando quieras
        </p>
      </DialogContent>
    </Dialog>
  );
}
