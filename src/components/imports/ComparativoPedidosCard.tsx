import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GitCompareArrows, TrendingUp, TrendingDown, Minus, Info, CalendarClock } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';
import { useImports, type ImportRow } from '@/hooks/useImports';
import { useMacroIndicators } from '@/hooks/useMacroIndicators';
import { fetchTrmForDate } from '@/hooks/useImportPayments';
import {
  buildComparativo,
  deltaPct,
  type ColumnaComparativo,
  type PedidoComparable,
} from '@/lib/importComparison';

const fmtCop = (n: number | null) =>
  n == null ? '—' : new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
const fmtUsd = (n: number | null) =>
  n == null ? '—' : `US$ ${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n)}`;
const fmtNum = (n: number | null, dec = 0) =>
  n == null ? '—' : new Intl.NumberFormat('es-CO', { maximumFractionDigits: dec }).format(n);
const fmtDias = (n: number | null) => (n == null ? '—' : `${n} d`);
const fmtFecha = (iso: string | null) =>
  !iso ? '—' : format(parseLocalDate(iso), 'd MMM yyyy', { locale: es });

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Delta contra el último entregado. Para costos, subir es malo (rojo). */
function Delta({ pct, invertirColor = false }: { pct: number | null; invertirColor?: boolean }) {
  if (pct == null || Math.abs(pct) < 0.05) {
    return <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground"><Minus className="h-3 w-3" />0%</span>;
  }
  const sube = pct > 0;
  const malo = invertirColor ? !sube : sube;
  const Icon = sube ? TrendingUp : TrendingDown;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[10px] font-medium', malo ? 'text-destructive' : 'text-success')}>
      <Icon className="h-3 w-3" />
      {sube ? '+' : ''}{pct.toFixed(1)}%
    </span>
  );
}

function toComparable(r: ImportRow, trm: number | null): PedidoComparable {
  const fechaDe = (estado: string) => (r.import_estado_history ?? []).find((x) => x.estado === estado)?.fecha ?? null;
  const yaEntregada = r.estado === 'entregado' || r.estado === 'cerrado';
  return {
    id: r.id,
    label: r.ref_pedido || r.proveedor_nombre || 'Pedido',
    estado: r.estado,
    cantidad_ton: r.cantidad_ton,
    precio_smm_cerrado_usd_ton: r.precio_smm_cerrado_usd_ton,
    monto_total_usd: r.monto_total_usd,
    trm,
    arancel_pct: r.arancel_pct,
    iva_pct: r.iva_pct,
    costs: r.import_costs,
    fechas: {
      estado: r.estado,
      fecha_anticipo: fechaDe('produccion') ?? r.fecha_anticipo,
      fecha_embarque: fechaDe('transito') ?? r.fecha_embarque,
      fecha_estimada_llegada: r.fecha_estimada_llegada,
      fecha_arribo_real: fechaDe('aduana') ?? r.fecha_arribo_real,
      fecha_entregado: fechaDe('entregado') ?? (yaEntregada ? r.fecha_arribo_real : null),
      fecha_listo_fabrica: fechaDe('listo_fabrica'),
    },
  };
}

/**
 * "El actual vs lo que viene vs si pido hoy" — costo y tiempo en la misma
 * tabla. Las columnas son pedidos, las filas son métricas: así se lee de
 * corrido cuál sale más caro y cuál llega antes.
 */
export default function ComparativoPedidosCard() {
  const { data } = useImports();
  const { indicators } = useMacroIndicators();
  const [verSupuestos, setVerSupuestos] = useState(false);

  const { data: trmHoy = null } = useQuery({
    queryKey: ['trm-hoy'],
    queryFn: () => fetchTrmForDate(todayIso()),
    staleTime: 60 * 60_000,
  });

  const lme = indicators.find((i) => i.type === 'aluminio_lme') ?? null;

  const comparativo = useMemo(() => {
    const rows = data?.all ?? [];
    return buildComparativo({
      pedidos: rows.map((r) => toComparable(r, r.trm_causacion ? Number(r.trm_causacion) : trmHoy)),
      hoy: todayIso(),
      trmHoy,
      lmeHoy: lme?.value ?? null,
      lmeHistoria: lme?.history ?? [],
    });
  }, [data, trmHoy, lme]);

  const { columnas, baseId, leadTime } = comparativo;
  const base = columnas.find((c) => c.id === baseId) ?? null;
  const hoyCol = columnas.find((c) => c.kind === 'hoy') ?? null;

  if (columnas.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4 text-muted-foreground" />
            Comparativo de pedidos
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">{comparativo.vacio}</p>
        </CardContent>
      </Card>
    );
  }

  const filas: Array<{
    label: string;
    hint?: string;
    seccion?: boolean;
    valor: (c: ColumnaComparativo) => string;
    delta?: (c: ColumnaComparativo) => number | null;
    /** Para tiempos: menos días es mejor → el verde va al que baja. */
    invertirColor?: boolean;
    destacar?: boolean;
  }> = [
    { label: 'Costo', seccion: true, valor: () => '' },
    { label: 'Toneladas', valor: (c) => (c.toneladas == null ? '—' : `${fmtNum(c.toneladas, 1)} t`) },
    {
      label: 'Precio aluminio',
      hint: 'USD por tonelada cerrado con el proveedor',
      valor: (c) => (c.precioUsdTon == null ? '—' : `${fmtNum(c.precioUsdTon)} USD/t`),
      delta: (c) => deltaPct(c.precioUsdTon, base?.precioUsdTon ?? null),
    },
    {
      label: 'Mercancía FOB',
      valor: (c) => fmtUsd(c.mercanciaUsd),
      delta: (c) => deltaPct(c.mercanciaUsd, base?.mercanciaUsd ?? null),
    },
    {
      label: 'TRM',
      valor: (c) => (c.trm == null ? '—' : fmtNum(c.trm)),
      delta: (c) => deltaPct(c.trm, base?.trm ?? null),
    },
    {
      label: 'Total nacionalizado',
      hint: 'Mercancía + flete + seguro + arancel + IVA + agencia',
      valor: (c) => fmtCop(c.totalCop),
      delta: (c) => deltaPct(c.totalCop, base?.totalCop ?? null),
    },
    {
      label: 'Costo por kilo',
      hint: 'Total nacionalizado ÷ kilos. Es la cifra comparable entre pedidos de distinto tamaño.',
      valor: (c) => (c.copPorKg == null ? '—' : `${fmtCop(c.copPorKg)}/kg`),
      delta: (c) => deltaPct(c.copPorKg, base?.copPorKg ?? null),
      destacar: true,
    },
    { label: 'Tiempos', seccion: true, valor: () => '' },
    {
      label: 'Producción',
      valor: (c) => fmtDias(c.etapas.produccion),
      delta: (c) => deltaPct(c.etapas.produccion, base?.etapas.produccion ?? null),
      invertirColor: true,
    },
    {
      label: 'Tránsito',
      valor: (c) => fmtDias(c.etapas.transito),
      delta: (c) => deltaPct(c.etapas.transito, base?.etapas.transito ?? null),
      invertirColor: true,
    },
    {
      label: 'Nacionalización',
      valor: (c) => fmtDias(c.etapas.nacionalizacion),
      delta: (c) => deltaPct(c.etapas.nacionalizacion, base?.etapas.nacionalizacion ?? null),
      invertirColor: true,
    },
    {
      label: 'Total puerta a puerta',
      valor: (c) => fmtDias(c.etapas.total),
      delta: (c) => deltaPct(c.etapas.total, base?.etapas.total ?? null),
      invertirColor: true,
      destacar: true,
    },
    {
      label: 'En bodega',
      hint: 'Fecha real de entrega, o estimada para lo que está en curso',
      valor: (c) => fmtFecha(c.fechaLlegada) + (c.fechaLlegadaEstimada ? ' ≈' : ''),
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <GitCompareArrows className="h-4 w-4 text-muted-foreground" />
              Comparativo: lo entregado · lo que viene · si pido hoy
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Todo se mide contra el último contenedor entregado
              {base ? ` (${base.label})` : ''}. Verde = mejor que ese, rojo = peor.
            </p>
          </div>
          {hoyCol && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-[11px]"
              onClick={() => setVerSupuestos((v) => !v)}
            >
              <Info className="h-3.5 w-3.5" />
              {verSupuestos ? 'Ocultar supuestos' : 'Qué asume "si pido hoy"'}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        {verSupuestos && hoyCol && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-xs font-medium mb-1.5">La columna "Si pido hoy" no es un pedido real. Asume:</p>
            <ul className="space-y-1">
              {hoyCol.supuestos.map((s, i) => (
                <li key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
                  <span className="text-muted-foreground/60">·</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
            {leadTime.tieneDefaults && (
              <p className="text-[11px] text-warning mt-2">
                Algún tramo del lead time todavía usa el promedio por defecto: falta historia de fechas para medirlo con tus pedidos.
              </p>
            )}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left font-medium text-muted-foreground py-2 pr-3 sticky left-0 bg-card min-w-[150px]">
                  Concepto
                </th>
                {columnas.map((c) => (
                  <th key={c.id} className="text-right font-medium py-2 px-3 min-w-[130px] align-bottom">
                    <div className="flex flex-col items-end gap-1">
                      <span className={cn(
                        'text-[10px] uppercase tracking-wide',
                        c.kind === 'hoy' ? 'text-primary' : 'text-muted-foreground',
                      )}>
                        {c.sublabel}
                      </span>
                      <span className="font-semibold">{c.label}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[9px] h-4 px-1',
                          c.kind === 'hoy' && 'border-primary/40 text-primary',
                          c.id === baseId && 'border-foreground/30',
                        )}
                      >
                        {c.kind === 'hoy' ? 'simulación' : c.estado}
                      </Badge>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) =>
                f.seccion ? (
                  <tr key={`s${i}`} className="border-b bg-muted/30">
                    <td
                      colSpan={columnas.length + 1}
                      className="py-1.5 pr-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sticky left-0"
                    >
                      {f.label}
                    </td>
                  </tr>
                ) : (
                  <tr key={f.label} className={cn('border-b last:border-0', f.destacar && 'bg-muted/20')}>
                    <td
                      className="py-2 pr-3 text-muted-foreground sticky left-0 bg-card"
                      title={f.hint}
                    >
                      <span className={cn(f.destacar && 'font-medium text-foreground')}>{f.label}</span>
                      {f.hint && <span className="text-muted-foreground/60"> ⓘ</span>}
                    </td>
                    {columnas.map((c) => (
                      <td key={c.id} className="py-2 px-3 text-right tabular-nums">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className={cn(f.destacar && 'font-semibold')}>{f.valor(c)}</span>
                          {f.delta && c.id !== baseId && (
                            <Delta pct={f.delta(c)} invertirColor={f.invertirColor} />
                          )}
                        </div>
                      </td>
                    ))}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>

        {hoyCol && base && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex items-start gap-2">
            <CalendarClock className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
            <p className="text-xs">
              {(() => {
                const d = deltaPct(hoyCol.copPorKg, base.copPorKg);
                const dir = d == null ? null : d > 0.5 ? 'más caro' : d < -0.5 ? 'más barato' : 'igual';
                return (
                  <>
                    Si montás el pedido hoy, el kilo te sale{' '}
                    <strong>
                      {d == null ? '—' : dir === 'igual' ? 'prácticamente igual' : `${Math.abs(d).toFixed(1)}% ${dir}`}
                    </strong>{' '}
                    que el último entregado, y llegaría a bodega alrededor del{' '}
                    <strong>{fmtFecha(hoyCol.fechaLlegada)}</strong> ({leadTime.totalDias} días).
                  </>
                );
              })()}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
