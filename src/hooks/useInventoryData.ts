import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

export interface InventoryProduct {
  id: string;
  reference: string;
  name: string;
  unit: string;
  stock_system: number;
  stock_physical: number | null;
  cost_per_unit: number;
  sale_price: number;
  min_stock: number;
  last_count_date: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  source?: 'manual' | 'siigo';
  siigo_id?: string | null;
  last_siigo_sync_at?: string | null;
  /** Sistema/grupo al que pertenece la referencia (ej: "744", "8025", "proyectante"). */
  system?: string | null;
  /** Punto de ancla del inventario teórico (modo Gerencial). El teórico se
   *  calcula como stock_inicial + entradas manuales − remisiones de venta,
   *  contando solo movimientos posteriores a stock_inicial_date. Null si la
   *  referencia nunca se configuró para teórico. */
  stock_inicial?: number | null;
  stock_inicial_date?: string | null;
}

export type InventoryDataSource = 'dian' | 'gerencial';

export interface InventoryMovement {
  id: string;
  product_id: string;
  movement_type: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  invoice_id: string | null;
  notes: string | null;
  movement_date: string;
  created_at: string;
  /** Origen del movimiento: 'remision', 'entrada_manual', 'factura', etc.
   *  El teórico gerencial solo cuenta 'entrada_manual' (entradas) y
   *  'remision' (salidas de venta). */
  source_type?: string | null;
  source_id?: string | null;
}

export type InventoryStatus = 'critico' | 'alerta' | 'sano' | 'exceso';

export interface ProductWithMetrics extends InventoryProduct {
  difference: number;
  days_of_inventory: number;
  rotation: number;
  status: InventoryStatus;
  avg_daily_sales: number;
  /** Lo que debería haber en bodega. En modo Gerencial se calcula desde
   *  stock_inicial + entradas manuales − remisiones de venta. En modo DIAN
   *  es igual a stock_system (Siigo). */
  teorico: number;
}

export interface InventoryMetrics {
  totalValue: number;
  avgDaysOfInventory: number;
  avgRotation: number;
  pctNoMovement: number;
  totalDifference: number;
  totalDifferenceValue: number;
  totalProducts: number;
  criticalCount: number;
  excessCount: number;
  /** false cuando no hay ningun inventory_movement registrado — los KPIs
   *  de "Días de Inventario" y "Sin Movimiento" no son confiables y la UI
   *  debe mostrar "—" en lugar de 0d/100%. */
  hasMovementData: boolean;
  /** Última fecha en la que se sincronizó el stock_system desde Siigo (MAX
   *  de inventory_products.last_siigo_sync_at). Null si ningún producto
   *  vino de Siigo o nunca se hizo sync. Sirve para contextualizar el
   *  descuadre Siigo vs físico (ej: si la sync fue ayer y el conteo hace
   *  un mes, el descuadre es esperado). */
  lastSiigoSyncAt: string | null;
  /** Última fecha en la que se registró conteo físico (MAX de
   *  inventory_products.last_count_date). Null si nunca se hizo conteo.
   *  El delta entre esta fecha y lastSiigoSyncAt explica los descuadres
   *  por entradas/salidas no contadas todavía. */
  lastPhysicalCountAt: string | null;
}

function classifyStatus(daysOfInventory: number, avgDailySales: number, stock: number): InventoryStatus {
  // Sin stock NO puede haber exceso (antes una ref con 0 en Siigo y sin ventas
  // caía en 'exceso', incoherente). Si hay demanda y no hay stock → agotado
  // (crítico); si no hay demanda ni stock, no hay nada que gestionar → sano.
  if (stock <= 0) return avgDailySales > 0 ? 'critico' : 'sano';
  if (avgDailySales <= 0) return 'exceso'; // stock parado que no rota = exceso
  if (daysOfInventory < 15) return 'critico';
  if (daysOfInventory <= 45) return 'alerta';
  if (daysOfInventory <= 90) return 'sano';
  return 'exceso';
}

/**
 * Hook de inventario.
 *
 * @param dataSource Fuente para calcular ventas/rotación de los últimos 30 días:
 *   - 'dian': usa invoice_items de invoices type='venta' (lo que ven la DIAN y los bancos)
 *   - 'gerencial': usa remision_items de remisiones module_origin='gerencial' (operativo real)
 * Si se omite, usa 'dian' (default seguro).
 */
export function useInventoryData(dataSource: InventoryDataSource = 'dian') {
  const { user } = useAuth();
  const { toast } = useToast();
  const [products, setProducts] = useState<ProductWithMetrics[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<InventoryMetrics>({
    totalValue: 0, avgDaysOfInventory: 0, avgRotation: 0,
    pctNoMovement: 0, totalDifference: 0, totalDifferenceValue: 0,
    totalProducts: 0, criticalCount: 0, excessCount: 0,
    hasMovementData: false,
    lastSiigoSyncAt: null, lastPhysicalCountAt: null,
  });

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    try {
      // Traemos eventos de venta de los últimos 90 días — el chart usa este
      // rango para mostrar diario/semanal/mensual (90d cubre 3 meses).
      // Los KPIs se calculan sobre los últimos 30 días filtrando este array.
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const ninetyDaysAgoIso = ninetyDaysAgo.toISOString().split('T')[0];

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoIso = thirtyDaysAgo.toISOString().split('T')[0];

      // 1. Catálogo + historial completo de movimientos (para auditoría y compatibilidad)
      const [prodRes, movRes] = await Promise.all([
        supabase.from('inventory_products').select('*').eq('active', true).order('reference'),
        supabase.from('inventory_movements').select('*').order('movement_date', { ascending: false }),
      ]);

      if (prodRes.error) throw prodRes.error;
      if (movRes.error) throw movRes.error;

      const rawProducts = (prodRes.data || []) as InventoryProduct[];
      const rawInventoryMovements = (movRes.data || []) as InventoryMovement[];

      // 2. Ventas y compras de los últimos 90 días según fuente del modo.
      //    Devuelve eventos individuales (date, quantity, reference) para
      //    poder construir el chart por bucket — no solo el agregado por ref.
      const [salesEvents, purchaseEvents] = await Promise.all([
        loadRecentSalesEvents(user.id, dataSource, ninetyDaysAgoIso),
        loadRecentPurchaseEvents(user.id, dataSource, ninetyDaysAgoIso),
      ]);

      // Map ref → product_id para mapear eventos sintéticos a productos.
      const productByRef = new Map<string, InventoryProduct>();
      for (const p of rawProducts) {
        const k = (p.reference ?? '').trim().toLowerCase();
        if (k) productByRef.set(k, p);
      }

      // Construir movimientos sintéticos de SALIDA desde la fuente del modo.
      // Esto reemplaza las salidas que antes venían de inventory_movements
      // (que rara vez se popula en producción — las ventas reales están en
      // facturas o remisiones, no en inventory_movements).
      const syntheticSalidas: InventoryMovement[] = salesEvents
        .map(ev => {
          const k = ev.reference.trim().toLowerCase();
          const product = productByRef.get(k);
          if (!product) return null;
          return {
            id: `synthetic-salida-${dataSource}-${ev.sourceId}-${ev.lineIndex}`,
            product_id: product.id,
            movement_type: 'salida',
            quantity: Math.abs(ev.quantity),
            unit_cost: product.cost_per_unit ?? 0,
            total_cost: Math.abs(ev.quantity) * (product.cost_per_unit ?? 0),
            invoice_id: dataSource === 'dian' ? ev.sourceId : null,
            notes: dataSource === 'dian' ? '[Auto: factura venta]' : '[Auto: remisión venta]',
            movement_date: ev.date,
            created_at: ev.date,
          } satisfies InventoryMovement;
        })
        .filter((m): m is InventoryMovement => m !== null);

      // Construir movimientos sintéticos de ENTRADA desde la fuente del modo.
      // Razón: siigo-sync-products solo actualiza stock_system (total acumulado)
      // pero no inserta movimientos individuales — entonces las compras Siigo
      // nunca aparecían en el gráfico. Las entradas reales viven en
      // invoices type='compra' (DIAN, incluye facturas Siigo) o
      // remisiones remision_type='compra' (Gerencial).
      const syntheticEntradas: InventoryMovement[] = purchaseEvents
        .map(ev => {
          const k = ev.reference.trim().toLowerCase();
          const product = productByRef.get(k);
          if (!product) return null;
          return {
            id: `synthetic-entrada-${dataSource}-${ev.sourceId}-${ev.lineIndex}`,
            product_id: product.id,
            movement_type: 'entrada',
            quantity: Math.abs(ev.quantity),
            unit_cost: product.cost_per_unit ?? 0,
            total_cost: Math.abs(ev.quantity) * (product.cost_per_unit ?? 0),
            invoice_id: dataSource === 'dian' ? ev.sourceId : null,
            notes: dataSource === 'dian' ? '[Auto: factura compra]' : '[Auto: remisión compra]',
            movement_date: ev.date,
            created_at: ev.date,
          } satisfies InventoryMovement;
        })
        .filter((m): m is InventoryMovement => m !== null);

      // Movimientos para chart e historial:
      // - Entradas raw de inventory_movements (incluyen las que siigo-sync-products
      //   inserta cuando detecta delta positivo de stock — caso importador que
      //   carga contenedor directo en Siigo sin factura DIAN).
      // - Ajustes manuales raw (movement_type distinto a entrada/salida).
      // - Entradas sintéticas desde facturas de compra DIAN o remisiones compra
      //   gerencial (cuando hay factura/remisión que respalda la compra).
      // - Salidas sintéticas desde facturas de venta DIAN o remisiones venta
      //   gerencial.
      // Excluimos salidas raw para no duplicar (las salidas oficiales son
      // siempre las facturas/remisiones del modo activo).
      const rawNonSalidas = rawInventoryMovements.filter(m => m.movement_type !== 'salida');
      const combinedMovements = [
        ...rawNonSalidas,
        ...syntheticEntradas,
        ...syntheticSalidas,
      ].sort((a, b) => new Date(b.movement_date).getTime() - new Date(a.movement_date).getTime());
      setMovements(combinedMovements);

      // 3. Calcular agregado por reference SOLO para últimos 30 días (KPIs).
      const recentSalesByRef = new Map<string, number>();
      for (const ev of salesEvents) {
        if (ev.date < thirtyDaysAgoIso) continue;
        const k = ev.reference.trim().toLowerCase();
        recentSalesByRef.set(k, (recentSalesByRef.get(k) ?? 0) + Math.abs(ev.quantity));
      }

      // Teórico (modo Gerencial): "lo que debería haber en bodega" sin importar
      // factura/Siigo. Parte del stock_inicial que cargó el usuario y suma
      // entradas manuales / resta remisiones de venta, contando solo los
      // movimientos posteriores a stock_inicial_date (el ancla del último
      // cuadre). En modo DIAN no se calcula — el teórico es igual a Siigo.
      const teoricoByProduct = new Map<string, number>();
      if (dataSource === 'gerencial') {
        for (const p of rawProducts) {
          if (p.stock_inicial === null || p.stock_inicial === undefined) continue;
          const anchorDate = (p.stock_inicial_date ?? '').split('T')[0];
          let entradas = 0;
          let salidas = 0;
          for (const m of rawInventoryMovements) {
            if (m.product_id !== p.id) continue;
            if (anchorDate && m.movement_date < anchorDate) continue;
            if (m.source_type === 'entrada_manual' && m.movement_type === 'entrada') {
              entradas += Number(m.quantity) || 0;
            } else if (m.source_type === 'remision' && m.movement_type === 'salida') {
              salidas += Number(m.quantity) || 0;
            }
          }
          teoricoByProduct.set(p.id, Number(p.stock_inicial) + entradas - salidas);
        }
      }

      const enriched: ProductWithMetrics[] = rawProducts.map(p => {
        const refKey = (p.reference ?? '').trim().toLowerCase();
        const recentSales = recentSalesByRef.get(refKey) ?? 0;

        // En Gerencial el stock "real" es el teórico; en DIAN es Siigo. Si en
        // Gerencial la referencia no tiene stock_inicial cargado, degradamos a
        // Siigo para no dejar la fila vacía (el usuario debería cargarlo).
        const teorico = teoricoByProduct.has(p.id)
          ? teoricoByProduct.get(p.id)!
          : p.stock_system;
        const compareBase = dataSource === 'gerencial' ? teorico : p.stock_system;

        const avgDailySales = recentSales / 30;
        // Stock 0 → 0 días de cobertura (antes daba 999, "cobertura infinita",
        // que no tiene sentido para algo que no tenés). Con stock y sin ventas
        // sí es 999 (cobertura infinita real: stock parado).
        const daysOfInventory = compareBase <= 0 ? 0 : (avgDailySales > 0 ? compareBase / avgDailySales : 999);
        const totalSales30d = recentSales;
        const avgStock = compareBase > 0 ? compareBase : 1;
        const rotation = totalSales30d / avgStock;
        // Math.round: stock_system/physical son numeric de Postgres y arrastran
        // ruido de floating point (ej: 175.99 → DIF +170.99). Las unidades de
        // inventario son enteras, así que la diferencia también.
        const difference = p.stock_physical !== null ? Math.round(compareBase - p.stock_physical) : 0;

        return {
          ...p,
          teorico,
          difference,
          days_of_inventory: Math.round(daysOfInventory),
          rotation: Math.round(rotation * 100) / 100,
          status: classifyStatus(daysOfInventory, avgDailySales, compareBase),
          avg_daily_sales: Math.round(avgDailySales * 100) / 100,
        };
      });

      setProducts(enriched);

      // Aggregate metrics. Valor total usa p.teorico — en DIAN es igual a
      // stock_system, en Gerencial refleja lo que debería haber en bodega.
      const totalValue = enriched.reduce((s, p) => s + p.teorico * p.cost_per_unit, 0);
      const withSales = enriched.filter(p => p.avg_daily_sales > 0);
      const avgDays = withSales.length > 0
        ? withSales.reduce((s, p) => s + p.days_of_inventory, 0) / withSales.length
        : 0;
      const avgRot = enriched.length > 0
        ? enriched.reduce((s, p) => s + p.rotation, 0) / enriched.length
        : 0;
      const noMovement = enriched.filter(p => p.avg_daily_sales === 0).length;
      const pctNo = enriched.length > 0 ? (noMovement / enriched.length) * 100 : 0;
      // Math.round en la suma final — cada p.difference (numeric de Postgres)
      // arrastra ruido de floating point al sumarse, y la suma terminaba en
      // valores como 17379.989999999998. Redondear acá deja el valor limpio
      // para todos los consumidores (Insights, Metrics, score).
      const totalDiff = Math.round(enriched.reduce((s, p) => s + Math.abs(p.difference), 0));
      const totalDiffValue = Math.round(enriched.reduce((s, p) => s + Math.abs(p.difference) * (p.cost_per_unit || 0), 0));

      // hasMovementData refleja si la FUENTE ACTIVA (DIAN/Gerencial) tiene
      // ventas en los últimos 30d. Si no hay, "Días de Inventario" y
      // "Sin Movimiento" no son confiables y la UI los muestra como "—".
      const hasMovementData = recentSalesByRef.size > 0;

      // Trackeo de fechas: cuándo se actualizó Siigo y cuándo se hizo conteo.
      // Sirve para contextualizar descuadres (ej: llegó mercancía hoy y el
      // conteo es de hace un mes → el descuadre es esperado).
      const maxIso = (arr: (string | null | undefined)[]): string | null => {
        let best: string | null = null;
        for (const v of arr) {
          if (!v) continue;
          if (best === null || v > best) best = v;
        }
        return best;
      };
      const lastSiigoSyncAt = maxIso(rawProducts.map(p => p.last_siigo_sync_at));
      const lastPhysicalCountAt = maxIso(rawProducts.map(p => p.last_count_date));

      setMetrics({
        totalValue,
        avgDaysOfInventory: Math.round(avgDays),
        avgRotation: Math.round(avgRot * 100) / 100,
        pctNoMovement: Math.round(pctNo),
        totalDifference: totalDiff,
        totalDifferenceValue: totalDiffValue,
        totalProducts: enriched.length,
        criticalCount: enriched.filter(p => p.status === 'critico').length,
        excessCount: enriched.filter(p => p.status === 'exceso').length,
        hasMovementData,
        lastSiigoSyncAt,
        lastPhysicalCountAt,
      });
    } catch (err: any) {
      toast({ title: 'Error cargando inventario', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [user, toast, dataSource]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const addProduct = async (product: Omit<InventoryProduct, 'id' | 'created_at' | 'updated_at' | 'active' | 'last_count_date' | 'stock_physical'>) => {
    if (!user) return;
    const { error } = await supabase.from('inventory_products').insert({ ...product, user_id: user.id });
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    await fetchData();
    return true;
  };

  const updateProduct = async (id: string, updates: Partial<InventoryProduct>) => {
    if (!user) return;
    const { error } = await supabase.from('inventory_products').update(updates).eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    await fetchData();
    return true;
  };

  const addMovement = async (movement: { product_id: string; movement_type: string; quantity: number; unit_cost: number; notes?: string; movement_date?: string }) => {
    if (!user) return;

    // Validación pre-insert: bloquear salidas que dejarían stock negativo.
    // Idealmente esto va respaldado por trigger SQL para resistir concurrencia,
    // pero el check cliente cubre el caso single-user típico.
    const product = products.find(p => p.id === movement.product_id);
    if (product && movement.movement_type === 'salida') {
      const projected = product.stock_system - movement.quantity;
      if (projected < 0) {
        toast({
          title: 'Stock insuficiente',
          description: `Stock actual: ${product.stock_system}. Intentás retirar: ${movement.quantity}.`,
          variant: 'destructive',
        });
        return false;
      }
    }

    const totalCost = movement.quantity * movement.unit_cost;
    const { error: movErr } = await supabase.from('inventory_movements').insert({
      ...movement,
      total_cost: totalCost,
      user_id: user.id,
      movement_date: movement.movement_date || new Date().toISOString().split('T')[0],
    });
    if (movErr) {
      toast({ title: 'Error', description: movErr.message, variant: 'destructive' });
      return false;
    }

    // Update stock
    if (product) {
      let newStock = product.stock_system;
      if (movement.movement_type === 'entrada') newStock += movement.quantity;
      else if (movement.movement_type === 'salida') newStock -= movement.quantity;
      else newStock = movement.quantity; // ajuste = set to quantity

      await supabase.from('inventory_products')
        .update({ stock_system: newStock })
        .eq('id', movement.product_id)
        ;
    }

    await fetchData();
    return true;
  };

  const deleteProduct = async (id: string) => {
    if (!user) return;
    const { error } = await supabase.from('inventory_products').update({ active: false }).eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    await fetchData();
    return true;
  };

  // Entrada manual de inventario (modo Gerencial). Solo deja registro en
  // inventory_movements con source_type='entrada_manual' — alimenta el
  // teórico, NO toca stock_system (Siigo) ni stock_physical (conteo). El
  // teórico la suma en el próximo fetchData.
  const registerEntradaManual = async (data: {
    product_id: string;
    quantity: number;
    unit_cost: number;
    movement_date?: string;
    notes?: string;
  }) => {
    if (!user) return false;
    const { error } = await supabase.from('inventory_movements').insert({
      user_id: user.id,
      product_id: data.product_id,
      movement_type: 'entrada',
      source_type: 'entrada_manual',
      quantity: data.quantity,
      unit_cost: data.unit_cost,
      total_cost: data.quantity * data.unit_cost,
      movement_date: data.movement_date || new Date().toISOString().split('T')[0],
      notes: data.notes ?? null,
    } as never);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return false;
    }
    await fetchData();
    return true;
  };

  // Cuadre global del inventario teórico: el stock físico contado de cada
  // referencia pasa a ser el nuevo stock_inicial y stock_inicial_date se
  // actualiza a hoy ("el final se vuelve inicial"). El teórico arranca de
  // cero desde ese punto.
  const cuadrarInventario = async () => {
    if (!user) return false;
    const { data, error } = await supabase.rpc('cuadrar_inventario_teorico' as never);
    if (error) {
      toast({ title: 'Error al cuadrar inventario', description: error.message, variant: 'destructive' });
      return false;
    }
    await fetchData();
    toast({
      title: 'Inventario cuadrado',
      description: `${data ?? 0} referencias re-ancladas. El teórico arranca de nuevo desde el conteo físico.`,
    });
    return true;
  };

  return {
    products, movements, metrics, loading,
    addProduct, updateProduct, addMovement, deleteProduct, refetch: fetchData,
    registerEntradaManual, cuadrarInventario,
    dataSource,
  };
}

interface SalesEvent {
  date: string; // YYYY-MM-DD
  quantity: number;
  reference: string;
  sourceId: string; // invoice_id o remision_id (para tracing)
  lineIndex: number; // posición del item en su parent (para id sintético único)
}

/**
 * Carga eventos individuales de venta desde la fuente del modo activo.
 *
 * - DIAN: invoice_items de invoices type='venta' confirmadas en el período.
 *   Es lo que ve la DIAN y lo que reportan los bancos.
 * - Gerencial: remision_items de remisiones module_origin='gerencial' y
 *   remision_type='venta' en el período. Es el flujo operativo real.
 *
 * Devuelve eventos individuales para que el chart pueda agruparlos por
 * bucket (día/semana/mes) y los KPIs pueden filtrar el rango que necesiten.
 */
async function loadRecentSalesEvents(
  userId: string,
  source: InventoryDataSource,
  sinceIso: string,
): Promise<SalesEvent[]> {
  const out: SalesEvent[] = [];

  if (source === 'dian') {
    const { data, error } = await supabase
      .from('invoice_items')
      .select('id, invoice_id, reference, quantity, invoices!inner(id, issue_date, type, user_id)')
      .eq('user_id', userId)
      .eq('invoices.user_id', userId)
      .eq('invoices.type', 'venta')
      .gte('invoices.issue_date', sinceIso);
    if (error) throw error;
    let i = 0;
    for (const row of (data ?? []) as Array<{
      id: string;
      invoice_id: string;
      reference: string | null;
      quantity: number | null;
      invoices: { issue_date: string };
    }>) {
      if (!row.reference) continue;
      out.push({
        date: row.invoices.issue_date,
        quantity: Number(row.quantity ?? 0),
        reference: row.reference,
        sourceId: row.invoice_id ?? row.id,
        lineIndex: i++,
      });
    }
    return out;
  }

  // gerencial
  const { data, error } = await supabase
    .from('remision_items')
    .select('id, remision_id, reference, units, remisiones!inner(id, date, module_origin, remision_type, user_id)')
    .eq('remisiones.user_id', userId)
    .eq('remisiones.module_origin', 'gerencial')
    .eq('remisiones.remision_type', 'venta')
    .gte('remisiones.date', sinceIso);
  if (error) throw error;
  let i = 0;
  for (const row of (data ?? []) as Array<{
    id: string;
    remision_id: string;
    reference: string | null;
    units: number | null;
    remisiones: { date: string };
  }>) {
    if (!row.reference) continue;
    out.push({
      date: row.remisiones.date,
      quantity: Number(row.units ?? 0),
      reference: row.reference,
      sourceId: row.remision_id ?? row.id,
      lineIndex: i++,
    });
  }
  return out;
}

/**
 * Carga eventos de compra (entradas de inventario) según el modo:
 * - DIAN: invoice_items de invoices type='compra' (incluye facturas Siigo).
 * - Gerencial: remision_items de remisiones module_origin='gerencial' y
 *   remision_type='compra'.
 *
 * Simétrica a loadRecentSalesEvents pero para entradas. Razón de existir:
 * siigo-sync-products solo actualiza stock_system acumulado, no crea
 * inventory_movements individuales, así que las compras Siigo no aparecían
 * en el gráfico de entradas/salidas.
 */
async function loadRecentPurchaseEvents(
  userId: string,
  source: InventoryDataSource,
  sinceIso: string,
): Promise<SalesEvent[]> {
  const out: SalesEvent[] = [];

  if (source === 'dian') {
    const { data, error } = await supabase
      .from('invoice_items')
      .select('id, invoice_id, reference, quantity, invoices!inner(id, issue_date, type, user_id)')
      .eq('user_id', userId)
      .eq('invoices.user_id', userId)
      .eq('invoices.type', 'compra')
      .gte('invoices.issue_date', sinceIso);
    if (error) throw error;
    let i = 0;
    for (const row of (data ?? []) as Array<{
      id: string;
      invoice_id: string;
      reference: string | null;
      quantity: number | null;
      invoices: { issue_date: string };
    }>) {
      if (!row.reference) continue;
      out.push({
        date: row.invoices.issue_date,
        quantity: Number(row.quantity ?? 0),
        reference: row.reference,
        sourceId: row.invoice_id ?? row.id,
        lineIndex: i++,
      });
    }
    return out;
  }

  // gerencial
  const { data, error } = await supabase
    .from('remision_items')
    .select('id, remision_id, reference, units, remisiones!inner(id, date, module_origin, remision_type, user_id)')
    .eq('remisiones.user_id', userId)
    .eq('remisiones.module_origin', 'gerencial')
    .eq('remisiones.remision_type', 'compra')
    .gte('remisiones.date', sinceIso);
  if (error) throw error;
  let i = 0;
  for (const row of (data ?? []) as Array<{
    id: string;
    remision_id: string;
    reference: string | null;
    units: number | null;
    remisiones: { date: string };
  }>) {
    if (!row.reference) continue;
    out.push({
      date: row.remisiones.date,
      quantity: Number(row.units ?? 0),
      reference: row.reference,
      sourceId: row.remision_id ?? row.id,
      lineIndex: i++,
    });
  }
  return out;
}
