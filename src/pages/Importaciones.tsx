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
import { Plus, Ship, AlertCircle, Search, LineChart, List, Clock, TrendingUp, TrendingDown } from 'lucide-react';
import { useImports, sumImportCosts, type ImportRow, type ImportEstado, IMPORT_ESTADO_LABEL, IMPORT_ESTADOS_ORDER } from '@/hooks/useImports';
import { supabase } from '@/integrations/supabase/client';
import ImportModal from '@/components/imports/ImportModal';
import ImportPriceAnalysis from '@/components/imports/ImportPriceAnalysis';
import { computeTotalDays, computeStageAverages } from '@/lib/importStages';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';

const todayIso = () => new Date().toISOString().split('T')[0];

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
  cancelado:   { bg: 'bg-red-100',    color: 'text-red-700',    border: 'border-red-300' },
};

const fmtUSD = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—';
  return `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
};
type Filter = 'abiertos' | 'todos' | ImportEstado;

export default function Importaciones() {
  const { data, isLoading, changeEstado } = useImports();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ImportRow | null>(null);
  const [filter, setFilter] = useState<Filter>('abiertos');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'pedidos' | 'analisis'>('pedidos');
  // Diálogo "¿en qué fecha cambió de estado?" al cambiar desde el select inline
  const [changing, setChanging] = useState<{ row: ImportRow; estado: ImportEstado; fecha: string } | null>(null);

  const currentYear = new Date().getFullYear();

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

  // Promedio de días por etapa a través de todas las importaciones con historial
  const stageAverages = useMemo(() => {
    const rows = (data?.all ?? []).filter(r => (r.import_estado_history?.length ?? 0) > 0);
    if (!rows.length) return null;
    const avgs = computeStageAverages(rows.map(r => ({ history: r.import_estado_history!, estado: r.estado })));
    return Object.keys(avgs).length ? avgs : null;
  }, [data]);

  // ── KPIs de contenedores en general ──────────────────────────────────────
  // Pedidos por año + variación de precio en USD (SMM cerrado) y en COP/ton
  // (SMM × TRM ponderada de los abonos, fallback trm_causacion).
  const kpis = useMemo(() => {
    const rows = (data?.all ?? []).filter(r => r.estado !== 'cancelado');
    if (!rows.length) return null;
    const fechaRef = (r: ImportRow) => r.fecha_cotizacion ?? r.created_at.slice(0, 10);
    const ordered = [...rows].sort((a, b) => fechaRef(a).localeCompare(fechaRef(b)));
    const yearOf = (r: ImportRow) => Number(fechaRef(r).slice(0, 4));

    const pedidosEsteAnio = ordered.filter(r => yearOf(r) === currentYear).length;
    const pedidosAnioPasado = ordered.filter(r => yearOf(r) === currentYear - 1).length;

    const conPrecio = ordered.filter(r => r.precio_smm_cerrado_usd_ton != null && Number(r.precio_smm_cerrado_usd_ton) > 0);
    const last = conPrecio[conPrecio.length - 1];
    const prev = conPrecio[conPrecio.length - 2];
    const usdLast = last ? Number(last.precio_smm_cerrado_usd_ton) : null;
    const usdPrev = prev ? Number(prev.precio_smm_cerrado_usd_ton) : null;
    const usdDeltaPct = usdLast != null && usdPrev != null && usdPrev > 0
      ? ((usdLast - usdPrev) / usdPrev) * 100
      : null;

    const copPerTon = (r: ImportRow | undefined) => {
      if (!r?.precio_smm_cerrado_usd_ton) return null;
      const trm = trmByImport.get(r.id) ?? (r.trm_causacion ? Number(r.trm_causacion) : null);
      return trm ? Number(r.precio_smm_cerrado_usd_ton) * trm : null;
    };
    const copLast = copPerTon(last);
    const copPrev = copPerTon(prev);
    const copDeltaPct = copLast != null && copPrev != null && copPrev > 0
      ? ((copLast - copPrev) / copPrev) * 100
      : null;

    // Flete USD promedio por pedido (solo pedidos que ya tienen flete cargado)
    const fletes = ordered
      .map(r => sumImportCosts(r.import_costs, 'flete').usd)
      .filter(v => v > 0);
    const fleteProm = fletes.length ? fletes.reduce((a, b) => a + b, 0) / fletes.length : null;
    const fleteUltimo = fletes.length ? fletes[fletes.length - 1] : null;

    return { pedidosEsteAnio, pedidosAnioPasado, usdLast, usdDeltaPct, copLast, copDeltaPct, fleteProm, fleteUltimo };
  }, [data, currentYear, trmByImport]);

  const filtered = useMemo(() => {
    const rows = data?.all ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (filter === 'abiertos') {
        if (r.estado === 'entregado' || r.estado === 'cancelado') return false;
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
                  : `${data?.total_abiertos ?? 0} pedidos abiertos · ${fmtUSD(data?.total_saldo_pendiente_usd ?? 0)} saldo USD`}
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
            </div>
            <Button onClick={openNew} className="gap-2">
              <Plus className="h-4 w-4" />
              Nueva importación
            </Button>
          </div>
        </div>

        {view === 'analisis' ? (
          <ImportPriceAnalysis />
        ) : (
        <>
        {/* KPIs de contenedores en general */}
        {kpis && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card>
              <CardContent className="py-3 px-4">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">Pedidos {currentYear}</p>
                <p className="text-2xl font-bold tabular-nums">{kpis.pedidosEsteAnio}</p>
                <p className="text-[11px] text-muted-foreground">{kpis.pedidosAnioPasado} en {currentYear - 1}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">SMM último (USD/t)</p>
                <p className="text-2xl font-bold tabular-nums font-mono">
                  {kpis.usdLast != null ? `$${kpis.usdLast.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
                </p>
                {kpis.usdDeltaPct != null && (
                  <p className={cn('text-[11px] font-medium inline-flex items-center gap-1', kpis.usdDeltaPct > 0 ? 'text-destructive' : 'text-success')}>
                    {kpis.usdDeltaPct > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {kpis.usdDeltaPct > 0 ? '+' : ''}{kpis.usdDeltaPct.toFixed(1)}% vs pedido anterior
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">COP/ton último</p>
                <p className="text-2xl font-bold tabular-nums font-mono">
                  {kpis.copLast != null ? fmtCOPShort(kpis.copLast) : '—'}
                </p>
                {kpis.copDeltaPct != null ? (
                  <p className={cn('text-[11px] font-medium inline-flex items-center gap-1', kpis.copDeltaPct > 0 ? 'text-destructive' : 'text-success')}>
                    {kpis.copDeltaPct > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {kpis.copDeltaPct > 0 ? '+' : ''}{kpis.copDeltaPct.toFixed(1)}% vs pedido anterior
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">SMM × TRM de abonos</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">Flete USD</p>
                <p className="text-2xl font-bold tabular-nums font-mono">
                  {kpis.fleteUltimo != null ? `$${kpis.fleteUltimo.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {kpis.fleteProm != null ? `promedio $${kpis.fleteProm.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : 'cargalo en costos del pedido'}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filtros + búsqueda */}
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
            <div className="inline-flex bg-muted rounded-md p-0.5 gap-0.5">
              {(['abiertos', 'todos', ...IMPORT_ESTADOS_ORDER] as Filter[]).map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    'px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap',
                    filter === f
                      ? 'bg-background shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f === 'abiertos' ? 'Abiertos' : f === 'todos' ? 'Todos' : IMPORT_ESTADO_LABEL[f as ImportEstado]}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Promedios de duración por etapa (histórico) */}
        {stageAverages && (
          <Card>
            <CardContent className="py-3 px-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> Demora promedio por etapa:
              </span>
              {IMPORT_ESTADOS_ORDER.filter(e => stageAverages[e]).map(e => (
                <span key={e} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{IMPORT_ESTADO_LABEL[e]}</span>{' '}
                  <span className="font-mono">{stageAverages[e]!.promedio}d</span>
                  <span className="text-[10px]"> ({stageAverages[e]!.muestras})</span>
                </span>
              ))}
            </CardContent>
          </Card>
        )}

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
                    <TableHead className="font-semibold text-right">Arancel</TableHead>
                    <TableHead className="font-semibold text-right">IVA import.</TableHead>
                    <TableHead className="font-semibold text-right">Agencia</TableHead>
                    <TableHead className="font-semibold text-right">Total USD</TableHead>
                    <TableHead className="font-semibold text-right">Saldo</TableHead>
                    <TableHead className="font-semibold">ETA</TableHead>
                    <TableHead className="font-semibold text-right">Días</TableHead>
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
                      return (
                        <TableRow
                          key={row.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => openEdit(row)}
                        >
                          <TableCell className="text-sm">
                            <div className="font-medium">{row.proveedor_nombre}</div>
                            {row.ref_pedido && (
                              <div className="text-[10px] text-muted-foreground font-mono">{row.ref_pedido}</div>
                            )}
                          </TableCell>
                          {/* Estado editable en línea — mismos estados que el modal.
                              El cambio pide fecha en el dialog antes de aplicarse. */}
                          <TableCell onClick={(e) => e.stopPropagation()}>
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
                          </TableCell>
                          <TableCell className="text-right text-sm font-mono">{fmtUSD(row.precio_smm_cerrado_usd_ton)}</TableCell>
                          <TableCell className="text-right"><CostCell usd={flete.usd} cop={flete.cop} /></TableCell>
                          <TableCell className="text-right"><CostCell usd={arancel.usd} cop={arancel.cop} /></TableCell>
                          <TableCell className="text-right"><CostCell usd={iva.usd} cop={iva.cop} /></TableCell>
                          <TableCell className="text-right"><CostCell usd={agencia.usd} cop={agencia.cop} /></TableCell>
                          <TableCell className="text-right text-sm font-mono">{fmtUSD(row.monto_total_usd)}</TableCell>
                          <TableCell className="text-right text-sm font-mono font-bold text-destructive">{fmtUSD(row.saldo_pendiente_usd)}</TableCell>
                          <TableCell className="text-sm">
                            {row.fecha_estimada_llegada
                              ? format(parseLocalDate(row.fecha_estimada_llegada), 'dd MMM yyyy', { locale: es })
                              : <span className="text-muted-foreground">—</span>}
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
                                  {total.dias}d{total.enCurso ? '…' : ''}
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
