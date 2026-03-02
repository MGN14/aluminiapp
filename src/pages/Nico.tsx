import AppLayout from '@/components/layout/AppLayout';
import NicoChat from '@/components/nico/NicoChat';
import nicoAvatar from '@/assets/nico-avatar.png';
import { useSubscription } from '@/hooks/useSubscription';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Lock, Loader2 } from 'lucide-react';

export default function NicoPage() {
  const { plan, trialExpired, loading: subLoading, isAdmin, isFounder, isTrialing } = useSubscription();
  const navigate = useNavigate();

  // Gate: block for demo with expired trial (not trialing, not paid)
  const hasAccess = isAdmin || isFounder || isTrialing || ['basico', 'pro', 'empresarial', 'admin'].includes(plan);

  if (subLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!hasAccess) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-6">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Coach Financiero con IA</h1>
          <p className="text-muted-foreground max-w-md mb-6">
            Nico está disponible en los planes Básico y Empresarial.
            Activa tu plan para acceder a análisis financiero inteligente.
          </p>
          <Button onClick={() => navigate('/pricing')} className="gap-2">
            Activar Plan
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl overflow-hidden border border-border shadow-sm bg-muted">
              <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Nico</h1>
              <p className="text-sm text-muted-foreground">Tu analista financiero inteligente</p>
            </div>
          </div>
          <p className="text-muted-foreground text-sm mt-3 max-w-lg">
            Pregúntale a Nico cualquier cosa sobre tus ingresos, gastos, proveedores o tendencias.
            Usa tus datos reales para darte respuestas ejecutivas y accionables.
          </p>
        </div>

        {/* Chat */}
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <NicoChat />
        </div>
      </div>
    </AppLayout>
  );
}
