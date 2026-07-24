import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Ship, AlertCircle, Search, LineChart, List, Clock, TrendingUp, TrendingDown, CheckCircle2, Lock as LockIcon, Radar as RadarIcon, AlertTriangle, PackageCheck, PackageSearch, Factory } from 'lucide-react';
import { useImports, sumImportCosts, type ImportRow, type ImportEstado, IMPORT_ESTADO_LABEL, IMPORT_ESTADOS_ORDER } from '@/hooks/useImports';
import { fetchTrmForDate } from '@/hooks/useImportPayments';
import { computeImportBreakdown } from '@/lib/importCosting';
import { supabase } from '@/integrations/supabase/client';
import ImportModal from '@/components/imports/ImportModal';
import ImportPriceAnalysis from '@/components/imports/ImportPriceAnalysis';
import ReorderSuggestionCard from '@/components/imports/ReorderSuggestionCard';
import CoverageAnalysis from '@/components/imports/CoverageAnalysis';
import { useReorderSuggestion } from '@/hooks/useReorderSuggestion';
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
  return (
    <p className={cn('text-[11px] font-medium inline-flex items-center gap-1', pct > 0 ? 'text-destructive' : 'text-success')}>
      {pct > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {pct > 0 ? '+' : ''}{pct.toFixed(1)}% {label}
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
      <p className="text-[11px] font-medium inline-flex items-center gap-1 text-muted-foreground">
        <CheckCircle2 className="h-3 w-3 text-success" /> en línea con {label} ({fmtVal(refVal)})
      </p>
    );
  }
  const caro = pct > 0;
  return (
    <p className={cn('text-[11px] font-semibold inline-flex items-center gap-1', caro ? 'text-destructive' : 'text-success')}>
      {caro ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {caro ? '+' : ''}{pct.toFixed(1)}% vs {label} ({fmtVal(refVal)})
    </p>
  );
}

type Filter = 'abiertos' | 'todos' | ImportEstado;

export default function Importaciones() {
  const { data, isLoading, changeEstado } = useImports();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ImportRow | null>(null);
  const [filter, setFilter] = useState<Filter>('abiertos');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'pedidos' | 'analisis' | 'cobertura'>('pedidos');
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
  const trmByImport = useMemo(
    () => new Map(liqRows.map(r => [r.import_id, r.trm_promedio_ponderada ? Number(r.trm_promedio_ponderada) : null])),
    [liqRows],
  );

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
    const fechaRef = (r: ImportRow) => r.fecha_cotizacion ?? r.created_at.slice(0, 10);
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
    const ESTADO_AVANCE: Record<string, number> = { cotizacion: 0, anticipo: 1, produccion: 2, transito: 3, aduana: 4 };
    const yaLlego = (r: ImportRow) => r.estado === 'entregado' || r.estado === 'cerrado';
    const entregados = ordered.filter(yaLlego);
    const abiertosPipeline = [...ordered]
      .filter(r => !yaLlego(r))
      .sort((a, b) => (ESTADO_AVANCE[b.estado] ?? 0) - (ESTADO_AVANCE[a.estado] ?? 0) || fechaRef(a).localeCompare(fechaRef(b)));
    const fechaEntrega = (r: ImportRow) => r.fecha_arribo_real ?? fechaRef(r);
    const entregadosOrd = [...entregados].sort((a, b) => fechaEntrega(a).localeCompare(fechaEntrega(b)));
    // Sin abiertos, el foco cae al último entregado (y anterior al penúltimo).
    const foco = abiertosPipeline[0] ?? entregadosOrd[entregadosOrd.length - 1] ?? null;
    const anterior = abiertosPipeline[0]
      ? entregadosOrd[entregadosOrd.length - 1] ?? null
      : entregadosOrd[entregadosOrd.length - 2] ?? null;
    const ESTADO_LABEL: Record<string, string> = {
      cotizacion: 'cotización', anticipo: 'anticipo', produccion: 'en producción',
      transito: 'en tránsito', aduana: 'en aduanas', entregado: 'entregado', cerrado: 'cerrado',
    };
    const focoLabel = foco ? `${foco.ref_pedido || foco.proveedor_nombre} · ${ESTADO_LABEL[foco.estado] ?? foco.estado}` : null;

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

    // TRM pagada (ponderada de los abonos) — del pedido en FOCO vs último
    // entregado (mismo criterio que SMM/Total/COP-ton: el que viene manda).
    const trmPedido = (r: ImportRow | null) => {
      if (!r) return null;
      const t = trmByImport.get(r.id) ?? null;
      return t != null && t > 0 ? t : null;
    };
    const trmLast = trmPedido(foco);
    const trmDeltaPct = pct(trmLast, trmPedido(anterior));
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

    return {
      pedidosEsteAnio, pedidosAnioPasado, tonEsteAnio, tonAnioPasado,
      focoLabel,
      usdLast, usdDeltaPct, usdYoYPct, usdProm,
      totLast, totDeltaPct, totProm,
      nacLast, nacDeltaPct, nacYoYPct, nacProm,
      trmLast, trmDeltaPct, trmProm,
      fleteProm, fleteUltimo, fleteDeltaPct,
    };
  }, [data, currentYear, trmByImport, trmHoy]);

  // Sugerencia de próximo pedido — MISMA fuente que la card de arriba (antes
  // el radar calculaba su propia fecha con cadencia de pedidos y se
  // contradecía con la card en pantalla).
  const reorder = useReorderSuggestion();
  // Pedidos abiertos sin proforma/packing → badge en la lista (es incoherente
  // una importación sin proforma: queda invisible para la cobertura).
  const sinProformaIds = useMemo(
    () => new Set(reorder.pedidosSinItems.map((p) => p.id)),
    [reorder.pedidosSinItems],
  );

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
    const fechaRef = (r: ImportRow) => r.fecha_cotizacion ?? r.created_at.slice(0, 10);
    const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

    // Lead time cotización→entrega: entregados reales; si no hay (negocio
    // arrancando), proxy con la ETA de los pedidos abiertos que la tienen.
    const ltEntregados = all
      .filter(r => (r.estado === 'entregado' || r.estado === 'cerrado') && (r.import_estado_history?.length ?? 0) > 0)
      .map(r => computeTotalDays(r.import_estado_history!, r.estado))
      .filter((t): t is { dias: number; enCurso: boolean } => !!t && !t.enCurso && t.dias > 0)
      .map(t => t.dias);
    const ltProxy = abiertos
      .filter(r => r.fecha_estimada_llegada)
      .map(r => isoDiffDays(fechaRef(r), r.fecha_estimada_llegada!))
      .filter(d => d > 0);
    const leadTime = avg(ltEntregados) ?? avg(ltProxy);

    // Llegada (real o estimada) de cada pedido abierto
    const conLlegada = abiertos
      .map(r => ({
        r,
        llega: r.fecha_estimada_llegada
          ?? (leadTime != null ? isoAddDays(fechaRef(r), Math.round(leadTime)) : null),
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
    const cadencia = avg(diffs.slice(-6));
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
  }, [data, trmByImport, trmHoy]);

  const filtered = useMemo(() => {
    const rows = data?.all ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
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
  }, [data, filter, search]);

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
        ) : (
        <>
        {/* Sugerencia de próximo pedido: quiebre de stock − lead time − colchón */}
        <ReorderSuggestionCard onVerReporte={() => setView('cobertura')} />

        {/* KPIs de materia prima: cada uno con variación vs pedido anterior y vs año pasado */}
        {kpis && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Card>
              <CardContent className="py-3 px-4">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">Pedidos {currentYear}</p>
                <p className="text-2xl font-bold tabular-nums">{kpis.pedidosEsteAnio}</p>
                <p className="text-[11px] text-muted-foreground">
                  {kpis.pedidosAnioPasado} en {currentYear - 1}
                  {kpis.tonEsteAnio > 0 && ` · ${kpis.tonEsteAnio.toLocaleString('es-CO', { maximumFractionDigits: 1 })} t${kpis.tonAnioPasado > 0 ? ` (${kpis.tonAnioPasado.toLocaleString('es-CO', { maximumFractionDigits: 1 })} t en ${currentYear - 1})` : ''}`}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70" title="SMM cerrado del pedido próximo a entregar — el costo del material que está por llegar a bodega. Cuando se entregue, el foco pasa solo al siguiente del pipeline.">SMM próx. a entregar (USD/t)</p>
                <p className="text-2xl font-bold tabular-nums font-mono">
                  {kpis.usdLast != null ? `$${kpis.usdLast.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
                </p>
                {kpis.focoLabel && <p className="text-[10px] text-muted-foreground truncate">📦 {kpis.focoLabel}</p>}
                <SignalLine curr={kpis.usdLast} refVal={kpis.usdProm} label="promedio"
                  fmtVal={(n) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />
                <DeltaLine pct={kpis.usdDeltaPct} label="vs último entregado" />
                <DeltaLine pct={kpis.usdYoYPct} label={`vs ${currentYear - 1}`} />
                {kpis.usdLast == null && kpis.usdProm != null && (
                  <p className="text-[11px] text-muted-foreground">promedio ${kpis.usdProm.toLocaleString('en-US', { maximumFractionDigits: 0 })}</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70" title="CIF + arancel + IVA + otros costos del pedido PRÓXIMO A ENTREGAR, en pesos — la plata comprometida en lo que viene. Usa el estimado (≈) mientras no esté cargado el costo real.">Total Importación (COP)</p>
                <p className="text-2xl font-bold tabular-nums font-mono">
                  {kpis.totLast != null ? fmtCOPShort(kpis.totLast) : '—'}
                </p>
                {kpis.focoLabel && <p className="text-[10px] text-muted-foreground truncate">📦 {kpis.focoLabel}</p>}
                <SignalLine curr={kpis.totLast} refVal={kpis.totProm} label="promedio" fmtVal={fmtCOPShort} />
                <DeltaLine pct={kpis.totDeltaPct} label="vs último entregado" />
                {kpis.totLast == null && (kpis.totProm != null
                  ? <p className="text-[11px] text-muted-foreground">promedio {fmtCOPShort(kpis.totProm)}</p>
                  : <p className="text-[11px] text-muted-foreground">CIF + arancel + IVA + otros</p>)}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70" title="Total Importación ÷ toneladas del pedido PRÓXIMO A ENTREGAR — el costo real de la materia prima que está por llegar a bodega.">COP/ton nacionalizado</p>
                <p className="text-2xl font-bold tabular-nums font-mono">
                  {kpis.nacLast != null ? fmtCOPShort(kpis.nacLast) : '—'}
                </p>
                {kpis.focoLabel && <p className="text-[10px] text-muted-foreground truncate">📦 {kpis.focoLabel}</p>}
                <SignalLine curr={kpis.nacLast} refVal={kpis.nacProm} label="promedio" fmtVal={fmtCOPShort} />
                <DeltaLine pct={kpis.nacDeltaPct} label="vs último entregado" />
                <DeltaLine pct={kpis.nacYoYPct} label={`vs ${currentYear - 1}`} />
                {kpis.nacLast == null && kpis.nacProm != null && (
                  <p className="text-[11px] text-muted-foreground">promedio {fmtCOPShort(kpis.nacProm)}</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70" title="TRM ponderada de los abonos del pedido próximo a entregar. La TRM de hoy (mercado) va abajo para comparar si conviene abonar ya.">TRM pagada</p>
                <p className="text-2xl font-bold tabular-nums font-mono">
                  {kpis.trmLast != null ? `$${kpis.trmLast.toLocaleString('es-CO', { maximumFractionDigits: 0 })}` : '—'}
                </p>
                {kpis.focoLabel && <p className="text-[10px] text-muted-foreground truncate">📦 {kpis.focoLabel}</p>}
                <SignalLine curr={kpis.trmLast} refVal={trmHoy != null ? Number(trmHoy) : null} label="TRM de hoy"
                  fmtVal={(n) => `$${n.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`} />
                <DeltaLine pct={kpis.trmDeltaPct} label="vs último entregado" />
                <p className="text-[11px] text-muted-foreground">
                  {kpis.trmProm != null
                    ? `promedio $${kpis.trmProm.toLocaleString('es-CO', { maximumFractionDigits: 0 })} · ponderada de abonos`
                    : 'ponderada de los abonos'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70" title="Flete del pedido próximo a entregar (se conoce al embarcar). '—' = el pedido en foco todavía no tiene flete cargado.">Flete USD</p>
                <p className="text-2xl font-bold tabular-nums font-mono">
                  {kpis.fleteUltimo != null ? `$${kpis.fleteUltimo.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
                </p>
                {kpis.focoLabel && <p className="text-[10px] text-muted-foreground truncate">📦 {kpis.focoLabel}</p>}
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
          </div>
        )}

        {/* ── Radar de abastecimiento: prioridad, futuros y cuándo montar ── */}
        {radar && (
          <Card className="border-primary/25">
            <CardContent className="py-4 px-4 space-y-3">
              <div className="flex items-center gap-2">
                <RadarIcon className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Radar de abastecimiento</span>
                {radar.leadTime != null && (
                  <span className="text-[10px] text-muted-foreground">
                    lead time ~{radar.leadTime}d{radar.cadencia != null ? ` · pedís cada ~${radar.cadencia}d` : ''}
                  </span>
                )}
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
                      {radar.saldoProximo != null && radar.saldoProximo > 0 ? (
                        <p><span className="text-muted-foreground">Saldo por girar:</span> <span className="font-mono font-semibold text-destructive">{fmtUSD0(radar.saldoProximo)}</span></p>
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
                        <>
                          <span className="font-semibold text-destructive">Fecha límite alcanzada:</span>{' '}
                          <strong>{fmtFechaCorta(reorder.suggestion.fechaLimite)}</strong>. Uno montado hoy
                          queda en bodega ~<strong>{fmtFechaCorta(reorder.suggestion.llegadaSiPidoHoy)}</strong>.
                        </>
                      ) : (
                        <>
                          Montalo antes del <strong>{fmtFechaCorta(reorder.suggestion.fechaLimite)}</strong>{' '}
                          ({reorder.suggestion.diasParaDecidir} día{reorder.suggestion.diasParaDecidir !== 1 ? 's' : ''}) —
                          detalle en la card de arriba.
                        </>
                      )}
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
                    <TableHead className="font-semibold">Proveedor</TableHead>
                    <TableHead className="font-semibold">Estado</TableHead>
                    <TableHead className="font-semibold text-right">SMM cerrado</TableHead>
                    <TableHead className="font-semibold text-right">Flete</TableHead>
                    <TableHead className="font-semibold text-right" title="Con ≈ es el estimado que calcula la app (CIF × %). Cuando cargués el real en el Resumen del pedido, manda el real.">Arancel</TableHead>
                    <TableHead className="font-semibold text-right" title="Con ≈ es el estimado que calcula la app ((CIF + arancel) × %). Cuando cargués el real en el Resumen del pedido, manda el real.">IVA</TableHead>
                    <TableHead className="font-semibold text-right">Agencia</TableHead>
                    <TableHead className="font-semibold text-right">Total USD</TableHead>
                    <TableHead className="font-semibold text-right">Saldo</TableHead>
                    <TableHead className="font-semibold" title="Fecha en que arrancó el pedido (primera etapa registrada)">Inicio</TableHead>
                    <TableHead className="font-semibold">ETA</TableHead>
                    <TableHead className="font-semibold" title="Fecha de entrega. Queda EN FIRME solo cuando subís la declaración frente al Banco de la República (certificado BanRep) en el checklist del pedido.">Cierre</TableHead>
                    <TableHead className="font-semibold text-right">Días</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={13} className="text-center py-12 text-muted-foreground">
                        Cargando importaciones...
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={13} className="text-center py-12">
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
                      // Inicio = primera etapa registrada en el historial (fallback: fecha de cotización).
                      const fechaInicio = (row.import_estado_history ?? [])
                        .map(h => h.fecha).filter(Boolean).sort()[0] ?? row.fecha_cotizacion ?? null;
                      // Cierre = fecha de entrega; en firme solo con la declaración BanRep subida.
                      const fechaEntrega = row.import_estado_history?.find(h => h.estado === 'entregado')?.fecha
                        ?? row.fecha_arribo_real ?? null;
                      const tieneBanrep = row.cerrada
                        || (row.import_documents ?? []).some(d => d.tipo === 'certificado_banrep');
                      return (
                        <TableRow
                          key={row.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => openEdit(row)}
                        >
                          <TableCell className="text-sm">
                            <div className="font-medium flex items-center gap-1.5">
                              {row.proveedor_nombre}
                              {sinProformaIds.has(row.id) && (
                                <AlertTriangle
                                  className="h-3.5 w-3.5 text-amber-500 shrink-0"
                                  aria-label="Sin proforma"
                                  // Un pedido sin proforma es invisible para la cobertura
                                />
                              )}
                            </div>
                            {row.ref_pedido && (
                              <div className="text-[10px] text-muted-foreground font-mono">{row.ref_pedido}</div>
                            )}
                            {sinProformaIds.has(row.id) && (
                              <div className="text-[10px] text-amber-600">sin proforma — subilo en Costeo</div>
                            )}
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
                                  <SelectItem value="cancelado">Cancelado</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm font-mono">{fmtUSD(row.precio_smm_cerrado_usd_ton)}</TableCell>
                          <TableCell className="text-right"><CostCell usd={flete.usd} cop={flete.cop} /></TableCell>
                          {/* Arancel / IVA: real cargado si existe; si no, el estimado de la app (≈) */}
                          <TableCell className="text-right">
                            {hayArancelReal
                              ? <CostCell usd={arancel.usd} cop={arancel.cop} />
                              : arancelEst != null
                                ? <span className="font-mono text-sm text-muted-foreground" title={`Estimado: CIF × ${Number(row.arancel_pct ?? 5)}% — cargá el real en el Resumen cuando lo pagues`}>≈{fmtCOPShort(arancelEst)}</span>
                                : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            {hayIvaReal
                              ? <CostCell usd={iva.usd} cop={iva.cop} />
                              : ivaEst != null
                                ? <span className="font-mono text-sm text-muted-foreground" title={`Estimado: (CIF + arancel) × ${Number(row.iva_pct ?? 19)}% — cargá el real en el Resumen cuando lo pagues`}>≈{fmtCOPShort(ivaEst)}</span>
                                : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right"><CostCell usd={agencia.usd} cop={agencia.cop} /></TableCell>
                          {/* Total USD = mercancía + flete (el saldo sigue siendo vs mercancía) */}
                          <TableCell
                            className="text-right text-sm font-mono"
                            title={`Mercancía ${fmtUSD(row.monto_total_usd)} + flete ${fmtUSD(flete.usd)}`}
                          >
                            {fmtUSD(Number(row.monto_total_usd ?? 0) + flete.usd)}
                          </TableCell>
                          <TableCell className="text-right text-sm font-mono font-bold text-destructive">{fmtUSD0(row.saldo_pendiente_usd)}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {fechaInicio
                              ? format(parseLocalDate(fechaInicio), 'dd MMM yy', { locale: es })
                              : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-sm">
                            {row.fecha_estimada_llegada
                              ? format(parseLocalDate(row.fecha_estimada_llegada), 'dd MMM yyyy', { locale: es })
                              : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          {/* Cierre: entregado ≠ cerrado — sin declaración BanRep queda "pendiente" */}
                          <TableCell className="text-sm whitespace-nowrap">
                            {fechaEntrega ? (
                              tieneBanrep ? (
                                <span className="inline-flex items-center gap-1" title="Cierre en firme — declaración frente al Banco de la República subida">
                                  <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                                  {format(parseLocalDate(fechaEntrega), 'dd MMM yy', { locale: es })}
                                </span>
                              ) : (
                                <div title="Pendiente de cierre frente al Banco de la República — subí la declaración (certificado BanRep) en el checklist del pedido">
                                  <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                    {format(parseLocalDate(fechaEntrega), 'dd MMM yy', { locale: es })}
                                  </span>
                                  <div className="text-[10px] text-amber-600">pendiente cierre BanRep</div>
                                </div>
                              )
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm font-mono">
                            {(() => {
                              const total = row.import_estado_history?.length
                                ? computeTotalDays(row.import_estado_history, row.estado)
                                : null;
                              if (!total) return <span className="text-muted-foreground">—</span>;
                              return (
                                <span
                                  className={total.enCurso ? 'text-primary' : 'text-muted-foreground'}
                                  title={total.enCurso ? 'Días desde el inicio (en curso)' : 'Días totales hasta la entrega'}
                                >
                                  {total.dias}d
                                </span>
                              );
                            })()}
                          </TableCell>
                        </TableRow>
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
        onOpenChange={(v) => { setShowModal(v); if (!v) setEditing(null); }}
        editing={editing}
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
