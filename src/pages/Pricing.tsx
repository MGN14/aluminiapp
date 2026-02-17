import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FileSpreadsheet, Check, ArrowRight, Sparkles, Shield, Lock, Loader2, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Footer from '@/components/layout/Footer';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';

const plans = [
  {
    id: 'demo',
    name: 'Demo',
    price: '$0',
    period: 'gratis',
    description: 'Prueba AluminIA con un extracto real',
    features: [
      '1 PDF único (para siempre)',
      '1 cuenta bancaria',
      'Parseo de extractos con IA',
      'Conciliación manual',
      'Cálculo de IVA y retenciones',
      'Dashboard básico',
      'Exportación a Excel',
    ],
    cta: 'Probar con un extracto',
    ctaAction: 'signup' as const,
    highlighted: false,
    note: 'Este plan es solo para probar AluminIA con un extracto real',
  },
  {
    id: 'basico',
    name: 'Básico',
    price: '$399.000',
    period: 'COP / 30 días',
    description: 'Para negocios en crecimiento',
    features: [
      'Hasta 10 PDFs por mes',
      'Hasta 2 cuentas bancarias',
      'Historial de hasta 2 años',
      '2 usuarios incluidos (Administrador y Auxiliar)',
      'Dashboard completo',
      'IVA y retenciones automáticas',
      'Exportación a Excel',
      'Soporte por email',
    ],
    cta: 'Suscribirme al plan Básico',
    ctaAction: 'wompi-basico' as const,
    highlighted: true,
    note: null,
  },
  {
    id: 'empresarial',
    name: 'Empresarial',
    price: '$699.000',
    period: 'COP/mes',
    description: 'Para PyMEs establecidas',
    features: [
      'PDFs ilimitados',
      'Hasta 3 cuentas bancarias',
      'Historial ilimitado',
      'Reportes avanzados',
      'Soporte prioritario',
      'Acceso temprano a módulo de inventario',
    ],
    cta: 'Contactar para suscribirme',
    ctaAction: 'contact' as const,
    highlighted: false,
    note: null,
  },
];

export default function Pricing() {
  const { user } = useAuth();
  const { plan: currentPlan, createWompiCheckout } = useSubscription();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  const paymentSuccess = searchParams.get('payment') === 'success';

  const handlePlanAction = async (action: string) => {
    if (action === 'signup') {
      navigate(user ? '/upload' : '/signup');
      return;
    }

    if (action === 'contact') {
      navigate('/contact');
      return;
    }

    if (action === 'wompi-basico') {
      if (!user) {
        toast({
          title: 'Inicia sesión primero',
          description: 'Debes tener una cuenta para suscribirte a un plan.',
        });
        navigate('/signup');
        return;
      }

      setLoadingPlan('basico');
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
      } catch (error) {
        toast({
          title: 'Error',
          description: 'Hubo un problema al procesar tu solicitud.',
          variant: 'destructive',
        });
      } finally {
        setLoadingPlan(null);
      }
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
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4 text-center">
          <Badge variant="secondary" className="mb-4">
            <Sparkles className="w-3 h-3 mr-1" />
            Planes simples y transparentes
          </Badge>
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4">
            Elige el plan perfecto para tu negocio
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Prueba gratis con un extracto real. Escala cuando estés listo. Sin sorpresas, sin costos ocultos.
          </p>
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
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {plans.map((plan) => {
              const isCurrentPlan = user && currentPlan === plan.id;
              const isLoading = loadingPlan === plan.id;

              return (
                <Card 
                  key={plan.id}
                  className={`relative flex flex-col ${
                    plan.highlighted 
                      ? 'border-primary shadow-lg shadow-primary/10 scale-105' 
                      : 'border-border'
                  } ${isCurrentPlan ? 'ring-2 ring-success' : ''}`}
                >
                  {plan.highlighted && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="bg-primary text-primary-foreground">
                        Recomendado
                      </Badge>
                    </div>
                  )}
                  {isCurrentPlan && (
                    <div className="absolute -top-3 right-4">
                      <Badge className="bg-success text-success-foreground">
                        Tu plan actual
                      </Badge>
                    </div>
                  )}
                  <CardHeader className="pb-4">
                    <CardTitle className="text-xl">{plan.name}</CardTitle>
                    <CardDescription>{plan.description}</CardDescription>
                    <div className="pt-4">
                      <span className="text-4xl font-bold text-foreground">{plan.price}</span>
                      <span className="text-muted-foreground ml-1">{plan.period}</span>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col">
                    <ul className="space-y-3 flex-1">
                      {plan.features.map((feature, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <Check className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
                          <span className="text-sm text-muted-foreground">{feature}</span>
                        </li>
                      ))}
                    </ul>
                    {plan.note && (
                      <p className="text-xs text-muted-foreground mt-4 italic">
                        💡 {plan.note}
                      </p>
                    )}
                    <div className="mt-6">
                      <Button 
                        className="w-full" 
                        size="lg"
                        variant={plan.highlighted ? 'default' : 'outline'}
                        disabled={!!isCurrentPlan || isLoading}
                        onClick={() => handlePlanAction(plan.ctaAction)}
                      >
                        {isLoading ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Redirigiendo...
                          </>
                        ) : isCurrentPlan ? (
                          'Plan actual'
                        ) : (
                          <>
                            {plan.cta}
                            <ArrowRight className="w-4 h-4 ml-2" />
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
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
            <div>
              <h3 className="font-semibold text-foreground mb-2">
                ¿Cómo funciona el pago?
              </h3>
              <p className="text-muted-foreground text-sm">
                Al suscribirte, serás redirigido a Wompi para realizar un pago único. Tu plan se activará automáticamente por 30 días una vez el pago sea aprobado.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground mb-2">
                ¿Se renueva automáticamente?
              </h3>
              <p className="text-muted-foreground text-sm">
                No. Al vencer los 30 días, puedes renovar manualmente realizando un nuevo pago. No hay cargos automáticos.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground mb-2">
                ¿Qué bancos soportan?
              </h3>
              <p className="text-muted-foreground text-sm">
                Soportamos distintos formatos de extractos bancarios colombianos. Algunos formatos pueden requerir ajuste de plantilla.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground mb-2">
                ¿Mis datos están seguros?
              </h3>
              <p className="text-muted-foreground text-sm">
                Absolutamente. Utilizamos cifrado de nivel bancario y nunca compartimos tu información con terceros.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground mb-2">
                ¿AluminIA reemplaza a mi contador?
              </h3>
              <p className="text-muted-foreground text-sm">
                No. AluminIA es una herramienta de organización financiera que complementa el trabajo de tu contador, 
                no lo reemplaza.
              </p>
            </div>
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
    </div>
  );
}
