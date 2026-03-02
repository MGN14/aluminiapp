import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ShieldCheck, Sparkles } from 'lucide-react';

interface SubscriptionConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planName: string;
  monthlyPrice: number;
  isAnnual: boolean;
  loading: boolean;
  onConfirm: () => void;
}

function formatCOP(n: number) {
  return '$' + n.toLocaleString('es-CO');
}

export default function SubscriptionConfirmModal({
  open,
  onOpenChange,
  planName,
  monthlyPrice,
  isAnnual,
  loading,
  onConfirm,
}: SubscriptionConfirmModalProps) {
  const annualTotal = Math.round(monthlyPrice * 12 * 0.8);
  const annualSavings = monthlyPrice * 12 - annualTotal;

  const finalPrice = isAnnual ? annualTotal : monthlyPrice;
  const period = isAnnual ? 'año' : '30 días';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-success/10 flex items-center justify-center">
            <Sparkles className="h-6 w-6 text-success" />
          </div>
          <DialogTitle className="text-center text-xl">Confirmar suscripción</DialogTitle>
          <DialogDescription className="text-center pt-1">
            Revisa los detalles antes de continuar
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-3">
          <div className="bg-muted/50 rounded-xl p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Plan seleccionado</span>
              <span className="font-semibold text-foreground">{planName}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Precio</span>
              <span className="font-bold text-lg text-foreground">
                {formatCOP(finalPrice)} COP / {period}
              </span>
            </div>
            {isAnnual && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Ahorro anual</span>
                <Badge className="bg-success/10 text-success border-success/20" variant="secondary">
                  🔥 {formatCOP(annualSavings)}
                </Badge>
              </div>
            )}
          </div>

          {planName === 'Empresarial' && (
            <p className="text-xs text-center text-muted-foreground italic">
              ✨ Incluye acceso futuro a módulo de fabricación e inventario inteligente.
            </p>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            onClick={onConfirm}
            disabled={loading}
            className="w-full bg-success hover:bg-success/90 text-success-foreground h-11 font-bold"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Redirigiendo a pago seguro...
              </>
            ) : (
              'Confirmar suscripción'
            )}
          </Button>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="w-full"
            disabled={loading}
          >
            Volver a los planes
          </Button>
        </DialogFooter>

        <p className="text-xs text-center text-muted-foreground flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" />
          Pago seguro con Wompi · Sin cargos automáticos
        </p>
      </DialogContent>
    </Dialog>
  );
}
