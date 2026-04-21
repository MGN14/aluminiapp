import { useState } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import NicoAgentsView from '@/components/nico/NicoAgentsView';
import NicoPronosticos from '@/components/nico/NicoPronosticos';
import NicoPatrones from '@/components/nico/NicoPatrones';
import NicoReglas from '@/pages/nico/Reglas';
import nicoAvatar from '@/assets/nico-avatar.png';
import { useSubscription } from '@/hooks/useSubscription';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Lock, Loader2, MessageSquare, TrendingUp, Layers, Zap } from 'lucide-react';

type Tab = 'chat' | 'pronosticos' | 'patrones' | 'reglas';

export default function NicoPage() {
  const { plan, loading: subLoading, isAdmin, isFounder, isTrialing } = useSubscription();
  const navigate = useNavigate();
  const location = useLocation();
  // Initialize tab from URL (/nico/reglas → reglas)
  const initialTab: Tab = location.pathname.endsWith('/reglas') ? 'reglas' : 'chat';
  const [tab, setTab] = useState<Tab>(initialTab);

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
          </p>
          <Button onClick={() => navigate('/pricing')}>Activar Plan</Button>
        </div>
      </AppLayout>
    );
  }

  const tabBtn = (id: Tab, icon: JSX.Element, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
        tab === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  const isChatTab = tab === 'chat';

  return (
    <AppLayout>
      <div className={isChatTab ? 'max-w-6xl mx-auto' : 'max-w-3xl mx-auto'}>
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl overflow-hidden border border-border shadow-sm bg-muted">
              <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Nico</h1>
              <p className="text-sm text-muted-foreground">Tu equipo financiero con IA — 6 agentes con memoria</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center bg-muted/60 rounded-lg p-0.5 w-fit mb-5 flex-wrap">
          {tabBtn('chat', <MessageSquare className="h-4 w-4" />, 'Agentes')}
          {tabBtn('pronosticos', <TrendingUp className="h-4 w-4" />, 'Pronósticos')}
          {tabBtn('patrones', <Layers className="h-4 w-4" />, 'Patrones')}
          {tabBtn('reglas', <Zap className="h-4 w-4" />, 'Reglas')}
        </div>

        {/* Contenido */}
        {tab === 'chat' && <NicoAgentsView />}

        {tab === 'pronosticos' && (
          <div className="bg-card border border-border rounded-2xl shadow-sm p-5">
            <NicoPronosticos />
          </div>
        )}

        {tab === 'patrones' && (
          <div className="bg-card border border-border rounded-2xl shadow-sm p-5">
            <NicoPatrones onPreguntarNico={() => setTab('chat')} />
          </div>
        )}

        {tab === 'reglas' && (
          <div className="bg-card border border-border rounded-2xl shadow-sm p-5">
            <NicoReglas />
          </div>
        )}
      </div>
    </AppLayout>
  );
}
