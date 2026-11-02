/**
 * Análisis de precios con el pipeline completo — pedido de Nico 2026-10-31.
 *
 * Antes: "¿este contenedor salió más caro que el anterior?" sobre pedidos con
 * abonos. Ahora, tres preguntas por variante:
 *   1. ¿Qué me costó de verdad?   → lotes REALES (entregados), como siempre.
 *   2. ¿Qué me va a costar lo que viene? → lotes PROYECTADOS (aduana /
 *      tránsito / fábrica) con TRM mixta (hoy para el saldo) y nacionalización
 *      estimada si el pedido no tiene costos — siempre marcados.
 *   3. ¿A cuánto queda mi inventario y mi margen? → costo promedio proyectado
 *      (stock actual + lo que viene) y margen a la lista de hoy, actual vs
 *      proyectado. Es el número que manda para la lista de precios.
 *
 * Todo cálculo vive en src/lib/costoProyectado.ts (puro, con tests) y los
 * datos en usePrecioProyectado. Esta pantalla solo pinta. Solo lectura.
 */

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
  TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight, AlertCircle, LineChart,
  ArrowDown, ArrowUp, ArrowUpDown, Search, Factory, Ship, Anchor, Loader2, Info,
} from 'lucide-react';
import { usePrecioProyectado } from '@/hooks/usePrecioProyectado';
import { ESTADO_LOTE_LABEL, UMBRAL_CAMBIO_PCT, type RefCostPoint, type RefCostSeries, type RefCostoProyectado, type EstadoLote } from '@/lib/costoProyectado';
import { MARGEN_OBJETIVO, MARGEN_RIESGO } from '@/lib/priceImpact';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';

const fmtCop = (n: number | null | undefined) =>
  n === null || n === undefined ? '—'
    : new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
const fmtNum = (n: number) => Math.round(n).toLocaleString('es-CO');
const pct1 = (n: number | null | undefined) =>
  n == null ? '—' : `${(n * 100).toFixed(1).replace('.', ',')}%`;
const fmtMes = (iso: string | null | undefined) => (iso ? format(parseLocalDate(iso), 'MMM yyyy', { locale: es }) : '—');
const fmtDia = (iso: string | null | undefined) => (iso ? format(parseLocalDate(iso), 'dd MMM yyyy', { locale: es }) : '—');

function margenTono(m: number | null | undefined): string {
  if (m == null) return 'text-muted-foreground';
  if (m < 0) return 'text-destructive';
  if (m < MARGEN_RIESGO) return 'text-amber-700 dark:text-amber-400';
  if (m >= MARGEN_OBJETIVO) return 'text-success';
  return 'text-foreground';
}

function DeltaBadge({ pct, invert = false }: { pct: number | null; invert?: boolean }) {
  if (pct === null) return <span className="text-muted-foreground text-xs">—</span>;
  const Icon = pct > 0.5 ? TrendingUp : pct < -0.5 ? TrendingDown : Minus;
  // Un costo que SUBE es malo (rojo); invert = la lectura contraria.
  const malo = invert ? pct < -0.5 : pct > 0.5;
  const bueno = invert ? pct > 0.5 : pct < -0.5;
  const color = malo ? 'text-destructive' : bueno ? 'text-success' : 'text-muted-foreground';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
      <Icon className="h-3.5 w-3.5" />
      {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
    </span>
  );
}

/** Chip de etapa del lote: aduana (ya en puerto) · tránsito (en el agua) · fábrica. */
function EtapaChip({ estado, className }: { estado: EstadoLote; className?: string }) {
  const Icon = estado === 'aduana' ? Anchor : estado === 'transito' ? Ship : Factory;
  const tono = estado === 'aduana'
    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/25'
    : estado === 'transito'
      ? 'bg-primary/10 text-primary ring-primary/25'
      : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/25';
  if (estado === 'entregado') return null;
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', tono, className)}>
      <Icon className="h-3 w-3" /> {ESTADO_LOTE_LABEL[estado].replace('en ', '')}
    </span>
  );
}

type SortKey = 'desemb' | 'prom' | 'ultimo' | 'camino' | 'delta' | 'proy' | 'lista' | 'margen' | 'ajuste';

function SortHead({ k, label, title, sortKey, sortDir, onSort, align = 'right' }: {
  k: SortKey; label: string; title: string;
  sortKey: SortKey | null; sortDir: 'asc' | 'desc'; onSort: (k: SortKey) => void; align?: 'right' | 'center';
}) {
  return (
    <TableHead
      className={cn('font-semibold text-xs cursor-pointer select-none hover:bg-muted/70 transition-colors whitespace-nowrap', align === 'right' ? 'text-right' : 'text-center')}
      title={`${title} Click para ordenar.`}
      onClick={() => onSort(k)}
    >
      <span className={cn('inline-flex items-center gap-1 w-full', align === 'right' ? 'justify-end' : 'justify-center')}>{label}
        {sortKey === k
          ? (sortDir === 'desc' ? <ArrowDown className="h-3 w-3 text-primary" /> : <ArrowUp className="h-3 w-3 text-primary" />)
          : <ArrowUpDown className="h-3 w-3 text-muted-foreground/40" />}
      </span>
    </TableHead>
  );
}

function LotesDetalle({ points }: { points: RefCostPoint[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs h-7">Fecha</TableHead>
          <TableHead className="text-xs h-7">Pedido</TableHead>
          <TableHead className="text-xs h-7">Etapa</TableHead>
          <TableHead className="text-xs h-7">Proveedor</TableHead>
          <TableHead className="text-xs h-7 text-right">Unds</TableHead>
          <TableHead className="text-xs h-7 text-right">SMM USD/t</TableHead>
          <TableHead className="text-xs h-7 text-right">FOB USD/kg</TableHead>
          <TableHead className="text-xs h-7 text-right" title="FOB USD/ton − SMM cerrado: lo que cobra el proveedor por encima del metal. Si sube cuando el SMM baja, te está corriendo el margen.">Prima USD/t</TableHead>
          <TableHead className="text-xs h-7 text-right">TRM</TableHead>
          <TableHead className="text-xs h-7 text-right">Landed unit.</TableHead>
          <TableHead className="text-xs h-7 text-right" title="Reales: vs el desembarco anterior. Proyectados: vs el último real.">Δ</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {points.map((p, i) => (
          <TableRow key={p.import_id + i} className={cn(p.proyectado && 'bg-amber-500/[0.03]')}>
            <TableCell className="text-xs py-1 whitespace-nowrap">
              {p.proyectado ? <span title="Llegada estimada a bodega (la misma fecha que usa Cobertura)">≈ {fmtDia(p.fecha)}</span> : fmtDia(p.fecha)}
            </TableCell>
            <TableCell className="text-xs py-1 font-mono tabular-nums">{p.pedido}</TableCell>
            <TableCell className="text-xs py-1">
              {p.proyectado ? <EtapaChip estado={p.estado} /> : <span className="text-muted-foreground">entregado</span>}
            </TableCell>
            <TableCell className="text-xs py-1 truncate max-w-[140px]">{p.proveedor}</TableCell>
            <TableCell className="text-xs py-1 text-right font-mono tabular-nums">{fmtNum(p.cantidad)}</TableCell>
            <TableCell className="text-xs py-1 text-right font-mono tabular-nums">{p.smm_usd_ton ? `$${p.smm_usd_ton.toLocaleString('en-US')}` : '—'}</TableCell>
            <TableCell className="text-xs py-1 text-right font-mono tabular-nums">{p.fob_usd_kg !== null ? `$${p.fob_usd_kg.toFixed(2)}` : '—'}</TableCell>
            <TableCell className="text-xs py-1 text-right font-mono tabular-nums">{p.prima_smm_usd_ton !== null ? `$${p.prima_smm_usd_ton.toLocaleString('en-US')}` : '—'}</TableCell>
            <TableCell className="text-xs py-1 text-right font-mono tabular-nums whitespace-nowrap">
              {p.trm > 0 ? `$${p.trm.toLocaleString('es-CO', { maximumFractionDigits: 0 })}` : '—'}
              {p.trmEstimada && <span className="ml-1 text-muted-foreground" title="Lo ya girado va a la TRM real de cada abono; el saldo sin girar, a la TRM de hoy.">hoy</span>}
            </TableCell>
            <TableCell className="text-xs py-1 text-right font-mono tabular-nums font-medium whitespace-nowrap">
              {fmtCop(p.landed_unit_cop)}
              {p.costosEstimados && <span className="ml-1 text-muted-foreground font-normal" title="El pedido no tiene costos de nacionalización cargados: se estimaron con la estructura del último contenedor entregado.">est.</span>}
            </TableCell>
            <TableCell className="text-xs py-1 text-right"><DeltaBadge pct={p.delta_unit_pct} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RefRow({ r, serie }: { r: RefCostoProyectado; serie: RefCostSeries | undefined }) {
  const [open, setOpen] = useState(false);
  const points = serie?.points ?? [];
  const multi = points.length > 0;
  const nProy = serie?.proyectados.length ?? 0;
  const fila = r.riesgoProyectado === 'perdida' ? 'bg-destructive/[0.06]' : r.riesgoProyectado === 'riesgo' ? 'bg-amber-500/[0.04]' : '';
  return (
    <>
      <TableRow className={cn(multi && 'cursor-pointer hover:bg-muted/40', fila)} onClick={() => multi && setOpen(!open)}>
        <TableCell className="text-xs font-mono tabular-nums">
          <div className="flex items-center gap-1">
            {multi ? (open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : <span className="w-3.5" />}
            {r.reference}
            <span className={cn('font-sans text-muted-foreground ml-1', r.color === 'sin discriminar' && 'italic')}>{r.color}</span>
          </div>
          {r.descripcion && <div className="text-xs font-sans text-muted-foreground ml-4.5 truncate max-w-[220px]">{r.descripcion}</div>}
        </TableCell>
        <TableCell className="text-center text-xs">{serie?.reales.length ?? 0}</TableCell>
        <TableCell className="text-right text-xs font-mono tabular-nums text-muted-foreground" title="Promedio ponderado por cantidad de los desembarcos reales: tu costo histórico de compra">
          {fmtCop(serie?.avg_landed_unit_cop)}
        </TableCell>
        <TableCell className="text-right text-xs font-mono tabular-nums whitespace-nowrap">
          {r.ultimoReal ? (
            <>
              <span className="font-semibold">{fmtCop(r.ultimoReal.landed_unit_cop)}</span>
              <span className="block text-xs text-muted-foreground font-sans">{fmtMes(r.ultimoReal.fecha)} · {r.ultimoReal.pedido}</span>
            </>
          ) : <span className="text-muted-foreground">—</span>}
        </TableCell>
        <TableCell
          className="text-right text-xs font-mono tabular-nums whitespace-nowrap"
          title={r.proximo
            ? `${fmtNum(r.enCamino)} und en ${nProy} lote${nProy > 1 ? 's' : ''}; el primero (${r.proximo.pedido}) llega ≈ ${fmtDia(r.proximo.fecha)}.${r.proximo.trmEstimada ? ' TRM de hoy para el saldo sin girar.' : ''}${r.proximo.costosEstimados ? ' Nacionalización estimada con la estructura del último entregado.' : ''}`
            : 'Nada en camino para esta variante'}
        >
          {r.proximo && r.landedEnCamino != null ? (
            <>
              <span className="font-semibold">{fmtCop(r.landedEnCamino)}</span>
              <span className="block text-xs font-sans text-muted-foreground">
                <EtapaChip estado={r.proximo.estado} />{' '}
                {fmtNum(r.enCamino)} und{nProy > 1 ? ` · ${nProy} lotes` : ''}
                {(r.proximo.trmEstimada || r.proximo.costosEstimados) && (
                  <span className="ml-1 text-amber-700 dark:text-amber-400" title="Estimado: TRM de hoy en el saldo y/o nacionalización con la estructura del último entregado">est.</span>
                )}
              </span>
            </>
          ) : <span className="text-muted-foreground">—</span>}
        </TableCell>
        <TableCell className="text-right" title="Landed de lo que viene vs el último desembarco real de esta variante">
          <DeltaBadge pct={r.deltaCaminoVsUltimoRealPct} />
        </TableCell>
        <TableCell
          className="text-right text-xs font-mono tabular-nums whitespace-nowrap"
          title={r.costoProyectado == null
            ? 'Sin costo con qué valorar: ni inventario ni desembarco real'
            : r.enCamino > 0
              ? `(${fmtNum(r.stockActual)} und en bodega × ${fmtCop(r.costoBase)}${r.costoBaseFuente === 'ultimo_real' ? ' [último real: el inventario no tiene costo]' : r.costoBaseFuente === 'kardex' ? ' [kardex -5]' : ''} + ${fmtNum(r.enCamino)} und × ${fmtCop(r.landedEnCamino)}) ÷ ${fmtNum(r.stockActual + r.enCamino)}`
              : 'Nada en camino: el costo proyectado es el actual del stock'}
        >
          <span className={cn('font-semibold', r.enCamino > 0 && 'text-foreground')}>{r.costoBaseFuente === 'ultimo_real' && r.costoProyectado != null ? '~' : ''}{fmtCop(r.costoProyectado)}</span>
          <span className="block text-xs font-sans text-muted-foreground">
            {fmtNum(r.stockActual)} en bodega{r.enCamino > 0 ? ` + ${fmtNum(r.enCamino)}` : ''}
          </span>
        </TableCell>
        <TableCell className="text-right text-xs font-mono tabular-nums text-muted-foreground">{fmtCop(r.precioSinIva)}</TableCell>
        <TableCell className="text-right text-xs font-mono tabular-nums whitespace-nowrap" title="Margen mayorista sobre el precio de lista sin IVA: con el costo actual del stock → con el costo proyectado">
          {r.margenProyectado == null ? <span className="text-muted-foreground">—</span> : (
            <>
              <span className={margenTono(r.margenActual)}>{pct1(r.margenActual)}</span>
              <span className="text-muted-foreground"> → </span>
              <span className={cn('font-semibold', margenTono(r.margenProyectado))}>{pct1(r.margenProyectado)}</span>
            </>
          )}
        </TableCell>
        <TableCell
          className="text-right text-xs font-mono tabular-nums whitespace-nowrap"
          title={r.ajustePct != null ? `Para volver al ${pct1(MARGEN_OBJETIVO)} con el costo proyectado la lista sin IVA tendría que estar en ${fmtCop(r.precioNecesario)}` : r.margenProyectado != null ? 'Ya está en o sobre el objetivo' : undefined}
        >
          {r.ajustePct != null ? <span className="text-amber-700 dark:text-amber-400 font-medium">+{r.ajustePct.toFixed(1)}%</span> : <span className="text-muted-foreground">—</span>}
        </TableCell>
      </TableRow>
      {open && multi && (
        <TableRow>
          <TableCell colSpan={10} className="bg-muted/20 p-0">
            <div className="px-6 py-2">
              <LotesDetalle points={points} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function ImportPriceAnalysis() {
  const { isLoading, series, refs, kpis, supuestos, costoFuente, ivaIncluido, toggleIva } = usePrecioProyectado();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const seriePorKey = useMemo(() => new Map(series.map((s) => [s.key, s])), [series]);

  // "¿Estoy comprando caro?" — REAL: última compra vs promedio ponderado
  // histórico, agregado ponderando por el valor de la última compra de cada ref.
  const realKpi = useMemo(() => {
    const conHist = series.filter((s) => s.reales.length > 1 && s.delta_vs_avg_pct !== null && s.last);
    let pesoTotal = 0;
    let deltaPonderado = 0;
    for (const s of conHist) {
      const peso = s.last!.landed_unit_cop * s.last!.cantidad;
      pesoTotal += peso;
      deltaPonderado += (s.delta_vs_avg_pct ?? 0) * peso;
    }
    return {
      refsConHistorial: conHist.length,
      avgDelta: pesoTotal > 0 ? Math.round((deltaPonderado / pesoTotal) * 10) / 10 : null,
    };
  }, [series]);

  const filtradas = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q ? refs.filter((r) => r.reference.toLowerCase().includes(q) || r.color.includes(q) || (r.descripcion ?? '').toLowerCase().includes(q)) : refs;
    if (!sortKey) return base;
    const val = (r: RefCostoProyectado): number | null => {
      const s = seriePorKey.get(r.key);
      switch (sortKey) {
        case 'desemb': return s?.reales.length ?? 0;
        case 'prom': return s?.avg_landed_unit_cop ?? null;
        case 'ultimo': return r.ultimoReal?.landed_unit_cop ?? null;
        case 'camino': return r.landedEnCamino;
        case 'delta': return r.deltaCaminoVsUltimoRealPct;
        case 'proy': return r.costoProyectado;
        case 'lista': return r.precioSinIva;
        case 'margen': return r.margenProyectado;
        case 'ajuste': return r.ajustePct;
      }
    };
    return [...base].sort((a, b) => {
      const va = val(a); const vb = val(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }, [refs, search, sortKey, sortDir, seriePorKey]);

  const toggleSort = (k: SortKey) => {
    if (sortKey !== k) { setSortKey(k); setSortDir('desc'); return; }
    if (sortDir === 'desc') { setSortDir('asc'); return; }
    setSortKey(null);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Calculando costos reales y proyectados…
        </CardContent>
      </Card>
    );
  }

  if (refs.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="flex flex-col items-center gap-2">
            <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-muted-foreground text-sm max-w-sm">
              Todavía no hay referencias costeadas. Cargá el packing list o la proforma de una importación
              (editá un pedido → "Costeo referencia a referencia") para ver acá la variación de precios.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const sortProps = { sortKey, sortDir, onSort: toggleSort };
  const enRiesgo = kpis.refsEnRiesgoProy + kpis.refsEnPerdidaProy;
  const sinPrecio = kpis.refsConPrecio === 0;

  // Supuestos declarados: un comparativo que no dice qué asumió no sirve para decidir.
  const supuestosTexto: string[] = [];
  if (supuestos) {
    if (supuestos.abiertosProyectados > 0) {
      supuestosTexto.push(
        `${supuestos.abiertosProyectados} pedido${supuestos.abiertosProyectados > 1 ? 's' : ''} abierto${supuestos.abiertosProyectados > 1 ? 's' : ''} proyectado${supuestos.abiertosProyectados > 1 ? 's' : ''}`
        + (supuestos.trmHoy ? ` con TRM de hoy $${Math.round(supuestos.trmHoy).toLocaleString('es-CO')} para los saldos sin girar` : ''),
      );
    }
    if (supuestos.abiertosCostosEstimados > 0 && supuestos.moldeLabel) {
      supuestosTexto.push(
        `nacionalización estimada con la estructura de ${supuestos.moldeLabel}`
        + (supuestos.moldeCostosPorKg ? ` (${fmtCop(supuestos.moldeCostosPorKg)}/kg)` : '')
        + ` en ${supuestos.abiertosCostosEstimados} pedido${supuestos.abiertosCostosEstimados > 1 ? 's' : ''} sin costos cargados`,
      );
    }
    if (supuestos.abiertosSinTrm > 0) {
      supuestosTexto.push(`${supuestos.abiertosSinTrm} pedido${supuestos.abiertosSinTrm > 1 ? 's' : ''} abierto${supuestos.abiertosSinTrm > 1 ? 's' : ''} sin TRM (ni abonos ni TRM de hoy): no entra${supuestos.abiertosSinTrm > 1 ? 'n' : ''}`);
    }
  }
  supuestosTexto.push(`costo actual del stock: ${costoFuente === 'variante' ? 'maestra por variante' : 'kardex -5 (la maestra de variantes no está sembrada)'}`);

  return (
    <div className="imports-analysis min-w-0 space-y-5">
      {/* Supuestos, visibles y honestos */}
      <Card>
        <CardContent className="py-3 px-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <div className="flex items-center gap-2">
            <LineChart className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Análisis de precios: lo real, lo que viene y a cuánto queda el inventario</span>
          </div>
          <span className="text-muted-foreground inline-flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>Proyectado: {supuestosTexto.join(' · ')}.</span>
          </span>
          <button type="button" onClick={toggleIva}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground border border-border rounded-full px-2.5 py-1 transition-colors"
            title="Cambia si el precio de lista del maestro está cargado con IVA o sin IVA — define el margen. Es la misma decisión que en Impacto en lista.">
            Lista {ivaIncluido ? 'CON' : 'SIN'} IVA · cambiar
          </button>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="border border-border shadow-none rounded-xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Últimas compras vs histórico</p>
            <div className="mt-1"><span className="text-xl font-bold"><DeltaBadge pct={realKpi.avgDelta} /></span></div>
            <p className="text-xs text-muted-foreground mt-0.5">{realKpi.refsConHistorial} refs con 2+ desembarcos reales · vs promedio ponderado</p>
          </CardContent>
        </Card>
        <Card className="border border-border shadow-none rounded-xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Lo que viene vs lo que tengo</p>
            <div className="mt-1"><span className="text-xl font-bold"><DeltaBadge pct={kpis.deltaCaminoVsActualPct} /></span></div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {fmtNum(kpis.unidadesEnCamino)} und en camino · {kpis.refsSuben} suben &gt;{UMBRAL_CAMBIO_PCT}% · {kpis.refsBajan} bajan
            </p>
          </CardContent>
        </Card>
        <Card className="border border-border shadow-none rounded-xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Margen a lista de hoy</p>
            {sinPrecio ? (
              <p className="text-xl font-bold mt-1 text-muted-foreground">—</p>
            ) : (
              <p className="text-xl font-bold mt-1 tabular-nums">
                <span className={margenTono(kpis.margenActualPond)}>{pct1(kpis.margenActualPond)}</span>
                <span className="text-muted-foreground font-normal"> → </span>
                <span className={margenTono(kpis.margenProyectadoPond)}>{pct1(kpis.margenProyectadoPond)}</span>
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">
              {sinPrecio ? 'cargá sale_price en Inventario para ver el margen' : `actual → con lo que viene · objetivo ${pct1(MARGEN_OBJETIVO)} · ponderado por valor`}
            </p>
          </CardContent>
        </Card>
        <Card className="border border-border shadow-none rounded-xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">En riesgo con lo que viene</p>
            <p className={cn('text-xl font-bold mt-1 tabular-nums', sinPrecio ? 'text-muted-foreground' : enRiesgo > 0 ? 'text-destructive' : 'text-success')}>
              {sinPrecio ? '—' : enRiesgo}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {sinPrecio
                ? 'sin precios de lista'
                : enRiesgo > 0
                  ? `${kpis.refsEnPerdidaProy} a pérdida · peor: ${kpis.peorRef?.reference ?? '—'} ${pct1(kpis.peorRef?.margenProyectado)}`
                  : `ninguna baja de ${pct1(MARGEN_RIESGO)} con el costo proyectado`}
              {kpis.ajusteNecesarioPct != null && ` · lista +${kpis.ajusteNecesarioPct.toFixed(1)}% para el objetivo`}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              Costo por variante
              <span className="text-xs font-normal text-muted-foreground">landed en COP · {refs.length} referencias · {kpis.refsConCamino} con algo en camino</span>
            </CardTitle>
            <div className="relative max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Buscar referencia…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/80">
                  <TableHead className="font-semibold text-xs">Referencia</TableHead>
                  <SortHead k="desemb" label="Desemb." title="Desembarcos REALES (contenedores entregados) de esta variante." align="center" {...sortProps} />
                  <SortHead k="prom" label="Prom. real" title="Promedio ponderado por cantidad de los desembarcos reales: tu costo histórico de compra." {...sortProps} />
                  <SortHead k="ultimo" label="Último real" title="Landed del último contenedor entregado." {...sortProps} />
                  <SortHead k="camino" label="En camino" title="Landed PROYECTADO de lo que viene (aduana / tránsito / fábrica), ponderado por unidades. TRM mixta: lo girado a su TRM, el saldo a la de hoy." {...sortProps} />
                  <SortHead k="delta" label="Δ vs último" title="Lo que viene vs el último desembarco real: rojo = lo que viene es más caro." {...sortProps} />
                  <SortHead k="proy" label="Costo prom. proy." title="A cuánto queda el inventario cuando todo esté en bodega: (stock × costo actual + en camino × landed proyectado) ÷ total. Es el número que manda para la lista." {...sortProps} />
                  <SortHead k="lista" label="Lista s/IVA" title="Precio de lista del maestro (familia -5), sin IVA." {...sortProps} />
                  <SortHead k="margen" label="Margen hoy → proy." title="Margen mayorista sobre el precio: con el costo actual → con el costo proyectado." {...sortProps} />
                  <SortHead k="ajuste" label="Ajuste" title={`% que habría que subir la lista para volver al ${pct1(MARGEN_OBJETIVO)} con el costo proyectado.`} {...sortProps} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtradas.map((r) => <RefRow key={r.key} r={r} serie={seriePorKey.get(r.key)} />)}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Cada fila es una VARIANTE de color (el FOB cambia por color); el precio de lista vive en la familia -5.
        <strong className="text-foreground"> Real</strong> = contenedores entregados a la TRM ponderada de sus abonos.
        <strong className="text-foreground"> En camino</strong> = pedidos abiertos a costo proyectado, siempre marcados: TRM de
        hoy para el saldo sin girar y nacionalización estimada si el pedido no tiene costos cargados (la fecha es la misma
        llegada a bodega que usa Cobertura). <strong className="text-foreground">Costo prom. proy.</strong> es a cuánto queda
        el inventario cuando todo esté en bodega — ese es el costo contra el que hay que mirar la lista, no el del último
        contenedor. El margen es mayorista (sobre el precio): objetivo {pct1(MARGEN_OBJETIVO)}, riesgo bajo {pct1(MARGEN_RIESGO)}.
        Abrí una fila para ver lote a lote (SMM, FOB, prima, TRM, landed). Nada de acá escribe en el pedido.
      </p>
    </div>
  );
}
