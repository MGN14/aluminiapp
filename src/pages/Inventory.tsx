import { useState } from 'react';
import { Plus, Package, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useInventoryData, type ProductWithMetrics } from '@/hooks/useInventoryData';
import InventoryMetrics from '@/components/inventory/InventoryMetrics';
import InventoryInsights from '@/components/inventory/InventoryInsights';
import InventoryChart from '@/components/inventory/InventoryChart';
import InventoryTable from '@/components/inventory/InventoryTable';
import AddProductModal from '@/components/inventory/AddProductModal';
import AdjustStockModal from '@/components/inventory/AdjustStockModal';
import BulkUploadModal from '@/components/inventory/BulkUploadModal';
import AppLayout from '@/components/layout/AppLayout';

export default function Inventory() {
  const { products, movements, metrics, loading, addProduct, addMovement, refetch } = useInventoryData();
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [adjustProduct, setAdjustProduct] = useState<ProductWithMetrics | null>(null);
  const [adjustMode, setAdjustMode] = useState<'adjust' | 'entrada' | 'salida'>('adjust');

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
        {/* Header */}
        <div className="flex items-center justify-between animate-fade-in">
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
          <Button onClick={() => setShowAdd(true)} size="sm" className="gap-2 rounded-xl">
            <Plus className="h-4 w-4" />
            Agregar producto
          </Button>
        </div>

        {loading ? (
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
          </>
        )}
      </div>

      <AddProductModal open={showAdd} onOpenChange={setShowAdd} onSubmit={addProduct} />
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
