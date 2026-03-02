import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FileSpreadsheet, Shield, Lock, MessageCircle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Footer from '@/components/layout/Footer';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import PricingToggle from '@/components/pricing/PricingToggle';
import PricingCard from '@/components/pricing/PricingCard';
import SubscriptionConfirmModal from '@/components/pricing/SubscriptionConfirmModal';
import { plans } from '@/components/pricing/pricingPlans';

export default function Pricing() {
  const { user } = useAuth();
  const { plan: currentPlan, createWompiCheckout } = useSubscription();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [isAnnual, setIsAnnual] = useState(false);

  // Confirm modal state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<typeof plans[0] | null>(null);

  const paymentSuccess = searchParams.get('payment') === 'success';

  const handlePlanAction = (action: string) => {
    if (action === 'signup') {
      navigate(user ? '/upload' : '/signup');
      return;
    }

    if (action === 'contact') {
      navigate('/contact');
      return;
    }

    // For paid plans, open confirmation modal
    if (action.startsWith('wompi-')) {
      if (!user) {
        toast({
          title: 'Inicia sesión primero',
          description: 'Debes tener una cuenta para suscribirte a un plan.',
        });
        navigate('/signup');
        return;
      }

      const planId = action.replace('wompi-', '');
      const plan = plans.find((p) => p.id === planId);
      if (plan) {
        setSelectedPlan(plan);
        setConfirmOpen(true);
      }
    }
  };

  const handleConfirmSubscription = async () => {
    if (!selectedPlan) return;

    setLoadingPlan(selectedPlan.id);
    try {
      const url = await createWompiCheckout();
      if (url) {
        window.location.href = url;
      } else {
        toast({
          title: 'Error',
          description: 'No pudimos crear el enlace de pago. Intenta de nuevo.',
          variant: 'destructive',
        });
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Hubo un problema al procesar tu solicitud.',
        variant: 'destructive',
      });
    } finally {
      setLoadingPlan(null);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold text-foreground">AluminIA</span>
          </Link>
          <div className="flex items-center gap-3">
            {user ? (
              <Link to="/dashboard">
                <Button size="sm">Ir al Dashboard</Button>
              </Link>
            ) : (
              <>
                <Link to="/login">
                  <Button variant="ghost" size="sm">Iniciar Sesión</Button>
                </Link>
                <Link to="/signup">
                  <Button size="sm">Crear Cuenta</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-16 pb-10 md:pt-24 md:pb-14">
        <div className="container mx-auto px-4 text-center">
          <Badge variant="secondary" className="mb-4">
            <Sparkles className="w-3 h-3 mr-1" />
            Planes simples y transparentes
          </Badge>
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4">
            Elige el plan perfecto para tu negocio
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            Empieza gratis. Escala cuando estés listo. Sin tarjeta, sin sorpresas.
          </p>

          {/* Toggle */}
          <PricingToggle isAnnual={isAnnual} onToggle={setIsAnnual} />
        </div>
      </section>

      {paymentSuccess && (
        <div className="container mx-auto px-4 mb-6">
          <Alert className="max-w-3xl mx-auto border-success bg-success/10">
            <AlertDescription className="text-success">
              ¡Pago procesado! Tu plan se activará en unos momentos. Si no ves el cambio, recarga la página.
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Pricing Cards */}
      <section className="pb-12">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto items-start">
            {plans.map((plan) => {
              const isCurrentPlan = !!(user && currentPlan === plan.id);
              const isLoading = loadingPlan === plan.id;

              return (
                <PricingCard
                  key={plan.id}
                  plan={plan}
                  isAnnual={isAnnual}
                  isCurrentPlan={isCurrentPlan}
                  isLoading={isLoading}
                  onAction={handlePlanAction}
                />
              );
            })}
          </div>
        </div>
      </section>

      {/* Strategic message */}
      <section className="pb-10">
        <div className="container mx-auto px-4 text-center">
          <p className="text-base text-muted-foreground font-medium max-w-xl mx-auto">
            Empieza con orden financiero. Escala a control fiscal y de inventario.
          </p>
        </div>
      </section>

      {/* Trust Badges */}
      <section className="py-8 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="flex flex-wrap justify-center gap-8 md:gap-16">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Shield className="h-5 w-5" />
              <span className="text-sm">Pagos seguros con Wompi</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Lock className="h-5 w-5" />
              <span className="text-sm">Datos protegidos con encriptación</span>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-16 border-t border-border">
        <div className="container mx-auto px-4 max-w-3xl">
          <h2 className="text-2xl font-bold text-foreground mb-8 text-center">
            Preguntas frecuentes
          </h2>
          <div className="space-y-6">
            {[
              {
                q: '¿Cómo funciona el pago?',
                a: 'Al suscribirte, serás redirigido a Wompi para realizar un pago único. Tu plan se activará automáticamente por 30 días una vez el pago sea aprobado.',
              },
              {
                q: '¿Se renueva automáticamente?',
                a: 'No. Al vencer los 30 días, puedes renovar manualmente realizando un nuevo pago. No hay cargos automáticos.',
              },
              {
                q: '¿Qué bancos soportan?',
                a: 'Soportamos distintos formatos de extractos bancarios colombianos. Algunos formatos pueden requerir ajuste de plantilla.',
              },
              {
                q: '¿Mis datos están seguros?',
                a: 'Absolutamente. Utilizamos cifrado de nivel bancario y nunca compartimos tu información con terceros.',
              },
              {
                q: '¿AluminIA reemplaza a mi contador?',
                a: 'No. AluminIA es una herramienta de organización financiera que complementa el trabajo de tu contador, no lo reemplaza.',
              },
              {
                q: '¿Qué incluye el módulo de Inventario?',
                a: 'El plan Empresarial incluye un área de inventario integrada que descuenta automáticamente productos desde tu facturación DIAN. Próximamente se añadirá fabricación inteligente.',
              },
            ].map((faq, i) => (
              <div key={i}>
                <h3 className="font-semibold text-foreground mb-2">{faq.q}</h3>
                <p className="text-muted-foreground text-sm">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact CTA */}
      <section className="py-12 bg-muted/30 border-t border-border">
        <div className="container mx-auto px-4 text-center">
          <h3 className="text-xl font-semibold text-foreground mb-2">
            ¿Necesitas un plan personalizado?
          </h3>
          <p className="text-muted-foreground mb-4">
            Contáctanos para discutir soluciones empresariales a medida.
          </p>
          <Link to="/contact">
            <Button variant="outline" size="lg">
              <MessageCircle className="w-4 h-4 mr-2" />
              Contactar ventas
            </Button>
          </Link>
        </div>
      </section>

      <Footer />

      {/* Confirm modal */}
      {selectedPlan && (
        <SubscriptionConfirmModal
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          planName={selectedPlan.name}
          monthlyPrice={selectedPlan.monthlyPrice}
          isAnnual={isAnnual}
          loading={!!loadingPlan}
          onConfirm={handleConfirmSubscription}
        />
      )}
    </div>
  );
}
