import { Link, Navigate } from 'react-router-dom';
import { FileSpreadsheet } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import MobileNav from '@/components/layout/MobileNav';
import Footer from '@/components/layout/Footer';
import AnnouncementBar from './landing/AnnouncementBar';
import HeroSection from './landing/HeroSection';
import SocialProofStrip from './landing/SocialProofStrip';
import NicoCoachSection from './landing/NicoCoachSection';
import PYGSection from './landing/PYGSection';
import DIANSection from './landing/DIANSection';
import HowItWorksSection from './landing/HowItWorksSection';
import ForEntrepreneursSection from './landing/ForEntrepreneursSection';
import FAQSection from './landing/FAQSection';
import ClosingCTA from './landing/ClosingCTA';

export default function Index() {
  const { user, loading } = useAuth();

  // If user is authenticated, redirect to dashboard
  if (!loading && user) {
    return <Navigate to="/dashboard" replace />;
  }
  return (
    <div className="min-h-screen bg-background flex flex-col" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif" }}>
      {/* Announcement bar */}
      <AnnouncementBar />

      {/* Navigation */}
      <nav style={{
        position: 'fixed', top: 36, left: 0, right: 0, zIndex: 100,
        height: 60,
        background: 'rgba(255,255,255,0.72)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 28px',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif",
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
            <FileSpreadsheet className="w-5 h-5 text-white" />
          </div>
          <span style={{ fontSize: 17, fontWeight: 600, color: '#1d1d1f', letterSpacing: '-0.2px' }}>AluminIA</span>
        </div>

        {/* Desktop nav */}
        <div className="hidden md:flex" style={{ alignItems: 'center', gap: 24 }}>
          <Link
            to="/pricing"
            style={{ fontSize: 13, color: 'rgba(29,29,31,0.7)', textDecoration: 'none' }}
          >
            Precios
          </Link>
          <Link
            to="/contact"
            style={{ fontSize: 13, color: 'rgba(29,29,31,0.7)', textDecoration: 'none' }}
          >
            Contacto
          </Link>
          <Link
            to="/login"
            style={{ fontSize: 13, color: 'rgba(29,29,31,0.7)', textDecoration: 'none' }}
          >
            Iniciar Sesión
          </Link>
          <Link to="/signup">
            <button
              style={{
                borderRadius: 999,
                background: '#1d1d1f',
                color: '#fff',
                height: 36,
                padding: '0 18px',
                fontSize: 13,
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Crear Cuenta
            </button>
          </Link>
        </div>

        {/* Mobile nav */}
        <MobileNav isAuthenticated={false} />
      </nav>

      {/* Page sections */}
      <main className="flex-1" style={{ paddingTop: 96 }}>
        <HeroSection />
        <SocialProofStrip />
        <NicoCoachSection />
        <PYGSection />
        <DIANSection />
        <HowItWorksSection />
        <ForEntrepreneursSection />
        <FAQSection />
        <ClosingCTA />
      </main>

      <Footer />
    </div>
  );
}
