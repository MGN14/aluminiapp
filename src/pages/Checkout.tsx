import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, CreditCard, Shield, Lock, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useToast } from '@/hooks/use-toast';
import Footer from '@/components/layout/Footer';
import { Link } from 'react-router-dom';
import { FileSpreadsheet } from 'lucide-react';

const planDetails = {
  basico: {
    name: 'Plan Básico',
    price: '$399.000',
    period: 'COP/mes',
    features: [
      'Hasta 10 PDFs por mes',
      '1 cuenta bancaria',
      '6 meses de historial',
      'Dashboard completo',
      'IVA y retenciones automáticas',
    ],
  },
  empresarial: {
    name: 'Plan Empresarial',
    price: '$699.000',
    period: 'COP/mes',
    features: [
      'PDFs ilimitados',
      'Hasta 3 cuentas bancarias',
      'Historial ilimitado',
      'Reportes avanzados',
      'Soporte prioritario',
    ],
  },
};

export default function Checkout() {
  const { user, loading: authLoading } = useAuth();
  const { createCheckout } = useSubscription();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  const planId = searchParams.get('plan') as 'basico' | 'empresarial' | null;
  const plan = planId ? planDetails[planId] : null;

  useEffect(() => {
    if (!authLoading && !user) {
      toast({
        title: 'Inicia sesión',
        description: 'Debes tener una cuenta para suscribirte.',
      });
      navigate('/login?redirect=/checkout?plan=' + (planId || 'basico'));
    }
  }, [user, authLoading, navigate, toast, planId]);

  useEffect(() => {
    if (!planId || !planDetails[planId]) {
      navigate('/pricing');
    }
  }, [planId, navigate]);

  const handleCheckout = async () => {
    if (!planId) return;
    
    setLoading(true);
    setRedirecting(true);
    
    try {
      const url = await createCheckout(planId);
      if (url) {
        window.location.href = url;
      } else {
        toast({
          title: 'Error',
          description: 'No pudimos crear la sesión de pago. Intenta de nuevo.',
          variant: 'destructive',
        });
        setRedirecting(false);
      }
    } catch (error) {
      console.error('Checkout error:', error);
      toast({
        title: 'Error',
        description: 'Hubo un problema al procesar tu solicitud.',
        variant: 'destructive',
      });
      setRedirecting(false);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || !plan) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (redirecting) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="text-lg text-muted-foreground">Redirigiendo a Stripe...</p>
        <p className="text-sm text-muted-foreground">Por favor espera mientras preparamos tu checkout seguro.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground">AluminIA</span>
          </Link>
          <Button variant="ghost" size="sm" onClick={() => navigate('/pricing')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Volver a planes
          </Button>
        </div>
      </header>

      {/* Checkout Content */}
      <main className="flex-1 py-12">
        <div className="container mx-auto px-4 max-w-2xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Confirmar suscripción
            </h1>
            <p className="text-muted-foreground">
              Estás a un paso de desbloquear todo el potencial de AluminIA
            </p>
          </div>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{plan.name}</span>
                <span className="text-primary">{plan.price} <span className="text-sm font-normal text-muted-foreground">{plan.period}</span></span>
              </CardTitle>
              <CardDescription>
                Suscripción mensual con renovación automática
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 mb-6">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="text-success">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>

              <Button 
                onClick={handleCheckout} 
                disabled={loading}
                className="w-full"
                size="lg"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Procesando...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Continuar al pago
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Trust Indicators */}
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="flex flex-col items-center gap-2">
              <Shield className="h-6 w-6 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Pagos seguros</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <CreditCard className="h-6 w-6 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Stripe</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Lock className="h-6 w-6 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Encriptado</span>
            </div>
          </div>

          <p className="text-xs text-center text-muted-foreground mt-6">
            Al continuar, aceptas los{' '}
            <Link to="/terms" className="underline hover:text-foreground">términos de servicio</Link>
            {' '}y la{' '}
            <Link to="/privacy" className="underline hover:text-foreground">política de privacidad</Link>.
            Puedes cancelar tu suscripción en cualquier momento.
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}
