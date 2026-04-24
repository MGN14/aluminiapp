import { useState } from 'react';
import { Plus, Package, Upload, ClipboardCheck, History, BookOpen, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useInventoryData, type ProductWithMetrics } from '@/hooks/useInventoryData';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import InventoryMetrics from '@/components/inventory/InventoryMetrics';
import InventoryInsights from '@/components/inventory/InventoryInsights';
import InventoryChart from '@/components/inventory/InventoryChart';
import InventoryTable from '@/components/inventory/InventoryTable';
import AddProductModal from '@/components/inventory/AddProductModal';
import AdjustStockModal from '@/components/inventory/AdjustStockModal';
import BulkUploadModal from '@/components/inventory/BulkUploadModal';
import PhysicalCountModal from '@/components/inventory/PhysicalCountModal';
import MaestroProductos from '@/components/inventory/MaestroProductos';
import AppLayout from '@/components/layout/AppLayout';

type Tab = 'inventario' | 'maestro';

export default function Inventory() {
  const { products, movements, metrics, loading, addProduct, addMovement, refetch } = useInventoryData();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('inventario');
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [showPhysical, setShowPhysical] = useState(false);
  const [siigoSyncing, setSiigoSyncing] = useState(false);
  const [adjustProduct, setAdjustProduct] = useState<ProductWithMetrics | null>(null);
  const [adjustMode, setAdjustMode] = useState<'adjust' | 'entrada' | 'salida'>('adjust');

  const handleSiigoSync = async () => {
    setSiigoSyncing(true);
    try {
      // Step 1: sync product catalog from Siigo /v1/products
      const sync = await supabase.functions.invoke('siigo-sync-products', { body: {} });
      if (sync.error) throw sync.error;
      if (!sync.data?.ok) throw new Error(sync.data?.error || 'Sincronización falló');

      // Step 2: recalculate cost_per_unit from purchase invoices (Plan B —
      // Siigo's API doesn't expose the "Saldo de productos y valoración de
      // inventarios" report, so we compute weighted-avg cost from compras).
      const recalc = await supabase.functions.invoke('recalculate-inventory-costs', { body: {} });
      const recalcData = recalc.data ?? {};

      await refetch();

      const synced = sync.data.synced ?? 0;
      const updated = recalcData.updated ?? 0;
      const skippedBits = sync.data.skipped ? `, ${sync.data.skipped} omitidos` : '';
      const costBits = updated > 0
        ? ` Costos recalculados desde compras: ${updated} productos.`
        : recalcData.message ? ` ${recalcData.message}` : '';

      toast({
        title: 'Inventario sincronizado',
        description: `${synced} productos importados desde Siigo${skippedBits}.${costBits}`,
      });
    } catch (e: any) {
      toast({
        title: 'No se pudo sincronizar',
        description: e.message ?? 'Verifica que tengas Siigo conectado en Ajustes.',
        variant: 'destructive',
      });
    } finally {
      setSiigoSyncing(false);
    }
  };

  const openMovement = (product: ProductWithMetrics, type: 'entrada' | 'salida') => {
    setAdjustProduct(product);
    setAdjustMode(type);
  };

  const openAdjust = (product: ProductWithMetrics) => {
    setAdjustProduct(product);
    setAdjustMode('adjust');
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        {/* Tabs */}
        <div className="flex items-center bg-muted/60 rounded-lg p-0.5 w-fit">
          <button
            onClick={() => setTab('inventario')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === 'inventario' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Package className="h-4 w-4" />
            Inventario
          </button>
          <button
            onClick={() => setTab('maestro')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === 'maestro' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <BookOpen className="h-4 w-4" />
            Maestro de Productos
          </button>
        </div>

        {/* Header */}
        {tab === 'inventario' && <div className="flex items-center justify-between animate-fade-in">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/10 flex items-center justify-center border border-white/[0.06]">
              <Package className="h-6 w-6 text-blue-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Inventario bajo control</h1>
              <p className="text-sm text-muted-foreground">
                {loading ? 'Cargando...' : `${metrics.totalProducts} referencias activas`}
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <Button
              variant="outline"
              onClick={() => setShowPhysical(true)}
              size="sm"
              className="gap-2 rounded-xl border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
            >
              <ClipboardCheck className="h-4 w-4" />
              Inventario físico
            </Button>
            <Button
              variant="outline"
              onClick={handleSiigoSync}
              disabled={siigoSyncing}
              size="sm"
              className="gap-2 rounded-xl border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
            >
              {siigoSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Traer de Siigo
            </Button>
            <Button variant="outline" onClick={() => setShowBulk(true)} size="sm" className="gap-2 rounded-xl">
              <Upload className="h-4 w-4" />
              Carga CSV
            </Button>
            <Button onClick={() => setShowAdd(true)} size="sm" className="gap-2 rounded-xl">
              <Plus className="h-4 w-4" />
              Agregar producto
            </Button>
          </div>
        </div>}

        {/* Maestro tab */}
        {tab === 'maestro' && (
          <div className="animate-fade-in">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-foreground">Maestro de Productos</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Tabla maestra de referencias — Siigo, Local, Proveedor A/B/C y unidad de medida.
                Solo el administrador puede editar.
              </p>
            </div>
            <MaestroProductos />
          </div>
        )}

        {tab === 'inventario' && (loading ? (
          <div className="flex items-center justify-center py-32">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <>
            {/* Insights Nico */}
            <div className="animate-slide-up opacity-0 [animation-fill-mode:forwards]" style={{ animationDelay: '0ms' }}>
              <InventoryInsights products={products} metrics={metrics} />
            </div>

            {/* Metric Cards */}
            <div className="animate-slide-up opacity-0 [animation-fill-mode:forwards]" style={{ animationDelay: '80ms' }}>
              <InventoryMetrics metrics={metrics} />
            </div>

            {/* Chart */}
            <div className="animate-slide-up opacity-0 [animation-fill-mode:forwards]" style={{ animationDelay: '160ms' }}>
              <InventoryChart movements={movements} />
            </div>

            {/* Table */}
            <div className="animate-slide-up opacity-0 [animation-fill-mode:forwards]" style={{ animationDelay: '240ms' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">Inventario operativo</h3>
              </div>
              <InventoryTable products={products} onAdjust={openAdjust} onAddMovement={openMovement} />
            </div>

            {/* Historial de ajustes */}
            {movements.filter((m: any) => ['ajuste', 'salida'].includes(m.movement_type) && m.notes && m.notes.includes('[') ).length > 0 && (
              <div className="animate-slide-up opacity-0 [animation-fill-mode:forwards]" style={{ animationDelay: '320ms' }}>
                <div className="flex items-center gap-2 mb-3">
                  <History className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium text-muted-foreground">Historial de ajustes con motivo</h3>
                </div>
                <div className="rounded-xl border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left px-3 py-2 font-semibold">Fecha</th>
                        <th className="text-left px-3 py-2 font-semibold">Producto</th>
                        <th className="text-left px-3 py-2 font-semibold">Motivo</th>
                        <th className="text-right px-3 py-2 font-semibold">Cantidad</th>
                        <th className="text-right px-3 py-2 font-semibold">Tipo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements
                        .filter((m: any) => ['ajuste', 'salida', 'entrada'].includes(m.movement_type) && m.notes)
                        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                        .slice(0, 20)
                        .map((m: any) => {
                          const producto = products.find((p: any) => p.id === m.product_id);
                          const date = new Date(m.created_at);
                          return (
                            <tr key={m.id} className="border-t border-border">
                              <td className="px-3 py-2 text-muted-foreground">{date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}</td>
                              <td className="px-3 py-2 font-medium">{producto?.reference || '—'}</td>
                              <td className="px-3 py-2 text-muted-foreground">{m.notes}</td>
                              <td className="text-right px-3 py-2 font-mono">{m.quantity}</td>
                              <td className="text-right px-3 py-2">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  m.movement_type === 'entrada' ? 'bg-green-100 text-green-700' :
                                  m.movement_type === 'salida' ? 'bg-red-100 text-red-700' :
                                  'bg-muted text-muted-foreground'
                                }`}>{m.movement_type}</span>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ))}
      </div>

      <AddProductModal open={showAdd} onOpenChange={setShowAdd} onSubmit={addProduct} />
      <BulkUploadModal open={showBulk} onOpenChange={setShowBulk} onComplete={refetch} />
      <PhysicalCountModal open={showPhysical} onOpenChange={setShowPhysical} onComplete={refetch} />
      <AdjustStockModal
        open={!!adjustProduct}
        onOpenChange={(open) => { if (!open) setAdjustProduct(null); }}
        product={adjustProduct}
        mode={adjustMode}
        onSubmitMovement={addMovement}
      />
    </AppLayout>
  );
}
