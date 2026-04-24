import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FileSpreadsheet, Shield, Lock, MessageCircle, Sparkles, CheckCircle2 } from 'lucide-react';
import Footer from '@/components/layout/Footer';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useToast } from '@/hooks/use-toast';
import PricingToggle from '@/components/pricing/PricingToggle';
import PricingCard from '@/components/pricing/PricingCard';
import SubscriptionConfirmModal from '@/components/pricing/SubscriptionConfirmModal';
import { plans } from '@/components/pricing/pricingPlans';

const BRAND = 'oklch(0.43 0.14 155)';
const INK = '#1d1d1f';
const INK2 = '#6e6e73';
const INK3 = '#a1a1a6';
const SURFACE = '#f5f5f7';

const FAQS = [
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
];

export default function Pricing() {
  const { user } = useAuth();
  const { plan: currentPlan, createWompiCheckout } = useSubscription();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [isAnnual, setIsAnnual] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<typeof plans[0] | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

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
      const planKey = selectedPlan.id + (isAnnual ? '-anual' : '');
      const url = await createWompiCheckout(planKey);
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
    <div style={{ minHeight: '100vh', background: SURFACE, display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'rgba(255,255,255,0.82)',
          backdropFilter: 'saturate(180%) blur(20px)',
          WebkitBackdropFilter: 'saturate(180%) blur(20px)',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
        }}
      >
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: `linear-gradient(135deg, ${BRAND}, oklch(0.55 0.12 165))`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <FileSpreadsheet style={{ width: 16, height: 16, color: '#fff' }} />
            </div>
            <span style={{ fontSize: 17, fontWeight: 700, color: INK, letterSpacing: '-0.3px' }}>AluminIA</span>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {user ? (
              <Link to="/dashboard">
                <button style={pillButton(true)}>Ir al Dashboard</button>
              </Link>
            ) : (
              <>
                <Link to="/login" style={{ textDecoration: 'none' }}>
                  <button style={pillButton(false)}>Iniciar sesión</button>
                </Link>
                <Link to="/signup" style={{ textDecoration: 'none' }}>
                  <button style={pillButton(true)}>Crear cuenta</button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section style={{ padding: '72px 24px 32px', textAlign: 'center' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 12px',
              borderRadius: 99,
              background: 'oklch(0.43 0.14 155 / 0.10)',
              color: BRAND,
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.1px',
              marginBottom: 20,
            }}
          >
            <Sparkles style={{ width: 12, height: 12 }} />
            Planes simples y transparentes
          </span>
          <h1
            style={{
              fontSize: 44,
              fontWeight: 700,
              color: INK,
              margin: 0,
              letterSpacing: '-1.5px',
              lineHeight: 1.1,
            }}
          >
            Elige el plan perfecto para tu negocio
          </h1>
          <p
            style={{
              fontSize: 17,
              color: INK2,
              maxWidth: 560,
              margin: '16px auto 28px',
              lineHeight: 1.5,
            }}
          >
            Empieza gratis. Escala cuando estés listo. Sin tarjeta, sin sorpresas.
          </p>
          <PricingToggle isAnnual={isAnnual} onToggle={setIsAnnual} />
        </div>
      </section>

      {paymentSuccess && (
        <div style={{ maxWidth: 760, margin: '0 auto 24px', padding: '0 24px', width: '100%' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 18px',
              background: 'oklch(0.43 0.14 155 / 0.08)',
              border: '1px solid oklch(0.43 0.14 155 / 0.20)',
              borderRadius: 12,
            }}
          >
            <CheckCircle2 style={{ width: 18, height: 18, color: BRAND, flexShrink: 0 }} />
            <p style={{ fontSize: 13, color: BRAND, margin: 0, fontWeight: 500 }}>
              ¡Pago procesado! Tu plan se activará en unos momentos. Si no ves el cambio, recarga la página.
            </p>
          </div>
        </div>
      )}

      <section style={{ padding: '40px 24px 48px' }}>
        <div
          style={{
            maxWidth: 1100,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 20,
            alignItems: 'start',
          }}
        >
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
      </section>

      <section style={{ padding: '16px 24px 48px', textAlign: 'center' }}>
        <p style={{ fontSize: 15, color: INK2, fontWeight: 500, maxWidth: 520, margin: '0 auto' }}>
          Empieza con orden financiero. Escala a control fiscal y de inventario.
        </p>
      </section>

      <section style={{ padding: '32px 24px', background: '#fff', borderTop: '1px solid rgba(0,0,0,0.05)', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
        <div
          style={{
            maxWidth: 900,
            margin: '0 auto',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 40,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: INK2 }}>
            <Shield style={{ width: 18, height: 18, color: BRAND }} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>Pagos seguros con Wompi</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: INK2 }}>
            <Lock style={{ width: 18, height: 18, color: BRAND }} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>Datos protegidos con encriptación</span>
          </div>
        </div>
      </section>

      <section style={{ padding: '72px 24px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <h2
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: INK,
              textAlign: 'center',
              letterSpacing: '-0.8px',
              margin: '0 0 40px 0',
            }}
          >
            Preguntas frecuentes
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {FAQS.map((faq, i) => {
              const open = openFaq === i;
              return (
                <div
                  key={i}
                  style={{
                    background: '#fff',
                    border: '1px solid rgba(0,0,0,0.07)',
                    borderRadius: 14,
                    overflow: 'hidden',
                    transition: 'border-color 0.2s',
                    borderColor: open ? 'oklch(0.43 0.14 155 / 0.30)' : 'rgba(0,0,0,0.07)',
                  }}
                >
                  <button
                    onClick={() => setOpenFaq(open ? null : i)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '18px 20px',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: 14,
                      fontWeight: 600,
                      color: INK,
                      letterSpacing: '-0.1px',
                    }}
                  >
                    <span>{faq.q}</span>
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 99,
                        background: open ? BRAND : '#f5f5f7',
                        color: open ? '#fff' : INK2,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 16,
                        fontWeight: 400,
                        transition: 'all 0.2s',
                        flexShrink: 0,
                        marginLeft: 12,
                      }}
                    >
                      {open ? '−' : '+'}
                    </span>
                  </button>
                  {open && (
                    <div
                      style={{
                        padding: '0 20px 18px',
                        fontSize: 13,
                        color: INK2,
                        lineHeight: 1.6,
                        animation: 'fadeUp 0.25s ease-out',
                      }}
                    >
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section style={{ padding: '56px 24px', background: '#fff', borderTop: '1px solid rgba(0,0,0,0.05)', textAlign: 'center' }}>
        <h3 style={{ fontSize: 22, fontWeight: 700, color: INK, margin: 0, letterSpacing: '-0.5px' }}>
          ¿Necesitas un plan personalizado?
        </h3>
        <p style={{ fontSize: 14, color: INK2, margin: '8px 0 22px' }}>
          Contáctanos para discutir soluciones empresariales a medida.
        </p>
        <Link to="/contact" style={{ textDecoration: 'none' }}>
          <button
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 22px',
              height: 44,
              border: '1.5px solid rgba(0,0,0,0.12)',
              borderRadius: 10,
              background: '#fff',
              color: INK,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = BRAND;
              e.currentTarget.style.color = BRAND;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)';
              e.currentTarget.style.color = INK;
            }}
          >
            <MessageCircle style={{ width: 16, height: 16 }} />
            Contactar ventas
          </button>
        </Link>
      </section>

      <Footer />

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

function pillButton(primary: boolean): React.CSSProperties {
  return {
    height: 34,
    padding: '0 14px',
    borderRadius: 99,
    border: primary ? 'none' : '1px solid rgba(0,0,0,0.10)',
    background: primary ? INK : '#fff',
    color: primary ? '#fff' : INK,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s',
  };
}
