import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Boxes, Calculator, Settings } from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';
import CotizacionesView from '@/components/productos-terminados/CotizacionesView';
import ConfiguracionView from '@/components/productos-terminados/ConfiguracionView';

type Tab = 'cotizaciones' | 'configuracion';

export default function ProductosTerminados() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab: Tab = searchParams.get('tab') === 'configuracion' ? 'configuracion' : 'cotizaciones';
  const [tab, setTab] = useState<Tab>(initialTab);

  // Sync URL ?tab=... cuando cambia el state (deep-link friendly)
  useEffect(() => {
    const current = searchParams.get('tab');
    if (current !== tab) {
      const next = new URLSearchParams(searchParams);
      next.set('tab', tab);
      setSearchParams(next, { replace: true });
    }
  }, [tab, searchParams, setSearchParams]);

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 max-w-6xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Boxes className="h-6 w-6 text-muted-foreground" />
            Productos terminados
          </h1>
        </div>

        {/* Tabs (mismo estilo pill que /inventarios) */}
        <div className="flex items-center bg-muted/60 rounded-lg p-0.5 w-fit">
          <button
            onClick={() => setTab('cotizaciones')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
              tab === 'cotizaciones'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Calculator className="h-4 w-4" />
            Cotizaciones
          </button>
          <button
            onClick={() => setTab('configuracion')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
              tab === 'configuracion'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Settings className="h-4 w-4" />
            Configuración
          </button>
        </div>

        {/* Content */}
        {tab === 'cotizaciones' && (
          <CotizacionesView onSwitchToConfig={() => setTab('configuracion')} />
        )}
        {tab === 'configuracion' && <ConfiguracionView />}
      </div>
    </AppLayout>
  );
}
