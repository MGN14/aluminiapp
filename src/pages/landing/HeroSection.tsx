import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight, CheckCircle, Play } from 'lucide-react';

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-background">
      {/* Subtle background accent */}
      <div className="absolute inset-0 bg-gradient-to-br from-[hsl(152_69%_31%/0.04)] via-transparent to-[hsl(222_47%_20%/0.06)] pointer-events-none" />

      <div className="container mx-auto px-4 pt-24 pb-20 md:pt-32 md:pb-28 relative">
        <div className="max-w-3xl mx-auto text-center">
          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border bg-card text-sm font-medium text-muted-foreground mb-8">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            Copiloto financiero para empresarios en Colombia
          </div>

          {/* Heading */}
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6 tracking-tight">
            Tu copiloto financiero para tomar{' '}
            <span className="text-success">decisiones inteligentes</span>
          </h1>

          {/* Subheading */}
          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
            Automatiza tus extractos bancarios, visualiza tu PyG en segundos y{' '}
            <span className="font-semibold text-foreground">pregúntale a Nico</span>{' '}
            cualquier cosa sobre tu negocio.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <Link to="/signup">
              <Button size="lg" className="h-12 px-8 text-base font-semibold">
                Probar ahora
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <a href="#como-funciona">
              <Button variant="outline" size="lg" className="h-12 px-8 text-base font-medium">
                <Play className="mr-2 h-4 w-4" />
                Ver cómo funciona
              </Button>
            </a>
          </div>

          {/* Trust bullets */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
            {[
              'Compatible con la mayoría de bancos en Colombia',
              'Sin contabilidad complicada',
              'Información clara en minutos',
            ].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-success flex-shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
