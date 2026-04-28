// PaymentMethodCard — gestión del método de pago tokenizado (Wompi).
//
// Muestra la tarjeta guardada (last 4 + brand + expiración), botón para
// cambiarla (redirige a Wompi checkout — el wompi-webhook upserta el nuevo
// token automáticamente) y botón para cancelar suscripción (borra el token,
// el plan queda activo hasta plan_expires_at y luego pasa a demo).

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CreditCard, Loader2, AlertCircle, CheckCircle2, RefreshCw, X } from 'lucide-react';

interface PaymentMethodRow {
  id: string;
  wompi_payment_source_id: string;
  card_last_four: string | null;
  card_brand: string | null;
  card_exp_month: number | null;
  card_exp_year: number | null;
  status: string;
  last_used_at: string | null;
  last_error: string | null;
}

export default function PaymentMethodCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [creatingCheckout, setCreatingCheckout] = useState(false);

  const { data: paymentMethod, isLoading } = useQuery({
    queryKey: ['payment-method', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_payment_methods' as never)
        .select('id, wompi_payment_source_id, card_last_four, card_brand, card_exp_month, card_exp_year, status, last_used_at, last_error')
        .eq('user_id', user!.id)
        .eq('status', 'active')
        .maybeSingle();
      if (error) throw error;
      return data as PaymentMethodRow | null;
    },
  });

  const handleAddOrChange = async () => {
    setCreatingCheckout(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-wompi-checkout', {
        body: { plan: 'empresarial' },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('No se pudo crear el enlace de pago');
      // Redirigir a Wompi — al volver, wompi-webhook upserta el nuevo token
      window.location.href = data.url;
    } catch (e: any) {
      toast({
        title: 'No se pudo abrir Wompi',
        description: e.message ?? 'Intentá de nuevo en un momento.',
        variant: 'destructive',
      });
      setCreatingCheckout(false);
    }
  };

  const handleCancel = async () => {
    if (!paymentMethod || !user) return;
    setCanceling(true);
    try {
      const { error } = await supabase
        .from('user_payment_methods' as never)
        .delete()
        .eq('id', paymentMethod.id);
      if (error) throw error;

      qc.invalidateQueries({ queryKey: ['payment-method', user.id] });
      toast({
        title: 'Suscripción cancelada',
        description: 'Tu plan sigue activo hasta la fecha de vencimiento. Después pasa a demo.',
      });
    } catch (e: any) {
      toast({
        title: 'No se pudo cancelar',
        description: e.message ?? 'Intentá de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setCanceling(false);
      setConfirmCancel(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <CreditCard className="h-5 w-5 text-muted-foreground" />
          Método de pago
        </CardTitle>
        <CardDescription>
          {paymentMethod
            ? 'Cobramos automáticamente cada mes con esta tarjeta. Podés cancelar cuando quieras.'
            : 'Aún no tenés un método de pago guardado. Podés activar débito automático desde acá.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {paymentMethod ? (
          <>
            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border">
              <div className="flex items-center gap-3">
                <div className="w-12 h-8 bg-foreground/5 rounded flex items-center justify-center">
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <div className="font-medium text-sm">
                    {paymentMethod.card_brand ?? 'Tarjeta'} ···· {paymentMethod.card_last_four ?? '????'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {paymentMethod.card_exp_month && paymentMethod.card_exp_year
                      ? `Expira ${String(paymentMethod.card_exp_month).padStart(2, '0')}/${String(paymentMethod.card_exp_year).slice(-2)}`
                      : 'Tokenizada para cobros recurrentes'}
                  </div>
                </div>
              </div>
              <Badge variant="outline" className="border-success text-success gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Activa
              </Badge>
            </div>

            {paymentMethod.last_error && (
              <div className="flex items-start gap-2 p-3 bg-destructive/5 border border-destructive/30 rounded-md text-xs text-destructive">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium">Último cobro falló</div>
                  <div className="opacity-80">{paymentMethod.last_error}</div>
                </div>
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              <Button onClick={handleAddOrChange} variant="outline" disabled={creatingCheckout} className="gap-2">
                {creatingCheckout ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Cambiar tarjeta
              </Button>
              <Button onClick={() => setConfirmCancel(true)} variant="outline" className="gap-2 border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive">
                <X className="h-4 w-4" />
                Cancelar suscripción
              </Button>
            </div>
          </>
        ) : (
          <Button onClick={handleAddOrChange} disabled={creatingCheckout} className="gap-2">
            {creatingCheckout ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
            Activar débito automático
          </Button>
        )}
      </CardContent>

      <AlertDialog open={confirmCancel} onOpenChange={(open) => !canceling && setConfirmCancel(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar suscripción?</AlertDialogTitle>
            <AlertDialogDescription>
              Tu plan sigue activo hasta la fecha de vencimiento actual. Después de eso vas al plan demo
              automáticamente. Podés volver a activar el débito automático cuando quieras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={canceling}>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              disabled={canceling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {canceling ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Sí, cancelar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
