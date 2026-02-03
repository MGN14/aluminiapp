import { Link } from 'react-router-dom';
import { FileSpreadsheet, Check, ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Footer from '@/components/layout/Footer';

const plans = [
  {
    name: 'Gratis',
    price: '$0',
    period: 'siempre',
    description: 'Ideal para probar AluminIA',
    features: [
      '5 PDFs por mes',
      '1 cuenta bancaria',
      'Dashboard básico',
      'Exportación a Excel',
      'Soporte por email',
    ],
    cta: 'Comenzar gratis',
    ctaLink: '/signup',
    highlighted: false,
    available: true,
  },
  {
    name: 'Básico',
    price: '$49.900',
    period: '/mes',
    description: 'Para negocios en crecimiento',
    features: [
      '50 PDFs por mes',
      '2 cuentas bancarias',
      'IVA y retenciones automáticas',
      'Alertas básicas',
      'Dashboard completo',
      'Soporte prioritario',
    ],
    cta: 'Próximamente',
    ctaLink: null,
    highlighted: true,
    available: false,
  },
  {
    name: 'Pro',
    price: '$149.900',
    period: '/mes',
    description: 'Para PyMEs establecidas',
    features: [
      'PDFs ilimitados',
      'Hasta 5 cuentas bancarias',
      'Reportes avanzados',
      'Múltiples usuarios',
      'API de integración',
      'Soporte prioritario 24/7',
    ],
    cta: 'Próximamente',
    ctaLink: null,
    highlighted: false,
    available: false,
  },
];

export default function Pricing() {
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
            <Link to="/login">
              <Button variant="ghost" size="sm">Iniciar Sesión</Button>
            </Link>
            <Link to="/signup">
              <Button size="sm">Crear Cuenta</Button>
            </Link>
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
            Comienza gratis y escala cuando estés listo. Sin sorpresas, sin costos ocultos.
          </p>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="pb-20">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {plans.map((plan) => (
              <Card 
                key={plan.name}
                className={`relative flex flex-col ${
                  plan.highlighted 
                    ? 'border-accent shadow-lg shadow-accent/10 scale-105' 
                    : 'border-border'
                }`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-accent text-accent-foreground">
                      Recomendado
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
                  <div className="mt-6">
                    {plan.available ? (
                      <Link to={plan.ctaLink!}>
                        <Button className="w-full" size="lg">
                          {plan.cta}
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      </Link>
                    ) : (
                      <Button 
                        className="w-full" 
                        size="lg" 
                        variant="outline" 
                        disabled
                      >
                        {plan.cta}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Note */}
          <div className="text-center mt-10">
            <p className="text-sm text-muted-foreground">
              💡 Los planes pagos se activarán próximamente. Por ahora, disfruta del plan gratuito sin límite de tiempo.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-16 bg-muted/30 border-t border-border">
        <div className="container mx-auto px-4 max-w-3xl">
          <h2 className="text-2xl font-bold text-foreground mb-8 text-center">
            Preguntas frecuentes
          </h2>
          <div className="space-y-6">
            <div>
              <h3 className="font-semibold text-foreground mb-2">
                ¿Puedo cambiar de plan en cualquier momento?
              </h3>
              <p className="text-muted-foreground text-sm">
                Sí, cuando los planes pagos estén disponibles podrás actualizar o reducir tu plan en cualquier momento.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground mb-2">
                ¿Qué bancos soportan?
              </h3>
              <p className="text-muted-foreground text-sm">
                Actualmente soportamos extractos de Bancolombia. Estamos trabajando para agregar más bancos colombianos.
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
                no lo reemplaza. Siempre consulta a un profesional para obligaciones tributarias oficiales.
              </p>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
