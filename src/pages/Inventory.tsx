import { useState, useMemo } from 'react';
import { Plus, Package, Upload, ClipboardCheck, BookOpen, RefreshCw, Loader2, FileText, ScrollText, ArrowDownToLine, CheckCheck, Layers, ScanLine } from 'lucide-react';
import ConteoFisicoPanel from '@/components/scanner/ConteoFisicoPanel';
import ProbarPistolaPanel from '@/components/scanner/ProbarPistolaPanel';
import { Button } from '@/components/ui/button';
import { useInventoryData, type ProductWithMetrics } from '@/hooks/useInventoryData';
import { useModuleContext } from '@/hooks/useModuleContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import InventoryMetrics from '@/components/inventory/InventoryMetrics';
import InventoryInsights from '@/components/inventory/InventoryInsights';
import ReorderAlerts from '@/components/inventory/ReorderAlerts';
import InventoryChart from '@/components/inventory/InventoryChart';
import InventoryTable from '@/components/inventory/InventoryTable';
import AddProductModal from '@/components/inventory/AddProductModal';
import AdjustStockModal from '@/components/inventory/AdjustStockModal';
import BulkUploadModal from '@/components/inventory/BulkUploadModal';
import PhysicalCountModal from '@/components/inventory/PhysicalCountModal';
import MaestroProductos from '@/components/inventory/MaestroProductos';
import VariantInventoryPanel from '@/components/inventory/VariantInventoryPanel';
import EntradaInventarioModal from '@/components/inventory/EntradaInventarioModal';
import ManageSystemsModal from '@/components/inventory/ManageSystemsModal';
import InventoryFreshnessBanner from '@/components/inventory/InventoryFreshnessBanner';
import AppLayout from '@/components/layout/AppLayout';
import { usePersistedDialogOpen, usePersistedFormState } from '@/hooks/usePersistedFormState';

type Tab = 'inventario' | 'variantes' | 'maestro' | 'conteo';

export default function Inventory() {
  const { isGerencial } = useModuleContext();
  const dataSource = isGerencial ? 'gerencial' : 'dian';
  const { products, movements, metrics, loading, addProduct, updateProduct, addMovement, registerEntradaManual, cuadrarInventario, refetch } = useInventoryData(dataSource);
  const { toast } = useToast();

  const existingSystems = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const s = (p.system ?? '').trim();
      if (s) set.add(s);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  }, [products]);
  // Persistido en sessionStorage: si Nico cambia de pestaña/app y vuelve, el
  // tab (Inventario / Maestro) se mantiene en vez de resetear a 'inventario'.
  const [tab, setTab] = usePersistedFormState<Tab>('inventario:tab:v1', 'inventario');
  const [conteoSub, setConteoSub] = useState<'contar' | 'probar'>('contar');
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [showEntrada, setShowEntrada] = useState(false);
  const [showSystems, setShowSystems] = useState(false);
  const [cuadreLoading, setCuadreLoading] = useState(false);
  // El modal de conteo físico persiste su estado abierto: si el usuario
  // está en medio del wizard (subiendo / mapeando / revisando el cruce) y
  // se sale o refresca, al volver el modal se reabre y el wizard sigue
  // donde estaba (PhysicalCountModal persiste su propio wizard state).
  const [showPhysical, setShowPhysical] = usePersistedDialogOpen('inventario:conteo-fisico:open');
  const [siigoSyncing, setSiigoSyncing] = useState(false);
  const [adjustProduct, setAdjustProduct] = useState<ProductWithMetrics | null>(null);
  const [adjustMode, setAdjustMode] = useState<'adjust' | 'entrada' | 'salida'>('adjust');
  const [editProduct, setEditProduct] = useState<ProductWithMetrics | null>(null);

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

  const openEdit = (product: ProductWithMetrics) => {
    setEditProduct(product);
  };

  // Cuadre global del inventario teórico: el stock físico contado pasa a ser
  // el nuevo punto de partida (inicial) de cada referencia.
  const handleCuadrarInventario = async () => {
    const ok = window.confirm(
      'Cuadrar inventario teórico\n\n' +
      'El stock físico contado de cada referencia pasará a ser su nuevo punto de partida (inicial). ' +
      'Las entradas y remisiones se contarán desde hoy.\n\n' +
      'Hacé esto después de un conteo físico. ¿Continuar?',
    );
    if (!ok) return;
    setCuadreLoading(true);
    await cuadrarInventario();
    setCuadreLoading(false);
  };

  // Eliminar referencia del inventario. Útil para refs basura que entraron
  // del sync de Siigo (ej: "transporte", "producto generico", "servicios").
  // Soft delete: marcamos active=false para no romper FKs de movimientos /
  // remisiones históricas que apunten a ese producto.
  const handleDeleteProduct = async (product: ProductWithMetrics) => {
    const ok = window.confirm(
      `¿Eliminar "${product.reference} — ${product.name}" del inventario?\n\n` +
      `La referencia se ocultará de la lista. Los movimientos históricos no se borran.`,
    );
    if (!ok) return;
    try {
      const { error } = await supabase
        .from('inventory_products')
        .update({ active: false })
        .eq('id', product.id);
      if (error) throw error;
      await refetch();
      toast({ title: 'Referencia eliminada', description: `${product.reference} ya no aparece en el inventario.` });
    } catch (err: any) {
      toast({ title: 'Error al eliminar', description: err.message, variant: 'destructive' });
    }
  };

  const handleUpdateProduct = async (data: { reference: string; name: string; unit: string; stock_system: number; cost_per_unit: number; sale_price: number; min_stock: number; system: string | null }) => {
    if (!editProduct) return false;
    // No permitimos cambiar la referencia (es ID lógico). Resto sí.
    const { reference: _ref, ...updates } = data;
    return await updateProduct(editProduct.id, updates) ?? false;
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
            onClick={() => setTab('variantes')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === 'variantes' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Layers className="h-4 w-4" />
            Por variante
          </button>
          <button
            onClick={() => setTab('maestro')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === 'maestro' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <BookOpen className="h-4 w-4" />
            Maestro de Productos
          </button>
          <button
            onClick={() => setTab('conteo')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${tab === 'conteo' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <ScanLine className="h-4 w-4" />
            Conteo físico
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
              {isGerencial && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowEntrada(true)}
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
                      cursor: 'pointer',
                      transition: 'background 0.15s, border-color 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'oklch(0.43 0.14 155 / 0.08)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}
                  >
                    <ArrowDownToLine style={{ width: 14, height: 14 }} />
                    Registrar entrada
                  </button>
                  <button
                    type="button"
                    onClick={handleCuadrarInventario}
                    disabled={cuadreLoading}
                    title="El stock físico contado pasa a ser el nuevo punto de partida (inicial) del teórico"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      height: 36,
                      padding: '0 14px',
                      borderRadius: 10,
                      background: '#fff',
                      border: '1.5px solid oklch(0.55 0.17 70 / 0.30)',
                      color: 'oklch(0.55 0.17 70)',
                      fontSize: 13,
                      fontWeight: 500,
                      fontFamily: 'inherit',
                      cursor: cuadreLoading ? 'not-allowed' : 'pointer',
                      opacity: cuadreLoading ? 0.6 : 1,
                      transition: 'background 0.15s, border-color 0.15s',
                    }}
                    onMouseEnter={(e) => { if (!cuadreLoading) e.currentTarget.style.background = 'oklch(0.70 0.17 70 / 0.08)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}
                  >
                    {cuadreLoading ? (
                      <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />
                    ) : (
                      <CheckCheck style={{ width: 14, height: 14 }} />
                    )}
                    Cuadrar inventario
                  </button>
                </>
              )}
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
              {existingSystems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowSystems(true)}
                  title="Renombrar, fusionar o borrar sistemas (limpiar duplicados)"
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
                  <Layers style={{ width: 14, height: 14 }} />
                  Sistemas
                </button>
              )}
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

        {/* Inventario por variante (color) */}
        {tab === 'variantes' && <VariantInventoryPanel />}

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

        {/* Conteo físico tab (escáner) */}
        {tab === 'conteo' && (
          <div className="animate-fade-in space-y-4">
            <div className="flex items-center bg-muted/60 rounded-lg p-0.5 w-fit">
              <button
                onClick={() => setConteoSub('contar')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${conteoSub === 'contar' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <ClipboardCheck className="h-4 w-4" /> Contar
              </button>
              <button
                onClick={() => setConteoSub('probar')}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${conteoSub === 'probar' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <ScanLine className="h-4 w-4" /> Probar pistola
              </button>
            </div>
            {conteoSub === 'contar' ? <ConteoFisicoPanel products={products} /> : <ProbarPistolaPanel />}
          </div>
        )}

        {/* Spinner SOLO en carga inicial (sin datos). En refetches mantenemos
            la tabla montada para no perder filtros / búsqueda / scroll. */}
        {tab === 'inventario' && (loading && products.length === 0 ? (
          <div className="flex items-center justify-center py-32">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <>
            {/* Insights Nico */}
            <div className="animate-slide-up opacity-0 [animation-fill-mode:forwards]" style={{ animationDelay: '0ms' }}>
              <InventoryInsights products={products} metrics={metrics} />
            </div>

            {/* Freshness banner — fechas de última sync Siigo y último conteo físico */}
            <div className="animate-slide-up opacity-0 [animation-fill-mode:forwards]" style={{ animationDelay: '40ms' }}>
              <InventoryFreshnessBanner
                lastSiigoSyncAt={metrics.lastSiigoSyncAt}
                lastPhysicalCountAt={metrics.lastPhysicalCountAt}
              />
            </div>

            {/* Alertas de reorden — qué referencias reponer y cuánto */}
            <div className="animate-slide-up opacity-0 [animation-fill-mode:forwards]" style={{ animationDelay: '60ms' }}>
              <ReorderAlerts products={products} />
            </div>

            {/* Metric Cards */}
            <div className="animate-slide-up opacity-0 [animation-fill-mode:forwards]" style={{ animationDelay: '80ms' }}>
              <InventoryMetrics metrics={metrics} isGerencial={isGerencial} />
            </div>

            {/* Chart */}
            <div className="animate-slide-up opacity-0 [animation-fill-mode:forwards]" style={{ animationDelay: '160ms' }}>
              <InventoryChart movements={movements} />
            </div>

            {/* Table */}
            <div className="animate-slide-up opacity-0 [animation-fill-mode:forwards]" style={{ animationDelay: '240ms' }}>
              <InventoryTable products={products} onAdjust={openAdjust} onEdit={openEdit} onAddMovement={openMovement} onDelete={handleDeleteProduct} isGerencial={isGerencial} />
            </div>

          </>
        ))}
      </div>

      <AddProductModal open={showAdd} onOpenChange={setShowAdd} onSubmit={addProduct} existingSystems={existingSystems} />
      <AddProductModal
        open={!!editProduct}
        onOpenChange={(open) => { if (!open) setEditProduct(null); }}
        onSubmit={handleUpdateProduct}
        existingSystems={existingSystems}
        initialData={editProduct ? {
          reference: editProduct.reference,
          name: editProduct.name,
          unit: editProduct.unit,
          stock_system: editProduct.stock_system,
          cost_per_unit: editProduct.cost_per_unit,
          sale_price: editProduct.sale_price,
          min_stock: editProduct.min_stock,
          system: editProduct.system ?? null,
        } : null}
      />
      <BulkUploadModal open={showBulk} onOpenChange={setShowBulk} onComplete={refetch} />
      <ManageSystemsModal
        open={showSystems}
        onOpenChange={setShowSystems}
        products={products}
        onComplete={refetch}
      />
      <EntradaInventarioModal open={showEntrada} onOpenChange={setShowEntrada} products={products} onSubmit={registerEntradaManual} />
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
