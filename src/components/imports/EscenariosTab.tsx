/**
 * Pestaña ESCENARIOS — el tablero de decisión de importaciones, con el
 * lenguaje del "Calculador de costo MGN" que Nico construyó a mano.
 *
 * Orquesta: perillas (TRM · SMM · flete) → un ModuloContenedor por cada
 * pedido en curso (el PRÓXIMO A LLEGAR primero y abierto por defecto) →
 * simulador del que sigue → caja del próximo → histórico → escenarios
 * guardados.
 *
 * REGLAS: no escribe en import_costs/import_payments/transactions ni crea
 * pedidos. Escribe lo suyo (import_manual_abonos, import_scenarios) y — desde
 * 2026-09-03, pedido de Nico — las correcciones REALES del contenedor
 * (mercancía → imports.monto_total_usd, peso/unidades → peso_real_kg/
 * unidades_reales): editar acá actualiza Pedidos y el saldo, sin doble
 * digitación. Las perillas TRM/SMM/flete siguen siendo juego, no contabilidad.
 */

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  FlaskConical, RotateCcw, ChevronDown, PiggyBank, BookmarkPlus, Trash2, Upload, CheckCircle2, Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { buildComparativo, type PedidoComparable, type EscenarioOverrides } from '@/lib/importComparison';
import { IMPORT_ESTADOS_ORDER } from '@/hooks/useImports';
import { escenarioVigente, viernesAduana } from '@/lib/importScenario';
import { useQuery } from '@tanstack/react-query';
import { fetchTrmForDate } from '@/hooks/useImportPayments';
import { computeImportBreakdown, type ImportCostLine } from '@/lib/importCosting';
import { useImportItems } from '@/hooks/useImportItems';
import { useImportScenarios, type ImportScenario } from '@/hooks/useImportScenarios';
import { useManualAbonos } from '@/hooks/useManualAbonos';
import { computeLandedCost } from '@/lib/landedCost';
import { scalePacking, totalesDe } from '@/lib/scalePacking';
import ModuloContenedor, {
  cop, copM, usdF, numF, pctS, sinIva, fleteUsdDe, type PayRow,
} from './ModuloContenedor';
import HistorialContenedores from './HistorialContenedores';
import ImpactoListaPrecios from './ImpactoListaPrecios';

interface Props {
  pedidos: PedidoComparable[];
  payRows: PayRow[];
  trmHoy: number | null;
  lmeHoy: number | null;
  lmeHistoria: Array<{ date: string; value: number }>;
  hoy: string;
}

/**
 * Orden CRONOLOGICO de la cadena (viejo → nuevo): cuándo arrancó cada pedido.
 * Se usa para el histórico y para saber cuál es "el anterior" de cada uno.
 * La fecha de anticipo es la estable — la de llegada se corre todo el tiempo.
 */
const fechaOrden = (p: PedidoComparable): string =>
  p.fechas.fecha_anticipo ?? p.fechas.fecha_embarque ?? p.fechas.fecha_estimada_llegada ?? p.fechas.fecha_entregado ?? '';

/**
 * Qué tan cerca de bodega está un pedido. MAYOR = más cerca.
 *
 * El ESTADO manda sobre la fecha (reporte de Nico 2026-08-31: el tablero
 * marcaba 2026-3 como próximo cuando 2026-2 ya venía en tránsito y 2026-3
 * seguía listo en fábrica en China). Un contenedor embarcado está
 * objetivamente más cerca que uno esperando embarque, sin importar qué diga
 * una ETA que nadie actualizó. IMPORT_ESTADOS_ORDER es el orden canónico de
 * la app: produccion → listo_fabrica → transito → aduana → entregado.
 */
const avanceDe = (p: PedidoComparable): number => {
  const i = IMPORT_ESTADOS_ORDER.indexOf(p.estado as never);
  if (i >= 0) return i;
  // Estados viejos (cotizacion, anticipo) o desconocidos: antes de producción.
  return -1;
};

/** Orden "próximo a llegar" primero: más avanzado, y a igual estado, ETA más cercana. */
const porProximidad = (a: PedidoComparable, b: PedidoComparable): number => {
  const d = avanceDe(b) - avanceDe(a);
  if (d !== 0) return d;
  const ea = a.fechas.fecha_estimada_llegada ?? '9999-12-31';
  const eb = b.fechas.fecha_estimada_llegada ?? '9999-12-31';
  return ea.localeCompare(eb);
};

function Perilla({ label, unit, value, onChange, min, max, step, chips, refs }: {
  label: string; unit: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number;
  chips: Array<{ label: string; value: number }>; refs?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold">{label}</span>
        <span className="flex items-baseline gap-1">
          <Input
            inputMode="numeric" value={new Intl.NumberFormat('es-CO').format(value)}
            onChange={(e) => { const n = Number(e.target.value.replace(/[.,\s]/g, '')); if (Number.isFinite(n) && n > 0) onChange(n); }}
            className="h-8 w-28 text-right font-mono font-bold tabular-nums text-lg border-0 border-b rounded-none px-1 focus-visible:ring-0"
          />
          <span className="text-[11px] text-muted-foreground uppercase">{unit}</span>
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, value))}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-primary h-2" />
      <div className="flex items-center gap-1.5 flex-wrap">
        {chips.map((c) => (
          <button key={c.label} type="button" onClick={() => onChange(c.value)}
            className={cn('rounded-full border px-2.5 py-1 text-[11px] transition-colors',
              value === c.value ? 'border-primary bg-primary/10 text-primary font-semibold'
                : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground')}>
            {c.label}
          </button>
        ))}
      </div>
      {refs && <p className="text-[11px] text-muted-foreground">{refs}</p>}
    </div>
  );
}

export default function EscenariosTab({ pedidos, payRows, trmHoy, lmeHoy, lmeHistoria, hoy }: Props) {
  // ── Cadena cronológica de contenedores ──
  const cadena = useMemo(
    () => [...pedidos].filter((p) => p.estado !== 'cancelado').sort((a, b) => fechaOrden(a).localeCompare(fechaOrden(b))),
    [pedidos],
  );
  const entregados = useMemo(() => cadena.filter((p) => p.estado === 'entregado' || p.estado === 'cerrado'), [cadena]);
  const ultimoEntregado = entregados[entregados.length - 1] ?? null;
  // EN CURSO ordenados por llegada: el PRIMERO es el próximo al último
  // entregado — y ese es el default que Nico quiere ver arriba y abierto.
  const enCurso = useMemo(
    () => cadena
      .filter((p) => !['entregado', 'cerrado'].includes(p.estado) && Number(p.monto_total_usd) > 0)
      .sort(porProximidad),
    [cadena],
  );
  const proximo = enCurso[0] ?? null;

  /** El contenedor anterior a uno dado, dentro de la cadena. */
  const anteriorDe = (p: PedidoComparable): PedidoComparable | null => {
    const i = cadena.findIndex((x) => x.id === p.id);
    return i > 0 ? cadena[i - 1] : null;
  };

  // ── Perillas: defaults tomados del PRÓXIMO (no de uno arbitrario) ──
  const smmRef = proximo?.precio_smm_cerrado_usd_ton ?? ultimoEntregado?.precio_smm_cerrado_usd_ton ?? null;
  const fleteRef = fleteUsdDe(proximo?.costs) ?? fleteUsdDe(ultimoEntregado?.costs) ?? null;

  const [trm, setTrm] = useState<number | null>(null);
  const [smm, setSmm] = useState<number | null>(null);
  const [flete, setFlete] = useState<number | null>(null);
  // TRM de LIQUIDACION ADUANERA — distinta de la de compra de dólares. La DIAN
  // liquida arancel e IVA sobre la TRM vigente (la del último viernes), no
  // sobre el promedio al que compraste los giros (corrección de Nico).
  const [trmAdu, setTrmAdu] = useState<number | null>(null);
  const trmVal = trm ?? (trmHoy != null ? Math.round(trmHoy) : 3500);
  const smmVal = smm ?? Math.round(Number(smmRef ?? 3500));
  const fleteVal = flete ?? Math.round(fleteRef ?? 5700);
  // TRM de aduana automática del PRÓXIMO: la del último viernes previo a la
  // semana de su arribo (regla DIAN, Nico 2026-09-03). La perilla la fuerza.
  const viernesProx = viernesAduana(
    proximo?.fechas.fecha_arribo_real ?? proximo?.fechas.fecha_estimada_llegada ?? hoy,
  );
  const { data: trmViernesProx } = useQuery({
    queryKey: ['trm-fecha', viernesProx],
    enabled: !!viernesProx,
    staleTime: 30 * 60_000,
    queryFn: () => fetchTrmForDate(viernesProx!),
  });
  const trmAduanaVal = trmAdu ?? (trmViernesProx != null ? Math.round(trmViernesProx) : null)
    ?? (trmHoy != null ? Math.round(trmHoy) : trmVal);
  const tocado = trm != null || smm != null || flete != null || trmAdu != null;
  const volverAHoy = () => { setTrm(null); setSmm(null); setFlete(null); setTrmAdu(null); };

  const smmReposicion = useMemo(() => {
    const base = ultimoEntregado?.precio_smm_cerrado_usd_ton;
    if (base == null || lmeHoy == null || !ultimoEntregado) return null;
    const f = fechaOrden(ultimoEntregado);
    let lmeEntonces: number | null = null;
    for (const p of lmeHistoria) { if (p.date <= f) lmeEntonces = p.value; else break; }
    if (lmeEntonces == null && lmeHistoria.length > 0) lmeEntonces = lmeHistoria[0].value;
    return lmeEntonces && lmeEntonces > 0 ? Math.round(Number(base) * (lmeHoy / lmeEntonces)) : null;
  }, [ultimoEntregado, lmeHoy, lmeHistoria]);

  // ── Simulador del que sigue (columnaHoy con overrides) ──
  const cmp = useMemo(() => {
    const overrides: EscenarioOverrides = { trm: trmVal, smmUsdTon: smmVal, fleteUsd: fleteVal };
    return buildComparativo({ pedidos, hoy, trmHoy, lmeHoy, lmeHistoria, overrides });
  }, [pedidos, hoy, trmHoy, lmeHoy, lmeHistoria, trmVal, smmVal, fleteVal]);
  const colSiguiente = cmp.columnas.find((c) => c.kind === 'hoy') ?? null;

  const bdSiguiente = useMemo(() => {
    if (!colSiguiente?.mercanciaUsd || !ultimoEntregado) return null;
    const costsEff = [
      ...(ultimoEntregado.costs ?? []).filter((c) => c.tipo !== 'flete'),
      { tipo: 'flete', monto: fleteVal, moneda: 'USD', trm: null } as ImportCostLine,
    ];
    return computeImportBreakdown({
      mercanciaUsd: colSiguiente.mercanciaUsd, costs: costsEff, trm: trmVal, trmAduana: trmAduanaVal,
      arancelPct: Number(ultimoEntregado.arancel_pct ?? 5), ivaPct: Number(ultimoEntregado.iva_pct ?? 19),
      cantidadKg: colSiguiente.toneladas != null ? colSiguiente.toneladas * 1000 : null,
    });
  }, [colSiguiente, ultimoEntregado, fleteVal, trmVal, trmAduanaVal]);
  const totalSiguienteSinIva = sinIva(bdSiguiente);
  const copKgSiguiente = totalSiguienteSinIva != null && colSiguiente?.toneladas
    ? totalSiguienteSinIva / (colSiguiente.toneladas * 1000) : null;

  const bdUltimo = useMemo(() => {
    if (!ultimoEntregado || ultimoEntregado.monto_total_usd == null) return null;
    return computeImportBreakdown({
      mercanciaUsd: Number(ultimoEntregado.monto_total_usd), costs: ultimoEntregado.costs,
      trm: ultimoEntregado.trm != null ? Number(ultimoEntregado.trm) : null,
      arancelPct: Number(ultimoEntregado.arancel_pct ?? 5), ivaPct: Number(ultimoEntregado.iva_pct ?? 19),
      cantidadKg: ultimoEntregado.cantidad_ton != null ? Number(ultimoEntregado.cantidad_ton) * 1000 : null,
    });
  }, [ultimoEntregado]);
  const totalUltimoSinIva = sinIva(bdUltimo);
  const copKgUltimo = totalUltimoSinIva != null && ultimoEntregado?.cantidad_ton
    ? totalUltimoSinIva / (Number(ultimoEntregado.cantidad_ton) * 1000) : null;

  const sens = useMemo(() => {
    if (!colSiguiente?.mercanciaUsd) return null;
    const usdTot = colSiguiente.mercanciaUsd + fleteVal + 110;
    const tons = colSiguiente.toneladas ?? 0;
    return { trm100: usdTot * 100, smm100: tons * 100 * trmVal, flete1000: 1000 * trmVal };
  }, [colSiguiente, fleteVal, trmVal]);

  // ── CAJA: SOLO la del próximo, con saldo + TODO lo de aduanas ──
  const { abonos: manualesTodos } = useManualAbonos();
  // Correcciones REALES del próximo (mercancía/peso/unidades): viven en el
  // PEDIDO (se editan en su ModuloContenedor y escriben imports), así la
  // caja y la tabla de referencias hablan del mismo despacho que Pedidos.
  const escProximo = useMemo(() => {
    if (!proximo || Number(proximo.monto_total_usd) <= 0) return null;
    const reales = payRows.filter((p) => p.import_id === proximo.id && Number(p.amount_usd) > 0 && Number(p.trm) > 0)
      .map((p) => ({ amount_usd: Number(p.amount_usd), trm: Number(p.trm) }));
    // Los "sin conectar" son plata REAL ya pagada (otro negocio, directo a
    // China): restan del saldo y de la caja para cerrar. Mismo criterio que
    // ModuloContenedor — si no, la caja pediría dólares ya girados.
    const manuales = manualesTodos.filter((m) => m.import_id === proximo.id)
      .map((m) => ({ amount_usd: m.cop / m.trm, trm: m.trm }));
    const manualUsd = manuales.reduce((s, m) => s + m.amount_usd, 0);
    return escenarioVigente({
      mercanciaUsd: Number(proximo.monto_total_usd), costs: proximo.costs,
      abonos: [...reales, ...manuales],
      saldoUsdReal: proximo.saldo_pendiente_usd != null
        ? Math.max(0, Number(proximo.saldo_pendiente_usd) - manualUsd)
        : null,
      trmSimulada: trmVal, trmAduana: trmAduanaVal,
      arancelPct: Number(proximo.arancel_pct ?? 5), ivaPct: Number(proximo.iva_pct ?? 19),
      cantidadKg: (proximo.peso_real_kg != null ? Number(proximo.peso_real_kg) : null)
        ?? (proximo.cantidad_ton != null ? Number(proximo.cantidad_ton) * 1000 : null),
    });
  }, [proximo, payRows, manualesTodos, trmVal, trmAduanaVal]);

  const caja = useMemo(() => {
    if (!escProximo) return null;
    const bd = escProximo.breakdown;
    const saldo = escProximo.saldoCopSimulado ?? 0;
    // Aduanas COMPLETO: arancel + IVA + agencia/transporte/bancarios. Los que
    // ya tienen liquidación real cargada no vuelven a pedir caja.
    const arancel = bd.usaArancelReal ? 0 : (bd.arancelCop ?? 0);
    const iva = bd.usaIvaReal ? 0 : (bd.ivaCop ?? 0);
    const otros = bd.otrosCop ?? 0;
    return { saldo, arancel, iva, otros, total: saldo + arancel + iva + otros };
  }, [escProximo]);

  // ── Costo por referencia del próximo, sobre el packing ESCALADO ──
  // Si Nico corrigió mercancía/peso/unidades, la tabla y el margen tienen que
  // salir del reprorrateo, no del packing original (si no, el flete unitario
  // que se ve acá no coincide con el del módulo de arriba).
  const { effectiveItems, costs: costsProximo, hayPacking } = useImportItems(proximo?.id ?? null, trmVal);
  const landed = useMemo(() => {
    const base = effectiveItems ?? [];
    if (base.length === 0 || !proximo) return null;
    // Mercancía escala solo si el pedido difiere del packing de verdad (>0.5%).
    const packSum = totalesDe(base);
    const montoPedido = Number(proximo.monto_total_usd) || 0;
    const mercanciaOverride = packSum.mercanciaUsd > 0 && montoPedido > 0
      && Math.abs(montoPedido - packSum.mercanciaUsd) / packSum.mercanciaUsd > 0.005
      ? montoPedido : null;
    const esc = scalePacking(base, {
      mercanciaUsd: mercanciaOverride,
      pesoKg: proximo.peso_real_kg != null ? Number(proximo.peso_real_kg) : null,
      unidades: proximo.unidades_reales != null ? Number(proximo.unidades_reales) : null,
    });
    return computeLandedCost(esc.items, costsProximo ?? [], trmVal);
  }, [effectiveItems, costsProximo, trmVal, proximo]);
  const [verRefs, setVerRefs] = useState(false);
  const [buscar, setBuscar] = useState('');
  const refsFiltradas = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    const rows = landed?.items ?? [];
    const f = q ? rows.filter((r) => r.reference.toLowerCase().includes(q) || (r.descripcion ?? '').toLowerCase().includes(q)) : rows;
    return [...f].sort((a, b) => b.landed_total_cop - a.landed_total_cop);
  }, [landed, buscar]);

  // ── Escenarios guardados ──
  const { scenarios, save, remove } = useImportScenarios();
  const [saving, setSaving] = useState(false);
  const [nombre, setNombre] = useState('');
  const [notas, setNotas] = useState('');
  const [verGuardados, setVerGuardados] = useState(false);

  const handleGuardar = () => {
    const n = nombre.trim();
    if (!n) return;
    save.mutate({
      nombre: n, trm: trmVal, smm_usd_ton: smmVal, flete_usd: fleteVal,
      import_id: proximo?.id ?? null, notas: notas.trim() || null,
      snapshot: {
        trmHoy,
        vigente: escProximo && proximo ? {
          label: proximo.label, saldoUsd: escProximo.saldoUsd,
          saldoCop: escProximo.saldoCopSimulado, cajaParaCerrar: caja?.total ?? null,
        } : null,
        siguiente: colSiguiente ? {
          totalCop: totalSiguienteSinIva, copPorKg: copKgSiguiente,
          mercanciaUsd: colSiguiente.mercanciaUsd, llegada: colSiguiente.fechaLlegada,
        } : null,
      },
    }, { onSuccess: () => { setSaving(false); setNombre(''); setNotas(''); setVerGuardados(true); } });
  };
  const cargarEscenario = (sc: ImportScenario) => {
    if (sc.trm != null) setTrm(Math.round(sc.trm));
    if (sc.smm_usd_ton != null) setSmm(Math.round(sc.smm_usd_ton));
    if (sc.flete_usd != null) setFlete(Math.round(sc.flete_usd));
  };
  const confrontacion = (sc: ImportScenario) => {
    if (!sc.import_id || sc.trm == null) return null;
    const p = pedidos.find((x) => x.id === sc.import_id);
    if (!p || !['entregado', 'cerrado'].includes(p.estado)) return null;
    const ab = payRows.filter((x) => x.import_id === sc.import_id && Number(x.amount_usd) > 0 && Number(x.trm) > 0);
    const u = ab.reduce((s, a) => s + Number(a.amount_usd), 0);
    if (u <= 0) return null;
    const trmReal = ab.reduce((s, a) => s + Number(a.amount_usd) * Number(a.trm), 0) / u;
    return { trmReal, delta: trmReal - sc.trm };
  };

  return (
    <div className="space-y-4">
      {/* ═══ Perillas ═══ */}
      <Card className="border-primary/30">
        <CardContent className="py-4 px-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-4.5 w-4.5 text-primary" />
              <h3 className="text-base font-bold tracking-tight">Escenario</h3>
              <Badge variant="outline" className="text-[11px]">simulación — no toca la contabilidad</Badge>
            </div>
            <div className="flex items-center gap-1.5">
              {tocado && (
                <Button size="sm" variant="ghost" className="h-8 text-xs gap-1.5" onClick={volverAHoy}>
                  <RotateCcw className="h-3.5 w-3.5" /> Volver a hoy
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setSaving((v) => !v)}>
                <BookmarkPlus className="h-3.5 w-3.5" /> Guardar
              </Button>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-x-6 gap-y-5">
            <Perilla label="Dólar (TRM)" unit="COP/USD" value={trmVal} onChange={setTrm} min={2800} max={4300} step={1}
              chips={[
                ...(trmHoy != null ? [{ label: `Hoy (${numF(trmHoy)})`, value: Math.round(trmHoy) }, { label: '+100', value: Math.round(trmHoy) + 100 }, { label: '+250', value: Math.round(trmHoy) + 250 }] : []),
                { label: '3.500', value: 3500 },
              ]}
              refs={ultimoEntregado?.trm != null ? `prom. logrado ${ultimoEntregado.label}: ${numF(Number(ultimoEntregado.trm))}` : undefined} />
            <Perilla label="SMM (aluminio)" unit="USD/TON" value={smmVal} onChange={setSmm} min={2900} max={4500} step={5}
              chips={[
                ...(proximo?.precio_smm_cerrado_usd_ton != null ? [{ label: `${proximo.label} ✓`, value: Math.round(Number(proximo.precio_smm_cerrado_usd_ton)) }] : []),
                ...(smmReposicion != null ? [{ label: `Reposición hoy (≈${numF(smmReposicion)})`, value: smmReposicion }] : []),
                ...(ultimoEntregado?.precio_smm_cerrado_usd_ton != null ? [{ label: `${ultimoEntregado.label}`, value: Math.round(Number(ultimoEntregado.precio_smm_cerrado_usd_ton)) }] : []),
              ]}
              refs="el SMM que fijás acá manda sobre el LME" />
            <Perilla label="Flete" unit="USD" value={fleteVal} onChange={setFlete} min={2000} max={9000} step={50}
              chips={[
                ...(fleteUsdDe(proximo?.costs) != null ? [{ label: `${proximo?.label}`, value: Math.round(fleteUsdDe(proximo?.costs)!) }] : []),
                ...(fleteUsdDe(ultimoEntregado?.costs) != null ? [{ label: `${ultimoEntregado?.label}`, value: Math.round(fleteUsdDe(ultimoEntregado?.costs)!) }] : []),
                { label: 'Pesimista 7.000', value: 7000 },
              ]} />
          </div>

          <div className="flex items-end gap-3 flex-wrap border-t border-border pt-3">
            <div>
              <label className="text-[13px] font-semibold block mb-1">
                TRM de aduana <span className="text-[11px] font-normal text-muted-foreground">(liquidación DIAN)</span>
              </label>
              <Input inputMode="numeric" value={new Intl.NumberFormat('es-CO').format(trmAduanaVal)}
                onChange={(e) => { const n = Number(e.target.value.replace(/[.,\s]/g, '')); if (Number.isFinite(n) && n > 0) setTrmAdu(n); }}
                className={cn('h-9 w-32 font-mono font-bold tabular-nums text-[15px]', trmAdu != null && 'border-primary')} />
            </div>
            <p className="text-[11px] text-muted-foreground flex-1 min-w-[260px] leading-relaxed pb-1.5">
              El arancel y el IVA se liquidan sobre <b>esta</b> TRM — no sobre el promedio al que
              compraste los dólares. <b>Automática por contenedor</b>: la del último viernes previo a la
              semana del arribo de cada uno{viernesProx ? ` (próximo: viernes ${viernesProx.slice(8, 10)}/${viernesProx.slice(5, 7)})` : ''}.
              Escribí un valor solo para forzarla{trmAdu != null ? ' — forzada ahora' : ''}.
            </p>
          </div>

          {saving && (
            <div className="flex items-end gap-2 flex-wrap rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
              <div className="flex-1 min-w-[180px]">
                <label className="text-[11px] text-muted-foreground block mb-1">Nombre</label>
                <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: si el dólar toca 3.000" className="h-8 text-[13px]" autoFocus />
              </div>
              <div className="flex-[2] min-w-[220px]">
                <label className="text-[11px] text-muted-foreground block mb-1">Notas (opcional)</label>
                <Input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Por qué este escenario" className="h-8 text-[13px]" />
              </div>
              <Button size="sm" className="h-8 text-xs" onClick={handleGuardar} disabled={!nombre.trim() || save.isPending}>Guardar</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ Un módulo por contenedor en curso — el próximo primero ═══ */}
      {enCurso.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-[13px] text-muted-foreground">
          No hay pedidos en curso con factura confirmada.
        </CardContent></Card>
      ) : (
        enCurso.map((p, i) => (
          <ModuloContenedor key={p.id} pedido={p} anterior={anteriorDe(p)} payRows={payRows}
            trmVal={trmVal} trmHoy={trmHoy} esProximo={i === 0} trmAduana={trmAdu} />
        ))
      )}

      {/* ═══ CAJA del próximo (saldo + aduanas completo) ═══ */}
      {proximo && caja && (
        <Card>
          <CardContent className="py-4 px-5 space-y-3">
            <div className="flex items-center gap-2">
              <PiggyBank className="h-4 w-4 text-primary" />
              <h4 className="text-base font-bold tracking-tight">Caja que necesito — {proximo.label}</h4>
              <Badge variant="secondary" className="text-[11px]">el próximo a llegar</Badge>
            </div>
            <div className="grid sm:grid-cols-2 gap-x-8">
              <div>
                <div className="flex items-baseline justify-between gap-3 border-b border-border/50 py-2">
                  <span className="text-[13px] text-muted-foreground">Saldo de mercancía · {usdF(escProximo?.saldoUsd)}</span>
                  <span className="text-[14px] font-semibold tabular-nums">{cop(caja.saldo)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-b border-border/50 py-2">
                  <span className="text-[13px] text-muted-foreground">Arancel {escProximo?.breakdown.usaArancelReal ? '(ya liquidado)' : 'estimado'}</span>
                  <span className="text-[14px] font-semibold tabular-nums">{cop(caja.arancel)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-b border-border/50 py-2">
                  <span className="text-[13px] text-muted-foreground">IVA importación {escProximo?.breakdown.usaIvaReal ? '(ya liquidado)' : 'estimado'}</span>
                  <span className="text-[14px] font-semibold tabular-nums text-amber-700 dark:text-amber-400">{cop(caja.iva)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-b border-border/50 py-2">
                  <span className="text-[13px] text-muted-foreground">Agencia + transporte + bancarios</span>
                  <span className="text-[14px] font-semibold tabular-nums">{cop(caja.otros)}</span>
                </div>
              </div>
              <div className="flex flex-col justify-center py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Necesito en total</p>
                <p className="text-[38px] leading-none font-extrabold tabular-nums tracking-tight mt-1">{cop(caja.total)}</p>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  A TRM {numF(trmVal)} · para dejar {proximo.label} nacionalizado y en bodega.
                  {proximo.fechas.fecha_estimada_llegada ? ` Llegada estimada ${proximo.fechas.fecha_estimada_llegada}.` : ''}
                </p>
              </div>
            </div>
            {enCurso.length > 1 && (
              <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
                Hay {enCurso.length - 1} contenedor(es) más en curso — su caja se calcula cuando les toque el turno,
                cada uno en su módulo de arriba.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══ Simulador del que sigue ═══ */}
      {colSiguiente && (
        <Card>
          <CardContent className="py-4 px-5 space-y-3">
            <h4 className="text-base font-bold tracking-tight">Si monto el siguiente hoy</h4>
            <div className="grid lg:grid-cols-2 gap-x-8 gap-y-3 items-start">
              <div className="rounded-xl border border-border bg-muted/20 px-4 py-3.5">
                <p className="text-[34px] leading-none font-extrabold tabular-nums tracking-tight">{cop(totalSiguienteSinIva)}</p>
                {totalUltimoSinIva != null && totalSiguienteSinIva != null && ultimoEntregado && (
                  <p className={cn('text-sm font-semibold mt-1.5',
                    totalSiguienteSinIva <= totalUltimoSinIva ? 'text-success' : 'text-destructive')}>
                    {pctS((totalSiguienteSinIva / totalUltimoSinIva - 1) * 100)} vs. {ultimoEntregado.label}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  mercancía {usdF(colSiguiente.mercanciaUsd)} · SMM {numF(colSiguiente.precioUsdTon)} · {numF(colSiguiente.toneladas)} t ·
                  llega ≈ {colSiguiente.fechaLlegada ?? '—'} ({colSiguiente.etapas.total ?? '—'}d)
                </p>
                <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] text-muted-foreground">Costo por kilo (sin IVA)</p>
                    <p className={cn('text-lg font-bold tabular-nums',
                      copKgUltimo != null && copKgSiguiente != null ? (copKgSiguiente <= copKgUltimo ? 'text-success' : 'text-destructive') : '')}>
                      {numF(copKgSiguiente)} <span className="text-xs font-normal text-muted-foreground">COP/kg</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">IVA (caja aparte)</p>
                    <p className="text-lg font-bold tabular-nums text-amber-700 dark:text-amber-400">{cop(bdSiguiente?.ivaCop ?? null)}</p>
                  </div>
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Sensibilidad — impacto por movimiento</p>
                {sens && (
                  <>
                    <div className="flex items-baseline justify-between border-b border-border/50 py-2">
                      <span className="text-[13px] text-muted-foreground">Dólar ±100 pesos</span>
                      <span className="text-[15px] font-semibold tabular-nums">± {copM(sens.trm100).replace('+', '')}</span>
                    </div>
                    <div className="flex items-baseline justify-between border-b border-border/50 py-2">
                      <span className="text-[13px] text-muted-foreground">SMM ±100 USD/ton</span>
                      <span className="text-[15px] font-semibold tabular-nums">± {copM(sens.smm100).replace('+', '')}</span>
                    </div>
                    <div className="flex items-baseline justify-between border-b border-border/50 py-2">
                      <span className="text-[13px] text-muted-foreground">Flete ±1.000 USD</span>
                      <span className="text-[15px] font-semibold tabular-nums">± {copM(sens.flete1000).replace('+', '')}</span>
                    </div>
                  </>
                )}
                <details className="mt-2">
                  <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground">
                    Qué asume este número ({colSiguiente.supuestos.length})
                  </summary>
                  <ul className="mt-1.5 space-y-1">
                    {colSiguiente.supuestos.map((t, i) => <li key={i} className="text-[11px] text-muted-foreground pl-3">· {t}</li>)}
                  </ul>
                </details>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ Histórico de contenedores ═══ */}
      <HistorialContenedores pedidos={cadena} payRows={payRows} trmVal={trmVal} />

      {/* ═══ Impacto en la lista de precios — la conclusión del tablero ═══ */}
      {proximo && hayPacking && (landed?.items.length ?? 0) > 0 && (
        <ImpactoListaPrecios
          label={proximo.label}
          items={landed!.items}
          smmActual={smmVal}
          smmPiso={proximo.precio_smm_cerrado_usd_ton != null ? Number(proximo.precio_smm_cerrado_usd_ton) : null}
        />
      )}

      {/* ═══ Costo por referencia del próximo ═══ */}
      {proximo && hayPacking && (landed?.items.length ?? 0) > 0 && (
        <Card>
          <CardContent className="py-4 px-5 space-y-3">
            <button type="button" onClick={() => setVerRefs((v) => !v)} className="flex items-center gap-2 text-base font-bold tracking-tight w-full text-left">
              <ChevronDown className={cn('h-4 w-4 transition-transform', verRefs && 'rotate-180')} />
              Costo por referencia · {proximo.label}
              <span className="text-[13px] font-normal text-muted-foreground">({landed!.items.length} ítems · TRM {numF(trmVal)})</span>
            </button>
            {verRefs && (
              <>
                <div className="relative max-w-xs">
                  <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar referencia o descripción…" className="h-9 pl-9 text-[13px]" />
                </div>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-[13px]">
                    <thead className="bg-muted/60">
                      <tr className="text-left">
                        <th className="px-3 py-2 font-semibold">Ref</th>
                        <th className="px-3 py-2 font-semibold">Descripción</th>
                        <th className="px-3 py-2 font-semibold text-right">Cant.</th>
                        <th className="px-3 py-2 font-semibold text-right">Costo unit. (proy.)</th>
                        <th className="px-3 py-2 font-semibold text-right">Total landed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {refsFiltradas.slice(0, 150).map((r) => (
                        <tr key={r.id} className="border-t border-border/50 hover:bg-muted/30">
                          <td className="px-3 py-1.5 font-mono font-medium">{r.reference}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{r.descripcion ?? '—'}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{numF(r.cantidad)}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums font-semibold">{cop(r.landed_unit_cop)}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">{cop(r.landed_total_cop)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {refsFiltradas.length > 150 && (
                    <p className="px-3 py-2 text-[11px] text-muted-foreground">Mostrando 150 de {refsFiltradas.length} — usá el buscador.</p>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Landed = mercancía + flete + arancel + agencia prorrateados (el IVA va aparte: es descontable).
                  Recalcula con la TRM del escenario. Las variaciones vs contenedores pasados viven en Análisis de precios.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══ Escenarios guardados ═══ */}
      {scenarios.length > 0 && (
        <Card>
          <CardContent className="py-4 px-5 space-y-2">
            <button type="button" onClick={() => setVerGuardados((v) => !v)} className="flex items-center gap-2 text-base font-bold tracking-tight w-full text-left">
              <ChevronDown className={cn('h-4 w-4 transition-transform', verGuardados && 'rotate-180')} />
              Escenarios guardados <span className="text-[13px] font-normal text-muted-foreground">({scenarios.length})</span>
            </button>
            {verGuardados && (
              <div className="space-y-1.5 pt-1">
                {scenarios.map((sc) => {
                  const conf = confrontacion(sc);
                  return (
                    <div key={sc.id} className="rounded-lg border border-border/60 px-3 py-2.5 flex items-center gap-3 flex-wrap text-[13px]">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate">{sc.nombre}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(sc.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                          {sc.snapshot?.vigente?.label ? ` · ${sc.snapshot.vigente.label}` : ''}
                          {sc.notas ? ` · ${sc.notas}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {sc.trm != null && <Badge variant="secondary" className="text-[11px] font-mono">TRM {numF(sc.trm)}</Badge>}
                        {sc.smm_usd_ton != null && <Badge variant="secondary" className="text-[11px] font-mono">SMM {numF(sc.smm_usd_ton)}</Badge>}
                        {sc.flete_usd != null && <Badge variant="secondary" className="text-[11px] font-mono">Flete {numF(sc.flete_usd)}</Badge>}
                        {sc.snapshot?.vigente?.cajaParaCerrar != null && (
                          <Badge variant="outline" className="text-[11px] font-mono" title="Caja que daba al guardarlo">{cop(sc.snapshot.vigente.cajaParaCerrar)}</Badge>
                        )}
                        {conf && (
                          <Badge variant="outline" className={cn('text-[11px] font-mono gap-1',
                            conf.delta > 50 ? 'bg-destructive/10 text-destructive border-destructive/30' : 'bg-success/15 text-success border-success/30')}
                            title={`El pedido cerró: TRM real ${numF(conf.trmReal)} vs ${numF(sc.trm)} asumida`}>
                            <CheckCircle2 className="h-3 w-3" /> Real: {numF(conf.trmReal)} ({conf.delta >= 0 ? '+' : ''}{numF(conf.delta)})
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs gap-1" onClick={() => cargarEscenario(sc)}>
                          <Upload className="h-3.5 w-3.5" /> Cargar
                        </Button>
                        <button type="button" onClick={() => { if (window.confirm(`¿Borrar "${sc.nombre}"?`)) remove.mutate(sc.id); }}
                          className="h-8 w-8 rounded flex items-center justify-center text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
