import { Link, Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { FileSpreadsheet } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import MobileNav from '@/components/layout/MobileNav';
import Footer from '@/components/layout/Footer';
import HeroSection from './landing/HeroSection';
import NicoCoachSection from './landing/NicoCoachSection';
import PYGSection from './landing/PYGSection';
import DIANSection from './landing/DIANSection';
import HowItWorksSection from './landing/HowItWorksSection';
import ForEntrepreneursSection from './landing/ForEntrepreneursSection';
import ClosingCTA from './landing/ClosingCTA';

export default function Index() {
  const { user, loading } = useAuth();

  // If user is authenticated, redirect to dashboard
  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Navigation */}
      <nav className="border-b border-border bg-card/90 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-foreground">AluminIA</span>
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-4">
            <Link
              to="/pricing"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Precios
            </Link>
            <Link
              to="/contact"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Contacto
            </Link>
            <Link to="/login">
              <Button variant="ghost" size="sm">
                Iniciar Sesión
              </Button>
            </Link>
            <Link to="/signup">
              <Button size="sm">Crear Cuenta</Button>
            </Link>
          </div>

          {/* Mobile nav */}
          <MobileNav isAuthenticated={false} />
        </div>
      </nav>

      {/* Page sections */}
      <main className="flex-1">
        <HeroSection />
        <NicoCoachSection />
        <PYGSection />
        <DIANSection />
        <HowItWorksSection />
        <ForEntrepreneursSection />
        <ClosingCTA />
      </main>

      <Footer />
    </div>
  );
}
