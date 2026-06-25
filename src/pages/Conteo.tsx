import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import AppLayout from '@/components/layout/AppLayout';
import { ScanLine, QrCode, MapPin } from 'lucide-react';
import type { InventoryProduct } from '@/hooks/useInventoryData';
import { usePersistedFormState } from '@/hooks/usePersistedFormState';
import ConteoFisicoPanel from '@/components/scanner/ConteoFisicoPanel';
import QrLabelsPanel from '@/components/scanner/QrLabelsPanel';
import UbicacionesPanel from '@/components/scanner/UbicacionesPanel';

type Tab = 'conteo' | 'etiquetas' | 'ubicaciones';

export default function Conteo() {
  const { user } = useAuth();
  const [tab, setTab] = usePersistedFormState<Tab>('conteo:tab:v1', 'conteo');

  const { data: products = [], refetch } = useQuery({
    queryKey: ['scanner-products', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_products')
        .select('*')
        .eq('active', true)
        .order('reference');
      if (error) throw error;
      return (data || []) as InventoryProduct[];
    },
    enabled: !!user?.id,
  });

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div
            className="h-11 w-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: 'linear-gradient(135deg, oklch(0.55 0.18 290 / 0.18), oklch(0.60 0.14 290 / 0.06))',
              border: '1px solid oklch(0.55 0.18 290 / 0.22)',
            }}
          >
            <ScanLine style={{ width: 22, height: 22, color: 'oklch(0.50 0.18 290)' }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#1d1d1f', letterSpacing: '-0.6px' }}>
              Conteo con escáner
            </h1>
            <p className="text-sm text-muted-foreground">
              Inventario físico e impresión de etiquetas QR — pistola Bluetooth + tablet
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center bg-muted/60 rounded-lg p-0.5 w-fit">
          <TabButton active={tab === 'conteo'} onClick={() => setTab('conteo')} icon={ScanLine}>
            Conteo físico
          </TabButton>
          <TabButton active={tab === 'etiquetas'} onClick={() => setTab('etiquetas')} icon={QrCode}>
            Etiquetas QR
          </TabButton>
          <TabButton active={tab === 'ubicaciones'} onClick={() => setTab('ubicaciones')} icon={MapPin}>
            Ubicaciones
          </TabButton>
        </div>

        {tab === 'conteo' && <ConteoFisicoPanel products={products} />}
        {tab === 'etiquetas' && <QrLabelsPanel products={products} onSaved={refetch} />}
        {tab === 'ubicaciones' && <UbicacionesPanel products={products} />}
      </div>
    </AppLayout>
  );
}

function TabButton({ active, onClick, icon: Icon, children }: {
  active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}
