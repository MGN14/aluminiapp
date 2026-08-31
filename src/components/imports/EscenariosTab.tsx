/**
 * Pestaña ESCENARIOS — "lo real", no la contabilidad (Nico, 2026-08-31).
 *
 * Tres perillas (TRM · SMM · flete) sobre dos contenedores a la vez:
 *   · VIGENTE: el pedido abierto — cuánta caja falta para cerrarlo y cómo
 *     quedan arancel/IVA con lo pagado a sus TRMs reales + saldo a la TRM
 *     del escenario (TRM mixta, lib/importScenario).
 *   · SIGUIENTE: "si lo monto hoy" — columnaHoy de lib/importComparison con
 *     los overrides del escenario.
 *
 * REGLAS: solo lectura (jamás escribe en imports/import_costs/import_payments/
 * transactions), no crea pedidos, y todo supuesto queda declarado en pantalla.
 */

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FlaskConical, RotateCcw, Ship, Wallet, ChevronDown, PiggyBank } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildComparativo, deltaPct,
  type PedidoComparable, type EscenarioOverrides,
} from '@/lib/importComparison';
import { escenarioVigente } from '@/lib/importScenario';
import type { ImportCostLine } from '@/lib/importCosting';

const fmtCop = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
const fmtUsd = (n: number | null | undefined) =>
  n == null ? '—' : `US$ ${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n)}`;
const fmtNum = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);

const fleteUsdDe = (costs: ImportCostLine[] | undefined): number | null => {
  const usd = (costs ?? [])
    .filter((c) => c.tipo === 'flete' && (c.moneda ?? 'USD') === 'USD')
    .reduce((s, c) => s + (Number(c.monto) || 0), 0);
  return usd > 0 ? usd : null;
};

interface PayRow { import_id: string; amount_usd: number | null; trm: number | null }

interface Props {
  pedidos: PedidoComparable[];
  payRows: PayRow[];
  trmHoy: number | null;
  lmeHoy: number | null;
  lmeHistoria: Array<{ date: string; value: number }>;
  hoy: string;
}

function Dato({ label, value, sub, tone, big }: {
  label: string; value: string; sub?: string; tone?: string; big?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground truncate">{label}</p>
      <p className={cn('font-semibold tabular-nums tracking-tight', big ? 'text-xl' : 'text-sm', tone)}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground truncate">{sub}</p>}
    </div>
  );
}

function Supuestos({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className="pt-1">
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

export default function EscenariosTab({ pedidos, payRows, trmHoy, lmeHoy, lmeHistoria, hoy }: Props) {
  // ── Pedido vigente (abierto con factura) y molde (último entregado) ──
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

  // ── Las tres perillas. Defaults: TRM de hoy · SMM del vigente (o molde) ·
  //    flete del vigente (o molde). "Volver a hoy" las resetea. ──
  const defaults = useMemo(() => ({
    trm: trmHoy != null ? String(Math.round(trmHoy)) : '',
    smm: (() => {
      const v = vigente?.precio_smm_cerrado_usd_ton ?? molde?.precio_smm_cerrado_usd_ton;
      return v != null ? String(Math.round(Number(v))) : '';
    })(),
    flete: (() => {
      const v = fleteUsdDe(vigente?.costs) ?? fleteUsdDe(molde?.costs);
      return v != null ? String(Math.round(v)) : '';
    })(),
  }), [trmHoy, vigente, molde]);

  const [trmStr, setTrmStr] = useState<string | null>(null);
  const [smmStr, setSmmStr] = useState<string | null>(null);
  const [fleteStr, setFleteStr] = useState<string | null>(null);
  const trmVal = trmStr ?? defaults.trm;
  const smmVal = smmStr ?? defaults.smm;
  const fleteVal = fleteStr ?? defaults.flete;
  const tocado = trmStr != null || smmStr != null || fleteStr != null;
  const volverAHoy = () => { setTrmStr(null); setSmmStr(null); setFleteStr(null); };

  const parse = (s: string): number | null => {
    const n = Number(s.replace(/[.,\s]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const overrides: EscenarioOverrides = {
    trm: parse(trmVal),
    smmUsdTon: parse(smmVal),
    fleteUsd: parse(fleteVal),
  };

  // ── SIGUIENTE: el motor de comparación con los overrides ──
  const cmp = useMemo(() => buildComparativo({
    pedidos, hoy, trmHoy, lmeHoy, lmeHistoria, overrides,
  }), [pedidos, hoy, trmHoy, lmeHoy, lmeHistoria, overrides.trm, overrides.smmUsdTon, overrides.fleteUsd]);
  const colSiguiente = cmp.columnas.find((c) => c.kind === 'hoy') ?? null;
  const colBase = cmp.columnas.find((c) => c.id === cmp.baseId) ?? null;
  const dTotal = deltaPct(colSiguiente?.totalCop ?? null, colBase?.totalCop ?? null);

  // ── VIGENTE: saldo + impuestos con TRM mixta ──
  const abonosVigente = useMemo(
    () => payRows
      .filter((p) => p.import_id === vigente?.id && Number(p.amount_usd) > 0 && Number(p.trm) > 0)
      .map((p) => ({ amount_usd: Number(p.amount_usd), trm: Number(p.trm) })),
    [payRows, vigente?.id],
  );
  const esc = useMemo(() => {
    if (!vigente || Number(vigente.monto_total_usd) <= 0) return null;
    return escenarioVigente({
      mercanciaUsd: Number(vigente.monto_total_usd),
      costs: vigente.costs,
      abonos: abonosVigente,
      trmSimulada: overrides.trm ?? trmHoy,
      arancelPct: Number(vigente.arancel_pct ?? 5),
      ivaPct: Number(vigente.iva_pct ?? 19),
      cantidadKg: vigente.cantidad_ton != null ? Number(vigente.cantidad_ton) * 1000 : null,
    });
  }, [vigente, abonosVigente, overrides.trm, trmHoy]);

  // ── Caja consolidada: saldo de TODOS los pedidos abiertos a la TRM simulada ──
  const caja = useMemo(() => {
    const trm = overrides.trm ?? trmHoy;
    const rows = enCurso.map((p) => {
      const pagado = payRows
        .filter((x) => x.import_id === p.id && Number(x.amount_usd) > 0)
        .reduce((s, x) => s + Number(x.amount_usd), 0);
      const saldoUsd = Math.max(0, Number(p.monto_total_usd) - pagado);
      return {
        id: p.id, label: p.label, saldoUsd,
        saldoCop: trm != null ? saldoUsd * trm : null,
        giro: p.fechas.fecha_estimada_llegada ?? null,
      };
    }).filter((r) => r.saldoUsd > 0);
    return {
      rows,
      totalUsd: rows.reduce((s, r) => s + r.saldoUsd, 0),
      totalCop: rows.reduce((s, r) => s + (r.saldoCop ?? 0), 0),
    };
  }, [enCurso, payRows, overrides.trm, trmHoy]);

  return (
    <div className="space-y-4">
      {/* ── Cabecera + perillas ── */}
      <Card>
        <CardContent className="py-4 px-5 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Escenarios</h3>
              <Badge variant="outline" className="text-[10px]">
                Simulación — no toca la contabilidad ni crea pedidos
              </Badge>
            </div>
            {tocado && (
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5" onClick={volverAHoy}>
                <RotateCcw className="h-3.5 w-3.5" /> Volver a hoy
              </Button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3 max-w-xl">
            <div>
              <label className="text-[11px] text-muted-foreground block mb-1">
                TRM (COP/USD){trmHoy != null && ` · hoy ${fmtNum(trmHoy)}`}
              </label>
              <Input inputMode="numeric" value={trmVal} onChange={(e) => setTrmStr(e.target.value)}
                className={cn('h-9 font-mono tabular-nums', trmStr != null && 'border-primary')} />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground block mb-1">SMM (USD/ton)</label>
              <Input inputMode="numeric" value={smmVal} onChange={(e) => setSmmStr(e.target.value)}
                className={cn('h-9 font-mono tabular-nums', smmStr != null && 'border-primary')} />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground block mb-1">Flete (USD)</label>
              <Input inputMode="numeric" value={fleteVal} onChange={(e) => setFleteStr(e.target.value)}
                className={cn('h-9 font-mono tabular-nums', fleteStr != null && 'border-primary')} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {/* ── VIGENTE ── */}
        <Card>
          <CardContent className="py-4 px-5 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-primary" />
                <h4 className="text-sm font-semibold">Contenedor vigente</h4>
              </div>
              {enCurso.length > 1 && (
                <select
                  value={vigente?.id ?? ''}
                  onChange={(e) => setVigenteId(e.target.value)}
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                >
                  {enCurso.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              )}
            </div>

            {!vigente || !esc ? (
              <p className="text-xs text-muted-foreground py-4">
                No hay pedido abierto con factura confirmada. Cuando montes uno, acá vive su saldo.
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">{vigente.label} · factura {fmtUsd(esc.totalUsd)}</p>

                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Dato label="Ya pagado" value={fmtUsd(esc.pagadoUsd)}
                    sub={esc.pagadoUsd > 0 ? `${fmtCop(esc.pagadoCop)} · TRM prom. ${fmtNum(esc.trmPonderadaPagado)}` : 'sin abonos aún'} />
                  <Dato label="Saldo en USD" value={fmtUsd(esc.saldoUsd)}
                    sub={`a TRM ${fmtNum(overrides.trm ?? trmHoy)}`} />
                  <Dato label="Saldo en COP (escenario)" value={fmtCop(esc.saldoCopSimulado)} big
                    tone={esc.saldoUsd > 0 ? 'text-foreground' : 'text-success'} />
                  <Dato label="Caja para cerrar el contenedor" value={fmtCop(esc.cajaParaCerrarCop)} big
                    sub="saldo + impuestos pendientes" />
                </div>

                <div className="rounded-md border border-border bg-muted/20 px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <Dato label={esc.breakdown.usaArancelReal ? 'Arancel (real cargado)' : 'Arancel estimado'}
                    value={fmtCop(esc.breakdown.arancelCop)}
                    tone={esc.breakdown.usaArancelReal ? 'text-success' : undefined} />
                  <Dato label={esc.breakdown.usaIvaReal ? 'IVA importación (real)' : 'IVA importación estimado'}
                    value={fmtCop(esc.breakdown.ivaCop)}
                    sub={esc.breakdown.usaIvaReal ? undefined : `19% sobre base mixta + arancel`}
                    tone={esc.breakdown.usaIvaReal ? 'text-success' : undefined} />
                  {esc.breakdown.pisoAplicado && (
                    <p className="col-span-2 text-[10px] text-amber-700 dark:text-amber-400">
                      Impuestos sobre el piso FOB ({esc.breakdown.pisoFobUsdKg} USD/kg) — el precio real quedó por debajo.
                    </p>
                  )}
                </div>

                <Supuestos items={esc.supuestos} />
              </>
            )}
          </CardContent>
        </Card>

        {/* ── SIGUIENTE ── */}
        <Card>
          <CardContent className="py-4 px-5 space-y-3">
            <div className="flex items-center gap-2">
              <Ship className="h-4 w-4 text-primary" />
              <h4 className="text-sm font-semibold">Contenedor siguiente (si lo monto hoy)</h4>
            </div>

            {!colSiguiente ? (
              <p className="text-xs text-muted-foreground py-4">
                {cmp.vacio ?? 'Falta un pedido entregado para usar de molde.'}
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Molde: {colBase?.label ?? 'último entregado'} · {fmtNum(colSiguiente.toneladas)} t
                </p>

                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Dato label="Mercancía" value={fmtUsd(colSiguiente.mercanciaUsd)}
                    sub={`SMM ${fmtNum(colSiguiente.precioUsdTon)} USD/ton`} />
                  <Dato label="Llegaría" value={colSiguiente.fechaLlegada ?? '—'}
                    sub={`${colSiguiente.etapas.total ?? '—'} días desde hoy`} />
                  <Dato label="Total nacionalizado" value={fmtCop(colSiguiente.totalCop)} big />
                  <Dato label="Costo por kg" value={fmtCop(colSiguiente.copPorKg)} big
                    sub={dTotal != null && colBase ? `${dTotal >= 0 ? '+' : ''}${dTotal.toFixed(1)}% vs ${colBase.label}` : undefined}
                    tone={dTotal == null ? undefined : dTotal > 0.5 ? 'text-destructive' : dTotal < -0.5 ? 'text-success' : undefined} />
                </div>

                <Supuestos items={colSiguiente.supuestos} />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Caja que necesito (consolidado) ── */}
      <Card>
        <CardContent className="py-4 px-5 space-y-3">
          <div className="flex items-center gap-2">
            <PiggyBank className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold">Caja que necesito (todos los pedidos abiertos)</h4>
          </div>
          {caja.rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin saldos abiertos — todo lo pedido está pagado. 🎉</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-1.5 pr-3 font-medium">Pedido</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Saldo USD</th>
                    <th className="py-1.5 pr-3 font-medium text-right">COP a TRM {fmtNum(overrides.trm ?? trmHoy)}</th>
                    <th className="py-1.5 font-medium">Girar antes de</th>
                  </tr>
                </thead>
                <tbody>
                  {caja.rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-3">{r.label}</td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{fmtUsd(r.saldoUsd)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{fmtCop(r.saldoCop)}</td>
                      <td className="py-1.5 text-muted-foreground">
                        {r.giro ? `≈ ${r.giro} (llegada estimada)` : 'sin fecha estimada'}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-2 pr-3">Total</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmtUsd(caja.totalUsd)}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmtCop(caja.totalCop)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Solo mercancía (los abonos pagan la factura). El arancel y el IVA del vigente están en su card,
                y se pagan en la nacionalización.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
