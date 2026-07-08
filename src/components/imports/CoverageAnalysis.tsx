/**
 * Análisis de COBERTURA por referencia — el detalle completo detrás del
 * banner "¿cuándo montar el próximo pedido?". Mismo motor, misma familia -5:
 *
 *   · Consumo real/día    ← salidas de inventario (remisiones/despachos, 90d)
 *   · Stock físico        ← conteo QR propio (familia -5)
 *   · En tránsito         ← packing list (sufijos) / proforma (sin sufijo)
 *   · Cobertura           ← fecha de quiebre proyectada (con reposiciones)
 *   · Sugerido próx. pedido = consumo × horizonte − (stock + tránsito)
 *     horizonte = lead time + ciclo entre pedidos + colchón (visible arriba)
 *
 * El peso estimado del sugerido usa kg/unidad del propio packing/proforma —
 * y se compara contra el tope del contenedor.
 */

import { useMemo, useState } from 'react';
import { useReorderSuggestion } from '@/hooks/useReorderSuggestion';
import { suggestOrderQty, type QuiebreProducto } from '@/lib/reorderSuggestion';
import { refFamilyKey } from '@/lib/refFamily';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, PackageSearch, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Tope de carga del contenedor (kg) — del costeo de Nico. */
const TOPE_CONTENEDOR_KG = 28_400;

const fmtNum = (n: number, d = 0) => n.toLocaleString('es-CO', { maximumFractionDigits: d });

function fmtFecha(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}

function coberturaColor(dias: number | null): string {
  if (dias === null) return 'text-success';
  if (dias <= 45) return 'text-destructive';
  if (dias <= 90) return 'text-warning';
  return 'text-foreground';
}

export default function CoverageAnalysis() {
  const { isPending, suggestion: sug, kgPorUnidad, cicloPedidoDias, pedidosSinItems } = useReorderSuggestion();
  const [search, setSearch] = useState('');

  const horizonteDias = sug ? sug.leadTime.totalDias + sug.safetyDias + cicloPedidoDias : 0;

  const rows = useMemo(() => {
    if (!sug) return [];
    const q = search.trim().toLowerCase();
    const base = q
      ? sug.porReferencia.filter((r) => r.reference.toLowerCase().includes(q))
      : sug.porReferencia;
    // Menor cobertura primero (null = no quiebra → al final).
    return [...base].sort((a, b) =>
      (a.diasCobertura ?? Infinity) - (b.diasCobertura ?? Infinity) || b.consumoDiario - a.consumoDiario,
    );
  }, [sug, search]);

  const conSugerido = useMemo(() => {
    if (!sug) return [];
    return rows.map((r) => {
      const sugerido = suggestOrderQty(r, horizonteDias);
      const kgU = kgPorUnidad.get(refFamilyKey(r.reference)) ?? null;
      return { ...r, sugerido, kgEstimado: kgU !== null ? sugerido * kgU : null };
    });
  }, [rows, sug, horizonteDias, kgPorUnidad]);

  const totales = useMemo(() => {
    const unds = conSugerido.reduce((s, r) => s + r.sugerido, 0);
    const kg = conSugerido.reduce((s, r) => s + (r.kgEstimado ?? 0), 0);
    const sinKg = conSugerido.filter((r) => r.sugerido > 0 && r.kgEstimado === null).length;
    return { unds, kg, sinKg };
  }, [conSugerido]);

  if (isPending || !sug) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Calculando cobertura por referencia…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Parámetros del modelo, visibles y honestos */}
      <Card>
        <CardContent className="py-3 px-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <div className="flex items-center gap-2">
            <PackageSearch className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Análisis de cobertura por referencia</span>
          </div>
          <span className="text-muted-foreground">
            Consumo: salidas reales {sug.datos.ventanaDias}d · Stock: físico (familia -5) ·
            Tránsito: {sug.datos.llegadasEnTransito} llegadas
          </span>
          <span className="text-muted-foreground">
            Horizonte del sugerido: <strong className="text-foreground">{horizonteDias}d</strong>{' '}
            (lead time {sug.leadTime.totalDias}{sug.leadTime.tieneDefaults ? '≈' : ''} + ciclo {cicloPedidoDias} + colchón {sug.safetyDias})
          </span>
        </CardContent>
      </Card>

      {pedidosSinItems.length > 0 && (
        <p className="text-[11px] text-muted-foreground rounded-md border border-border bg-muted/30 px-3 py-2">
          📦 {pedidosSinItems.length} pedido{pedidosSinItems.length > 1 ? 's' : ''} abierto{pedidosSinItems.length > 1 ? 's' : ''} sin
          packing list/proforma ({pedidosSinItems.map((p) => p.label).join(', ')}) — su carga NO está contada como tránsito
          y el sugerido sale inflado. Subiles el proforma y esto se corrige solo.
        </p>
      )}

      <div className="relative max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Buscar referencia…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-8 text-sm"
        />
      </div>

      <div className="overflow-x-auto border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/60">
              <TableHead className="text-[11px]">Referencia (-5)</TableHead>
              <TableHead className="text-[11px] text-right" title="Salidas de inventario de los últimos 90 días ÷ 90">Consumo/día</TableHead>
              <TableHead className="text-[11px] text-right">Stock físico</TableHead>
              <TableHead className="text-[11px] text-right" title="Packing list / proforma de pedidos abiertos, agrupado por familia">En tránsito</TableHead>
              <TableHead className="text-[11px] text-right" title="Días hasta el quiebre proyectado, contando las reposiciones en camino">Cobertura</TableHead>
              <TableHead className="text-[11px] text-right">Quiebre</TableHead>
              <TableHead className="text-[11px] text-right" title={`consumo × ${horizonteDias}d − (stock + tránsito), redondeado hacia arriba`}>Sugerido próx. pedido</TableHead>
              <TableHead className="text-[11px] text-right" title="Sugerido × kg/unidad (del packing/proforma)">≈ kg</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {conSugerido.map((r) => (
              <TableRow key={r.reference} className={cn(r.diasCobertura !== null && r.diasCobertura <= 45 && 'bg-destructive/[0.04]')}>
                <TableCell className="text-xs font-mono">{r.reference}</TableCell>
                <TableCell className="text-xs font-mono text-right">{r.consumoDiario.toFixed(1)}</TableCell>
                <TableCell className="text-xs font-mono text-right">{fmtNum(r.stock)}</TableCell>
                <TableCell className={cn('text-xs font-mono text-right', r.enTransito > 0 ? 'text-primary font-medium' : 'text-muted-foreground')}>
                  {r.enTransito > 0 ? `+${fmtNum(r.enTransito)}` : '—'}
                </TableCell>
                <TableCell className={cn('text-xs font-mono text-right font-semibold', coberturaColor(r.diasCobertura))}>
                  {r.diasCobertura === null ? '>400d' : `${r.diasCobertura}d`}
                </TableCell>
                <TableCell className="text-xs font-mono text-right text-muted-foreground">
                  {r.fechaQuiebre ? fmtFecha(r.fechaQuiebre) : '—'}
                </TableCell>
                <TableCell className={cn('text-xs font-mono text-right font-semibold', r.sugerido > 0 ? 'text-foreground' : 'text-muted-foreground')}>
                  {r.sugerido > 0 ? fmtNum(r.sugerido) : '—'}
                </TableCell>
                <TableCell className="text-xs font-mono text-right text-muted-foreground">
                  {r.sugerido > 0 && r.kgEstimado !== null ? fmtNum(r.kgEstimado) : '—'}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/30 font-semibold">
              <TableCell className="text-xs" colSpan={6}>
                Pedido sugerido total ({conSugerido.filter((r) => r.sugerido > 0).length} referencias)
              </TableCell>
              <TableCell className="text-xs font-mono text-right">{fmtNum(totales.unds)}</TableCell>
              <TableCell className={cn('text-xs font-mono text-right', totales.kg > TOPE_CONTENEDOR_KG ? 'text-destructive' : 'text-foreground')}>
                {totales.kg > 0 ? `${fmtNum(totales.kg)}` : '—'}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {totales.kg > 0 && (
        <p className="text-xs text-muted-foreground">
          Peso estimado del sugerido: <strong className={totales.kg > TOPE_CONTENEDOR_KG ? 'text-destructive' : 'text-foreground'}>
            {fmtNum(totales.kg)} kg
          </strong>{' '}
          — {Math.round((totales.kg / TOPE_CONTENEDOR_KG) * 100)}% del tope del contenedor ({fmtNum(TOPE_CONTENEDOR_KG)} kg).
          {totales.kg > TOPE_CONTENEDOR_KG && ' Excede: tocará priorizar por cobertura (las de arriba primero).'}
          {totales.sinKg > 0 && ` · ${totales.sinKg} referencia${totales.sinKg > 1 ? 's' : ''} sin kg/unidad conocido (no suman al peso).`}
        </p>
      )}

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Limitaciones honestas del modelo: asume demanda constante (ventana {sug.datos.ventanaDias}d, sin estacionalidad
        todavía — mejora solo con más historia); las referencias sin ventas registradas no aparecen; y si estuviste sin
        stock, el consumo aparece subestimado justo donde más falta hace. El sugerido es punto de partida, no orden de compra.
      </p>
    </div>
  );
}
