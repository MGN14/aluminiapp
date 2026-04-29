import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type SemaforoColor = 'green' | 'yellow' | 'red';

export interface BancoMetrica {
  pregunta: string;
  respuesta: string;
  detalle?: string;
  valor: number | null;
  semaforo: SemaforoColor;
}

export interface InformeBancoData {
  empresa: {
    nombre: string;
    nit: string | null;
    ciudad: string | null;
    direccion: string | null;
    telefono: string | null;
    antiguedadMeses: number;
  };
  // Resumen del año actual
  thisYear: number;
  ingresosBancoAno: number;       // suma de transactions.credit > 0
  egresosBancoAno: number;        // suma de transactions.debit > 0
  facturadoVentaAno: number;      // invoices type=venta confirmed
  facturadoCompraAno: number;     // invoices type=compra confirmed
  utilidadEstimada: number;       // ingresos - egresos
  margenOperativoPct: number;     // utilidad / ingresos
  // Año previo
  ingresosBancoAnoPrev: number;
  crecimientoYoYPct: number | null;
  // Cartera y cobro
  carteraPendiente: number;       // facturado venta - cobrado venta
  dsoDays: number | null;         // (cartera / ventas anuales) × 365
  // Concentración de clientes
  topClientes: Array<{ name: string; total: number; pct: number }>;
  concentracionTopPct: number;    // % del cliente top
  // Inventario
  valorInventario: number;
  // Promedio mensual
  promedioVentasMensual: number;
  // Métricas semáforo para preguntas del banco
  metricas: BancoMetrica[];
}

function semaforoMargen(pct: number): SemaforoColor {
  if (pct >= 10) return 'green';
  if (pct >= 5) return 'yellow';
  return 'red';
}
function semaforoCrecimiento(pct: number | null): SemaforoColor {
  if (pct === null) return 'yellow';
  if (pct > 5) return 'green';
  if (pct >= 0) return 'yellow';
  return 'red';
}
function semaforoDSO(d: number | null): SemaforoColor {
  if (d === null) return 'yellow';
  if (d < 45) return 'green';
  if (d <= 90) return 'yellow';
  return 'red';
}
function semaforoConcentracion(pct: number): SemaforoColor {
  if (pct < 30) return 'green';
  if (pct <= 50) return 'yellow';
  return 'red';
}
function semaforoAntiguedad(meses: number): SemaforoColor {
  if (meses >= 36) return 'green';
  if (meses >= 12) return 'yellow';
  return 'red';
}

function fmt(n: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n);
}

export function useInformeBancoData() {
  const { user } = useAuth();
  return useQuery<InformeBancoData>({
    queryKey: ['informe-banco', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const thisYear = new Date().getFullYear();
      const yearStart = `${thisYear}-01-01`;
      const yearEnd = `${thisYear}-12-31`;
      const lastYearStart = `${thisYear - 1}-01-01`;
      const lastYearEnd = `${thisYear - 1}-12-31`;

      const [profileRes, txRes, invRes, txPrevRes, productsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('company_name, company_nit, company_city, company_address, company_phone')
          .eq('user_id', user!.id)
          .maybeSingle(),
        supabase
          .from('transactions')
          .select('credit, debit, date, responsible_id')
          .eq('user_id', user!.id)
          .is('deleted_at', null)
          .gte('date', yearStart)
          .lte('date', yearEnd),
        supabase
          .from('invoices')
          .select('id, type, total_amount, issue_date, counterparty_name')
          .eq('user_id', user!.id)
          .eq('status', 'confirmed'),
        supabase
          .from('transactions')
          .select('credit')
          .eq('user_id', user!.id)
          .is('deleted_at', null)
          .gte('date', lastYearStart)
          .lte('date', lastYearEnd),
        supabase
          .from('inventory_products')
          .select('stock_system, cost_per_unit')
          .eq('user_id', user!.id)
          .eq('active', true),
      ]);

      const profile = profileRes.data ?? {};
      const txs = txRes.data ?? [];
      const invs = (invRes.data ?? []) as Array<{ id: string; type: string; total_amount: number; issue_date: string; counterparty_name: string | null }>;
      const txsPrev = txPrevRes.data ?? [];
      const products = (productsRes.data ?? []) as Array<{ stock_system: number; cost_per_unit: number }>;

      // Ingresos / egresos del año (banco)
      const ingresosBancoAno = txs.reduce((s, t: { credit: number | null }) => s + (Number(t.credit) || 0), 0);
      const egresosBancoAno = txs.reduce((s, t: { debit: number | null }) => s + (Number(t.debit) || 0), 0);

      // Facturado del año
      const invThisYear = invs.filter(i => i.issue_date >= yearStart && i.issue_date <= yearEnd);
      const facturadoVentaAno = invThisYear.filter(i => i.type === 'venta').reduce((s, i) => s + Number(i.total_amount || 0), 0);
      const facturadoCompraAno = invThisYear.filter(i => i.type === 'compra').reduce((s, i) => s + Number(i.total_amount || 0), 0);

      const utilidadEstimada = ingresosBancoAno - egresosBancoAno;
      const margenOperativoPct = ingresosBancoAno > 0 ? (utilidadEstimada / ingresosBancoAno) * 100 : 0;

      // Crecimiento YoY (banco)
      const ingresosBancoAnoPrev = txsPrev.reduce((s, t: { credit: number | null }) => s + (Number(t.credit) || 0), 0);
      const crecimientoYoYPct = ingresosBancoAnoPrev > 0
        ? ((ingresosBancoAno - ingresosBancoAnoPrev) / ingresosBancoAnoPrev) * 100
        : null;

      // Cartera pendiente: simplificada (facturado venta - ingreso banco)
      const carteraPendiente = Math.max(0, facturadoVentaAno - ingresosBancoAno);
      const dsoDays = facturadoVentaAno > 0
        ? Math.round((carteraPendiente / facturadoVentaAno) * 365)
        : null;

      // Top clientes por facturación venta del año
      const byClient = new Map<string, number>();
      for (const i of invThisYear.filter(i => i.type === 'venta')) {
        const name = i.counterparty_name || 'Sin identificar';
        byClient.set(name, (byClient.get(name) ?? 0) + Number(i.total_amount || 0));
      }
      const topClientes = Array.from(byClient.entries())
        .map(([name, total]) => ({ name, total, pct: facturadoVentaAno > 0 ? (total / facturadoVentaAno) * 100 : 0 }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);
      const concentracionTopPct = topClientes[0]?.pct ?? 0;

      // Inventario
      const valorInventario = products.reduce((s, p) => s + (Number(p.stock_system) || 0) * (Number(p.cost_per_unit) || 0), 0);

      // Antigüedad: desde primera factura registrada
      const fechaMasAntigua = invs.length > 0
        ? invs.reduce((min, i) => i.issue_date < min ? i.issue_date : min, invs[0].issue_date)
        : null;
      const antiguedadMeses = fechaMasAntigua
        ? Math.floor((Date.now() - new Date(fechaMasAntigua).getTime()) / (30 * 86400 * 1000))
        : 0;

      const promedioVentasMensual = ingresosBancoAno / 12;

      // Métricas con semáforo
      const metricas: BancoMetrica[] = [
        {
          pregunta: '¿Cuánto facturás al mes en promedio?',
          respuesta: `${fmt(promedioVentasMensual)} mensuales`,
          detalle: `Total año ${thisYear}: ${fmt(ingresosBancoAno)} ingresos bancarios`,
          valor: promedioVentasMensual,
          semaforo: 'green',
        },
        {
          pregunta: '¿Cómo viene el crecimiento vs año anterior?',
          respuesta: crecimientoYoYPct === null
            ? 'Sin datos del año anterior aún'
            : crecimientoYoYPct >= 0
              ? `+${crecimientoYoYPct.toFixed(1)}% vs ${thisYear - 1}`
              : `${crecimientoYoYPct.toFixed(1)}% vs ${thisYear - 1}`,
          detalle: ingresosBancoAnoPrev > 0
            ? `${thisYear}: ${fmt(ingresosBancoAno)} · ${thisYear - 1}: ${fmt(ingresosBancoAnoPrev)}`
            : undefined,
          valor: crecimientoYoYPct,
          semaforo: semaforoCrecimiento(crecimientoYoYPct),
        },
        {
          pregunta: '¿Qué margen operativo tenés?',
          respuesta: `${margenOperativoPct.toFixed(1)}%`,
          detalle: `Ingresos ${fmt(ingresosBancoAno)} − Egresos ${fmt(egresosBancoAno)} = ${fmt(utilidadEstimada)}`,
          valor: margenOperativoPct,
          semaforo: semaforoMargen(margenOperativoPct),
        },
        {
          pregunta: '¿Cuánto te tarda en cobrar a tus clientes?',
          respuesta: dsoDays === null
            ? 'Sin facturación registrada'
            : `${dsoDays} días promedio (DSO)`,
          detalle: dsoDays !== null
            ? `Cartera pendiente estimada: ${fmt(carteraPendiente)} sobre ${fmt(facturadoVentaAno)} facturado`
            : undefined,
          valor: dsoDays,
          semaforo: semaforoDSO(dsoDays),
        },
        {
          pregunta: '¿Qué % de tus ventas depende de un solo cliente?',
          respuesta: topClientes.length > 0
            ? `${concentracionTopPct.toFixed(1)}% (${topClientes[0].name})`
            : 'Sin facturación registrada',
          detalle: topClientes.length > 1
            ? `Top 3: ${topClientes.slice(0, 3).map(c => `${c.name} (${c.pct.toFixed(0)}%)`).join(', ')}`
            : undefined,
          valor: concentracionTopPct,
          semaforo: semaforoConcentracion(concentracionTopPct),
        },
        {
          pregunta: '¿Cuánto vale tu inventario?',
          respuesta: fmt(valorInventario),
          detalle: products.length > 0 ? `${products.length} referencias activas` : 'Sin productos cargados',
          valor: valorInventario,
          semaforo: 'green',
        },
        {
          pregunta: '¿Cuánto tiempo lleva operando el negocio?',
          respuesta: antiguedadMeses === 0
            ? 'Sin facturas registradas'
            : antiguedadMeses < 12
              ? `${antiguedadMeses} meses`
              : `${Math.floor(antiguedadMeses / 12)} años y ${antiguedadMeses % 12} meses`,
          detalle: fechaMasAntigua ? `Desde ${fechaMasAntigua}` : undefined,
          valor: antiguedadMeses,
          semaforo: semaforoAntiguedad(antiguedadMeses),
        },
      ];

      return {
        empresa: {
          nombre: (profile as { company_name?: string }).company_name || 'Mi empresa',
          nit: (profile as { company_nit?: string | null }).company_nit ?? null,
          ciudad: (profile as { company_city?: string | null }).company_city ?? null,
          direccion: (profile as { company_address?: string | null }).company_address ?? null,
          telefono: (profile as { company_phone?: string | null }).company_phone ?? null,
          antiguedadMeses,
        },
        thisYear,
        ingresosBancoAno,
        egresosBancoAno,
        facturadoVentaAno,
        facturadoCompraAno,
        utilidadEstimada,
        margenOperativoPct,
        ingresosBancoAnoPrev,
        crecimientoYoYPct,
        carteraPendiente,
        dsoDays,
        topClientes,
        concentracionTopPct,
        valorInventario,
        promedioVentasMensual,
        metricas,
      };
    },
  });
}
