/**
 * Pestaña ESCENARIOS — port del "Calculador de costo MGN" que Nico construyó
 * a mano en HTML (2026-08-31: "no construiste nada parecido al html... no me
 * deja jugar con los números así de fácil"). El lenguaje visual ES el del
 * HTML: héroe con el total gigante y su delta, renglones de costo, IVA como
 * caja-NO-costo, drivers con barras y lectura narrativa, sliders con chips de
 * preset, sensibilidad por movimiento y escalera del saldo.
 *
 * La diferencia con el HTML: acá NADA está hardcodeado — pedidos, abonos,
 * costos y TRM salen de la base viva (los motores ya testeados:
 * importScenario, importComparison, importCosting, importDrivers, landedCost).
 *
 * REGLAS: solo lectura (jamás escribe en imports/import_costs/import_payments/
 * transactions), no crea pedidos, todo supuesto declarado.
 */

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  FlaskConical, RotateCcw, ChevronDown, PiggyBank, BookmarkPlus, Trash2,
  Upload, CheckCircle2, Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildComparativo, deltaPct,
  type PedidoComparable, type EscenarioOverrides,
} from '@/lib/importComparison';
import { escenarioVigente } from '@/lib/importScenario';
import { driversDelta } from '@/lib/importDrivers';
import { useImportItems } from '@/hooks/useImportItems';
import { useImportScenarios, type ImportScenario } from '@/hooks/useImportScenarios';
import { computeImportBreakdown, type ImportCostLine } from '@/lib/importCosting';

// ─────────────────────────── formato ───────────────────────────
const fmt0 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const cop = (n: number | null | undefined) => (n == null ? '—' : `$${fmt0.format(Math.round(n))}`);
const copM = (n: number | null | undefined) =>
  n == null ? '—' : `${n < 0 ? '−' : '+'}$${(Math.abs(n) / 1e6).toFixed(1).replace('.', ',')}M`;
const usd = (n: number | null | undefined) => (n == null ? '—' : `${fmt0.format(Math.round(n))} USD`);
const num = (n: number | null | undefined) => (n == null ? '—' : fmt0.format(Math.round(n)));
const pctS = (n: number | null | undefined) =>
  n == null ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1).replace('.', ',')}%`;

const fleteUsdDe = (costs: ImportCostLine[] | undefined): number | null => {
  const v = (costs ?? [])
    .filter((c) => c.tipo === 'flete' && (c.moneda ?? 'USD') === 'USD')
    .reduce((s, c) => s + (Number(c.monto) || 0), 0);
  return v > 0 ? v : null;
};
const seguroUsdDe = (costs: ImportCostLine[] | undefined): number =>
  (costs ?? [])
    .filter((c) => c.tipo === 'seguro' && (c.moneda ?? 'USD') === 'USD')
    .reduce((s, c) => s + (Number(c.monto) || 0), 0);

interface PayRow { import_id: string; amount_usd: number | null; trm: number | null; fecha?: string | null }

interface Props {
  pedidos: PedidoComparable[];
  payRows: PayRow[];
  trmHoy: number | null;
  lmeHoy: number | null;
  lmeHistoria: Array<{ date: string; value: number }>;
  hoy: string;
}

// ─────────────────────────── piezas de UI ───────────────────────────

/** Renglón etiqueta→valor, el "pricebox" del HTML. */
function PriceRow({ l, v, tone, big, title }: { l: React.ReactNode; v: React.ReactNode; tone?: string; big?: boolean; title?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 py-1.5 last:border-0" title={title}>
      <span className="text-xs text-muted-foreground">{l}</span>
      <span className={cn('font-semibold tabular-nums text-right', big ? 'text-lg' : 'text-sm', tone)}>{v}</span>
    </div>
  );
}

/** Slider + valor editable + chips de preset — la perilla del HTML. */
function Perilla({ label, unit, value, onChange, min, max, step, chips, refs }: {
  label: string; unit: string;
  value: number; onChange: (v: number) => void;
  min: number; max: number; step: number;
  chips: Array<{ label: string; value: number; activo?: boolean }>;
  refs?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium">{label}</span>
        <span className="flex items-baseline gap-1">
          <Input
            inputMode="numeric"
            value={fmt0.format(value)}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/[.,\s]/g, ''));
              if (Number.isFinite(n) && n > 0) onChange(n);
            }}
            className="h-7 w-24 text-right font-mono font-bold tabular-nums text-base border-0 border-b rounded-none px-1 focus-visible:ring-0"
          />
          <span className="text-[10px] text-muted-foreground uppercase">{unit}</span>
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, value))}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary h-1.5"
      />
      <div className="flex items-center gap-1.5 flex-wrap">
        {chips.map((c) => (
          <button
            key={c.label} type="button" onClick={() => onChange(c.value)}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
              c.activo || value === c.value
                ? 'border-primary bg-primary/10 text-primary font-medium'
                : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      {refs && <p className="text-[10px] text-muted-foreground">{refs}</p>}
    </div>
  );
}

function Supuestos({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
        Qué asume este número ({items.length})
      </button>
      {open && (
        <ul className="mt-1.5 space-y-0.5">
          {items.map((t, i) => <li key={i} className="text-[11px] text-muted-foreground pl-4">· {t}</li>)}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────── la pestaña ───────────────────────────

export default function EscenariosTab({ pedidos, payRows, trmHoy, lmeHoy, lmeHistoria, hoy }: Props) {
  // ── Vigente (abierto con factura) y molde (último entregado) ──
  const enCurso = useMemo(
    () => pedidos.filter((p) => !['entregado', 'cerrado', 'cancelado'].includes(p.estado) && Number(p.monto_total_usd) > 0),
    [pedidos],
  );
  const [vigenteId, setVigenteId] = useState<string | null>(null);
  const vigente = enCurso.find((p) => p.id === vigenteId) ?? enCurso[0] ?? null;
  const molde = useMemo(
    () => pedidos
      .filter((p) => p.estado === 'entregado' || p.estado === 'cerrado')
      .sort((a, b) => (b.fechas.fecha_entregado ?? '').localeCompare(a.fechas.fecha_entregado ?? ''))[0] ?? null,
    [pedidos],
  );

  // ── Las tres perillas, numéricas de una ──
  const smmVigente = vigente?.precio_smm_cerrado_usd_ton != null ? Number(vigente.precio_smm_cerrado_usd_ton) : null;
  const smmMolde = molde?.precio_smm_cerrado_usd_ton != null ? Number(molde.precio_smm_cerrado_usd_ton) : null;
  const fleteVigente = fleteUsdDe(vigente?.costs);
  const fleteMolde = fleteUsdDe(molde?.costs);

  const [trm, setTrm] = useState<number | null>(null);
  const [smm, setSmm] = useState<number | null>(null);
  const [flete, setFlete] = useState<number | null>(null);
  const trmVal = trm ?? (trmHoy != null ? Math.round(trmHoy) : 3500);
  const smmVal = smm ?? Math.round(smmVigente ?? smmMolde ?? 3500);
  const fleteVal = flete ?? Math.round(fleteVigente ?? fleteMolde ?? 5700);
  const tocado = trm != null || smm != null || flete != null;
  const volverAHoy = () => { setTrm(null); setSmm(null); setFlete(null); };

  // SMM "reposición hoy": el del molde movido por el LME (lo que haría el
  // comparativo sin overrides) — para el chip.
  const smmReposicion = useMemo(() => {
    if (smmMolde == null || lmeHoy == null || !molde) return null;
    const fechaMolde = molde.fechas.fecha_entregado ?? molde.fechas.fecha_anticipo ?? null;
    if (!fechaMolde) return null;
    let lmeEntonces: number | null = null;
    for (const p of lmeHistoria) { if (p.date <= fechaMolde) lmeEntonces = p.value; else break; }
    if (lmeEntonces == null && lmeHistoria.length > 0) lmeEntonces = lmeHistoria[0].value;
    return lmeEntonces && lmeEntonces > 0 ? Math.round(smmMolde * (lmeHoy / lmeEntonces)) : null;
  }, [smmMolde, lmeHoy, lmeHistoria, molde]);

  // ── Motores ──
  const cmp = useMemo(() => {
    const overrides: EscenarioOverrides = { trm: trmVal, smmUsdTon: smmVal, fleteUsd: fleteVal };
    return buildComparativo({ pedidos, hoy, trmHoy, lmeHoy, lmeHistoria, overrides });
  }, [pedidos, hoy, trmHoy, lmeHoy, lmeHistoria, trmVal, smmVal, fleteVal]);
  const colSiguiente = cmp.columnas.find((c) => c.kind === 'hoy') ?? null;
  const colBase = cmp.columnas.find((c) => c.id === cmp.baseId) ?? null;

  const abonosVigente = useMemo(
    () => payRows
      .filter((p) => p.import_id === vigente?.id && Number(p.amount_usd) > 0 && Number(p.trm) > 0)
      .map((p) => ({ amount_usd: Number(p.amount_usd), trm: Number(p.trm), fecha: p.fecha ?? null }))
      .sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? '')),
    [payRows, vigente?.id],
  );
  const esc = useMemo(() => {
    if (!vigente || Number(vigente.monto_total_usd) <= 0) return null;
    return escenarioVigente({
      mercanciaUsd: Number(vigente.monto_total_usd),
      costs: vigente.costs,
      abonos: abonosVigente,
      trmSimulada: trmVal,
      arancelPct: Number(vigente.arancel_pct ?? 5),
      ivaPct: Number(vigente.iva_pct ?? 19),
      cantidadKg: vigente.cantidad_ton != null ? Number(vigente.cantidad_ton) * 1000 : null,
    });
  }, [vigente, abonosVigente, trmVal]);

  // TRM efectiva final del contenedor vigente (pagado a sus TRMs + saldo a la simulada)
  const trmEfectiva = esc && esc.totalUsd > 0
    ? (esc.pagadoCop + esc.saldoUsd * trmVal) / esc.totalUsd
    : null;
  const kgVigente = vigente?.cantidad_ton != null ? Number(vigente.cantidad_ton) * 1000 : null;

  // ── Convención del calculador (Nico): el total EXCLUYE el IVA — es caja,
  //    no costo. El motor de la app lo incluye en totalImportacionCop (así lo
  //    consumen otros módulos), acá se resta para presentar. ──
  const sinIva = (total: number | null, iva: number | null): number | null =>
    total == null ? null : total - (iva ?? 0);
  const totalVigenteSinIva = esc ? sinIva(esc.breakdown.totalImportacionCop, esc.breakdown.ivaCop) : null;
  const copKgVigente = totalVigenteSinIva != null && kgVigente ? totalVigenteSinIva / kgVigente : null;

  // Breakdown del MOLDE con sus datos reales (para total sin IVA y drivers).
  const bdMolde = useMemo(() => {
    if (!molde || molde.monto_total_usd == null) return null;
    return computeImportBreakdown({
      mercanciaUsd: Number(molde.monto_total_usd),
      costs: molde.costs,
      trm: molde.trm != null ? Number(molde.trm) : null,
      arancelPct: Number(molde.arancel_pct ?? 5),
      ivaPct: Number(molde.iva_pct ?? 19),
      cantidadKg: molde.cantidad_ton != null ? Number(molde.cantidad_ton) * 1000 : null,
    });
  }, [molde]);
  const totalMoldeSinIva = bdMolde ? sinIva(bdMolde.totalImportacionCop, bdMolde.ivaCop) : null;
  const copKgMoldeSinIva = totalMoldeSinIva != null && molde?.cantidad_ton
    ? totalMoldeSinIva / (Number(molde.cantidad_ton) * 1000) : null;

  // Breakdown del SIGUIENTE bajo las perillas (mismos costos del molde con el
  // flete reemplazado — la lógica de columnaHoy, para separar su IVA).
  const bdSiguiente = useMemo(() => {
    if (!colSiguiente?.mercanciaUsd || !molde) return null;
    const costsEff = [
      ...(molde.costs ?? []).filter((c) => c.tipo !== 'flete'),
      { tipo: 'flete', monto: fleteVal, moneda: 'USD', trm: null } as ImportCostLine,
    ];
    return computeImportBreakdown({
      mercanciaUsd: colSiguiente.mercanciaUsd,
      costs: costsEff,
      trm: trmVal,
      arancelPct: Number(molde.arancel_pct ?? 5),
      ivaPct: Number(molde.iva_pct ?? 19),
      cantidadKg: colSiguiente.toneladas != null ? colSiguiente.toneladas * 1000 : null,
    });
  }, [colSiguiente, molde, fleteVal, trmVal]);
  const totalSiguienteSinIva = bdSiguiente ? sinIva(bdSiguiente.totalImportacionCop, bdSiguiente.ivaCop) : null;
  const copKgSiguienteSinIva = totalSiguienteSinIva != null && colSiguiente?.toneladas
    ? totalSiguienteSinIva / (colSiguiente.toneladas * 1000) : null;

  // Mercancía en COP con la mixta (para el renglón)
  const mercanciaCopMixta = esc ? esc.pagadoCop + esc.saldoUsd * trmVal : null;
  const fleteSeguroCop = esc?.breakdown.cifCop != null && mercanciaCopMixta != null
    ? esc.breakdown.cifCop - mercanciaCopMixta : null;

  // ── Drivers vs molde ──
  const drivers = useMemo(() => {
    if (totalVigenteSinIva == null || totalMoldeSinIva == null || !molde || !vigente || !esc) return null;
    return driversDelta(
      {
        totalCop: totalMoldeSinIva,
        smmUsdTon: smmMolde,
        tons: molde.cantidad_ton != null ? Number(molde.cantidad_ton) : null,
        trm: molde.trm != null ? Number(molde.trm) : null,
        fleteUsd: fleteMolde,
        usdTotal: molde.monto_total_usd != null ? Number(molde.monto_total_usd) + (fleteMolde ?? 0) + seguroUsdDe(molde.costs) : null,
      },
      {
        totalCop: totalVigenteSinIva,
        smmUsdTon: smmVigente,
        tons: vigente.cantidad_ton != null ? Number(vigente.cantidad_ton) : null,
        trm: trmEfectiva,
        fleteUsd: fleteVigente,
        usdTotal: esc.totalUsd + (fleteVigente ?? 0) + seguroUsdDe(vigente.costs),
      },
    );
  }, [esc, totalVigenteSinIva, totalMoldeSinIva, molde, vigente, smmMolde, smmVigente, fleteMolde, fleteVigente, trmEfectiva]);

  // ── Sensibilidad del siguiente (analítica, exacta) ──
  const sens = useMemo(() => {
    if (!colSiguiente?.mercanciaUsd) return null;
    const usdTot = colSiguiente.mercanciaUsd + fleteVal + 110;
    const tons = colSiguiente.toneladas ?? 0;
    return {
      trm100: usdTot * 100,
      smm100: tons * 100 * trmVal,
      flete1000: 1000 * trmVal,
    };
  }, [colSiguiente, fleteVal, trmVal]);

  // ── Escalera del saldo ──
  const escalera = useMemo(() => {
    if (!esc || esc.saldoUsd <= 0) return [];
    const hoyR = trmHoy != null ? Math.round(trmHoy) : null;
    const set = new Set<number>([2950, 3000, 3100, 3200, 3300, 3400, 3500]);
    if (hoyR) set.add(hoyR);
    set.add(trmVal);
    const base = hoyR != null ? esc.saldoUsd * hoyR : null;
    return Array.from(set).sort((a, b) => a - b).map((t) => ({
      trm: t,
      cop: esc.saldoUsd * t,
      vsHoy: base != null ? esc.saldoUsd * t - base : null,
      esHoy: t === hoyR,
      esEscenario: t === trmVal && t !== hoyR,
    }));
  }, [esc, trmHoy, trmVal]);

  // ── Costo por referencia bajo el escenario (packing del vigente) ──
  const { landed, hayPacking } = useImportItems(vigente?.id ?? null, trmVal);
  const [verRefs, setVerRefs] = useState(false);
  const [buscar, setBuscar] = useState('');
  const refsFiltradas = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    const rows = landed?.items ?? [];
    const f = q
      ? rows.filter((r) => r.reference.toLowerCase().includes(q) || (r.descripcion ?? '').toLowerCase().includes(q))
      : rows;
    return [...f].sort((a, b) => b.landed_total_cop - a.landed_total_cop);
  }, [landed, buscar]);

  // ── Caja consolidada ──
  const caja = useMemo(() => {
    const rows = enCurso.map((p) => {
      const pagado = payRows
        .filter((x) => x.import_id === p.id && Number(x.amount_usd) > 0)
        .reduce((s, x) => s + Number(x.amount_usd), 0);
      const saldoUsd = Math.max(0, Number(p.monto_total_usd) - pagado);
      return { id: p.id, label: p.label, saldoUsd, saldoCop: saldoUsd * trmVal, giro: p.fechas.fecha_estimada_llegada ?? null };
    }).filter((r) => r.saldoUsd > 0);
    return { rows, totalUsd: rows.reduce((s, r) => s + r.saldoUsd, 0), totalCop: rows.reduce((s, r) => s + r.saldoCop, 0) };
  }, [enCurso, payRows, trmVal]);

  // ── Escenarios guardados (F4) ──
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
      import_id: vigente?.id ?? null, notas: notas.trim() || null,
      snapshot: {
        trmHoy,
        vigente: esc && vigente ? { label: vigente.label, saldoUsd: esc.saldoUsd, saldoCop: esc.saldoCopSimulado, cajaParaCerrar: esc.cajaParaCerrarCop } : null,
        siguiente: colSiguiente ? { totalCop: totalSiguienteSinIva, copPorKg: copKgSiguienteSinIva, mercanciaUsd: colSiguiente.mercanciaUsd, llegada: colSiguiente.fechaLlegada } : null,
      },
    }, { onSuccess: () => { setSaving(false); setNombre(''); setNotas(''); setVerGuardados(true); } });
  };
  const cargarEscenario = (sc: ImportScenario) => {
    if (sc.trm != null) setTrm(Math.round(sc.trm));
    if (sc.smm_usd_ton != null) setSmm(Math.round(sc.smm_usd_ton));
    if (sc.flete_usd != null) setFlete(Math.round(sc.flete_usd));
  };
  const confrontacion = (sc: ImportScenario): { trmReal: number; delta: number } | null => {
    if (!sc.import_id || sc.trm == null) return null;
    const pedido = pedidos.find((p) => p.id === sc.import_id);
    if (!pedido || !['entregado', 'cerrado'].includes(pedido.estado)) return null;
    const ab = payRows.filter((x) => x.import_id === sc.import_id && Number(x.amount_usd) > 0 && Number(x.trm) > 0);
    const u = ab.reduce((s, a) => s + Number(a.amount_usd), 0);
    if (u <= 0) return null;
    const trmReal = ab.reduce((s, a) => s + Number(a.amount_usd) * Number(a.trm), 0) / u;
    return { trmReal, delta: trmReal - sc.trm };
  };

  // ── La lectura (narrativa de drivers, como el HTML) ──
  const lectura = useMemo(() => {
    if (!drivers || !colBase) return null;
    const grandes = [...drivers.drivers].filter((d) => d.key !== 'residual').sort((a, b) => Math.abs(b.cop) - Math.abs(a.cop));
    const g = grandes[0];
    if (!g) return null;
    const dir = drivers.deltaTotalCop < 0 ? 'menos' : 'más';
    return `${vigente?.label ?? 'El vigente'} cuesta ${copM(drivers.deltaTotalCop)} (${pctS(drivers.deltaPctTotal)}) ${dir} que ${colBase.label}. El grueso es ${g.label.toLowerCase()}: ${copM(g.cop)} (${g.detalle}). Lo único vivo es la TRM del saldo — movela arriba y mirá cómo cambia todo.`;
  }, [drivers, colBase, vigente]);

  const deltaVigenteVsMolde = deltaPct(totalVigenteSinIva, totalMoldeSinIva);
  const avance = esc && esc.totalUsd > 0 ? Math.min(esc.pagadoUsd / esc.totalUsd, 1) * 100 : null;

  return (
    <div className="space-y-4">
      {/* ═══ Perillas — el corazón: jugar con los números ═══ */}
      <Card className="border-primary/25">
        <CardContent className="py-4 px-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Escenario</h3>
              <Badge variant="outline" className="text-[10px]">simulación — no toca la contabilidad</Badge>
            </div>
            <div className="flex items-center gap-1.5">
              {tocado && (
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" onClick={volverAHoy}>
                  <RotateCcw className="h-3.5 w-3.5" /> Volver a hoy
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => setSaving((v) => !v)}>
                <BookmarkPlus className="h-3.5 w-3.5" /> Guardar
              </Button>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-x-6 gap-y-4">
            <Perilla
              label="Dólar (TRM)" unit="COP/USD"
              value={trmVal} onChange={setTrm}
              min={2800} max={4300} step={1}
              chips={[
                ...(trmHoy != null ? [{ label: `Hoy (${num(trmHoy)})`, value: Math.round(trmHoy) }] : []),
                ...(trmHoy != null ? [{ label: `+100`, value: Math.round(trmHoy) + 100 }] : []),
                ...(trmHoy != null ? [{ label: `+250`, value: Math.round(trmHoy) + 250 }] : []),
                { label: '3.500', value: 3500 },
              ]}
              refs={molde?.trm != null ? `prom. logrado ${molde.label}: ${num(Number(molde.trm))}` : undefined}
            />
            <Perilla
              label="SMM (aluminio)" unit="USD/TON"
              value={smmVal} onChange={setSmm}
              min={2900} max={4500} step={5}
              chips={[
                ...(smmVigente != null ? [{ label: `${vigente?.label} ✓ (${num(smmVigente)})`, value: Math.round(smmVigente) }] : []),
                ...(smmReposicion != null ? [{ label: `Reposición hoy (≈${num(smmReposicion)})`, value: smmReposicion }] : []),
                ...(smmMolde != null ? [{ label: `${molde?.label} (${num(smmMolde)})`, value: Math.round(smmMolde) }] : []),
              ]}
              refs="el SMM cerrado manda sobre el LME cuando lo fijás acá"
            />
            <Perilla
              label="Flete" unit="USD"
              value={fleteVal} onChange={setFlete}
              min={2000} max={9000} step={50}
              chips={[
                ...(fleteVigente != null ? [{ label: `${vigente?.label} (${num(fleteVigente)})`, value: Math.round(fleteVigente) }] : []),
                ...(fleteMolde != null ? [{ label: `${molde?.label} (${num(fleteMolde)})`, value: Math.round(fleteMolde) }] : []),
                { label: 'Pesimista 7.000', value: 7000 },
              ]}
            />
          </div>

          {saving && (
            <div className="flex items-end gap-2 flex-wrap rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
              <div className="flex-1 min-w-[180px]">
                <label className="text-[11px] text-muted-foreground block mb-1">Nombre</label>
                <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: si el dólar toca 3.000" className="h-8 text-xs" autoFocus />
              </div>
              <div className="flex-[2] min-w-[220px]">
                <label className="text-[11px] text-muted-foreground block mb-1">Notas (opcional)</label>
                <Input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Por qué este escenario" className="h-8 text-xs" />
              </div>
              <Button size="sm" className="h-8 text-xs" onClick={handleGuardar} disabled={!nombre.trim() || save.isPending}>Guardar</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ Héroe vigente + de dónde sale la diferencia ═══ */}
      {vigente && esc ? (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          {/* ── Izquierda: el contenedor vigente ── */}
          <Card>
            <CardContent className="py-4 px-5 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Contenedor {vigente.label}
                </p>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">● en curso</Badge>
                  {enCurso.length > 1 && (
                    <select value={vigente.id} onChange={(e) => setVigenteId(e.target.value)}
                      className="h-6 rounded border border-input bg-background px-1.5 text-[11px]">
                      {enCurso.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  )}
                </div>
              </div>

              <div>
                <p className="text-4xl font-extrabold tabular-nums tracking-tight">
                  {cop(totalVigenteSinIva)}
                </p>
                {deltaVigenteVsMolde != null && colBase && (
                  <p className={cn('text-sm font-semibold mt-1', deltaVigenteVsMolde <= 0 ? 'text-success' : 'text-destructive')}>
                    {pctS(deltaVigenteVsMolde)} vs. {colBase.label} (${(Math.abs(totalMoldeSinIva ?? 0) / 1e6).toFixed(1).replace('.', ',')}M)
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  {kgVigente != null ? `${num(kgVigente)} kg · ` : ''}mercancía {usd(esc.totalUsd)} · flete {fleteVigente != null ? usd(fleteVigente) : '—'} · TRM efectiva {num(trmEfectiva)} · sin IVA
                </p>
              </div>

              <div>
                <PriceRow l={`Mercancía · ${usd(esc.totalUsd)}`} v={cop(mercanciaCopMixta)} />
                <PriceRow l="Flete + seguro" v={cop(fleteSeguroCop)} />
                <PriceRow
                  l={esc.breakdown.usaArancelReal ? 'Arancel (liquidación real)' : `Arancel ${Number(vigente.arancel_pct ?? 5)}%${esc.breakdown.pisoAplicado ? ' · sobre piso FOB' : ''}`}
                  v={cop(esc.breakdown.arancelCop)}
                  tone={esc.breakdown.usaArancelReal ? 'text-success' : undefined}
                />
                <PriceRow l="Aduanas + transporte + otros" v={cop(esc.breakdown.otrosCop)} />
                <PriceRow l={<b>COSTO TOTAL IMPORTADO {esc.breakdown.usaArancelReal && esc.breakdown.usaIvaReal ? '' : '(proy.)'} · sin IVA</b>} v={<b>{cop(totalVigenteSinIva)}</b>} big />
              </div>

              <div className="rounded-lg border border-amber-400/50 bg-amber-50/70 dark:bg-amber-950/20 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                    IVA importación {esc.breakdown.usaIvaReal ? '(real)' : 'estimado'} — caja, NO costo
                  </span>
                  <span className="text-lg font-bold tabular-nums text-amber-800 dark:text-amber-300">{cop(esc.breakdown.ivaCop)}</span>
                </div>
                <p className="text-[10px] text-amber-800/80 dark:text-amber-300/80 mt-1">
                  {Number(vigente.iva_pct ?? 19)}% sobre (base + arancel), con lo pagado a sus TRMs reales y el saldo a {num(trmVal)}.
                  Se recupera como descontable, pero hay que tener la caja el día de nacionalizar.
                </p>
              </div>

              <Supuestos items={esc.supuestos} />
            </CardContent>
          </Card>

          {/* ── Derecha: de dónde sale la diferencia ── */}
          <Card>
            <CardContent className="py-4 px-5 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {vigente.label} vs. {colBase?.label ?? 'anterior'} — de dónde sale la diferencia
              </p>

              {!drivers || !colBase ? (
                <p className="text-xs text-muted-foreground py-4">Falta un contenedor entregado para comparar.</p>
              ) : (
                <>
                  <div className="space-y-1">
                    <PriceRow l={`${colBase.label} (real, cerrado) · sin IVA`} v={cop(totalMoldeSinIva)} />
                    <PriceRow l={`${vigente.label} (proyectado) · sin IVA`} v={cop(totalVigenteSinIva)} />
                  </div>
                  <div className={cn('rounded-lg px-3 py-2 flex items-center justify-between',
                    drivers.deltaTotalCop <= 0 ? 'bg-success/10 border border-success/30' : 'bg-destructive/10 border border-destructive/30')}>
                    <span className={cn('text-xs font-semibold', drivers.deltaTotalCop <= 0 ? 'text-success' : 'text-destructive')}>
                      {drivers.deltaTotalCop <= 0 ? 'Cuesta menos' : 'Cuesta más'}
                    </span>
                    <span className={cn('text-base font-bold tabular-nums', drivers.deltaTotalCop <= 0 ? 'text-success' : 'text-destructive')}>
                      {copM(drivers.deltaTotalCop)} ({pctS(drivers.deltaPctTotal)})
                    </span>
                  </div>

                  <div className="space-y-2 pt-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Drivers</p>
                    {(() => {
                      const maxAbs = Math.max(...drivers.drivers.map((d) => Math.abs(d.cop)), 1);
                      return drivers.drivers.map((d) => (
                        <div key={d.key} className="space-y-0.5">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span>{d.label} <span className="text-[10px] text-muted-foreground">{d.detalle}</span></span>
                            <span className={cn('font-semibold tabular-nums shrink-0', d.cop <= 0 ? 'text-success' : 'text-destructive')}>
                              {copM(d.cop)}
                            </span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className={cn('h-full rounded-full', d.cop <= 0 ? 'bg-success' : 'bg-destructive')}
                              style={{ width: `${Math.max(3, (Math.abs(d.cop) / maxAbs) * 100)}%` }} />
                          </div>
                        </div>
                      ));
                    })()}
                  </div>

                  {copKgMoldeSinIva != null && copKgVigente != null && (
                    <div className="rounded-md border border-border px-3 py-2 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Costo por kilo · {colBase.label} {num(copKgMoldeSinIva)}</span>
                      <span className={cn('font-bold tabular-nums text-sm', copKgVigente <= copKgMoldeSinIva ? 'text-success' : 'text-destructive')}>
                        {num(copKgVigente)} COP/kg ({pctS((copKgVigente / copKgMoldeSinIva - 1) * 100)})
                      </span>
                    </div>
                  )}

                  {lectura && (
                    <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-2">
                      <b className="text-foreground">La lectura:</b> {lectura}
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">
          No hay pedido abierto con factura confirmada — cuando montes uno, acá vive su escenario.
        </CardContent></Card>
      )}

      {/* ═══ Lo único vivo: el dólar del saldo ═══ */}
      {vigente && esc && (
        <Card>
          <CardContent className="py-4 px-5 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Lo único vivo: el dólar del saldo de {vigente.label}
            </p>
            <div className="grid lg:grid-cols-2 gap-x-8 gap-y-3">
              <div className="space-y-1">
                <PriceRow l="USD que falta comprar" v={usd(esc.saldoUsd)} big
                  tone={esc.saldoUsd > 0 ? 'text-destructive' : 'text-success'} />
                <PriceRow l={`Ese saldo a la TRM del escenario (${num(trmVal)})`} v={cop(esc.saldoCopSimulado)} />
                <PriceRow l="Exposición viva · cada 100 pesos de TRM" v={`± ${copM(esc.saldoUsd * 100).replace('+', '')}`} />
                <PriceRow l="Caja para cerrar (saldo + impuestos pendientes)" v={cop(esc.cajaParaCerrarCop)} big />
              </div>
              <div className="space-y-1">
                <PriceRow l="Total abonado" v={`${usd(esc.pagadoUsd)} · ${cop(esc.pagadoCop)}`} />
                <PriceRow l="TRM ponderada de lo abonado" v={num(esc.trmPonderadaPagado)} />
                <PriceRow l="TRM efectiva final del contenedor" v={num(trmEfectiva)} big />
                <PriceRow l="Avance del pago" v={avance != null ? `${avance.toFixed(0)}%` : '—'} />
                {molde?.trm != null && trmEfectiva != null && (
                  <div className={cn('rounded-md px-3 py-2 text-xs mt-1',
                    trmEfectiva <= Number(molde.trm) ? 'bg-success/10 text-success' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300')}>
                    {trmEfectiva <= Number(molde.trm)
                      ? `Así, tu dólar final queda en ${num(trmEfectiva)} — mejor que el ${num(Number(molde.trm))} de ${molde.label}. Cada abono a esta TRM lo asegura.`
                      : `Ojo: comprando el saldo a ${num(trmVal)}, tu dólar final (${num(trmEfectiva)}) queda peor que el ${num(Number(molde.trm))} de ${molde.label}.`}
                  </div>
                )}
              </div>
            </div>

            {/* Abonos reales + escalera */}
            <div className="grid lg:grid-cols-2 gap-x-8 gap-y-3 pt-1">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Abonos reales ({abonosVigente.length}) — se cargan en el pedido, acá se leen
                </p>
                {abonosVigente.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sin abonos todavía — todo el contenedor está expuesto a la TRM.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border">
                        <th className="py-1 pr-2 font-medium">Fecha</th>
                        <th className="py-1 pr-2 font-medium text-right">USD</th>
                        <th className="py-1 pr-2 font-medium text-right">TRM</th>
                        <th className="py-1 font-medium text-right">COP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {abonosVigente.map((a, i) => (
                        <tr key={i} className="border-b border-border/40">
                          <td className="py-1 pr-2">{a.fecha ?? '—'}</td>
                          <td className="py-1 pr-2 text-right font-mono tabular-nums">{num(a.amount_usd)}</td>
                          <td className="py-1 pr-2 text-right font-mono tabular-nums">{num(a.trm)}</td>
                          <td className="py-1 text-right font-mono tabular-nums">{cop(a.amount_usd * a.trm)}</td>
                        </tr>
                      ))}
                      <tr className="font-semibold">
                        <td className="py-1.5 pr-2">Total</td>
                        <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{num(esc.pagadoUsd)}</td>
                        <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{num(esc.trmPonderadaPagado)}</td>
                        <td className="py-1.5 text-right font-mono tabular-nums">{cop(esc.pagadoCop)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
              {escalera.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                    Si el dólar se mueve, el saldo te cuesta:
                  </p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b border-border">
                        <th className="py-1 pr-2 font-medium">TRM</th>
                        <th className="py-1 pr-2 font-medium text-right">COP del saldo</th>
                        <th className="py-1 font-medium text-right">vs. hoy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {escalera.map((r) => (
                        <tr key={r.trm} className={cn('border-b border-border/40',
                          r.esHoy && 'bg-destructive/5 font-bold', r.esEscenario && 'bg-primary/5 font-semibold')}>
                          <td className="py-1 pr-2">{num(r.trm)}{r.esHoy ? ' · hoy' : r.esEscenario ? ' · escenario' : ''}</td>
                          <td className="py-1 pr-2 text-right font-mono tabular-nums">{cop(r.cop)}</td>
                          <td className={cn('py-1 text-right font-mono tabular-nums',
                            r.vsHoy != null && r.vsHoy > 0 ? 'text-destructive' : r.vsHoy != null && r.vsHoy < 0 ? 'text-success' : 'text-muted-foreground')}>
                            {r.esHoy || r.vsHoy == null ? '—' : copM(r.vsHoy)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Lo ya abonado no se mueve: quedó blindado a su TRM. Solo el saldo respira.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ Simulador — el contenedor que sigue ═══ */}
      {colSiguiente && (
        <Card>
          <CardContent className="py-4 px-5 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Simulador — el contenedor que sigue (con las perillas de arriba)
            </p>
            <div className="grid lg:grid-cols-2 gap-x-8 gap-y-3 items-start">
              <div className="space-y-1">
                <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                  <p className="text-3xl font-extrabold tabular-nums tracking-tight">{cop(totalSiguienteSinIva)}</p>
                  {(() => {
                    const d = deltaPct(totalSiguienteSinIva, totalMoldeSinIva);
                    return d != null && colBase ? (
                      <p className={cn('text-sm font-semibold mt-0.5', d <= 0 ? 'text-success' : 'text-destructive')}>
                        {pctS(d)} vs. {colBase.label}
                      </p>
                    ) : null;
                  })()}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    mercancía {usd(colSiguiente.mercanciaUsd)} · SMM {num(colSiguiente.precioUsdTon)} · {num(colSiguiente.toneladas)} t ·
                    llega ≈ {colSiguiente.fechaLlegada ?? '—'} ({colSiguiente.etapas.total ?? '—'}d)
                  </p>
                </div>
                <PriceRow l="Costo por kilo (sin IVA)" v={`${num(copKgSiguienteSinIva)} COP/kg`} big
                  tone={copKgMoldeSinIva != null && copKgSiguienteSinIva != null ? (copKgSiguienteSinIva <= copKgMoldeSinIva ? 'text-success' : 'text-destructive') : undefined} />
                <PriceRow l="IVA de ese contenedor (caja aparte)" v={cop(bdSiguiente?.ivaCop ?? null)} tone="text-amber-700 dark:text-amber-400" />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sensibilidad — impacto por movimiento</p>
                {sens && (
                  <>
                    <PriceRow l="Dólar ±100 pesos" v={`± ${copM(sens.trm100).replace('+', '')}`} />
                    <PriceRow l="SMM ±100 USD/ton" v={`± ${copM(sens.smm100).replace('+', '')}`} />
                    <PriceRow l="Flete ±1.000 USD" v={`± ${copM(sens.flete1000).replace('+', '')}`} />
                  </>
                )}
                <div className="pt-1"><Supuestos items={colSiguiente.supuestos} /></div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ Costo por referencia bajo el escenario ═══ */}
      {vigente && hayPacking && (landed?.items.length ?? 0) > 0 && (
        <Card>
          <CardContent className="py-4 px-5 space-y-2">
            <button type="button" onClick={() => setVerRefs((v) => !v)} className="flex items-center gap-2 text-sm font-semibold w-full text-left">
              <ChevronDown className={cn('h-4 w-4 transition-transform', verRefs && 'rotate-180')} />
              Costo por referencia bajo este escenario ({landed!.items.length} ítems · TRM {num(trmVal)})
            </button>
            {verRefs && (
              <>
                <div className="relative max-w-xs">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar referencia o descripción…" className="h-8 pl-8 text-xs" />
                </div>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60">
                      <tr className="text-left">
                        <th className="px-3 py-1.5 font-semibold">Ref</th>
                        <th className="px-3 py-1.5 font-semibold">Descripción</th>
                        <th className="px-3 py-1.5 font-semibold text-right">Cant.</th>
                        <th className="px-3 py-1.5 font-semibold text-right">Costo unit. (proy.)</th>
                        <th className="px-3 py-1.5 font-semibold text-right">Total landed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {refsFiltradas.slice(0, 150).map((r) => (
                        <tr key={r.id} className="border-t border-border/50 hover:bg-muted/30">
                          <td className="px-3 py-1 font-mono font-medium">{r.reference}</td>
                          <td className="px-3 py-1 text-muted-foreground">{r.descripcion ?? '—'}</td>
                          <td className="px-3 py-1 text-right tabular-nums">{num(r.cantidad)}</td>
                          <td className="px-3 py-1 text-right font-mono tabular-nums font-semibold">{cop(r.landed_unit_cop)}</td>
                          <td className="px-3 py-1 text-right font-mono tabular-nums text-muted-foreground">{cop(r.landed_total_cop)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {refsFiltradas.length > 150 && (
                    <p className="px-3 py-1.5 text-[10px] text-muted-foreground">Mostrando 150 de {refsFiltradas.length} — usá el buscador.</p>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Landed = mercancía + flete + arancel + agencia prorrateados (el IVA va aparte: es descontable).
                  Recalcula en vivo con la TRM del escenario. Las variaciones vs contenedores pasados viven en Análisis de precios.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══ Caja que necesito ═══ */}
      <Card>
        <CardContent className="py-4 px-5 space-y-2.5">
          <div className="flex items-center gap-2">
            <PiggyBank className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold">Caja que necesito (todos los pedidos abiertos)</h4>
          </div>
          {caja.rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin saldos abiertos — todo lo pedido está pagado.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-medium">Pedido</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Saldo USD</th>
                  <th className="py-1.5 pr-3 font-medium text-right">COP a TRM {num(trmVal)}</th>
                  <th className="py-1.5 font-medium">Girar antes de</th>
                </tr>
              </thead>
              <tbody>
                {caja.rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="py-1.5 pr-3">{r.label}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{num(r.saldoUsd)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{cop(r.saldoCop)}</td>
                    <td className="py-1.5 text-muted-foreground">{r.giro ? `≈ ${r.giro} (llegada est.)` : 'sin fecha'}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2 pr-3">Total</td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">{num(caja.totalUsd)}</td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">{cop(caja.totalCop)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* ═══ Escenarios guardados ═══ */}
      {scenarios.length > 0 && (
        <Card>
          <CardContent className="py-4 px-5 space-y-2">
            <button type="button" onClick={() => setVerGuardados((v) => !v)}
              className="flex items-center gap-2 text-sm font-semibold w-full text-left">
              <ChevronDown className={cn('h-4 w-4 transition-transform', verGuardados && 'rotate-180')} />
              Escenarios guardados ({scenarios.length})
            </button>
            {verGuardados && (
              <div className="space-y-1.5 pt-1">
                {scenarios.map((sc) => {
                  const conf = confrontacion(sc);
                  return (
                    <div key={sc.id} className="rounded-lg border border-border/60 px-3 py-2 flex items-center gap-3 flex-wrap text-xs">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{sc.nombre}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(sc.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                          {sc.snapshot?.vigente?.label ? ` · ${sc.snapshot.vigente.label}` : ''}
                          {sc.notas ? ` · ${sc.notas}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {sc.trm != null && <Badge variant="secondary" className="text-[10px] font-mono">TRM {num(sc.trm)}</Badge>}
                        {sc.smm_usd_ton != null && <Badge variant="secondary" className="text-[10px] font-mono">SMM {num(sc.smm_usd_ton)}</Badge>}
                        {sc.flete_usd != null && <Badge variant="secondary" className="text-[10px] font-mono">Flete {num(sc.flete_usd)}</Badge>}
                        {sc.snapshot?.vigente?.cajaParaCerrar != null && (
                          <Badge variant="outline" className="text-[10px] font-mono" title="Caja para cerrar que daba al guardarlo">
                            {cop(sc.snapshot.vigente.cajaParaCerrar)}
                          </Badge>
                        )}
                        {conf && (
                          <Badge variant="outline"
                            className={cn('text-[10px] font-mono gap-1',
                              conf.delta > 50 ? 'bg-destructive/10 text-destructive border-destructive/30' : 'bg-success/15 text-success border-success/30')}
                            title={`El pedido cerró: TRM ponderada real ${num(conf.trmReal)} vs ${num(sc.trm)} de tu escenario`}>
                            <CheckCircle2 className="h-3 w-3" />
                            Real: {num(conf.trmReal)} ({conf.delta >= 0 ? '+' : ''}{num(conf.delta)})
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" onClick={() => cargarEscenario(sc)}
                          title="Poner estas perillas en el escenario">
                          <Upload className="h-3 w-3" /> Cargar
                        </Button>
                        <button type="button"
                          onClick={() => { if (window.confirm(`¿Borrar el escenario "${sc.nombre}"?`)) remove.mutate(sc.id); }}
                          className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                <p className="text-[10px] text-muted-foreground">
                  Cuando el contenedor de un escenario cierre, acá aparece la TRM real lograda contra la que asumiste.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
