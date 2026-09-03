/**
 * Módulo de UN contenedor dentro de la pestaña Escenarios.
 *
 * Se renderiza uno por cada pedido en curso (Nico 2026-08-31: "si se tiene
 * otro pedido que haya el mismo módulo para comparar"), cada uno comparado
 * contra el contenedor inmediatamente anterior en la cadena — no siempre
 * contra el último entregado.
 *
 * Contiene: héroe con el total sin IVA + delta · renglones que suman · IVA
 * en caja aparte · drivers de la diferencia con barras · el dólar del saldo
 * con abonos reales Y manuales · escalera del saldo.
 */

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, Plus, Trash2, Link2Off, Pencil, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { computeImportBreakdown, type ImportBreakdown } from '@/lib/importCosting';
import { computeLandedCost } from '@/lib/landedCost';
import { scalePacking, totalesDe } from '@/lib/scalePacking';
import { escenarioVigente, type EscenarioVigente } from '@/lib/importScenario';
import { driversDelta, type DriversResult } from '@/lib/importDrivers';
import type { PedidoComparable } from '@/lib/importComparison';
import { useManualAbonos, type ManualAbono } from '@/hooks/useManualAbonos';
import { useImportItems } from '@/hooks/useImportItems';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { errMsg } from '@/lib/importLink';
import { viernesAduana } from '@/lib/importScenario';
import { fetchTrmForDate } from '@/hooks/useImportPayments';
import { DEFAULT_BASIS_BY_TIPO } from '@/lib/landedCost';

// ── formato (fuentes legibles: nada por debajo de 12px en datos) ──
const fmt0 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
export const cop = (n: number | null | undefined) => (n == null ? '—' : `$${fmt0.format(Math.round(n))}`);
export const copM = (n: number | null | undefined) =>
  n == null ? '—' : `${n < 0 ? '−' : '+'}$${(Math.abs(n) / 1e6).toFixed(1).replace('.', ',')}M`;
export const usdF = (n: number | null | undefined) => (n == null ? '—' : `${fmt0.format(Math.round(n))} USD`);
export const numF = (n: number | null | undefined) => (n == null ? '—' : fmt0.format(Math.round(n)));
export const pctS = (n: number | null | undefined) =>
  n == null ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1).replace('.', ',')}%`;

export const fleteUsdDe = (costs: PedidoComparable['costs']): number | null => {
  const v = (costs ?? []).filter((c) => c.tipo === 'flete' && (c.moneda ?? 'USD') === 'USD')
    .reduce((s, c) => s + (Number(c.monto) || 0), 0);
  return v > 0 ? v : null;
};
export const seguroUsdDe = (costs: PedidoComparable['costs']): number =>
  (costs ?? []).filter((c) => c.tipo === 'seguro' && (c.moneda ?? 'USD') === 'USD')
    .reduce((s, c) => s + (Number(c.monto) || 0), 0);

/** El total del calculador de Nico EXCLUYE el IVA (es caja, no costo). */
export const sinIva = (bd: ImportBreakdown | null): number | null =>
  bd?.totalImportacionCop == null ? null : bd.totalImportacionCop - (bd.ivaCop ?? 0);

export interface PayRow { import_id: string; amount_usd: number | null; trm: number | null; fecha?: string | null }

function Row({ l, v, tone, big, sub }: { l: React.ReactNode; v: React.ReactNode; tone?: string; big?: boolean; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/50 py-2 last:border-0">
      <span className="text-[13px] text-muted-foreground">{l}{sub && <span className="block text-[11px] text-muted-foreground/70">{sub}</span>}</span>
      <span className={cn('font-semibold tabular-nums text-right shrink-0', big ? 'text-lg' : 'text-[14px]', tone)}>{v}</span>
    </div>
  );
}

interface Props {
  pedido: PedidoComparable;
  /** El contenedor contra el que se compara (el anterior en la cadena). */
  anterior: PedidoComparable | null;
  payRows: PayRow[];
  trmVal: number;
  trmHoy: number | null;
  /** true = es el próximo a llegar (se muestra expandido y destacado). */
  esProximo: boolean;
  /** TRM de liquidación aduanera (la vigente del viernes). */
  /** TRM de aduana FORZADA por la perilla (null = automática: la del último
   *  viernes previo a la semana del arribo de ESTE contenedor). */
  trmAduana: number | null;
}

export default function ModuloContenedor({ pedido, anterior, payRows, trmVal, trmHoy, esProximo, trmAduana }: Props) {
  const [abierto, setAbierto] = useState(esProximo);
  const [nuevoAbono, setNuevoAbono] = useState(false);
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Correcciones REALES del contenedor — viven en el pedido, no en el
  // tablero (Nico 2026-09-03: editar mercancía/peso/unidades acá tiene que
  // actualizar el pedido en Pedidos y por ende el saldo, que es columna
  // generada de monto_total_usd).
  const pesoReal = pedido.peso_real_kg != null ? Number(pedido.peso_real_kg) : null;
  const unidadesReales = pedido.unidades_reales != null ? Number(pedido.unidades_reales) : null;

  const guardarPedido = async (patch: { monto_total_usd?: number; peso_real_kg?: number | null; unidades_reales?: number | null }) => {
    setGuardando(true);
    try {
      const { error } = await (supabase.from('imports' as never) as any)
        .update(patch)
        .eq('id', pedido.id);
      if (error) throw error;
      // La lista de Pedidos, este tablero y la liquidación beben de ['imports'].
      queryClient.invalidateQueries({ queryKey: ['imports'] });
      queryClient.invalidateQueries({ queryKey: ['import_liquidation'] });
      toast({
        title: 'Pedido actualizado',
        description: 'El cambio quedó en el pedido real — saldo y prorrateos recalculados.',
      });
    } catch (err) {
      toast({ title: 'No se pudo actualizar el pedido', description: errMsg(err), variant: 'destructive' });
    } finally {
      setGuardando(false);
    }
  };
  const [fa, setFa] = useState(() => new Date().toISOString().slice(0, 10));
  const [da, setDa] = useState('');
  const [ca, setCa] = useState('');
  const [ta, setTa] = useState('');

  const { abonos: manualesTodos, add, remove } = useManualAbonos();
  const manuales = useMemo(
    () => manualesTodos.filter((m) => m.import_id === pedido.id).sort((a, b) => a.fecha.localeCompare(b.fecha)),
    [manualesTodos, pedido.id],
  );

  const reales = useMemo(
    () => payRows.filter((p) => p.import_id === pedido.id && Number(p.amount_usd) > 0 && Number(p.trm) > 0)
      .map((p) => ({ amount_usd: Number(p.amount_usd), trm: Number(p.trm), fecha: p.fecha ?? null }))
      .sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? '')),
    [payRows, pedido.id],
  );
  // Los manuales entran al saldo como abonos más (COP ÷ TRM = USD).
  const manualesComoAbono = useMemo(
    () => manuales.map((m) => ({ amount_usd: m.cop / m.trm, trm: m.trm, fecha: m.fecha })),
    [manuales],
  );
  const totalManualUsd = manualesComoAbono.reduce((s, a) => s + a.amount_usd, 0);

  // MERCANCIA: corregirla acá escribe imports.monto_total_usd — la factura
  // real ES el pedido (la china despacha de más y la definitiva llega después
  // de montarlo). Ya no hay capa "solo tablero": una sola fuente de verdad.
  const mercanciaBase = Number(pedido.monto_total_usd) || 0;
  const mercanciaUsdEff = mercanciaBase;

  // PACKING ESCALADO a lo realmente despachado.
  //
  // No alcanza con corregir el total: el flete se prorratea por peso, el
  // arancel por valor y otros por cantidad. Si la fábrica manda más unidades,
  // el flete UNITARIO baja. Por eso se escala el packing (lib/scalePacking) y
  // se deja que computeLandedCost vuelva a prorratear sobre la base nueva.
  const { effectiveItems, costs: costsPedido, addCost, updateCost } = useImportItems(pedido.id, trmVal);
  const [editOtros, setEditOtros] = useState(false);
  const [otrosInput, setOtrosInput] = useState('');
  // Fila "estimado" de aduanas/transporte que este tablero administra (se
  // guarda como costo REAL del pedido, tipo nacionalización, en COP).
  const otrosEstimadoRow = useMemo(
    () => (costsPedido ?? []).find((c) => c.tipo === 'nacionalizacion' && (c.concepto ?? '').includes('estimado')) ?? null,
    [costsPedido],
  );
  const guardarOtros = async () => {
    const n = Number(otrosInput.replace(/[.,\s]/g, ''));
    if (!Number.isFinite(n) || n < 0) return;
    try {
      if (otrosEstimadoRow) {
        await updateCost.mutateAsync({ id: otrosEstimadoRow.id, monto: n, moneda: 'COP' });
      } else if (n > 0) {
        await addCost.mutateAsync({
          tipo: 'nacionalizacion',
          concepto: 'Aduana + transporte (estimado desde Escenarios)',
          monto: n,
          moneda: 'COP',
          trm: null,
          base_asignacion: DEFAULT_BASIS_BY_TIPO.nacionalizacion,
          orden: (costsPedido ?? []).length,
        });
      }
      setEditOtros(false);
      toast({ title: 'Costo guardado en el pedido', description: 'Entra al costo total y al prorrateo por referencia.' });
    } catch (err) {
      toast({ title: 'No se pudo guardar', description: errMsg(err), variant: 'destructive' });
    }
  };
  const packingBase = useMemo(() => totalesDe(effectiveItems ?? []), [effectiveItems]);
  const hayPackingReal = packingBase.pesoKg > 0 || packingBase.unidades > 0;

  // La mercancía escala el packing solo cuando difiere de verdad de lo que
  // suma el packing (>0.5% — ruido decimal no es "escalado").
  const mercanciaOverride = useMemo(() => {
    if (!(packingBase.mercanciaUsd > 0) || mercanciaBase <= 0) return null;
    return Math.abs(mercanciaBase - packingBase.mercanciaUsd) / packingBase.mercanciaUsd > 0.005
      ? mercanciaBase : null;
  }, [packingBase.mercanciaUsd, mercanciaBase]);

  const escala = useMemo(
    () => scalePacking(effectiveItems ?? [], {
      mercanciaUsd: mercanciaOverride,
      pesoKg: pesoReal,
      unidades: unidadesReales,
    }),
    [effectiveItems, mercanciaOverride, pesoReal, unidadesReales],
  );

  /** Landed recalculado con el packing escalado — acá vive el reprorrateo. */
  const landedEscalado = useMemo(
    () => (escala.items.length > 0 ? computeLandedCost(escala.items, costsPedido ?? [], trmVal) : null),
    [escala.items, costsPedido, trmVal],
  );

  const kgPedido = pedido.cantidad_ton != null ? Number(pedido.cantidad_ton) * 1000 : null;
  const kgPacking = hayPackingReal && packingBase.pesoKg > 0 ? packingBase.pesoKg : null;
  // Orden de mando: ajuste manual > packing real > lo digitado en el pedido.
  const kg = pesoReal ?? kgPacking ?? kgPedido;
  const unidades = escala.efectivo.unidades > 0 ? escala.efectivo.unidades : null;
  const fuentePeso = pesoReal != null ? 'peso REAL corregido (guardado en el pedido)'
    : kgPacking != null ? 'peso REAL del packing' : 'peso digitado (falta packing)';
  const difPesoPct = kg != null && kgPedido != null && kgPedido > 0
    ? (kg / kgPedido - 1) * 100 : null;

  /** Flete unitario antes y después del escalado — el efecto que pidió ver Nico. */
  const fleteUnit = useMemo(() => {
    if (!landedEscalado || !escala.escalado || packingBase.unidades <= 0) return null;
    const fleteTotal = (costsPedido ?? []).filter((c) => c.tipo === 'flete')
      .reduce((s, c) => s + (c.moneda === 'USD' ? Number(c.monto) * trmVal : Number(c.monto)), 0);
    if (fleteTotal <= 0) return null;
    return { antes: fleteTotal / packingBase.unidades, despues: fleteTotal / escala.efectivo.unidades };
  }, [landedEscalado, escala, costsPedido, packingBase.unidades, trmVal]);
  const kgParaImpuestos = kg;

  // TRM DE ADUANA por contenedor: la DIAN liquida a la TRM vigente = la del
  // último viernes previo a la semana del ARRIBO de la mercancía (Nico
  // 2026-09-03). La perilla global solo manda si el usuario la tocó.
  const fechaArriboRef = pedido.fechas.fecha_arribo_real
    ?? pedido.fechas.fecha_estimada_llegada
    ?? new Date().toISOString().slice(0, 10);
  const viernesLiq = viernesAduana(fechaArriboRef);
  const { data: trmViernes } = useQuery({
    queryKey: ['trm-fecha', viernesLiq],
    enabled: !!viernesLiq,
    staleTime: 30 * 60_000,
    queryFn: () => fetchTrmForDate(viernesLiq!),
  });
  const trmAduanaEff = trmAduana ?? trmViernes ?? trmVal;
  const aduanaAuto = trmAduana == null && trmViernes != null;
  const viernesLabel = viernesLiq ? `${viernesLiq.slice(8, 10)}/${viernesLiq.slice(5, 7)}` : '';

  const esc: EscenarioVigente | null = useMemo(() => {
    if (mercanciaUsdEff <= 0) return null;
    return escenarioVigente({
      mercanciaUsd: mercanciaUsdEff,
      costs: pedido.costs,
      // Reales + manuales: los "sin conectar" son plata REAL (pagos de otro
      // negocio directo a China que jamás pasarán por contabilidad) y SÍ
      // restan del saldo del tablero (corrección Nico 2026-09-03). El ancla
      // a Pedidos queda en saldoUsdReal: saldo tablero = Pedidos − manuales,
      // y el puente se muestra explícito en la sección de abonos.
      abonos: [...reales, ...manualesComoAbono],
      saldoUsdReal: pedido.saldo_pendiente_usd != null
        ? Math.max(0, Number(pedido.saldo_pendiente_usd) - totalManualUsd)
        : null,
      trmSimulada: trmVal,
      arancelPct: Number(pedido.arancel_pct ?? 5),
      ivaPct: Number(pedido.iva_pct ?? 19),
      cantidadKg: kgParaImpuestos,
      trmAduana: trmAduanaEff,
    });
  }, [pedido, mercanciaUsdEff, reales, manualesComoAbono, totalManualUsd, trmVal, kgParaImpuestos, trmAduanaEff]);

  const totalSinIva = esc ? sinIva(esc.breakdown) : null;
  const copKg = totalSinIva != null && kg ? totalSinIva / kg : null;
  const trmEfectiva = esc && esc.totalUsd > 0 ? (esc.pagadoCop + esc.saldoUsd * trmVal) / esc.totalUsd : null;
  const mercanciaCop = esc ? esc.pagadoCop + esc.saldoUsd * trmVal : null;
  const fleteSeguroCop = esc?.breakdown.cifCop != null && mercanciaCop != null ? esc.breakdown.cifCop - mercanciaCop : null;

  // ── El anterior, con sus datos reales ──
  const bdAnterior = useMemo(() => {
    if (!anterior || anterior.monto_total_usd == null) return null;
    return computeImportBreakdown({
      mercanciaUsd: Number(anterior.monto_total_usd),
      costs: anterior.costs,
      trm: anterior.trm != null ? Number(anterior.trm) : null,
      arancelPct: Number(anterior.arancel_pct ?? 5),
      ivaPct: Number(anterior.iva_pct ?? 19),
      cantidadKg: anterior.cantidad_ton != null ? Number(anterior.cantidad_ton) * 1000 : null,
    });
  }, [anterior]);
  const totalAnteriorSinIva = sinIva(bdAnterior);
  const copKgAnterior = totalAnteriorSinIva != null && anterior?.cantidad_ton
    ? totalAnteriorSinIva / (Number(anterior.cantidad_ton) * 1000) : null;
  const deltaPctTotal = totalSinIva != null && totalAnteriorSinIva
    ? (totalSinIva / totalAnteriorSinIva - 1) * 100 : null;

  const drivers: DriversResult | null = useMemo(() => {
    if (totalSinIva == null || totalAnteriorSinIva == null || !anterior || !esc) return null;
    return driversDelta(
      {
        totalCop: totalAnteriorSinIva,
        smmUsdTon: anterior.precio_smm_cerrado_usd_ton != null ? Number(anterior.precio_smm_cerrado_usd_ton) : null,
        tons: anterior.cantidad_ton != null ? Number(anterior.cantidad_ton) : null,
        trm: anterior.trm != null ? Number(anterior.trm) : null,
        fleteUsd: fleteUsdDe(anterior.costs),
        usdTotal: anterior.monto_total_usd != null
          ? Number(anterior.monto_total_usd) + (fleteUsdDe(anterior.costs) ?? 0) + seguroUsdDe(anterior.costs) : null,
      },
      {
        totalCop: totalSinIva,
        smmUsdTon: pedido.precio_smm_cerrado_usd_ton != null ? Number(pedido.precio_smm_cerrado_usd_ton) : null,
        tons: kg != null ? kg / 1000 : null,
        trm: trmEfectiva,
        fleteUsd: fleteUsdDe(pedido.costs),
        usdTotal: esc.totalUsd + (fleteUsdDe(pedido.costs) ?? 0) + seguroUsdDe(pedido.costs),
      },
    );
  }, [totalSinIva, totalAnteriorSinIva, anterior, pedido, esc, trmEfectiva, kg]);

  const escalera = useMemo(() => {
    if (!esc || esc.saldoUsd <= 0) return [];
    const hoyR = trmHoy != null ? Math.round(trmHoy) : null;
    const set = new Set<number>([2950, 3000, 3100, 3200, 3300, 3400, 3500]);
    if (hoyR) set.add(hoyR);
    set.add(trmVal);
    const base = hoyR != null ? esc.saldoUsd * hoyR : null;
    return Array.from(set).sort((a, b) => a - b).map((t) => ({
      trm: t, cop: esc.saldoUsd * t,
      vsHoy: base != null ? esc.saldoUsd * t - base : null,
      esHoy: t === hoyR, esEscenario: t === trmVal && t !== hoyR,
    }));
  }, [esc, trmHoy, trmVal]);

  const guardarAbono = () => {
    const c = Number(ca.replace(/[.,\s]/g, ''));
    const t = Number(ta.replace(/[.,\s]/g, ''));
    if (!Number.isFinite(c) || c <= 0 || !Number.isFinite(t) || t <= 0) return;
    add.mutate({ import_id: pedido.id, fecha: fa, descripcion: da.trim(), cop: c, trm: t },
      { onSuccess: () => { setNuevoAbono(false); setDa(''); setCa(''); setTa(''); } });
  };

  if (!esc) return null;
  const avance = esc.totalUsd > 0 ? Math.min(esc.pagadoUsd / esc.totalUsd, 1) * 100 : null;

  return (
    <Card className={cn('overflow-hidden', esProximo && 'border-primary/40 shadow-sm')}>
      {/* ── Cabecera del módulo ── */}
      <button type="button" onClick={() => setAbierto((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3 text-left hover:bg-muted/30 transition-colors">
        <div className="flex items-center gap-2.5 min-w-0">
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground shrink-0 transition-transform', abierto && 'rotate-180')} />
          <span className="text-base font-bold tracking-tight">Contenedor {pedido.label}</span>
          {esProximo && <Badge className="text-[11px]">próximo a llegar</Badge>}
          <Badge variant="secondary" className="text-[11px]">{pedido.estado}</Badge>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <span className="text-lg font-bold tabular-nums">{cop(totalSinIva)}</span>
          {deltaPctTotal != null && (
            <span className={cn('text-sm font-semibold tabular-nums', deltaPctTotal <= 0 ? 'text-success' : 'text-destructive')}>
              {pctS(deltaPctTotal)}
            </span>
          )}
        </div>
      </button>

      {abierto && (
        <CardContent className="px-5 pb-5 pt-0 space-y-4">
          <div className="grid lg:grid-cols-2 gap-5 items-start">
            {/* ── Costo ── */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Costo del contenedor</p>
              <div>
                <p className="text-[38px] leading-none font-extrabold tabular-nums tracking-tight">{cop(totalSinIva)}</p>
                {deltaPctTotal != null && anterior && (
                  <p className={cn('text-sm font-semibold mt-1.5', deltaPctTotal <= 0 ? 'text-success' : 'text-destructive')}>
                    {pctS(deltaPctTotal)} vs. {anterior.label} ({cop(totalAnteriorSinIva)})
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed flex items-center gap-1.5 flex-wrap">
                  <span>
                    {kg != null ? `${numF(kg)} kg · ` : ''}mercancía {usdF(esc.totalUsd)} · flete {usdF(fleteUsdDe(pedido.costs))} ·
                    TRM efectiva {numF(trmEfectiva)} · sin IVA
                  </span>
                  <button type="button" onClick={() => setEditando((v) => !v)}
                    className="inline-flex items-center gap-1 text-primary hover:underline shrink-0"
                    title="Corregir la mercancía facturada, el peso y las unidades — se guarda en el PEDIDO (Pedidos y saldo incluidos)">
                    <Pencil className="h-3 w-3" /> corregir
                  </button>
                </p>

                {(pesoReal != null || unidadesReales != null) && (
                  <p className="text-[11px] text-primary mt-1 flex items-center gap-1.5 flex-wrap">
                    <b>Corregido en el pedido</b> — prorratea con lo real.
                    {pesoReal != null && ` Peso ${numF(kgPacking ?? kgPedido)} → ${numF(pesoReal)} kg.`}
                    {escala.escalado && escala.factores.cantidad !== 1 && ` Unidades ${numF(packingBase.unidades)} → ${numF(escala.efectivo.unidades)}.`}
                    <button type="button" disabled={guardando}
                      onClick={() => guardarPedido({ peso_real_kg: null, unidades_reales: null })}
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      <RotateCcw className="h-3 w-3" /> volver al packing/digitado
                    </button>
                  </p>
                )}

                {editando && (
                  <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                    <div className="flex items-end gap-3 flex-wrap">
                      <div>
                        <label className="text-[11px] text-muted-foreground block mb-1">Mercancía facturada (USD)</label>
                        <Input inputMode="numeric" defaultValue={numF(mercanciaUsdEff)} disabled={guardando}
                          onBlur={(e) => {
                            const n = Number(e.target.value.replace(/[.,\s]/g, ''));
                            if (Number.isFinite(n) && n > 0 && n !== mercanciaBase) guardarPedido({ monto_total_usd: n });
                          }}
                          className="h-8 w-36 text-[13px] font-mono tabular-nums" />
                        <p className="text-[10px] text-muted-foreground mt-0.5">se guarda en el pedido — el saldo se recalcula solo</p>
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground block mb-1">Peso real (kg)</label>
                        <Input inputMode="numeric" defaultValue={numF(kg)} disabled={guardando}
                          onBlur={(e) => {
                            const n = Number(e.target.value.replace(/[.,\s]/g, ''));
                            const ref = kgPacking ?? kgPedido;
                            if (!Number.isFinite(n) || n <= 0) return;
                            guardarPedido({ peso_real_kg: n !== ref ? n : null });
                          }}
                          className="h-8 w-32 text-[13px] font-mono tabular-nums" />
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {kgPacking != null ? `packing: ${numF(kgPacking)}` : `pedido: ${numF(kgPedido)}`}
                        </p>
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground block mb-1">Unidades despachadas</label>
                        <Input inputMode="numeric" defaultValue={numF(unidades)} disabled={guardando || !hayPackingReal}
                          onBlur={(e) => {
                            const n = Number(e.target.value.replace(/[.,\s]/g, ''));
                            const ref = packingBase.unidades;
                            if (!Number.isFinite(n) || n <= 0) return;
                            guardarPedido({ unidades_reales: n !== ref ? n : null });
                          }}
                          className="h-8 w-32 text-[13px] font-mono tabular-nums" />
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {hayPackingReal
                            ? (unidadesReales == null && pesoReal != null
                              ? 'derivadas del peso' : `packing: ${numF(packingBase.unidades)}`)
                            : 'necesita packing cargado'}
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditando(false)}>Listo</Button>
                    </div>

                    {fleteUnit && (
                      <div className="rounded-md bg-background border border-border px-3 py-2">
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          <b className="text-foreground">Se reprorrateó todo:</b> el flete se reparte entre{' '}
                          {numF(escala.efectivo.unidades)} unidades en vez de {numF(packingBase.unidades)}, así que
                          baja de <span className="font-mono">{cop(fleteUnit.antes)}</span> a{' '}
                          <span className="font-mono text-success">{cop(fleteUnit.despues)}</span> por unidad.
                          El arancel se recalcula sobre el valor nuevo y el costo por kilo sobre el peso nuevo.
                        </p>
                      </div>
                    )}

                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Poné lo que la fábrica despachó de verdad y la app <b>vuelve a prorratear</b> flete, arancel
                      y aduanas sobre esa base — no es solo cambiar el total. <b>Se guarda en el PEDIDO</b>:
                      la pestaña Pedidos y el saldo pendiente quedan actualizados de una.
                    </p>
                  </div>
                )}

                {difPesoPct != null && Math.abs(difPesoPct) >= 0.5 && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1.5 leading-relaxed">
                    El pedido dice {numF(kgPedido)} kg y estás costeando con {numF(kg)} ({pctS(difPesoPct)}):
                    el COP/kg se mueve por <b>peso</b>, no por precio.
                  </p>
                )}
              </div>
              <div>
                <Row l={`Mercancía · ${usdF(esc.totalUsd)}`}
                  sub={mercanciaOverride != null ? 'corregida — guardada en el pedido' : undefined}
                  v={cop(mercanciaCop)} />
                <Row l="Flete + seguro" v={cop(fleteSeguroCop)} />
                <Row l={esc.breakdown.usaArancelReal ? 'Arancel (liquidación real)' : `Arancel ${Number(pedido.arancel_pct ?? 5)}%`}
                  sub={[
                    esc.breakdown.usaArancelReal ? null : `a TRM de aduana ${numF(trmAduanaEff)}${aduanaAuto ? ` (viernes ${viernesLabel})` : ''}`,
                    esc.breakdown.pisoAplicado ? `piso FOB ${esc.breakdown.pisoFobUsdKg} USD/kg` : null,
                  ].filter(Boolean).join(' · ') || undefined}
                  v={cop(esc.breakdown.arancelCop)} tone={esc.breakdown.usaArancelReal ? 'text-success' : undefined} />
                <Row
                  l={
                    <span className="inline-flex items-center gap-1.5">
                      Aduanas + transporte + otros
                      <button
                        type="button"
                        onClick={() => { setOtrosInput(String(Math.round(esc.breakdown.otrosCop || 0))); setEditOtros((v) => !v); }}
                        className="text-primary hover:underline"
                        title="Estimar o corregir — se guarda como costo del PEDIDO (tipo nacionalización, COP) y entra al prorrateo"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </span>
                  }
                  v={cop(esc.breakdown.otrosCop)}
                  sub={otrosEstimadoRow ? 'estimado guardado en el pedido' : undefined}
                />
                {editOtros && (
                  <div className="flex items-end gap-2 py-2 border-b border-border/50">
                    <div>
                      <label className="text-[11px] text-muted-foreground block mb-1">Aduanas + transporte (COP)</label>
                      <Input inputMode="numeric" value={otrosInput} onChange={(e) => setOtrosInput(e.target.value)}
                        placeholder="8.000.000" className="h-8 w-36 text-[13px] font-mono tabular-nums" />
                    </div>
                    <Button size="sm" className="h-8 text-xs" onClick={guardarOtros}
                      disabled={addCost.isPending || updateCost.isPending}>
                      Guardar en el pedido
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditOtros(false)}>Cancelar</Button>
                  </div>
                )}
                <Row l={<b className="text-foreground">COSTO TOTAL IMPORTADO · sin IVA</b>} v={<b>{cop(totalSinIva)}</b>} big />
                {copKg != null && (
                  <Row l="Costo por kilo"
                    sub={[
                      copKgAnterior != null && anterior ? `${anterior.label}: ${numF(copKgAnterior)}` : null,
                      `sobre el ${fuentePeso}`,
                    ].filter(Boolean).join(' · ')}
                    v={<span className={cn(copKgAnterior != null && copKg <= copKgAnterior ? 'text-success' : copKgAnterior != null ? 'text-destructive' : '')}>
                      {numF(copKg)} COP/kg{copKgAnterior != null ? ` (${pctS((copKg / copKgAnterior - 1) * 100)})` : ''}
                    </span>} big />
                )}
              </div>
              <div className="rounded-lg border border-amber-400/50 bg-amber-50/70 dark:bg-amber-950/20 px-3.5 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-semibold text-amber-800 dark:text-amber-300">
                    IVA importación {esc.breakdown.usaIvaReal ? '(real)' : 'estimado'} — caja, NO costo
                  </span>
                  <span className="text-lg font-bold tabular-nums text-amber-800 dark:text-amber-300">{cop(esc.breakdown.ivaCop)}</span>
                </div>
                <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 mt-1.5 leading-relaxed">
                  {Number(pedido.iva_pct ?? 19)}% sobre (base + arancel), liquidado a la <b>TRM de aduana {numF(trmAduanaEff)}{aduanaAuto ? ` (viernes ${viernesLabel})` : ''}</b> —
                  la DIAN usa la TRM vigente, no el promedio al que compraste los dólares.
                  Se recupera como descontable, pero hay que tener la caja el día de nacionalizar.
                </p>
              </div>
            </div>

            {/* ── Diferencia vs anterior ── */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {anterior ? `vs. ${anterior.label} — de dónde sale la diferencia` : 'Sin contenedor anterior para comparar'}
              </p>
              {!drivers || !anterior ? (
                <p className="text-[13px] text-muted-foreground py-6">
                  Este es el primer contenedor de la cadena — no hay uno previo contra el cual medir.
                </p>
              ) : (
                <>
                  <div>
                    <Row l={`${anterior.label} (real, cerrado) · sin IVA`} v={cop(totalAnteriorSinIva)} />
                    <Row l={`${pedido.label} (proyectado) · sin IVA`} v={cop(totalSinIva)} />
                  </div>
                  <div className={cn('rounded-lg px-3.5 py-2.5 flex items-baseline justify-between',
                    drivers.deltaTotalCop <= 0 ? 'bg-success/10 border border-success/30' : 'bg-destructive/10 border border-destructive/30')}>
                    <span className={cn('text-[13px] font-bold', drivers.deltaTotalCop <= 0 ? 'text-success' : 'text-destructive')}>
                      {drivers.deltaTotalCop <= 0 ? 'Cuesta menos' : 'Cuesta más'}
                    </span>
                    <span className={cn('text-lg font-bold tabular-nums', drivers.deltaTotalCop <= 0 ? 'text-success' : 'text-destructive')}>
                      {copM(drivers.deltaTotalCop)} ({pctS(drivers.deltaPctTotal)})
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Drivers</p>
                    {(() => {
                      const maxAbs = Math.max(...drivers.drivers.map((d) => Math.abs(d.cop)), 1);
                      return drivers.drivers.map((d) => (
                        <div key={d.key} className="space-y-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[13px]">{d.label} <span className="text-[11px] text-muted-foreground">{d.detalle}</span></span>
                            <span className={cn('text-[13px] font-bold tabular-nums shrink-0', d.cop <= 0 ? 'text-success' : 'text-destructive')}>{copM(d.cop)}</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div className={cn('h-full rounded-full', d.cop <= 0 ? 'bg-success' : 'bg-destructive')}
                              style={{ width: `${Math.max(3, (Math.abs(d.cop) / maxAbs) * 100)}%` }} />
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── El dólar del saldo ── */}
          <div className="rounded-xl border border-border p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Lo único vivo: el dólar del saldo
            </p>
            <div className="grid lg:grid-cols-2 gap-x-8 gap-y-2">
              <div>
                <Row l="USD que falta comprar" v={usdF(esc.saldoUsd)} big tone={esc.saldoUsd > 0 ? 'text-destructive' : 'text-success'}
                  sub={totalManualUsd > 0 && pedido.saldo_pendiente_usd != null
                    ? `Pedidos dice ${numF(Number(pedido.saldo_pendiente_usd))} − ${numF(totalManualUsd)} pagados por fuera`
                    : undefined} />
                <Row l={`Ese saldo a la TRM del escenario (${numF(trmVal)})`} v={cop(esc.saldoCopSimulado)} />
                <Row l="Exposición viva · cada 100 pesos de TRM" v={`± ${copM(esc.saldoUsd * 100).replace('+', '')}`} />
              </div>
              <div>
                <Row l="Total abonado" sub={`${avance != null ? `${avance.toFixed(0)}% del contenedor` : ''}`}
                  v={`${usdF(esc.pagadoUsd)}`} />
                <Row l="TRM ponderada de lo abonado" v={numF(esc.trmPonderadaPagado)} />
                <Row l="TRM efectiva final del contenedor" v={numF(trmEfectiva)} big
                  tone={anterior?.trm != null && trmEfectiva != null
                    ? (trmEfectiva <= Number(anterior.trm) ? 'text-success' : 'text-amber-600 dark:text-amber-400') : undefined} />
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-x-8 gap-y-4 pt-1">
              {/* Abonos */}
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
                    Abonos reales ({reales.length}) <span className="font-normal normal-case">· del banco, se cargan en Pedidos</span>
                  </p>
                  {reales.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">Sin abonos reales todavía.</p>
                  ) : (
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="text-left text-muted-foreground border-b border-border">
                          <th className="py-1.5 pr-2 font-medium text-xs">Fecha</th>
                          <th className="py-1.5 pr-2 font-medium text-xs text-right">USD</th>
                          <th className="py-1.5 pr-2 font-medium text-xs text-right">TRM</th>
                          <th className="py-1.5 font-medium text-xs text-right">COP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reales.map((a, i) => (
                          <tr key={i} className="border-b border-border/40">
                            <td className="py-1.5 pr-2">{a.fecha ?? '—'}</td>
                            <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{numF(a.amount_usd)}</td>
                            <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{numF(a.trm)}</td>
                            <td className="py-1.5 text-right font-mono tabular-nums">{cop(a.amount_usd * a.trm)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Abonos manuales — "no reales" */}
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                      <Link2Off className="h-3.5 w-3.5" /> Abonos sin conectar ({manuales.length})
                    </p>
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setNuevoAbono((v) => !v)}>
                      <Plus className="h-3.5 w-3.5" /> Anotar
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-2 leading-relaxed">
                    Plata que ya se movió pero no está en la contabilidad (giros de terceros, compras sin conciliar).
                    <b>SÍ restan del saldo de este tablero</b> — es plata que ya se pagó
                    (giros de otro negocio directo a China que no pasan por contabilidad).
                    Por eso el saldo de arriba es menor que el de Pedidos: la diferencia
                    es exactamente esto. Si alguno SÍ salió de tu banco, no lo anotes acá:
                    conectalo en Conciliación (el giro se vincula al contenedor con un clic)
                    y va a contar en los dos lados.
                  </p>
                  {manuales.length > 0 && (
                    <table className="w-full text-[13px] mb-2">
                      <tbody>
                        {manuales.map((m: ManualAbono) => (
                          <tr key={m.id} className="border-b border-border/40">
                            <td className="py-1.5 pr-2 whitespace-nowrap">{m.fecha}</td>
                            <td className="py-1.5 pr-2 text-muted-foreground truncate max-w-[110px]">{m.descripcion || '—'}</td>
                            <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{cop(m.cop)}</td>
                            <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{numF(m.trm)}</td>
                            <td className="py-1.5 pr-1 text-right font-mono tabular-nums font-medium">{numF(m.cop / m.trm)} USD</td>
                            <td className="py-1.5 w-6">
                              <button type="button" onClick={() => remove.mutate(m.id)}
                                className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                            </td>
                          </tr>
                        ))}
                        <tr className="font-bold">
                          <td className="py-1.5" colSpan={4}>Total sin conectar</td>
                          <td className="py-1.5 text-right font-mono tabular-nums">{numF(totalManualUsd)} USD</td>
                          <td />
                        </tr>
                        {esc && totalManualUsd > 0 && pedido.saldo_pendiente_usd != null && (
                          <tr className="text-[11px] text-muted-foreground">
                            <td className="py-1" colSpan={6}>
                              Ya descontados: Pedidos dice {numF(Number(pedido.saldo_pendiente_usd))} USD y acá quedan{' '}
                              <b className="text-foreground">{numF(esc.saldoUsd)}</b>.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                  {nuevoAbono && (
                    <div className="flex items-end gap-2 flex-wrap">
                      <div><label className="text-[11px] text-muted-foreground block mb-1">Fecha</label>
                        <Input type="date" value={fa} onChange={(e) => setFa(e.target.value)} className="h-8 w-36 text-xs" /></div>
                      <div className="flex-1 min-w-[110px]"><label className="text-[11px] text-muted-foreground block mb-1">Descripción</label>
                        <Input value={da} onChange={(e) => setDa(e.target.value)} placeholder="Ej: giro Mauricio" className="h-8 text-xs" /></div>
                      <div><label className="text-[11px] text-muted-foreground block mb-1">COP</label>
                        <Input inputMode="numeric" value={ca} onChange={(e) => setCa(e.target.value)} placeholder="68.000.000" className="h-8 w-32 text-xs font-mono" /></div>
                      <div><label className="text-[11px] text-muted-foreground block mb-1">TRM</label>
                        <Input inputMode="numeric" value={ta} onChange={(e) => setTa(e.target.value)} placeholder="3.400" className="h-8 w-24 text-xs font-mono" /></div>
                      <Button size="sm" className="h-8 text-xs" onClick={guardarAbono} disabled={add.isPending}>Anotar</Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Escalera */}
              {escalera.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
                    Si el dólar se mueve, el saldo te cuesta
                  </p>
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border">
                        <th className="py-1.5 pr-2 font-medium text-xs">TRM</th>
                        <th className="py-1.5 pr-2 font-medium text-xs text-right">COP del saldo</th>
                        <th className="py-1.5 font-medium text-xs text-right">vs. hoy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {escalera.map((r) => (
                        <tr key={r.trm} className={cn('border-b border-border/40',
                          r.esHoy && 'bg-destructive/5 font-bold', r.esEscenario && 'bg-primary/5 font-semibold')}>
                          <td className="py-1.5 pr-2">{numF(r.trm)}{r.esHoy ? ' · hoy' : r.esEscenario ? ' · escenario' : ''}</td>
                          <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{cop(r.cop)}</td>
                          <td className={cn('py-1.5 text-right font-mono tabular-nums',
                            r.vsHoy != null && r.vsHoy > 0 ? 'text-destructive' : r.vsHoy != null && r.vsHoy < 0 ? 'text-success' : 'text-muted-foreground')}>
                            {r.esHoy || r.vsHoy == null ? '—' : copM(r.vsHoy)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                    Lo ya abonado no se mueve: quedó blindado a su TRM. Solo el saldo respira.
                  </p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

/** Lo que el módulo expone al orquestador para la caja del próximo. */
export function cajaDelContenedor(esc: EscenarioVigente | null): { saldo: number; impuestos: number; total: number } | null {
  if (!esc) return null;
  const saldo = esc.saldoCopSimulado ?? 0;
  const impuestos = esc.impuestosPendientesCop ?? 0;
  return { saldo, impuestos, total: saldo + impuestos };
}
