import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Boxes, Calculator, Ruler, Settings, Factory } from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';
import CotizacionesView from '@/components/productos-terminados/CotizacionesView';
import ConfiguracionView from '@/components/productos-terminados/ConfiguracionView';
import ProduccionView from '@/components/productos-terminados/ProduccionView';
import TemplatesConfigView from '@/components/productos-terminados/TemplatesConfigView';

type Tab = 'cotizaciones' | 'produccion' | 'configuracion';
type ConfigSub = 'plantillas' | 'm2';

export default function ProductosTerminados() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const initialTab: Tab = tabParam === 'configuracion' ? 'configuracion' : tabParam === 'produccion' ? 'produccion' : 'cotizaciones';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [configSub, setConfigSub] = useState<ConfigSub>(
    searchParams.get('sub') === 'm2' ? 'm2' : 'plantillas',
  );

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
            onClick={() => setTab('produccion')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
              tab === 'produccion'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Factory className="h-4 w-4" />
            Producción
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
        {tab === 'produccion' && <ProduccionView />}
        {tab === 'configuracion' && (
          <div className="space-y-5">
            {/* Sub-tabs: plantillas paramétricas vs productos por m² */}
            <div className="flex items-center bg-muted/40 rounded-lg p-0.5 w-fit">
              <button
                onClick={() => setConfigSub('plantillas')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  configSub === 'plantillas'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Ruler className="h-3.5 w-3.5" />
                Plantillas de producto
              </button>
              <button
                onClick={() => setConfigSub('m2')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  configSub === 'm2'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Boxes className="h-3.5 w-3.5" />
                Productos por m²
              </button>
            </div>
            {configSub === 'plantillas' ? <TemplatesConfigView /> : <ConfiguracionView />}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
