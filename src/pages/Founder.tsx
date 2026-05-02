import { useState, useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import { useSubscription } from '@/hooks/useSubscription';
import { Activity, Sparkles, Loader2 } from 'lucide-react';
import AdminAnalytics from './AdminAnalytics';
import NicoPromptEvolution from './NicoPromptEvolution';

type Tab = 'analytics' | 'evolution';

const VALID_TABS: Tab[] = ['analytics', 'evolution'];

/**
 * Cabina founder consolidada — solo niko14_gomez@hotmail.com.
 * Reúne en una sola página los dos paneles internos:
 *   - Analytics (métricas de producto)
 *   - Evolución del system prompt de Nico IA
 */
export default function Founder() {
  const { isFounder, loading } = useSubscription();
  const location = useLocation();
  const navigate = useNavigate();

  // Tab inicial desde ?tab=... o default analytics
  const initialTab: Tab = (() => {
    const t = new URLSearchParams(location.search).get('tab') as Tab | null;
    return t && VALID_TABS.includes(t) ? t : 'analytics';
  })();
  const [tab, setTab] = useState<Tab>(initialTab);

  // Sincronizar tab → query param (para deep-linking y refresh)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('tab') !== tab) {
      params.set('tab', tab);
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    }
  }, [tab, location.pathname, location.search, navigate]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isFounder) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Cabina Founder</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Vista exclusiva de Nico — métricas de producto y evolución del system prompt de Nico IA.
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center bg-muted/60 rounded-lg p-0.5 w-fit">
          <button
            onClick={() => setTab('analytics')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === 'analytics' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Activity className="h-4 w-4" />
            Analytics
          </button>
          <button
            onClick={() => setTab('evolution')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === 'evolution' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Sparkles className="h-4 w-4" />
            Evolución de Nico IA
          </button>
        </div>

        {/* Tab content */}
        {tab === 'analytics' && <AdminAnalytics />}
        {tab === 'evolution' && <NicoPromptEvolution />}
      </div>
    </AppLayout>
  );
}
