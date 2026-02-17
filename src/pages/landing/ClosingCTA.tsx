import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

export default function ClosingCTA() {
  return (
    <section className="py-28 bg-background">
      <div className="container mx-auto px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-5 leading-tight tracking-tight">
            Tus números ya están hablando.
            <br />
            <span className="text-success">Ahora puedes escucharlos.</span>
          </h2>
          <p className="text-muted-foreground text-lg mb-10 max-w-lg mx-auto">
            Únete a los empresarios colombianos que ya toman decisiones con información real.
          </p>
          <Link to="/signup">
            <Button size="lg" className="h-14 px-10 text-base font-semibold">
              Empieza gratis
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
          <p className="text-xs text-muted-foreground mt-5">
            Sin tarjeta de crédito · Sin contrato · Cancela cuando quieras
          </p>
        </div>
      </div>
    </section>
  );
}
