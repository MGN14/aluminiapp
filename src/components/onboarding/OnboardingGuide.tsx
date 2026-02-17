import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Upload, Table, BarChart3, ArrowRight, X, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface OnboardingGuideProps {
  hasTransactions: boolean;
  onDismiss?: () => void;
}

const steps = [
  {
    icon: Upload,
    title: 'Sube tu primer extracto',
    description: 'Carga el extracto de tu banco (PDF) para extraer automáticamente tus transacciones. Compatible con la mayoría de bancos en Colombia.',
    cta: 'Subir PDF',
    link: '/statement-upload',
  },
  {
    icon: Table,
    title: 'Revisa y clasifica',
    description: 'Organiza tus movimientos con categorías y responsables para mayor claridad.',
    cta: 'Ver transacciones',
    link: '/transactions',
  },
  {
    icon: BarChart3,
    title: 'Analiza tu dashboard',
    description: 'Visualiza ingresos, egresos, IVA estimado y métricas clave de tu negocio.',
    cta: 'Ver dashboard',
    link: '/dashboard',
  },
];

export default function OnboardingGuide({ hasTransactions, onDismiss }: OnboardingGuideProps) {
  const [dismissed, setDismissed] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  // Check localStorage for dismissal
  useEffect(() => {
    const wasDismissed = localStorage.getItem('aluminia_onboarding_dismissed');
    if (wasDismissed === 'true') {
      setDismissed(true);
    }
  }, []);

  // Don't show if dismissed or has transactions
  if (dismissed || hasTransactions) {
    return null;
  }

  const handleDismiss = () => {
    localStorage.setItem('aluminia_onboarding_dismissed', 'true');
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <Card className="border-accent/30 bg-accent/5 mb-6 animate-fade-in">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent" />
            <CardTitle className="text-lg">¡Bienvenido a AluminIA!</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={handleDismiss}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Cerrar guía</span>
          </Button>
        </div>
        <CardDescription>
          Sigue estos pasos para comenzar a organizar tus finanzas
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-3 gap-4">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive = index === currentStep;
            
            return (
              <div
                key={index}
                className={cn(
                  "relative p-4 rounded-lg border transition-all cursor-pointer",
                  isActive
                    ? "border-accent bg-card shadow-sm"
                    : "border-border/50 bg-card/50 hover:bg-card"
                )}
                onClick={() => setCurrentStep(index)}
              >
                {/* Step number */}
                <div className={cn(
                  "absolute -top-2 -left-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "bg-muted text-muted-foreground"
                )}>
                  {index + 1}
                </div>

                <div className="flex flex-col items-start">
                  <Icon className={cn(
                    "w-8 h-8 mb-3",
                    isActive ? "text-accent" : "text-muted-foreground"
                  )} />
                  <h4 className="font-medium text-foreground mb-1">{step.title}</h4>
                  <p className="text-sm text-muted-foreground mb-3">{step.description}</p>
                  
                  {isActive && (
                    <Link to={step.link}>
                      <Button size="sm" className="mt-2">
                        {step.cta}
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/50">
          <p className="text-xs text-muted-foreground">
            ¿Necesitas ayuda? <Link to="/contact" className="text-primary hover:underline">Contáctanos</Link>
          </p>
          <Button variant="ghost" size="sm" onClick={handleDismiss}>
            No mostrar de nuevo
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
