import { useState, useMemo } from 'react';
import { Plus, Package, Upload, ClipboardCheck, History, BookOpen, RefreshCw, Loader2, FileText, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useInventoryData, type ProductWithMetrics } from '@/hooks/useInventoryData';
import { useModuleContext } from '@/hooks/useModuleContext';
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
  const { isGerencial } = useModuleContext();
  const dataSource = isGerencial ? 'gerencial' : 'dian';
  const { products, movements, metrics, loading, addProduct, addMovement, refetch } = useInventoryData(dataSource);
  const { toast } = useToast();

  const existingSystems = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const s = (p.system ?? '').trim();
      if (s) set.add(s);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  }, [products]);
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
      // Si Step 2 falla, el sync de Step 1 quedó hecho — informamos
      // explícitamente al usuario en lugar de mostrar éxito completo.
      const recalc = await supabase.functions.invoke('recalculate-inventory-costs', { body: {} });
      await refetch();

      const synced = sync.data.synced ?? 0;
      const skippedBits = sync.data.skipped ? `, ${sync.data.skipped} omitidos` : '';

      if (recalc.error) {
        console.error('recalculate-inventory-costs error:', recalc.error);
        toast({
          title: 'Productos sincronizados, pero falló el recálculo de costos',
          description: `${synced} productos importados desde Siigo${skippedBits}. No pudimos recalcular costos desde compras (${recalc.error.message ?? 'error desconocido'}). Intentá "Sincronizar" de nuevo o ajustá costos manualmente.`,
          variant: 'destructive',
        });
        return;
      }

      const recalcData = recalc.data ?? {};
      const updated = recalcData.updated ?? 0;
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
        {tab === 'inventario' && (
          <div
            className="flex items-center justify-between flex-wrap gap-4"
            style={{ animation: 'fadeUp 0.5s cubic-bezier(0.16,1,0.3,1) both' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background:
                    'linear-gradient(135deg, oklch(0.55 0.15 240 / 0.18), oklch(0.60 0.12 220 / 0.06))',
                  border: '1px solid oklch(0.55 0.15 240 / 0.22)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Package style={{ width: 22, height: 22, color: 'oklch(0.55 0.15 240)' }} />
              </div>
              <div>
                <h1
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    letterSpacing: '-0.8px',
                    color: '#1d1d1f',
                    margin: 0,
                    lineHeight: 1.1,
                  }}
                >
                  Inventario bajo control
                </h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                  <p style={{ fontSize: 13, color: '#6e6e73', margin: 0 }}>
                    {loading ? 'Cargando...' : `${metrics.totalProducts} referencias activas`}
                  </p>
                  <span
                    title={
                      isGerencial
                        ? 'Rotación y días de inventario calculados desde remisiones del Modo Gerencial (operativo real)'
                        : 'Rotación y días de inventario calculados desde facturas de venta (lo que ven la DIAN y los bancos)'
                    }
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 8px',
                      fontSize: 10.5,
                      fontWeight: 600,
                      borderRadius: 999,
                      background: isGerencial ? 'oklch(0.43 0.14 155 / 0.10)' : 'oklch(0.55 0.15 240 / 0.10)',
                      color: isGerencial ? 'oklch(0.43 0.14 155)' : 'oklch(0.55 0.15 240)',
                      border: `1px solid ${isGerencial ? 'oklch(0.43 0.14 155 / 0.22)' : 'oklch(0.55 0.15 240 / 0.22)'}`,
                      letterSpacing: '0.02em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {isGerencial ? <ScrollText style={{ width: 11, height: 11 }} /> : <FileText style={{ width: 11, height: 11 }} />}
                    KPIs según {isGerencial ? 'remisiones gerenciales' : 'facturas DIAN'}
                  </span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowPhysical(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 36,
                  padding: '0 14px',
                  borderRadius: 10,
                  background: '#fff',
                  border: '1.5px solid oklch(0.70 0.17 70 / 0.30)',
                  color: 'oklch(0.55 0.17 70)',
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  transition: 'background 0.15s, border-color 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'oklch(0.70 0.17 70 / 0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#fff';
                }}
              >
                <ClipboardCheck style={{ width: 14, height: 14 }} />
                Inventario físico
              </button>
              <button
                type="button"
                onClick={handleSiigoSync}
                disabled={siigoSyncing}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 36,
                  padding: '0 14px',
                  borderRadius: 10,
                  background: '#fff',
                  border: '1.5px solid oklch(0.43 0.14 155 / 0.30)',
                  color: 'oklch(0.43 0.14 155)',
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  cursor: siigoSyncing ? 'not-allowed' : 'pointer',
                  opacity: siigoSyncing ? 0.6 : 1,
                  transition: 'background 0.15s, border-color 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!siigoSyncing) e.currentTarget.style.background = 'oklch(0.43 0.14 155 / 0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#fff';
                }}
              >
                {siigoSyncing ? (
                  <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />
                ) : (
                  <RefreshCw style={{ width: 14, height: 14 }} />
                )}
                Traer de Siigo
              </button>
              <button
                type="button"
                onClick={() => setShowBulk(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 36,
                  padding: '0 14px',
                  borderRadius: 10,
                  background: '#fff',
                  border: '1.5px solid rgba(0,0,0,0.08)',
                  color: '#1d1d1f',
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  transition: 'background 0.15s, border-color 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#f5f5f7';
                  e.currentTarget.style.borderColor = 'rgba(0,0,0,0.14)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#fff';
                  e.currentTarget.style.borderColor = 'rgba(0,0,0,0.08)';
                }}
              >
                <Upload style={{ width: 14, height: 14 }} />
                Carga CSV
              </button>
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 36,
                  padding: '0 16px',
                  borderRadius: 10,
                  background: '#1d1d1f',
                  border: 'none',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.02)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.18)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <Plus style={{ width: 14, height: 14 }} />
                Agregar producto
              </button>
            </div>
          </div>
        )}

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

      <AddProductModal open={showAdd} onOpenChange={setShowAdd} onSubmit={addProduct} existingSystems={existingSystems} />
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
