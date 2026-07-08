/**
 * Análisis de COBERTURA por referencia — el detalle completo detrás del
 * banner "¿cuándo montar el próximo pedido?". Mismo motor, misma familia -5:
 *
 *   · Demanda real/día  ← salidas (remisiones) CENSURADAS por días con stock:
 *     si una ref vendió 500 en 21 días y estuvo seca el resto, su demanda es
 *     500/21, no 500/90. El sugerido crece solo cuando hay quiebres (Nico).
 *   · Stock físico      ← conteo QR propio (familia -5)
 *   · En tránsito       ← packing list (sufijos) / proforma (sin sufijo)
 *   · Cobertura         ← fecha de quiebre proyectada (con reposiciones)
 *   · Sugerido próx. pedido = demanda × horizonte × índice estacional
 *                             − (stock + tránsito)
 *     La estacionalidad está MONTADA y se activa sola a los 12 meses de
 *     historia; mientras tanto el índice es 1 y la UI lo dice.
 *
 * Exportable a Excel para armar el pedido (flujo Nico + Cowork).
 */

import { useMemo, useState } from 'react';
import { useReorderSuggestion } from '@/hooks/useReorderSuggestion';
import { suggestOrderQty } from '@/lib/reorderSuggestion';
import { refFamilyKey } from '@/lib/refFamily';
import { ESTACIONALIDAD_MESES_MADURA } from '@/lib/demandModel';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, Loader2, PackageSearch, Search, TriangleAlert } from 'lucide-react';
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
  const { isPending, suggestion: sug, kgPorUnidad, cicloPedidoDias, pedidosSinItems, demandPorFamilia } = useReorderSuggestion();
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

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
      const fam = refFamilyKey(r.reference);
      const demanda = demandPorFamilia.get(fam) ?? null;
      // Factor = tendencia 30d × estacionalidad (ponderada por madurez).
      // Activo desde el primer dato — el disclaimer vive en el header.
      const indice = demanda?.factorDemanda ?? 1;
      const sugerido = suggestOrderQty({ ...r, consumoDiario: r.consumoDiario * indice }, horizonteDias);
      const kgU = kgPorUnidad.get(fam) ?? null;
      return {
        ...r,
        demanda,
        indice,
        sugerido,
        kgEstimado: kgU !== null ? sugerido * kgU : null,
      };
    });
  }, [rows, sug, horizonteDias, kgPorUnidad, demandPorFamilia]);

  const totales = useMemo(() => {
    const unds = conSugerido.reduce((s, r) => s + r.sugerido, 0);
    const kg = conSugerido.reduce((s, r) => s + (r.kgEstimado ?? 0), 0);
    const sinKg = conSugerido.filter((r) => r.sugerido > 0 && r.kgEstimado === null).length;
    return { unds, kg, sinKg };
  }, [conSugerido]);

  // Estado de los ajustes de demanda (a nivel módulo).
  const ajustes = useMemo(() => {
    let meses = 0;
    let estacionalActivas = 0;
    let maduras = 0;
    let tendenciaActivas = 0;
    for (const d of demandPorFamilia.values()) {
      meses = Math.max(meses, d.mesesDeHistoria);
      if (d.estacionalidadActiva) estacionalActivas++;
      if (d.estacionalidadMadura) maduras++;
      if (d.indiceTendencia !== 1) tendenciaActivas++;
    }
    return { meses, estacionalActivas, maduras, tendenciaActivas };
  }, [demandPorFamilia]);

  const handleExport = async () => {
    if (!sug) return;
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const hoy = new Date().toISOString().slice(0, 10);
      const data = conSugerido.map((r) => ({
        'Referencia (-5)': r.reference,
        'Demanda/día': Number(r.consumoDiario.toFixed(2)),
        'Días con stock (90d)': r.demanda?.diasConStock ?? null,
        'Stock físico': r.stock,
        'En tránsito': r.enTransito,
        'Cobertura (días)': r.diasCobertura ?? '>400',
        'Fecha quiebre': r.fechaQuiebre ?? '',
        'Tendencia 30d': Number((r.demanda?.indiceTendencia ?? 1).toFixed(2)),
        'Índice estacional': Number((r.demanda?.indiceEstacional ?? 1).toFixed(2)),
        'Factor aplicado': Number(r.indice.toFixed(2)),
        'Sugerido próx. pedido': r.sugerido,
        'Kg estimado': r.kgEstimado !== null ? Number(r.kgEstimado.toFixed(1)) : null,
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Cobertura');
      const meta = XLSX.utils.json_to_sheet([
        { Parámetro: 'Fecha del análisis', Valor: hoy },
        { Parámetro: 'Horizonte del sugerido (días)', Valor: horizonteDias },
        { Parámetro: 'Lead time (días)', Valor: sug.leadTime.totalDias },
        { Parámetro: 'Ciclo entre pedidos (días)', Valor: cicloPedidoDias },
        { Parámetro: 'Colchón (días)', Valor: sug.safetyDias },
        { Parámetro: 'Ventana de consumo (días)', Valor: sug.datos.ventanaDias },
        { Parámetro: 'Tope contenedor (kg)', Valor: TOPE_CONTENEDOR_KG },
        { Parámetro: 'Sugerido total (unds)', Valor: totales.unds },
        { Parámetro: 'Sugerido total (kg est.)', Valor: Math.round(totales.kg) },
      ]);
      XLSX.utils.book_append_sheet(wb, meta, 'Parámetros');
      XLSX.writeFile(wb, `cobertura-pedido-sugerido-${hoy}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

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
            Demanda: salidas reales {sug.datos.ventanaDias}d <strong className="text-foreground">censuradas por días con stock</strong> ·
            Tránsito: {sug.datos.llegadasEnTransito} llegadas
          </span>
          <span className="text-muted-foreground">
            Horizonte: <strong className="text-foreground">{horizonteDias}d</strong>{' '}
            (lead time {sug.leadTime.totalDias}{sug.leadTime.tieneDefaults ? '≈' : ''} + ciclo {cicloPedidoDias} + colchón {sug.safetyDias})
          </span>
          <span className="text-muted-foreground" title="Tendencia: tasa de los últimos 30 días vs la ventana — capta escasez, mercado saturado, regulación, demoras en puerto. Activa desde la primera semana de datos.">
            Tendencia 30d: {ajustes.tendenciaActivas > 0
              ? <strong className="text-foreground">activa ({ajustes.tendenciaActivas} refs)</strong>
              : 'neutra'}
          </span>
          <span
            className="text-muted-foreground"
            title={`La señal anual se aplica desde el primer dato, ponderada por madurez (${ajustes.meses}/${ESTACIONALIDAD_MESES_MADURA} meses = ${Math.round(Math.min(1, ajustes.meses / ESTACIONALIDAD_MESES_MADURA) * 100)}% del peso). Leela con pinzas hasta madurar.`}
          >
            Estacionalidad anual: {ajustes.maduras > 0
              ? <strong className="text-success">madura</strong>
              : ajustes.estacionalActivas > 0
                ? <strong className="text-warning">parcial ({ajustes.meses}/{ESTACIONALIDAD_MESES_MADURA} meses — a medias)</strong>
                : `acumulando serie (${Math.min(ajustes.meses, ESTACIONALIDAD_MESES_MADURA)}/${ESTACIONALIDAD_MESES_MADURA} meses)`}
          </span>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 ml-auto" onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Exportar Excel
          </Button>
        </CardContent>
      </Card>

      {pedidosSinItems.length > 0 && (
        <p className="text-xs text-amber-700 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 flex items-start gap-1.5">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            <strong>{pedidosSinItems.length} pedido{pedidosSinItems.length > 1 ? 's' : ''} abierto{pedidosSinItems.length > 1 ? 's' : ''} SIN proforma/packing list</strong>{' '}
            ({pedidosSinItems.map((p) => p.label).join(', ')}): su carga no cuenta como tránsito y el sugerido sale
            inflado. Subile el proforma en la pestaña Costeo del pedido — es parte del flujo, no opcional.
          </span>
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
              <TableHead className="text-[11px] text-right" title="Salidas ÷ días CON stock (censurado). Si estuvo agotada, la demanda real es más alta que salidas ÷ 90.">Demanda/día</TableHead>
              <TableHead className="text-[11px] text-right">Stock físico</TableHead>
              <TableHead className="text-[11px] text-right" title="Packing list / proforma de pedidos abiertos, agrupado por familia">En tránsito</TableHead>
              <TableHead className="text-[11px] text-right" title="Días hasta el quiebre proyectado, contando las reposiciones en camino">Cobertura</TableHead>
              <TableHead className="text-[11px] text-right">Quiebre</TableHead>
              <TableHead className="text-[11px] text-right" title={`demanda × ${horizonteDias}d × índice estacional − (stock + tránsito)`}>Sugerido próx. pedido</TableHead>
              <TableHead className="text-[11px] text-right" title="Sugerido × kg/unidad (del packing/proforma)">≈ kg</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {conSugerido.map((r) => (
              <TableRow key={r.reference} className={cn(r.diasCobertura !== null && r.diasCobertura <= 45 && 'bg-destructive/[0.04]')}>
                <TableCell className="text-xs font-mono">{r.reference}</TableCell>
                <TableCell
                  className="text-xs font-mono text-right"
                  title={r.demanda
                    ? `Vendió ${fmtNum(r.demanda.salidasVentana)} en ${r.demanda.diasConStock} días con stock (ventana ${r.demanda.ventanaDias}d)${r.demanda.huboQuiebre ? ' — tuvo quiebre: la tasa ingenua subestimaba' : ''}`
                    : undefined}
                >
                  {r.consumoDiario.toFixed(1)}
                  {r.demanda?.huboQuiebre && <span className="text-warning" title="Estuvo agotada dentro de la ventana — demanda corregida por censura">†</span>}
                </TableCell>
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
                  {r.indice !== 1 && r.sugerido > 0 && (
                    <span className="text-[9px] text-muted-foreground" title={`Factor aplicado ${r.indice.toFixed(2)} = tendencia 30d ${(r.demanda?.indiceTendencia ?? 1).toFixed(2)} × estacionalidad ${(r.demanda?.indiceEstacional ?? 1).toFixed(2)} (ponderada por madurez)`}> ×{r.indice.toFixed(2)}</span>
                  )}
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
        La demanda se mide solo sobre días con stock (†: tuvo quiebre y la tasa fue corregida hacia arriba). El sugerido
        se ajusta por DOS señales: tendencia de corto plazo (últimos 30 días — escasez, mercado, regulación, puerto) y
        estacionalidad anual, activa desde el primer dato pero ponderada por madurez — con poca historia pesa poco y se
        lee con pinzas; a los 12 meses aplica al 100%. Referencias sin ventas registradas no aparecen. El sugerido es
        punto de partida, no orden de compra.
      </p>
    </div>
  );
}
