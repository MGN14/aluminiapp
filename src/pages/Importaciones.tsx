import { Fragment, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Ship, AlertCircle, Search, LineChart, List, Clock, TrendingUp, TrendingDown, CheckCircle2, Lock as LockIcon, Radar as RadarIcon, AlertTriangle, PackageCheck, PackageSearch, Factory , FlaskConical } from 'lucide-react';
import { useImports, sumImportCosts, type ImportRow, type ImportEstado, IMPORT_ESTADO_LABEL, IMPORT_ESTADOS_ORDER } from '@/hooks/useImports';
import { fetchTrmForDate } from '@/hooks/useImportPayments';
import { computeImportBreakdown } from '@/lib/importCosting';
import { supabase } from '@/integrations/supabase/client';
import ImportModal from '@/components/imports/ImportModal';
import ImportPriceAnalysis from '@/components/imports/ImportPriceAnalysis';
import ReorderSuggestionCard from '@/components/imports/ReorderSuggestionCard';
import CoverageAnalysis from '@/components/imports/CoverageAnalysis';
import { useReorderSuggestion } from '@/hooks/useReorderSuggestion';
import { useMacroIndicators } from '@/hooks/useMacroIndicators';
import { buildComparativo, type TrmFuente } from '@/lib/importComparison';
import EscenariosTab from '@/components/imports/EscenariosTab';
import { computeTotalDays, computeStageAverages } from '@/lib/importStages';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';

const todayIso = () => new Date().toISOString().split('T')[0];

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDiffDays = (a: string, b: string) => {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
};
const isoAddDays = (iso: string, d: number) => {
  const [y, m, dd] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd + d)).toISOString().slice(0, 10);
};
const fmtFechaCorta = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });

/** COP compacto para columnas de costos: $3,2M / $850k */
const fmtCOPShort = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toLocaleString('es-CO', { maximumFractionDigits: 0 })}k`;
  return `$${n.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
};

/** Celda de costo: prioriza USD (flete) y cae a COP compacto (impuestos/agencia). */
function CostCell({ usd, cop }: { usd: number; cop: number }) {
  if (usd <= 0 && cop <= 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="font-mono text-sm">
      {usd > 0 && <span>${usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>}
      {usd > 0 && cop > 0 && <span className="text-muted-foreground"> + </span>}
      {cop > 0 && <span title={`$${cop.toLocaleString('es-CO')} COP`}>{fmtCOPShort(cop)}</span>}
    </span>
  );
}

const ESTADO_BADGE: Record<ImportEstado, { bg: string; color: string; border: string }> = {
  cotizacion:  { bg: 'bg-slate-100',  color: 'text-slate-700',  border: 'border-slate-300' },
  anticipo:    { bg: 'bg-amber-100',  color: 'text-amber-700',  border: 'border-amber-300' },
  produccion:  { bg: 'bg-blue-100',   color: 'text-blue-700',   border: 'border-blue-300' },
  listo_fabrica: { bg: 'bg-sky-100',  color: 'text-sky-700',    border: 'border-sky-300' },
  transito:    { bg: 'bg-cyan-100',   color: 'text-cyan-700',   border: 'border-cyan-300' },
  aduana:      { bg: 'bg-purple-100', color: 'text-purple-700', border: 'border-purple-300' },
  entregado:   { bg: 'bg-green-100',  color: 'text-green-700',  border: 'border-green-300' },
  cerrado:     { bg: 'bg-emerald-100', color: 'text-emerald-800', border: 'border-emerald-400' },
  cancelado:   { bg: 'bg-red-100',    color: 'text-red-700',    border: 'border-red-300' },
};

const fmtUSD = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—';
  return `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
};

/** Saldos en USD redondeados al dólar — los centavos solo meten ruido. */
const fmtUSD0 = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—';
  return `$${Math.round(Number(n)).toLocaleString('en-US')}`;
};

/** Variación % con color: subir costos = rojo, bajar = verde. */
function DeltaLine({ pct, label }: { pct: number | null; label: string }) {
  if (pct == null) return null;
  const caro = pct > 0;
  return (
    <p className="text-[11px] leading-tight">
      <span className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-px font-bold tabular-nums',
        caro
          ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
          : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
      )}>
        {caro ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {caro ? '+' : ''}{pct.toFixed(1)}%
      </span>{' '}
      <span className="text-muted-foreground">{label}</span>
    </p>
  );
}

/** Señal semáforo del pedido en foco contra una referencia (promedio
 *  histórico o mercado hoy). Semántica de COSTO: arriba = rojo (te sale más
 *  caro), abajo = verde. Banda neutral ±2% = "en línea" con check. */
function SignalLine({ curr, refVal, label, fmtVal }: {
  curr: number | null; refVal: number | null; label: string; fmtVal: (n: number) => string;
}) {
  if (curr == null || refVal == null || refVal <= 0) return null;
  const pct = ((curr - refVal) / refVal) * 100;
  if (Math.abs(pct) < 2) {
    return (
      <p className="text-[11px] leading-tight">
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-px font-semibold text-foreground/70">
          <CheckCircle2 className="h-3 w-3 text-success" /> en línea
        </span>{' '}
        <span className="text-muted-foreground">con {label} ({fmtVal(refVal)})</span>
      </p>
    );
  }
  const caro = pct > 0;
  return (
    <p className="text-[11px] leading-tight">
      <span className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-px font-bold tabular-nums',
        caro
          ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
          : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
      )}>
        {caro ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {caro ? '+' : ''}{pct.toFixed(1)}%
      </span>{' '}
      <span className="text-muted-foreground">vs {label} ({fmtVal(refVal)})</span>
    </p>
  );
}

type Filter = 'abiertos' | 'todos' | ImportEstado;

export default function Importaciones() {
  const { data, isLoading, changeEstado } = useImports();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ImportRow | null>(null);
  // Apertura dirigida desde los avisos por fila: pestaña + subida a disparar.
  const [modalOpts, setModalOpts] = useState<{ tab: 'resumen' | 'costeo' | 'datos'; upload: 'proforma' | 'packing' | null } | null>(null);
  const [filter, setFilter] = useState<Filter>('abiertos');
  // Foco de los banners: automático (próx. a entregar), un contenedor
  // puntual, o la simulación "si pido hoy". Reemplaza la tabla comparativa.
  const [focoSel, setFocoSel] = useState<'auto' | 'hoy' | string>('auto');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'pedidos' | 'analisis' | 'cobertura' | 'escenarios'>('pedidos');
  // Diálogo "¿en qué fecha cambió de estado?" al cambiar desde el select inline
  const [changing, setChanging] = useState<{ row: ImportRow; estado: ImportEstado; fecha: string } | null>(null);

  const currentYear = new Date().getFullYear();

  // TRM de hoy — fallback para estimar arancel/IVA cuando el pedido aún no
  // tiene abonos (sin TRM ponderada) ni TRM de causación.
  const { data: trmHoy = null } = useQuery({
    queryKey: ['trm-hoy'],
    queryFn: () => fetchTrmForDate(todayIso()),
    staleTime: 60 * 60_000,
  });

  // TRM ponderada por importación (de los abonos) — para el KPI de COP/ton.
  const { data: liqRows = [] } = useQuery({
    queryKey: ['imports-liquidation-all'],
    queryFn: async () => {
      const { data: rows } = await (supabase as any)
        .from('imports_liquidation')
        .select('import_id, trm_promedio_ponderada');
      return (rows ?? []) as { import_id: string; trm_promedio_ponderada: number | null }[];
    },
  });
  // Abonos crudos: la ponderada se calcula ACÁ (Σ usd×trm ÷ Σ usd). La tabla
  // imports_liquidation solo se usa de respaldo — si su fila no existe o su
  // ponderada quedó nula, el KPI mostraba la TRM de OTRO pedido (2026-2 con
  // abonos y salía 3.572, la del 2026-1 — reporte de Nico 2026-08-02).
  const { data: payRows = [] } = useQuery({
    queryKey: ['import-payments-all'],
    queryFn: async () => {
      const { data: rows } = await (supabase as any)
        .from('import_payments')
        .select('import_id, amount_usd, trm');
      return (rows ?? []) as { import_id: string; amount_usd: number | null; trm: number | null }[];
    },
  });
  const trmByImport = useMemo(() => {
    const acc = new Map<string, { usd: number; usdPorTrm: number }>();
    for (const p of payRows) {
      const usd = Number(p.amount_usd ?? 0);
      const trm = Number(p.trm ?? 0);
      if (usd <= 0 || trm <= 0) continue;
      const a = acc.get(p.import_id) ?? { usd: 0, usdPorTrm: 0 };
      a.usd += usd;
      a.usdPorTrm += usd * trm;
      acc.set(p.import_id, a);
    }
    const out = new Map<string, number | null>();
    for (const r of liqRows) {
      out.set(r.import_id, r.trm_promedio_ponderada ? Number(r.trm_promedio_ponderada) : null);
    }
    for (const [id, a] of acc) out.set(id, a.usdPorTrm / a.usd); // los abonos mandan
    return out;
  }, [liqRows, payRows]);

  // Columna "si pido hoy" del motor de comparación — alimenta la simulación
  // de los banners (reemplazo de la tabla comparativa, Nico 2026-07-30).
  const { indicators } = useMacroIndicators();
  const lme = indicators.find((i) => i.type === 'aluminio_lme') ?? null;
  // Pedidos en formato comparable — compartido entre la columna "si pido hoy"
  // de los banners y la pestaña Escenarios (misma fuente, cero recálculo).
  const pedidosComparables = useMemo(() => {
    const rows = (data?.all ?? []).filter(r => r.estado !== 'cancelado');
    const fechaDe = (r: ImportRow, estado: string) =>
      (r.import_estado_history ?? []).find((x) => x.estado === estado)?.fecha ?? null;
    return rows.map((r) => {
        const pond = trmByImport.get(r.id);
        const trm = (pond != null && pond > 0) ? pond
          : (r.trm_causacion && Number(r.trm_causacion) > 0) ? Number(r.trm_causacion)
          : (trmHoy != null ? Number(trmHoy) : null);
        const fuente: TrmFuente = (pond != null && pond > 0) ? 'ponderada'
          : (r.trm_causacion && Number(r.trm_causacion) > 0) ? 'causacion' : 'hoy';
        const yaEntregada = r.estado === 'entregado' || r.estado === 'cerrado';
        return {
          id: r.id,
          label: r.ref_pedido || r.proveedor_nombre || 'Pedido',
          estado: r.estado,
          cantidad_ton: r.cantidad_ton,
          precio_smm_cerrado_usd_ton: r.precio_smm_cerrado_usd_ton,
          monto_total_usd: r.monto_total_usd,
          trm, trmFuente: fuente,
          arancel_pct: r.arancel_pct,
          iva_pct: r.iva_pct,
          costs: r.import_costs,
          fechas: {
            estado: r.estado,
            fecha_anticipo: fechaDe(r, 'produccion') ?? r.fecha_anticipo,
            fecha_embarque: fechaDe(r, 'transito') ?? r.fecha_embarque,
            fecha_estimada_llegada: r.fecha_estimada_llegada,
            fecha_arribo_real: fechaDe(r, 'aduana') ?? r.fecha_arribo_real,
            fecha_entregado: fechaDe(r, 'entregado') ?? (yaEntregada ? r.fecha_arribo_real : null),
            fecha_listo_fabrica: fechaDe(r, 'listo_fabrica'),
          },
        };
      });
  }, [data, trmByImport, trmHoy]);

  const columnaHoy = useMemo(() => {
    if (!pedidosComparables.length) return null;
    const cmp = buildComparativo({
      pedidos: pedidosComparables,
      hoy: todayIso(),
      trmHoy: trmHoy != null ? Number(trmHoy) : null,
      lmeHoy: lme?.value ?? null,
      lmeHistoria: lme?.history ?? [],
    });
    return cmp.columnas.find((c) => c.kind === 'hoy') ?? null;
  }, [pedidosComparables, trmHoy, lme]);

  // Chips del selector de foco: los pedidos recientes + la simulación.
  // Chips del selector de banners (Nico 2026-08-02): SOLO los pedidos en
  // camino, ordenados por llegada estimada — el próximo a la izquierda. El
  // último ENTREGADO no lleva chip: es la vista por defecto. "Si pido hoy"
  // cierra a la derecha. (Se declara más abajo, después de `reorder`, porque
  // el orden sale de la llegada estimada del motor.)

  // Contenedores ACTUALES en cada etapa (para los chips del filtro).
  const conteoPorEstado = useMemo(() => {
    const m = new Map<ImportEstado, number>();
    for (const r of data?.all ?? []) {
      m.set(r.estado, (m.get(r.estado) ?? 0) + 1);
    }
    return m;
  }, [data]);

  // Promedio de días por etapa a través de todas las importaciones con historial
  const stageAverages = useMemo(() => {
    const rows = (data?.all ?? []).filter(r => (r.import_estado_history?.length ?? 0) > 0);
    if (!rows.length) return null;
    const avgs = computeStageAverages(rows.map(r => ({ history: r.import_estado_history!, estado: r.estado })));
    return Object.keys(avgs).length ? avgs : null;
  }, [data]);

  // ── KPIs de materia prima ─────────────────────────────────────────────────
  // Cómo se viene comportando el contenedor: precio SMM, Total Importación en
  // COP, COP/ton nacionalizado y TRM pagada — cada uno con variación vs el
  // pedido anterior y vs el año pasado (promedios anuales).
  const kpis = useMemo(() => {
    const rows = (data?.all ?? []).filter(r => r.estado !== 'cancelado');
    if (!rows.length) return null;
    // Fecha de referencia del pedido = cuando se MONTÓ (entró a producción);
    // cotización/creación solo como fallback legacy.
    const fechaRef = (r: ImportRow) =>
      (r.import_estado_history ?? []).find(h => h.estado === 'produccion')?.fecha
      ?? r.fecha_anticipo ?? r.fecha_cotizacion ?? r.created_at.slice(0, 10);
    const ordered = [...rows].sort((a, b) => fechaRef(a).localeCompare(fechaRef(b)));
    const yearOf = (r: ImportRow) => Number(fechaRef(r).slice(0, 4));
    const pct = (curr: number | null, prev: number | null) =>
      curr != null && prev != null && prev > 0 ? ((curr - prev) / prev) * 100 : null;
    const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

    const pedidosEsteAnio = ordered.filter(r => yearOf(r) === currentYear).length;
    const pedidosAnioPasado = ordered.filter(r => yearOf(r) === currentYear - 1).length;
    const tonsDe = (yr: number) => ordered.filter(r => yearOf(r) === yr).reduce((s, r) => s + Number(r.cantidad_ton ?? 0), 0);
    const tonEsteAnio = tonsDe(currentYear);
    const tonAnioPasado = tonsDe(currentYear - 1);

    // ── El FOCO es el pedido PRÓXIMO A ENTREGAR, no el último cargado ──
    // (decisión de Nico: "la más importante es la que sigue por pagar/
    // entregar"). Foco = el abierto más avanzado del pipeline; apenas pasa a
    // 'entregado', el siguiente toma el foco solo. "Anterior" = el último
    // entregado (la comparación es contra lo que YA llegó a bodega).
    const ESTADO_AVANCE: Record<string, number> = { cotizacion: 0, anticipo: 1, produccion: 2, listo_fabrica: 3, transito: 4, aduana: 5 };
    const yaLlego = (r: ImportRow) => r.estado === 'entregado' || r.estado === 'cerrado';
    const entregados = ordered.filter(yaLlego);
    const abiertosPipeline = [...ordered]
      .filter(r => !yaLlego(r))
      .sort((a, b) => (ESTADO_AVANCE[b.estado] ?? 0) - (ESTADO_AVANCE[a.estado] ?? 0) || fechaRef(a).localeCompare(fechaRef(b)));
    const fechaEntrega = (r: ImportRow) => r.fecha_arribo_real ?? fechaRef(r);
    const entregadosOrd = [...entregados].sort((a, b) => fechaEntrega(a).localeCompare(fechaEntrega(b)));
    // Foco por defecto = el ÚLTIMO ENTREGADO (Nico 2026-08-02: "los banners
    // muestran siempre el último entregado") — números REALES de lo que ya
    // llegó, no proyecciones. Sin entregados, cae al abierto más avanzado.
    const focoAuto = entregadosOrd[entregadosOrd.length - 1] ?? abiertosPipeline[0] ?? null;
    // El usuario puede ENFOCAR cualquier contenedor con los chips (reemplaza
    // la tabla comparativa gigante — decisión de Nico 2026-07-30: "comparar
    // desde los banners grandes que ya teníamos").
    const foco = (focoSel !== 'auto' && focoSel !== 'hoy')
      ? ordered.find(r => r.id === focoSel) ?? focoAuto
      : focoAuto;
    // LA VARA DE TODOS LOS DELTAS ES EL ÚLTIMO ENTREGADO (Nico 2026-08-02:
    // "todos los banners deben estar atados al último entregado"). Solo cuando
    // el foco ES ese último entregado la vara pasa al penúltimo — comparar algo
    // contra sí mismo daría 0%. En la simulación "Si pido hoy" el foco no es un
    // pedido real, así que el último entregado NO se excluye: antes se
    // excluía y la simulación quedaba sin ningún % (reporte de Nico).
    const esSimulacion = focoSel === 'hoy';
    const entregadosSinFoco = esSimulacion
      ? entregadosOrd
      : entregadosOrd.filter(r => r.id !== foco?.id);
    const anterior = entregadosSinFoco[entregadosSinFoco.length - 1] ?? null;
    const ESTADO_LABEL: Record<string, string> = {
      cotizacion: 'cotización', anticipo: 'anticipo', produccion: 'en producción',
      listo_fabrica: 'listo en fábrica', transito: 'en tránsito', aduana: 'en aduanas',
      entregado: 'entregado', cerrado: 'cerrado',
    };
    const focoLabel = esSimulacion
      ? 'Si pido hoy · simulación'
      : foco ? `${foco.ref_pedido || foco.proveedor_nombre} · ${ESTADO_LABEL[foco.estado] ?? foco.estado}` : null;

    // SMM (USD/ton): pedido en foco vs último entregado + promedios
    const conPrecio = ordered.filter(r => Number(r.precio_smm_cerrado_usd_ton ?? 0) > 0);
    const smmPedido = (r: ImportRow | null) =>
      r && Number(r.precio_smm_cerrado_usd_ton ?? 0) > 0 ? Number(r.precio_smm_cerrado_usd_ton) : null;
    const usdLast = smmPedido(foco);
    const usdDeltaPct = pct(usdLast, smmPedido(anterior));
    const smmDe = (yr: number) => avg(conPrecio.filter(r => yearOf(r) === yr).map(r => Number(r.precio_smm_cerrado_usd_ton)));
    const usdYoYPct = pct(smmDe(currentYear), smmDe(currentYear - 1));
    const usdProm = avg(conPrecio.map(r => Number(r.precio_smm_cerrado_usd_ton)));

    // Total Importación en COP por pedido (real o estimado ≈ — misma lib que
    // el Resumen) y COP/ton nacionalizado (Total ÷ toneladas).
    const trmDe = (r: ImportRow) => trmByImport.get(r.id) ?? (r.trm_causacion ? Number(r.trm_causacion) : null) ?? trmHoy;
    const conTotal = ordered
      .map(r => ({
        r,
        total: computeImportBreakdown({
          mercanciaUsd: Number(r.monto_total_usd ?? 0),
          costs: r.import_costs,
          trm: trmDe(r),
          arancelPct: Number(r.arancel_pct ?? 5),
          ivaPct: Number(r.iva_pct ?? 19),
          cantidadKg: Number(r.cantidad_ton ?? 0) > 0 ? Number(r.cantidad_ton) * 1000 : null,
        }).totalImportacionCop,
      }))
      .filter((x): x is { r: ImportRow; total: number } => x.total != null && x.total > 0);
    const totalPorId = new Map(conTotal.map(x => [x.r.id, x.total]));
    const totLast = foco ? totalPorId.get(foco.id) ?? null : null;
    const totDeltaPct = pct(totLast, anterior ? totalPorId.get(anterior.id) ?? null : null);
    const totProm = avg(conTotal.map(x => x.total));

    const conNac = conTotal
      .filter(x => Number(x.r.cantidad_ton ?? 0) > 0)
      .map(x => ({ r: x.r, porTon: x.total / Number(x.r.cantidad_ton) }));
    const nacPorId = new Map(conNac.map(x => [x.r.id, x.porTon]));
    const nacLast = foco ? nacPorId.get(foco.id) ?? null : null;
    const nacDeltaPct = pct(nacLast, anterior ? nacPorId.get(anterior.id) ?? null : null);
    const nacDe = (yr: number) => avg(conNac.filter(x => yearOf(x.r) === yr).map(x => x.porTon));
    const nacYoYPct = pct(nacDe(currentYear), nacDe(currentYear - 1));
    const nacProm = avg(conNac.map(x => x.porTon));

    // TRM pagada (ponderada de los abonos) — del pedido en FOCO; si el foco
    // aún no tiene abonos (lo normal recién montado), el ÚLTIMO dato ponderado
    // disponible (pedido de Nico: "que coja el último que tenga").
    const trmPedido = (r: ImportRow | null) => {
      if (!r) return null;
      const t = trmByImport.get(r.id) ?? null;
      return t != null && t > 0 ? t : null;
    };
    const trmSerieRows = ordered
      .map(r => ({ r, t: trmPedido(r) }))
      .filter((x): x is { r: ImportRow; t: number } => x.t != null);
    const focoTrm = trmPedido(foco);
    // EN CURSO: la ponderada del pedido en foco se va recalculando con cada
    // abono nuevo — el KPI la muestra viva apenas exista.
    const trmEnCurso = focoTrm != null;
    // SIN ABONOS → TRM DEL DÍA (regla de Nico 2026-08-02). Antes caía a "el
    // último pedido con abonos" y el banner quedaba PEGADO en la TRM de otro
    // contenedor (3.572 del 2026-1 sobre el 2026-2/2026-3), inflando ~13% todo
    // lo que se calcula con esa TRM.
    const trmLast = focoTrm ?? (trmHoy != null ? Number(trmHoy) : null);
    const trmDeLabel = trmEnCurso
      ? (foco ? (foco.ref_pedido || foco.proveedor_nombre) : null)
      : 'TRM de hoy (mercado)';
    // La vara es SIEMPRE la TRM del último entregado — igual que el resto de
    // los banners. Antes, sin abonos, se comparaba contra "la última pagada"
    // (que podía ser otro pedido abierto) y el % no era comparable con los
    // demás KPIs: el 2026-3 mostraba −1,7% contra el 2026-2 mientras el resto
    // medía contra el 2026-1 (reporte de Nico 2026-08-02).
    const trmPrev = trmPedido(anterior);
    const trmDeltaPct = pct(trmLast, trmPrev);
    const conTrm = ordered
      .map(r => trmByImport.get(r.id) ?? null)
      .filter((t): t is number => t != null && t > 0);
    const trmProm = avg(conTrm);

    // Flete USD — del pedido en FOCO (se conoce al embarcar) vs último entregado.
    const fletePedido = (r: ImportRow | null) => {
      if (!r) return null;
      const v = sumImportCosts(r.import_costs, 'flete').usd;
      return v > 0 ? v : null;
    };
    const fleteUltimo = fletePedido(foco);
    const fleteDeltaPct = pct(fleteUltimo, fletePedido(anterior));
    const fletes = ordered
      .map(r => sumImportCosts(r.import_costs, 'flete').usd)
      .filter(v => v > 0);
    const fleteProm = avg(fletes);

    // IMPUESTOS (arancel + IVA, COP) del pedido en foco — reemplaza las
    // columnas Arancel/IVA/Agencia de la tabla (decisión de Nico 2026-07-30:
    // "solo banners grandes, las columnas largas me hacen perder info").
    const bdDe = (r: ImportRow | null) => r
      ? computeImportBreakdown({
          mercanciaUsd: Number(r.monto_total_usd ?? 0),
          costs: r.import_costs,
          trm: trmDe(r),
          arancelPct: Number(r.arancel_pct ?? 5),
          ivaPct: Number(r.iva_pct ?? 19),
          cantidadKg: Number(r.cantidad_ton ?? 0) > 0 ? Number(r.cantidad_ton) * 1000 : null,
        })
      : null;
    const impuestosDe = (r: ImportRow | null) => {
      const bd = bdDe(r);
      if (!bd) return null;
      const t = (bd.arancelCop ?? 0) + (bd.ivaCop ?? 0);
      return t > 0 ? t : null;
    };
    const impFoco = bdDe(foco);
    const impLast = impuestosDe(foco);
    const impArancel = impFoco?.arancelCop ?? null;
    const impIva = impFoco?.ivaCop ?? null;
    const impAgencia = foco ? sumImportCosts(foco.import_costs, 'nacionalizacion').cop : 0;
    const impDeltaPct = pct(impLast, impuestosDe(anterior));
    const impProm = avg(ordered.map(impuestosDe).filter((v): v is number => v != null));
    // Real cargado vs estimado por % — que se vea de qué número estamos hablando.
    const impEsReal = !!(impFoco?.usaArancelReal && impFoco?.usaIvaReal);

    // DÍAS de la operación del pedido en foco (reemplaza la columna Días).
    const diasFoco = foco?.import_estado_history?.length
      ? computeTotalDays(foco.import_estado_history, foco.estado)
      : null;
    const diasCerrados = ordered
      .filter(r => (r.estado === 'entregado' || r.estado === 'cerrado') && (r.import_estado_history?.length ?? 0) > 0)
      .map(r => computeTotalDays(r.import_estado_history!, r.estado))
      .filter((t): t is { dias: number; enCurso: boolean } => !!t && !t.enCurso && t.dias > 0)
      .map(t => t.dias);
    const diasProm = avg(diasCerrados);

    const out = {
      pedidosEsteAnio, pedidosAnioPasado, tonEsteAnio, tonAnioPasado,
      focoLabel, esSimulacion,
      usdLast, usdDeltaPct, usdYoYPct, usdProm,
      totLast, totDeltaPct, totProm,
      nacLast, nacDeltaPct, nacYoYPct, nacProm,
      trmLast, trmDeltaPct, trmProm, trmEnCurso, trmDeLabel,
      fleteProm, fleteUltimo, fleteDeltaPct,
      impLast, impArancel, impIva, impAgencia, impDeltaPct, impProm, impEsReal,
      diasFoco, diasProm,
    };

    // ── Simulación "si pido hoy": mismos banners, números del motor de
    // comparación (LME hoy + molde del último pedido + TRM de hoy) — lo que
    // antes era la columna 'hoy' de la tabla comparativa que se quitó.
    if (esSimulacion && columnaHoy) {
      out.usdLast = columnaHoy.precioUsdTon;
      out.usdDeltaPct = pct(columnaHoy.precioUsdTon, smmPedido(anterior));
      out.totLast = columnaHoy.totalCop;
      out.totDeltaPct = pct(columnaHoy.totalCop, anterior ? totalPorId.get(anterior.id) ?? null : null);
      out.nacLast = columnaHoy.copPorKg != null ? columnaHoy.copPorKg * 1000 : null;
      out.nacDeltaPct = pct(out.nacLast, anterior ? nacPorId.get(anterior.id) ?? null : null);
      out.trmLast = columnaHoy.trm;
      out.trmEnCurso = false;
      out.trmDeLabel = 'TRM de hoy (mercado)';
      out.trmDeltaPct = pct(columnaHoy.trm, trmPedido(anterior));
      // Flete e impuestos: asumidos con tus promedios/porcentajes vigentes.
      out.fleteUltimo = fleteProm;
      out.fleteDeltaPct = pct(fleteProm, fletePedido(anterior));
      const bdHoy = columnaHoy.mercanciaUsd != null && columnaHoy.trm != null
        ? computeImportBreakdown({
            mercanciaUsd: columnaHoy.mercanciaUsd,
            costs: [],
            trm: columnaHoy.trm,
            arancelPct: 5,
            ivaPct: 19,
            cantidadKg: columnaHoy.toneladas != null ? columnaHoy.toneladas * 1000 : null,
          })
        : null;
      out.impArancel = bdHoy?.arancelCop ?? null;
      out.impIva = bdHoy?.ivaCop ?? null;
      out.impAgencia = 0;
      out.impLast = bdHoy && ((bdHoy.arancelCop ?? 0) + (bdHoy.ivaCop ?? 0)) > 0
        ? (bdHoy.arancelCop ?? 0) + (bdHoy.ivaCop ?? 0)
        : null;
      out.impDeltaPct = pct(out.impLast, impuestosDe(anterior));
      out.impEsReal = false;
      out.diasFoco = columnaHoy.etapas.total != null ? { dias: columnaHoy.etapas.total, enCurso: false } : null;
    }

    return out;
  }, [data, currentYear, trmByImport, trmHoy, focoSel, columnaHoy]);

  // Sugerencia de próximo pedido — MISMA fuente que la card de arriba (antes
  // el radar calculaba su propia fecha con cadencia de pedidos y se
  // contradecía con la card en pantalla).
  const reorder = useReorderSuggestion();
  // ETA que carga Nico = llegada a PUERTO. Bodega = puerto + nacionalización
  // promedio (medida por el motor de reorden; 10d por defecto).
  const nacProm = reorder.suggestion?.leadTime.nacionalizacion.dias ?? 10;
  // Pedidos EN CAMINO ordenados por llegada estimada (la misma del motor de
  // reorden — respeta etapa y fechas reales); el próximo queda a la izquierda.
  const pedidosChips = useMemo(() => {
    const llegadaDe = (id: string) => reorder.disponibilidadPorImport.get(id) ?? '9999-12-31';
    return [...(data?.abiertos ?? [])]
      .sort((a, b) => llegadaDe(a.id).localeCompare(llegadaDe(b.id)))
      .map(r => ({ id: r.id, label: r.ref_pedido || r.proveedor_nombre }));
  }, [data, reorder.disponibilidadPorImport]);

  // ── Checklist documental por pedido (pedido de Nico 2026-08-02): las
  // alertas van POR FILA, como la de BanRep — nada de banners. Cascada:
  // sin ítems → "falta subir proforma"; en tránsito/aduana sin packing →
  // "falta subir packing list"; entregado sin packing costeado → "falta
  // packing list costeado"; y por último la de BanRep (ya existía).
  const { data: docStatusData } = useQuery({
    queryKey: ['imports', 'items-doc-status'],
    staleTime: 60_000,
    queryFn: async () => {
      const PAGE = 1000;
      const rows: { import_id: string; source: string | null; costo_unitario_excel: number | null }[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data: page, error } = await (supabase as any)
          .from('import_items')
          .select('import_id, source, costo_unitario_excel')
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const p = (page ?? []) as typeof rows;
        rows.push(...p);
        if (p.length < PAGE) break;
      }
      return rows;
    },
  });
  const docStatus = useMemo(() => {
    const map = new Map<string, { hasItems: boolean; hasPacking: boolean; hasPackingCosteado: boolean }>();
    for (const r of docStatusData ?? []) {
      const st = map.get(r.import_id) ?? { hasItems: false, hasPacking: false, hasPackingCosteado: false };
      st.hasItems = true;
      // source null = legacy, cuenta como packing (default histórico).
      const esPacking = (r.source ?? 'packing') === 'packing';
      if (esPacking) {
        st.hasPacking = true;
        if (Number(r.costo_unitario_excel ?? 0) > 0) st.hasPackingCosteado = true;
      }
      map.set(r.import_id, st);
    }
    return map;
  }, [docStatusData]);

  // ── Radar de abastecimiento ───────────────────────────────────────────────
  // El análisis que el negocio necesita: (1) el contenedor que LLEGA — cuánta
  // plata hay que tener lista; (2) los que vienen detrás — a qué precio
  // promedio quedó la compra abierta; (3) cuándo montar el próximo pedido
  // para no quedar sin stock (cadencia de pedidos vs lead time).
  const radar = useMemo(() => {
    const abiertos = data?.abiertos ?? [];
    if (!abiertos.length) return null;
    const all = (data?.all ?? []).filter(r => r.estado !== 'cancelado');
    const hoy = todayIso();
    // Montaje del pedido = entrada a producción (cotización ya no cuenta).
    const fechaRef = (r: ImportRow) =>
      (r.import_estado_history ?? []).find(h => h.estado === 'produccion')?.fecha
      ?? r.fecha_anticipo ?? r.fecha_cotizacion ?? r.created_at.slice(0, 10);
    const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

    // Lead time = EL MISMO del motor de reorden (etapas medidas + defaults) —
    // tener dos cálculos hacía que la card dijera 85d y el radar 94d (bug
    // reportado por Nico). Fallback local solo mientras el motor carga.
    const ltEntregados = all
      .filter(r => (r.estado === 'entregado' || r.estado === 'cerrado') && (r.import_estado_history?.length ?? 0) > 0)
      .map(r => computeTotalDays(r.import_estado_history!, r.estado))
      .filter((t): t is { dias: number; enCurso: boolean } => !!t && !t.enCurso && t.dias > 0)
      .map(t => t.dias);
    const ltProxy = abiertos
      .filter(r => r.fecha_estimada_llegada)
      .map(r => isoDiffDays(fechaRef(r), r.fecha_estimada_llegada!))
      .filter(d => d > 0);
    const leadTime = reorder.suggestion?.leadTime.totalDias ?? avg(ltEntregados) ?? avg(ltProxy);

    // Llegada A BODEGA de cada pedido abierto — MISMA fuente que la cobertura
    // (estimateDisponibilidad): respeta el piso físico (nunca antes de hoy +
    // tránsito + nacionalización) y trata la ETA como puerto. La fórmula
    // local "inicio + lead time" daba fechas que envejecían mal: un pedido
    // demorado en fábrica seguía prometiendo la misma fecha aunque ya fuera
    // imposible. Fallback local solo mientras el motor carga.
    const conLlegada = abiertos
      .map(r => ({
        r,
        llega: reorder.disponibilidadPorImport.get(r.id)
          ?? (r.fecha_estimada_llegada
            ? isoAddDays(r.fecha_estimada_llegada, nacProm)
            : (leadTime != null ? isoAddDays(fechaRef(r), Math.round(leadTime)) : null)),
        etaEstimada: !r.fecha_estimada_llegada,
      }))
      .sort((a, b) => (a.llega ?? '9999').localeCompare(b.llega ?? '9999'));

    // (1) Prioridad: el que llega primero
    const proximo = conLlegada.find(x => x.llega != null) ?? conLlegada[0];
    const proximoDias = proximo?.llega ? isoDiffDays(hoy, proximo.llega) : null;
    const proximoBd = proximo
      ? computeImportBreakdown({
          mercanciaUsd: Number(proximo.r.monto_total_usd ?? 0),
          costs: proximo.r.import_costs,
          trm: trmByImport.get(proximo.r.id) ?? (proximo.r.trm_causacion ? Number(proximo.r.trm_causacion) : null) ?? trmHoy,
          arancelPct: Number(proximo.r.arancel_pct ?? 5),
          ivaPct: Number(proximo.r.iva_pct ?? 19),
          cantidadKg: Number(proximo.r.cantidad_ton ?? 0) > 0 ? Number(proximo.r.cantidad_ton) * 1000 : null,
        })
      : null;
    const cajaNacionalizar = proximoBd
      ? (proximoBd.arancelCop ?? 0) + (proximoBd.ivaCop ?? 0) + proximoBd.otrosCop
      : null;

    // (2) Los que vienen detrás + promedio ponderado de compra abierto
    const detras = conLlegada.filter(x => x !== proximo);
    const conSmm = abiertos.filter(r => Number(r.precio_smm_cerrado_usd_ton ?? 0) > 0);
    const pesoTon = (r: ImportRow) => Number(r.cantidad_ton ?? 0) > 0 ? Number(r.cantidad_ton) : 1;
    const smmPonderado = conSmm.length
      ? conSmm.reduce((s, r) => s + Number(r.precio_smm_cerrado_usd_ton) * pesoTon(r), 0)
        / conSmm.reduce((s, r) => s + pesoTon(r), 0)
      : null;
    const smmUltimo = conSmm.length
      ? Number([...conSmm].sort((a, b) => fechaRef(a).localeCompare(fechaRef(b)))[conSmm.length - 1].precio_smm_cerrado_usd_ton)
      : null;

    // (3) ¿Cuándo montar el próximo? Ritmo de pedidos (cadencia entre
    // cotizaciones) vs lead time: el siguiente debe llegar ~cadencia días
    // después de la última llegada estimada.
    const fechasPedidos = all.map(fechaRef).sort();
    const diffs: number[] = [];
    for (let i = 1; i < fechasPedidos.length; i++) {
      const d = isoDiffDays(fechasPedidos[i - 1], fechasPedidos[i]);
      if (d > 0) diffs.push(d);
    }
    // Cadencia unificada con el motor de reorden (cicloPedidoDias, acotada
    // 20-120); el cálculo local queda de respaldo mientras el motor carga.
    const cadencia = reorder.cicloPedidoDias ?? avg(diffs.slice(-6));
    const llegadas = conLlegada.map(x => x.llega).filter((f): f is string => !!f).sort();
    const ultimaLlegada = llegadas[llegadas.length - 1] ?? null;
    const montarAntesDe = ultimaLlegada && cadencia != null && leadTime != null
      ? isoAddDays(ultimaLlegada, Math.round(cadencia - leadTime))
      : null;
    const diasParaMontar = montarAntesDe ? isoDiffDays(hoy, montarAntesDe) : null;
    const llegariaHoy = leadTime != null ? isoAddDays(hoy, Math.round(leadTime)) : null;

    return {
      proximo, proximoDias, cajaNacionalizar,
      saldoProximo: proximo ? Number(proximo.r.saldo_pendiente_usd ?? 0) : null,
      detras, smmPonderado, smmUltimo,
      leadTime: leadTime != null ? Math.round(leadTime) : null,
      cadencia: cadencia != null ? Math.round(cadencia) : null,
      montarAntesDe, diasParaMontar, llegariaHoy,
    };
  }, [data, trmByImport, trmHoy, reorder.suggestion, reorder.cicloPedidoDias, reorder.disponibilidadPorImport, nacProm]);

  const filtered = useMemo(() => {
    const rows = data?.all ?? [];
    const q = search.trim().toLowerCase();
    const visibles = rows.filter(r => {
      if (filter === 'abiertos') {
        // El ciclo cierra en 'cerrado', no en 'entregado' (decisión de Nico):
        // un entregado sin cerrar frente al BanRep sigue siendo trabajo abierto.
        if (r.estado === 'cerrado' || r.estado === 'cancelado') return false;
      } else if (filter !== 'todos') {
        if (r.estado !== filter) return false;
      }
      if (q) {
        const hay =
          r.proveedor_nombre.toLowerCase().includes(q)
          || (r.ref_pedido ?? '').toLowerCase().includes(q)
          || (r.notas ?? '').toLowerCase().includes(q);
        if (!hay) return false;
      }
      return true;
    });
    // Orden (Nico 2026-08-02): EL PRÓXIMO A LLEGAR DE PRIMERAS, después del
    // más nuevo al más viejo. Los que están en camino se ordenan por llegada
    // estimada a bodega (la misma del motor de reorden); los ya entregados o
    // cerrados van después, del más reciente al más antiguo.
    const yaLlego = (r: ImportRow) => r.estado === 'entregado' || r.estado === 'cerrado' || r.estado === 'cancelado';
    const inicioDe = (r: ImportRow) =>
      (r.import_estado_history ?? []).map(h => h.fecha).filter(Boolean).sort()[0]
      ?? r.fecha_cotizacion ?? r.created_at ?? '';
    const llegadaDe = (r: ImportRow) =>
      reorder.disponibilidadPorImport.get(r.id) ?? r.fecha_estimada_llegada ?? '';
    return [...visibles].sort((a, b) => {
      const aLlego = yaLlego(a), bLlego = yaLlego(b);
      if (aLlego !== bLlego) return aLlego ? 1 : -1; // en camino primero
      if (!aLlego) {
        const la = llegadaDe(a), lb = llegadaDe(b);
        if (la && lb && la !== lb) return la.localeCompare(lb); // el próximo primero
        if (la && !lb) return -1;                              // con ETA antes que sin ETA
        if (!la && lb) return 1;
      }
      return inicioDe(b).localeCompare(inicioDe(a));           // más nuevo → más viejo
    });
  }, [data, filter, search, reorder.disponibilidadPorImport]);

  const openNew = () => {
    setEditing(null);
    setShowModal(true);
  };
  const openEdit = (row: ImportRow) => {
    setEditing(row);
    setShowModal(true);
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
              <Ship className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Importaciones</h1>
              <p className="text-sm text-muted-foreground">
                {isLoading
                  ? 'Cargando...'
                  : `${data?.total_abiertos ?? 0} pedidos abiertos · ${fmtUSD0(data?.total_saldo_pendiente_usd ?? 0)} saldo USD`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex bg-muted rounded-md p-0.5 gap-0.5">
              <button
                type="button"
                onClick={() => setView('pedidos')}
                className={cn('px-3 py-1.5 rounded text-xs font-medium transition-colors inline-flex items-center gap-1.5',
                  view === 'pedidos' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                <List className="h-3.5 w-3.5" /> Pedidos
              </button>
              <button
                type="button"
                onClick={() => setView('analisis')}
                className={cn('px-3 py-1.5 rounded text-xs font-medium transition-colors inline-flex items-center gap-1.5',
                  view === 'analisis' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                <LineChart className="h-3.5 w-3.5" /> Análisis de precios
              </button>
              <button
                type="button"
                onClick={() => setView('cobertura')}
                className={cn('px-3 py-1.5 rounded text-xs font-medium transition-colors inline-flex items-center gap-1.5',
                  view === 'cobertura' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                <PackageSearch className="h-3.5 w-3.5" /> Cobertura
              </button>
              <button
                type="button"
                onClick={() => setView('escenarios')}
                className={cn('px-3 py-1.5 rounded text-xs font-medium transition-colors inline-flex items-center gap-1.5',
                  view === 'escenarios' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                <FlaskConical className="h-3.5 w-3.5" /> Escenarios
              </button>
            </div>
            <Button onClick={openNew} className="gap-2">
              <Plus className="h-4 w-4" />
              Nueva importación
            </Button>
          </div>
        </div>

        {view === 'analisis' ? (
          <ImportPriceAnalysis />
        ) : view === 'cobertura' ? (
          <CoverageAnalysis />
        ) : view === 'escenarios' ? (
          <EscenariosTab
            pedidos={pedidosComparables}
            payRows={payRows}
            trmHoy={trmHoy != null ? Number(trmHoy) : null}
            lmeHoy={lme?.value ?? null}
            lmeHistoria={lme?.history ?? []}
            hoy={todayIso()}
          />
        ) : (
        <>
        {/* Sugerencia de próximo pedido: quiebre de stock − lead time − colchón */}
        <ReorderSuggestionCard onVerReporte={() => setView('cobertura')} />

        {/* KPIs de materia prima: cada uno con variación vs pedido anterior y
            vs año pasado. El SELECTOR enfoca los banners en cualquier
            contenedor o en la simulación "si pido hoy" — reemplaza la tabla
            comparativa gigante (Nico 2026-07-30: "comparar desde los banners
            grandes que ya teníamos"). */}
        {kpis && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-muted-foreground">Ver banners de:</span>
            <div className="inline-flex bg-muted rounded-md p-0.5 gap-0.5 flex-wrap">
              <button
                type="button"
                onClick={() => setFocoSel('auto')}
                className={cn('px-2.5 py-1 rounded text-xs font-medium transition-colors', focoSel === 'auto' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
                title="El último contenedor que llegó a bodega (estado entregado) — números reales, no proyecciones"
              >
                Último entregado
              </button>
              {pedidosChips.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setFocoSel(p.id)}
                  className={cn('px-2.5 py-1 rounded text-xs font-medium transition-colors font-mono', focoSel === p.id ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setFocoSel('hoy')}
                className={cn('px-2.5 py-1 rounded text-xs font-semibold transition-colors', focoSel === 'hoy' ? 'bg-amber-100 text-amber-800 shadow-sm' : 'text-amber-600 hover:text-amber-700')}
                title="Simulación: un contenedor montado HOY con el LME de hoy, la TRM de hoy y el molde de tu último pedido"
              >
                Si pido hoy
              </button>
            </div>
            {kpis.esSimulacion && (
              <span className="text-[10px] text-amber-600 font-medium">
                ⚠ simulación — LME y TRM de hoy, flete e impuestos asumidos con tus promedios
              </span>
            )}
          </div>
        )}
        {kpis && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Card className="rounded-xl border-border/80 border-t-[3px] border-t-primary/40 bg-gradient-to-b from-card to-muted/30 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="py-3.5 px-4 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Pedidos {currentYear}</p>
                <p className="text-[26px] leading-8 font-extrabold tracking-tight tabular-nums">{kpis.pedidosEsteAnio}</p>
                <p className="text-[11px] text-muted-foreground">
                  {kpis.pedidosAnioPasado} en {currentYear - 1}
                  {kpis.tonEsteAnio > 0 && ` · ${kpis.tonEsteAnio.toLocaleString('es-CO', { maximumFractionDigits: 1 })} t${kpis.tonAnioPasado > 0 ? ` (${kpis.tonAnioPasado.toLocaleString('es-CO', { maximumFractionDigits: 1 })} t en ${currentYear - 1})` : ''}`}
                </p>
              </CardContent>
            </Card>
            <Card className="rounded-xl border-border/80 border-t-[3px] border-t-primary/40 bg-gradient-to-b from-card to-muted/30 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="py-3.5 px-4 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground" title="SMM cerrado del pedido próximo a entregar — el costo del material que está por llegar a bodega. Cuando se entregue, el foco pasa solo al siguiente del pipeline.">SMM próx. a entregar (USD/t)</p>
                <p className="text-[26px] leading-8 font-extrabold tracking-tight tabular-nums font-mono">
                  {kpis.usdLast != null ? `$${kpis.usdLast.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
                </p>
                {kpis.focoLabel && <p className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground/75 truncate">📦 {kpis.focoLabel}</p>}
                <SignalLine curr={kpis.usdLast} refVal={kpis.usdProm} label="promedio"
                  fmtVal={(n) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />
                <DeltaLine pct={kpis.usdDeltaPct} label="vs último entregado" />
                <DeltaLine pct={kpis.usdYoYPct} label={`vs ${currentYear - 1}`} />
                {kpis.usdLast == null && kpis.usdProm != null && (
                  <p className="text-[11px] text-muted-foreground">promedio ${kpis.usdProm.toLocaleString('en-US', { maximumFractionDigits: 0 })}</p>
                )}
              </CardContent>
            </Card>
            <Card className="rounded-xl border-border/80 border-t-[3px] border-t-primary/40 bg-gradient-to-b from-card to-muted/30 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="py-3.5 px-4 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground" title="CIF + arancel + IVA + otros costos del pedido PRÓXIMO A ENTREGAR, en pesos — la plata comprometida en lo que viene. Usa el estimado (≈) mientras no esté cargado el costo real.">Total Importación (COP)</p>
                <p className="text-[26px] leading-8 font-extrabold tracking-tight tabular-nums font-mono">
                  {kpis.totLast != null ? fmtCOPShort(kpis.totLast) : '—'}
                </p>
                {kpis.focoLabel && <p className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground/75 truncate">📦 {kpis.focoLabel}</p>}
                <SignalLine curr={kpis.totLast} refVal={kpis.totProm} label="promedio" fmtVal={fmtCOPShort} />
                <DeltaLine pct={kpis.totDeltaPct} label="vs último entregado" />
                {kpis.totLast == null && (kpis.totProm != null
                  ? <p className="text-[11px] text-muted-foreground">promedio {fmtCOPShort(kpis.totProm)}</p>
                  : <p className="text-[11px] text-muted-foreground">CIF + arancel + IVA + otros</p>)}
              </CardContent>
            </Card>
            <Card className="rounded-xl border-border/80 border-t-[3px] border-t-primary/40 bg-gradient-to-b from-card to-muted/30 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="py-3.5 px-4 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground" title="Total Importación ÷ toneladas del pedido PRÓXIMO A ENTREGAR — el costo real de la materia prima que está por llegar a bodega.">COP/ton nacionalizado</p>
                <p className="text-[26px] leading-8 font-extrabold tracking-tight tabular-nums font-mono">
                  {kpis.nacLast != null ? fmtCOPShort(kpis.nacLast) : '—'}
                </p>
                {kpis.focoLabel && <p className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground/75 truncate">📦 {kpis.focoLabel}</p>}
                <SignalLine curr={kpis.nacLast} refVal={kpis.nacProm} label="promedio" fmtVal={fmtCOPShort} />
                <DeltaLine pct={kpis.nacDeltaPct} label="vs último entregado" />
                <DeltaLine pct={kpis.nacYoYPct} label={`vs ${currentYear - 1}`} />
                {kpis.nacLast == null && kpis.nacProm != null && (
                  <p className="text-[11px] text-muted-foreground">promedio {fmtCOPShort(kpis.nacProm)}</p>
                )}
              </CardContent>
            </Card>
            <Card className="rounded-xl border-border/80 border-t-[3px] border-t-primary/40 bg-gradient-to-b from-card to-muted/30 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="py-3.5 px-4 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground" title="TRM ponderada de los abonos del pedido en foco (Σ USD×TRM ÷ Σ USD). Si ese pedido AÚN NO tiene abonos, se muestra la TRM de hoy — nunca la de otro contenedor.">
                  {kpis.trmEnCurso ? 'TRM pagada' : 'TRM de hoy'}
                </p>
                <p className="text-[26px] leading-8 font-extrabold tracking-tight tabular-nums font-mono">
                  {kpis.trmLast != null ? `$${kpis.trmLast.toLocaleString('es-CO', { maximumFractionDigits: 0 })}` : '—'}
                </p>
                {/* De DÓNDE sale: abonos del pedido en foco, o mercado de hoy
                    cuando ese pedido todavía no tiene abonos. */}
                {kpis.trmDeLabel && (
                  <p className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground/75 truncate">
                    {kpis.trmEnCurso
                      ? <>📦 {kpis.trmDeLabel}<span className="text-primary font-medium"> · ponderada de sus abonos</span></>
                      : <>💱 {kpis.trmDeLabel} — este pedido aún no tiene abonos</>}
                  </p>
                )}
                {kpis.trmEnCurso && (
                  <SignalLine curr={kpis.trmLast} refVal={trmHoy != null ? Number(trmHoy) : null} label="TRM de hoy"
                    fmtVal={(n) => `$${n.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`} />
                )}
                <DeltaLine pct={kpis.trmDeltaPct} label="vs último entregado" />
                <p className="text-[11px] text-muted-foreground">
                  {kpis.trmProm != null
                    ? `promedio pagado $${kpis.trmProm.toLocaleString('es-CO', { maximumFractionDigits: 0 })} · ponderada de abonos`
                    : 'ponderada de los abonos'}
                </p>
              </CardContent>
            </Card>
            <Card className="rounded-xl border-border/80 border-t-[3px] border-t-primary/40 bg-gradient-to-b from-card to-muted/30 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="py-3.5 px-4 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground" title="Flete del pedido próximo a entregar (se conoce al embarcar). '—' = el pedido en foco todavía no tiene flete cargado.">Flete USD</p>
                <p className="text-[26px] leading-8 font-extrabold tracking-tight tabular-nums font-mono">
                  {kpis.fleteUltimo != null ? `$${kpis.fleteUltimo.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
                </p>
                {kpis.focoLabel && <p className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground/75 truncate">📦 {kpis.focoLabel}</p>}
                <SignalLine curr={kpis.fleteUltimo} refVal={kpis.fleteProm} label="promedio"
                  fmtVal={(n) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />
                <DeltaLine pct={kpis.fleteDeltaPct} label="vs último entregado" />
                {kpis.fleteUltimo == null && (
                  <p className="text-[11px] text-muted-foreground">
                    {kpis.fleteProm != null ? `promedio $${kpis.fleteProm.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : 'cargalo en costos del pedido'}
                  </p>
                )}
              </CardContent>
            </Card>
            {/* IMPUESTOS — reemplaza las columnas Arancel / IVA / Agencia */}
            <Card className="rounded-xl border-border/80 border-t-[3px] border-t-primary/40 bg-gradient-to-b from-card to-muted/30 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="py-3.5 px-4 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground" title="Arancel + IVA de importación del pedido próximo a entregar. Con ≈ es el estimado por % sobre el CIF; cuando cargás la liquidación real de aduana en el Resumen del pedido, manda el real.">
                  Impuestos del contenedor
                </p>
                <p className="text-[26px] leading-8 font-extrabold tracking-tight tabular-nums font-mono">
                  {kpis.impLast != null ? `${kpis.impEsReal ? '' : '≈'}${fmtCOPShort(kpis.impLast)}` : '—'}
                </p>
                {kpis.focoLabel && <p className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground/75 truncate">📦 {kpis.focoLabel}</p>}
                <p className="text-[11px] text-muted-foreground">
                  {kpis.impArancel != null && `arancel ${fmtCOPShort(kpis.impArancel)}`}
                  {kpis.impIva != null && ` + IVA ${fmtCOPShort(kpis.impIva)}`}
                  {kpis.impAgencia > 0 && ` + agencia ${fmtCOPShort(kpis.impAgencia)}`}
                </p>
                <SignalLine curr={kpis.impLast} refVal={kpis.impProm} label="promedio" fmtVal={fmtCOPShort} />
                <DeltaLine pct={kpis.impDeltaPct} label="vs último entregado" />
                {kpis.impLast != null && !kpis.impEsReal && (
                  <p className="text-[10px] text-amber-600">estimado — cargá la liquidación real en el pedido</p>
                )}
              </CardContent>
            </Card>
            {/* DÍAS — reemplaza la columna Días de la tabla */}
            <Card className="rounded-xl border-border/80 border-t-[3px] border-t-primary/40 bg-gradient-to-b from-card to-muted/30 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="py-3.5 px-4 space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground" title="Días desde que se montó el pedido (entrada a producción) hasta la entrega — o hasta hoy si sigue en curso. La cotización no cuenta.">
                  Días de la operación
                </p>
                <p className={cn('text-[26px] leading-8 font-extrabold tracking-tight tabular-nums font-mono', kpis.diasFoco?.enCurso && 'text-primary')}>
                  {kpis.diasFoco ? `${kpis.diasFoco.dias}d` : '—'}
                </p>
                {kpis.focoLabel && <p className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground/75 truncate">📦 {kpis.focoLabel}{kpis.diasFoco?.enCurso ? ' · en curso' : ''}</p>}
                <p className="text-[11px] text-muted-foreground">
                  {kpis.diasProm != null
                    ? `prom. histórico ${Math.round(kpis.diasProm)}d de montaje a entrega`
                    : 'sin ciclos completos todavía'}
                </p>
                {kpis.diasFoco && kpis.diasProm != null && (
                  <p className={cn('text-[11px] font-medium', kpis.diasFoco.dias > kpis.diasProm ? 'text-destructive' : 'text-success')}>
                    {kpis.diasFoco.dias > kpis.diasProm
                      ? `+${kpis.diasFoco.dias - Math.round(kpis.diasProm)}d sobre el promedio`
                      : `faltan ~${Math.round(kpis.diasProm) - kpis.diasFoco.dias}d si se comporta como siempre`}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Radar de abastecimiento: prioridad, futuros y cuándo montar ── */}
        {radar && (
          <Card className="border-primary/25">
            <CardContent className="py-4 px-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <RadarIcon className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Radar de abastecimiento</span>
                {/* Lead time total y cadencia BIEN visibles (pedido de Nico) */}
                <span className="ml-auto flex items-center gap-2">
                  {radar.leadTime != null && (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary"
                      title="Promedio real de tus pedidos: de producción a entregado (la cotización no cuenta — es tiempo de decisión)"
                    >
                      <Clock className="h-3.5 w-3.5" /> Lead time ~{radar.leadTime}d
                    </span>
                  )}
                  {radar.cadencia != null && (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2.5 py-1 text-xs font-bold text-foreground"
                      title="Días promedio entre un pedido y el siguiente (últimos 6 pedidos)"
                    >
                      <Ship className="h-3.5 w-3.5" /> Pedís cada ~{radar.cadencia}d
                    </span>
                  )}
                </span>
              </div>
              <div className="grid md:grid-cols-3 gap-3">
                {/* 1 · Prioridad: el que llega */}
                {radar.proximo && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-primary flex items-center gap-1">
                      <PackageCheck className="h-3 w-3" /> Prioridad · llega{' '}
                      {radar.proximoDias != null
                        ? radar.proximoDias <= 0 ? 'YA' : `en ${radar.proximoDias} día${radar.proximoDias !== 1 ? 's' : ''}`
                        : '—'}
                    </p>
                    <p className="text-sm font-semibold">
                      {radar.proximo.r.proveedor_nombre}
                      {radar.proximo.r.ref_pedido && <span className="font-mono text-xs text-muted-foreground"> · {radar.proximo.r.ref_pedido}</span>}
                      {radar.proximo.llega && <span className="font-normal text-xs text-muted-foreground"> — {fmtFechaCorta(radar.proximo.llega)}</span>}
                    </p>
                    <div className="text-[11px] space-y-0.5">
                      {/* Desglose puerto→aduana→bodega: la aduana es la fecha
                          LÍMITE para tener el saldo girado (pedido de Nico) */}
                      {radar.proximo.llega && radar.proximo.r.estado !== 'aduana' && radar.proximo.r.estado !== 'entregado' && (
                        <p>
                          <span className="text-muted-foreground">🛃 Aduana:</span>{' '}
                          <span className="font-semibold">≈{fmtFechaCorta(isoAddDays(radar.proximo.llega, -nacProm))}</span>
                          <span className="text-muted-foreground"> (límite de pago)</span>
                          {' · '}
                          <span className="text-muted-foreground">📦 Bodega:</span>{' '}
                          <span className="font-semibold">≈{fmtFechaCorta(radar.proximo.llega)}</span>
                        </p>
                      )}
                      {radar.saldoProximo != null && radar.saldoProximo > 0 ? (
                        <p><span className="text-muted-foreground">Saldo por girar:</span> <span className="font-mono font-semibold text-destructive">{fmtUSD0(radar.saldoProximo)}</span>
                          {radar.proximo.llega && radar.proximo.r.estado !== 'aduana' && radar.proximo.r.estado !== 'entregado' && (
                            <span className="text-muted-foreground"> antes de aduana</span>
                          )}
                        </p>
                      ) : (
                        <p className="text-success font-medium">Mercancía 100% pagada ✓</p>
                      )}
                      {radar.cajaNacionalizar != null && radar.cajaNacionalizar > 0 && (
                        <p>
                          <span className="text-muted-foreground">Caja para nacionalizar:</span>{' '}
                          <span className="font-mono font-semibold">≈{fmtCOPShort(radar.cajaNacionalizar)}</span>
                          <span className="text-muted-foreground"> (arancel + IVA + agencia)</span>
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* 2 · Los que vienen detrás — promedio de compra abierto */}
                <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                    <Factory className="h-3 w-3" /> Vienen detrás ({radar.detras.length})
                  </p>
                  {radar.smmPonderado != null && (
                    <p className="text-[11px]">
                      <span className="text-muted-foreground">Compra abierta promediada:</span>{' '}
                      <span className="font-mono font-semibold">${radar.smmPonderado.toLocaleString('en-US', { maximumFractionDigits: 0 })}/t</span>
                      {radar.smmUltimo != null && Math.round(radar.smmUltimo) !== Math.round(radar.smmPonderado) && (
                        <span className="text-muted-foreground"> · último pedido ${radar.smmUltimo.toLocaleString('en-US', { maximumFractionDigits: 0 })}/t</span>
                      )}
                    </p>
                  )}
                  <div className="text-[11px] space-y-0.5">
                    {radar.detras.length === 0 ? (
                      <p className="text-muted-foreground">Nada en camino detrás del que llega.</p>
                    ) : radar.detras.slice(0, 3).map(x => (
                      <p key={x.r.id} className="text-muted-foreground">
                        <span className="font-mono text-foreground">{x.r.ref_pedido ?? x.r.proveedor_nombre}</span>
                        {Number(x.r.precio_smm_cerrado_usd_ton ?? 0) > 0 && ` · $${Number(x.r.precio_smm_cerrado_usd_ton).toLocaleString('en-US', { maximumFractionDigits: 0 })}/t`}
                        {x.llega && ` · llega ~${fmtFechaCorta(x.llega)}${x.etaEstimada ? ' (est.)' : ''}`}
                      </p>
                    ))}
                  </div>
                </div>

                {/* 3 · Alerta: cuándo montar el próximo pedido */}
                {/* Misma fuente que la card de sugerencia — nunca se contradicen. */}
                <div className={cn(
                  'rounded-lg border px-3 py-2.5 space-y-1',
                  reorder.suggestion?.diasParaDecidir != null && reorder.suggestion.diasParaDecidir <= 7
                    ? 'border-destructive/40 bg-destructive/5'
                    : reorder.suggestion?.diasParaDecidir != null && reorder.suggestion.diasParaDecidir <= 30
                      ? 'border-amber-400/50 bg-amber-50/50 dark:bg-amber-950/10'
                      : 'border-border bg-muted/20',
                )}>
                  <p className={cn(
                    'text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1',
                    reorder.suggestion?.diasParaDecidir != null && reorder.suggestion.diasParaDecidir <= 7 ? 'text-destructive'
                      : reorder.suggestion?.diasParaDecidir != null && reorder.suggestion.diasParaDecidir <= 30 ? 'text-amber-600' : 'text-muted-foreground',
                  )}>
                    <AlertTriangle className="h-3 w-3" /> Próximo pedido
                  </p>
                  {reorder.suggestion?.fechaLimite && reorder.suggestion.diasParaDecidir != null ? (
                    <p className="text-[11px] leading-relaxed">
                      {reorder.suggestion.diasParaDecidir <= 0 ? (
                        reorder.retenidos.length > 0 || reorder.pedidosSinItems.length > 0 ? (
                          // Dos decisiones distintas (Nico 2026-08-02): con
                          // mercancía comprada retenida o sin proforma, lo
                          // urgente es traerla/cargarla — no montar otro pedido.
                          <>
                            <span className="font-semibold text-warning">
                              {reorder.retenidos.length > 0 ? 'Primero mandá a traer lo ya comprado' : 'Primero subí la proforma del pedido abierto'}
                            </span>{' '}
                            — la fecha de montar se recalcula sola. Detalle en la card de arriba.
                          </>
                        ) : (
                        <>
                          <span className="font-semibold text-destructive">Fecha límite alcanzada:</span>{' '}
                          <strong>{fmtFechaCorta(reorder.suggestion.fechaLimite)}</strong>. Uno montado hoy
                          queda en bodega ~<strong>{fmtFechaCorta(reorder.suggestion.llegadaSiPidoHoy)}</strong>.
                        </>
                        )
                      ) : (
                        <>
                          Montalo antes del <strong>{fmtFechaCorta(reorder.suggestion.fechaLimite)}</strong>{' '}
                          ({reorder.suggestion.diasParaDecidir} día{reorder.suggestion.diasParaDecidir !== 1 ? 's' : ''}) —
                          detalle en la card de arriba.
                        </>
                      )}
                    </p>
                  ) : reorder.suggestion?.motivoSinFecha === 'sin_urgencia' ? (
                    <p className="text-[11px] text-success leading-relaxed font-medium">
                      ✓ Cobertura sobrada (&gt;400d) — sin pedido a la vista. Normal recién entrado un contenedor.
                    </p>
                  ) : reorder.suggestion ? (
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Sin consumo registrado para proyectar fecha — detalle en la card de arriba.
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Calculando con stock físico, consumo y tránsito…
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Búsqueda + filtros por etapa, con el pipeline integrado: cada chip
            dice CUÁNTOS contenedores hay en esa etapa ahora y cuánto demora
            en promedio (antes eran dos barras separadas y el "(N)" era el
            número de muestras del promedio, no los contenedores). */}
        <Card>
          <CardContent className="py-3 px-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar proveedor / referencia..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
            <div className="inline-flex bg-muted rounded-md p-0.5 gap-0.5 flex-wrap">
              {(['abiertos', 'todos', ...IMPORT_ESTADOS_ORDER, 'cerrado'] as Filter[]).map(f => {
                const esEstado = f !== 'abiertos' && f !== 'todos';
                const count = f === 'abiertos'
                  // Mismo criterio que la tabla: abierto = todo lo NO cerrado/cancelado
                  ? (data?.all.filter(r => r.estado !== 'cerrado' && r.estado !== 'cancelado').length ?? 0)
                  : f === 'todos'
                    ? (data?.all.length ?? 0)
                    : conteoPorEstado.get(f as ImportEstado) ?? 0;
                const prom = esEstado ? stageAverages?.[f as ImportEstado]?.promedio : undefined;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    title={esEstado && prom != null
                      ? `${count} contenedor${count === 1 ? '' : 'es'} en esta etapa · demora promedio ${prom} días`
                      : undefined}
                    className={cn(
                      'px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap inline-flex items-center gap-1.5',
                      filter === f
                        ? 'bg-background shadow-sm text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {f === 'abiertos' ? 'Abiertos' : f === 'todos' ? 'Todos' : IMPORT_ESTADO_LABEL[f as ImportEstado]}
                    <span className={cn('font-mono font-semibold', count > 0 ? 'text-foreground' : 'text-muted-foreground/50')}>
                      {count}
                    </span>
                    {prom != null && (
                      <span className="text-[10px] text-muted-foreground font-normal inline-flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5" />~{prom}d
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Tabla */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {filter === 'abiertos' ? 'Abiertos' : filter === 'todos' ? 'Todos' : IMPORT_ESTADO_LABEL[filter as ImportEstado]}
              <span className="text-muted-foreground ml-2">({filtered.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/80">
                    {/* Costos POR COLUMNA (pedido de Nico 2026-08-02: "cada
                        ítem debe ser una columna, debo poder ver esa info
                        fácil") — valores compactos ($3,2M) con el exacto en
                        tooltip para que no explote el ancho. */}
                    <TableHead className="font-semibold">Proveedor</TableHead>
                    <TableHead className="font-semibold">Estado</TableHead>
                    <TableHead className="font-semibold text-right">Total USD</TableHead>
                    <TableHead className="font-semibold text-right">Saldo</TableHead>
                    <TableHead className="font-semibold text-right" title="Flete internacional (USD)">Flete</TableHead>
                    <TableHead className="font-semibold text-right" title="Mercancía en pesos: monto USD × TRM (abonos → causación → hoy)">Mercancía COP</TableHead>
                    <TableHead className="font-semibold text-right" title="Arancel + IVA de importación (liquidación real si está cargada; si no, estimado)">Aduana</TableHead>
                    <TableHead className="font-semibold text-right" title="Agencia de aduanas / nacionalización">Agencia</TableHead>
                    <TableHead className="font-semibold text-right" title="Transporte local a bodega — costos cuyo concepto diga 'transporte' o 'Argemiro'">Transporte</TableHead>
                    <TableHead className="font-semibold text-right" title="CIF COP + arancel + IVA + otros — la misma cuenta del Resumen del pedido">Total imp.</TableHead>
                    <TableHead className="font-semibold" title="La ETA que cargás es la llegada a PUERTO; la app le suma tu promedio de nacionalización para pronosticar la llegada a bodega.">ETA bodega</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-12 text-muted-foreground">
                        Cargando importaciones...
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-12">
                        <div className="flex flex-col items-center gap-2">
                          <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
                          <p className="text-muted-foreground">
                            {filter === 'abiertos'
                              ? 'No hay importaciones abiertas.'
                              : 'No hay importaciones con esos filtros.'}
                          </p>
                          {filter === 'abiertos' && (
                            <Button variant="outline" size="sm" onClick={openNew} className="mt-2">
                              <Plus className="h-4 w-4 mr-1" /> Crear la primera
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map(row => {
                      const badge = ESTADO_BADGE[row.estado];
                      const flete = sumImportCosts(row.import_costs, 'flete');
                      const arancel = sumImportCosts(row.import_costs, 'arancel');
                      const iva = sumImportCosts(row.import_costs, 'iva_importacion');
                      const agencia = sumImportCosts(row.import_costs, 'nacionalizacion');
                      // Estimados de arancel/IVA cuando aún no está cargado el
                      // real — misma lib que el Resumen. TRM: abonos → causación → hoy.
                      const trmEst = trmByImport.get(row.id)
                        ?? (row.trm_causacion ? Number(row.trm_causacion) : null)
                        ?? trmHoy;
                      const bd = computeImportBreakdown({
                        mercanciaUsd: Number(row.monto_total_usd ?? 0),
                        costs: row.import_costs,
                        trm: trmEst,
                        arancelPct: Number(row.arancel_pct ?? 5),
                        ivaPct: Number(row.iva_pct ?? 19),
                        cantidadKg: Number(row.cantidad_ton ?? 0) > 0 ? Number(row.cantidad_ton) * 1000 : null,
                      });
                      const arancelEst = bd.arancelCop != null && bd.arancelCop > 0 ? bd.arancelCop : null;
                      const ivaEst = bd.ivaCop != null && bd.ivaCop > 0 ? bd.ivaCop : null;
                      const hayArancelReal = arancel.usd > 0 || arancel.cop > 0;
                      const hayIvaReal = iva.usd > 0 || iva.cop > 0;
                      // ── Costos del contenedor, por COLUMNA (pedido de Nico
                      // 2026-08-02): flete, mercancía COP, aduana, agencia y
                      // transporte local a bodega (Argemiro).
                      const mercanciaCop = trmEst ? Number(row.monto_total_usd ?? 0) * trmEst : null;
                      const impuestosAduanaCop = (bd.arancelCop ?? 0) + (bd.ivaCop ?? 0);
                      const agenciaCop = agencia.cop + (trmEst ? agencia.usd * trmEst : 0);
                      // Transporte local: se reconoce por el concepto ("Transporte
                      // Argemiro", "acarreo"...) dentro de otros/gastos.
                      const transporteCop = (row.import_costs ?? []).reduce((s, c) => {
                        if (!/transport|argemiro|acarreo|flete\s*local/i.test(String((c as { concepto?: string | null }).concepto ?? ''))) return s;
                        const m = Number(c.monto ?? 0);
                        return s + (c.moneda === 'USD' ? (trmEst ? m * trmEst : 0) : m);
                      }, 0);
                      // Inicio = primera etapa registrada en el historial (fallback: fecha de cotización).
                      const fechaInicio = (row.import_estado_history ?? [])
                        .map(h => h.fecha).filter(Boolean).sort()[0] ?? row.fecha_cotizacion ?? null;
                      // Cierre = fecha de entrega; en firme solo con la declaración BanRep subida.
                      const fechaEntrega = row.import_estado_history?.find(h => h.estado === 'entregado')?.fecha
                        ?? row.fecha_arribo_real ?? null;
                      const tieneBanrep = row.cerrada
                        || (row.import_documents ?? []).some(d => d.tipo === 'certificado_banrep');
                      return (
                        <Fragment key={row.id}>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => openEdit(row)}
                        >
                          <TableCell className="text-sm">
                            <div className="font-medium flex items-center gap-1.5">
                              {row.proveedor_nombre}
                            </div>
                            {/* Ref + inicio + días: el detalle de contexto que
                                antes eran columnas propias, acá en chiquito. */}
                            <div className="text-[10px] text-muted-foreground font-mono flex items-center gap-1.5 flex-wrap">
                              {row.ref_pedido && <span>{row.ref_pedido}</span>}
                              {fechaInicio && (
                                <span className="font-sans" title="Fecha en que se montó el pedido">
                                  desde {format(parseLocalDate(fechaInicio), 'dd MMM yy', { locale: es })}
                                </span>
                              )}
                              {(() => {
                                const total = row.import_estado_history?.length
                                  ? computeTotalDays(row.import_estado_history, row.estado)
                                  : null;
                                if (!total) return null;
                                return (
                                  <span
                                    className={cn('font-sans font-semibold', total.enCurso && 'text-primary')}
                                    title={total.enCurso ? 'Días desde que se montó el pedido (en curso)' : 'Días totales hasta la entrega'}
                                  >
                                    · {total.dias}d
                                  </span>
                                );
                              })()}
                            </div>
                          </TableCell>
                          {/* Estado editable en línea — mismos estados que el modal.
                              El cambio pide fecha en el dialog antes de aplicarse.
                              Cerrada = candado: se reabre desde el modal (solo admin). */}
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {row.cerrada ? (
                              <span
                                className={cn('inline-flex items-center gap-1 h-7 px-2.5 rounded-md border text-[11px] font-medium', badge.bg, badge.color, badge.border)}
                                title="Importación cerrada — solo el admin puede reabrirla (desde el modal)"
                              >
                                <LockIcon className="h-3 w-3" />
                                {row.estado === 'cerrado' ? 'Cerrada' : `${IMPORT_ESTADO_LABEL[row.estado]} · Cerrada`}
                              </span>
                            ) : (
                              <Select
                                value={row.estado}
                                onValueChange={(v) => {
                                  if (v !== row.estado) setChanging({ row, estado: v as ImportEstado, fecha: todayIso() });
                                }}
                                disabled={changeEstado.isPending}
                              >
                                <SelectTrigger className={cn('h-7 w-[150px] text-[11px] font-medium border', badge.bg, badge.color, badge.border)}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {IMPORT_ESTADOS_ORDER.map(e => (
                                    <SelectItem key={e} value={e}>{IMPORT_ESTADO_LABEL[e]}</SelectItem>
                                  ))}
                                  {row.estado === 'anticipo' && (
                                    <SelectItem value="anticipo" disabled>Anticipo pagado (viejo)</SelectItem>
                                  )}
                                  {row.estado === 'cotizacion' && (
                                    <SelectItem value="cotizacion" disabled>Cotización (viejo)</SelectItem>
                                  )}
                                  {/* Cerrado (cierre de negocio) — NO "cancelado":
                                      Nico 2026-08-02, "cancelado no existe". */}
                                  <SelectItem value="cerrado">Cerrado</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                            {/* Checklist documental por etapa (Nico 2026-08-02):
                                alertas chiquitas POR FILA, estilo BanRep —
                                proforma → packing → packing costeado → BanRep. */}
                            {(() => {
                              const ds = docStatus.get(row.id);
                              const enviado = row.estado === 'transito' || row.estado === 'aduana';
                              const entregadoYa = row.estado === 'entregado' || row.estado === 'cerrado';
                              if (row.estado === 'cancelado') return null;
                              // Aviso → botón: te deja parado en Costeo con la
                              // subida correcta abierta y el tipo preseleccionado.
                              const abrirSubida = (upload: 'proforma' | 'packing') => (e: React.MouseEvent) => {
                                e.stopPropagation();
                                setEditing(row);
                                setModalOpts({ tab: 'costeo', upload });
                                setShowModal(true);
                              };
                              const warnBtn = 'text-[9px] text-amber-600 mt-0.5 whitespace-nowrap underline decoration-dotted underline-offset-2 hover:text-amber-700 block text-left';
                              if (!ds?.hasItems) {
                                return <button type="button" className={warnBtn} onClick={abrirSubida('proforma')}>⚠ falta subir proforma → subila acá</button>;
                              }
                              if (enviado && !ds.hasPacking) {
                                return <button type="button" className={warnBtn} onClick={abrirSubida('packing')}>⚠ falta subir packing list → subilo acá</button>;
                              }
                              if (entregadoYa && !ds.hasPackingCosteado) {
                                return <button type="button" className={warnBtn} onClick={abrirSubida('packing')}>⚠ falta packing list costeado → subilo acá</button>;
                              }
                              return null;
                            })()}
                            {/* Entregado pero sin declaración BanRep: la alerta
                                vive acá, chiquita, para no engordar Cierre */}
                            {fechaEntrega && !tieneBanrep && (
                              <div className="text-[9px] text-amber-600 mt-0.5 whitespace-nowrap">⚠ falta cierre BanRep</div>
                            )}
                          </TableCell>
                          {/* Total USD = mercancía + flete (el saldo sigue siendo vs mercancía) */}
                          <TableCell
                            className="text-right text-sm font-mono"
                            title={`Mercancía ${fmtUSD(row.monto_total_usd)} + flete ${fmtUSD(flete.usd)}`}
                          >
                            {fmtUSD(Number(row.monto_total_usd ?? 0) + flete.usd)}
                          </TableCell>
                          <TableCell className="text-right text-sm font-mono font-bold text-destructive">{fmtUSD0(row.saldo_pendiente_usd)}</TableCell>
                          {/* Costos por columna — compactos, exacto en tooltip */}
                          <TableCell className="text-right text-xs font-mono" title="Flete internacional">
                            {flete.usd > 0 ? fmtUSD0(flete.usd) : flete.cop > 0 ? fmtCOPShort(flete.cop) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right text-xs font-mono" title={mercanciaCop != null ? `Mercancía ${fmtUSD(row.monto_total_usd)} × TRM ${trmEst ? Math.round(trmEst).toLocaleString('es-CO') : '—'} = $${Math.round(mercanciaCop).toLocaleString('es-CO')} COP` : 'Sin TRM para convertir'}>
                            {mercanciaCop != null && mercanciaCop > 0 ? fmtCOPShort(mercanciaCop) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right text-xs font-mono" title={impuestosAduanaCop > 0 ? `Arancel + IVA = $${Math.round(impuestosAduanaCop).toLocaleString('es-CO')} COP ${hayArancelReal || hayIvaReal ? '(liquidación real)' : '(estimado)'}` : 'Sin datos para estimar'}>
                            {impuestosAduanaCop > 0 ? (
                              <span>
                                {fmtCOPShort(impuestosAduanaCop)}
                                {!hayArancelReal && !hayIvaReal && <span className="text-muted-foreground font-sans"> est.</span>}
                              </span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right text-xs font-mono" title={agenciaCop > 0 ? `Agencia / nacionalización: $${Math.round(agenciaCop).toLocaleString('es-CO')} COP` : 'Sin costo de agencia cargado'}>
                            {agenciaCop > 0 ? fmtCOPShort(agenciaCop) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right text-xs font-mono" title={transporteCop > 0 ? `Transporte local a bodega: $${Math.round(transporteCop).toLocaleString('es-CO')} COP` : 'Cargalo en Costeo con concepto "transporte" o "Argemiro"'}>
                            {transporteCop > 0 ? fmtCOPShort(transporteCop) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right text-xs font-mono font-semibold" title={bd.totalImportacionCop != null ? `Total importación: $${Math.round(bd.totalImportacionCop).toLocaleString('es-CO')} COP (CIF + arancel + IVA + otros)` : 'Sin TRM para calcular'}>
                            {bd.totalImportacionCop != null && bd.totalImportacionCop > 0 ? fmtCOPShort(bd.totalImportacionCop) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          {/* ETA cargada = PUERTO (dato de la naviera); bodega = + nacionalización
                              prom. (lo estimado). Entregado → manda la fecha REAL de entrega. */}
                          <TableCell className="text-sm whitespace-nowrap">
                            {(row.estado === 'entregado' || row.estado === 'cerrado') ? (
                              fechaEntrega
                                ? <span className="inline-flex items-center gap-1 text-success" title="Fecha real de entrega en bodega">
                                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                    {format(parseLocalDate(fechaEntrega), 'dd MMM yy', { locale: es })}
                                  </span>
                                : <span className="text-muted-foreground">—</span>
                            ) : row.fecha_estimada_llegada ? (
                              <div title={`Puerto ${format(parseLocalDate(row.fecha_estimada_llegada), 'dd MMM', { locale: es })} (naviera) + ~${nacProm}d de nacionalización promedio`}>
                                <span className="font-medium">
                                  ≈{format(parseLocalDate(isoAddDays(row.fecha_estimada_llegada, nacProm)), 'dd MMM yyyy', { locale: es })}
                                </span>
                                <div className="text-[10px] text-muted-foreground">puerto {format(parseLocalDate(row.fecha_estimada_llegada), 'dd MMM', { locale: es })}</div>
                              </div>
                            ) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        </TableRow>
                        </Fragment>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        </>
        )}
      </div>

      <ImportModal
        open={showModal}
        onOpenChange={(v) => { setShowModal(v); if (!v) { setEditing(null); setModalOpts(null); } }}
        editing={editing}
        initialTab={modalOpts?.tab}
        autoOpenUpload={modalOpts?.upload ?? null}
        onAutoOpenHandled={() => setModalOpts((o) => (o ? { ...o, upload: null } : o))}
      />

      {/* Fecha del cambio de estado (select inline de la lista) */}
      <Dialog open={!!changing} onOpenChange={(v) => { if (!v) setChanging(null); }}>
        <DialogContent className="sm:max-w-sm">
          {changing && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">
                  Cambiar a "{IMPORT_ESTADO_LABEL[changing.estado]}"
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {changing.row.proveedor_nombre}
                  {changing.row.ref_pedido ? ` · ${changing.row.ref_pedido}` : ''} — con esta fecha se calcula
                  cuánto duró la etapa "{IMPORT_ESTADO_LABEL[changing.row.estado]}".
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label className="text-sm">¿En qué fecha cambió de estado?</Label>
                <Input
                  type="date"
                  value={changing.fecha}
                  max={todayIso()}
                  onChange={e => setChanging({ ...changing, fecha: e.target.value })}
                  autoFocus
                />
              </div>
              <Button
                className="w-full"
                disabled={!changing.fecha || changeEstado.isPending}
                onClick={async () => {
                  await changeEstado.mutateAsync({ row: changing.row, estado: changing.estado, fecha: changing.fecha });
                  setChanging(null);
                }}
              >
                {changeEstado.isPending ? 'Guardando…' : 'Confirmar cambio'}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
