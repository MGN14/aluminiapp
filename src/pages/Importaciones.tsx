import { useState, useMemo } from 'react';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Ship, ChevronRight, AlertCircle, Search, ArrowUp, LineChart, List, Clock } from 'lucide-react';
import { useImports, type ImportRow, type ImportEstado, IMPORT_ESTADO_LABEL, IMPORT_ESTADOS_ORDER } from '@/hooks/useImports';
import ImportModal from '@/components/imports/ImportModal';
import ImportPriceAnalysis from '@/components/imports/ImportPriceAnalysis';
import { computeTotalDays, computeStageAverages } from '@/lib/importStages';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';

const todayIso = () => new Date().toISOString().split('T')[0];

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
const fmtTon = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—';
  return `${Number(n).toLocaleString('es-CO', { maximumFractionDigits: 3 })} t`;
};

type Filter = 'abiertos' | 'todos' | ImportEstado;

export default function Importaciones() {
  const { data, isLoading, advanceEstado } = useImports();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ImportRow | null>(null);
  const [filter, setFilter] = useState<Filter>('abiertos');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'pedidos' | 'analisis'>('pedidos');
  // Diálogo "¿en qué fecha cambió de estado?" al avanzar desde la lista
  const [advancing, setAdvancing] = useState<{ row: ImportRow; fecha: string } | null>(null);

  // Promedio de días por etapa a través de todas las importaciones con historial
  const stageAverages = useMemo(() => {
    const rows = (data?.all ?? []).filter(r => (r.import_estado_history?.length ?? 0) > 0);
    if (!rows.length) return null;
    const avgs = computeStageAverages(rows.map(r => ({ history: r.import_estado_history!, estado: r.estado })));
    return Object.keys(avgs).length ? avgs : null;
  }, [data]);

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
                    <TableHead className="font-semibold text-right">Cant.</TableHead>
                    <TableHead className="font-semibold text-right">SMM cerrado</TableHead>
                    <TableHead className="font-semibold text-right">Total USD</TableHead>
                    <TableHead className="font-semibold text-right">Anticipo</TableHead>
                    <TableHead className="font-semibold text-right">Saldo</TableHead>
                    <TableHead className="font-semibold">ETA</TableHead>
                    <TableHead className="font-semibold text-right">Días</TableHead>
                    <TableHead className="font-semibold text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                        Cargando importaciones...
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-12">
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
                      const idx = IMPORT_ESTADOS_ORDER.indexOf(row.estado);
                      const canAdvance = idx >= 0 && idx < IMPORT_ESTADOS_ORDER.length - 1;
                      const nextLabel = canAdvance ? IMPORT_ESTADO_LABEL[IMPORT_ESTADOS_ORDER[idx + 1]] : null;
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
                          <TableCell>
                            <Badge variant="outline" className={cn('text-[10px]', badge.bg, badge.color, badge.border)}>
                              {IMPORT_ESTADO_LABEL[row.estado]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-sm font-mono">{fmtTon(row.cantidad_ton)}</TableCell>
                          <TableCell className="text-right text-sm font-mono">{fmtUSD(row.precio_smm_cerrado_usd_ton)}</TableCell>
                          <TableCell className="text-right text-sm font-mono">{fmtUSD(row.monto_total_usd)}</TableCell>
                          <TableCell className="text-right text-sm font-mono text-success">{fmtUSD(row.anticipo_pagado_usd)}</TableCell>
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
                          <TableCell className="text-right">
                            <div className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
                              {canAdvance && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-[11px] text-primary gap-1"
                                  title={`Avanzar a "${nextLabel}"`}
                                  onClick={() => setAdvancing({ row, fecha: todayIso() })}
                                  disabled={advanceEstado.isPending}
                                >
                                  <ArrowUp className="h-3 w-3" />
                                  {nextLabel}
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => openEdit(row)}
                              >
                                <ChevronRight className="h-4 w-4" />
                              </Button>
                            </div>
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

      {/* Fecha del cambio de estado (avance rápido desde la lista) */}
      <Dialog open={!!advancing} onOpenChange={(v) => { if (!v) setAdvancing(null); }}>
        <DialogContent className="sm:max-w-sm">
          {advancing && (() => {
            const idx = IMPORT_ESTADOS_ORDER.indexOf(advancing.row.estado);
            const next = idx >= 0 && idx < IMPORT_ESTADOS_ORDER.length - 1 ? IMPORT_ESTADOS_ORDER[idx + 1] : null;
            if (!next) return null;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="text-base">
                    Avanzar a "{IMPORT_ESTADO_LABEL[next]}"
                  </DialogTitle>
                  <DialogDescription className="text-xs">
                    {advancing.row.proveedor_nombre}
                    {advancing.row.ref_pedido ? ` · ${advancing.row.ref_pedido}` : ''} — con esta fecha se calcula
                    cuánto duró la etapa "{IMPORT_ESTADO_LABEL[advancing.row.estado]}".
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-1.5">
                  <Label className="text-sm">¿En qué fecha cambió de estado?</Label>
                  <Input
                    type="date"
                    value={advancing.fecha}
                    max={todayIso()}
                    onChange={e => setAdvancing({ ...advancing, fecha: e.target.value })}
                    autoFocus
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={!advancing.fecha || advanceEstado.isPending}
                  onClick={async () => {
                    await advanceEstado.mutateAsync({ row: advancing.row, fecha: advancing.fecha });
                    setAdvancing(null);
                  }}
                >
                  {advanceEstado.isPending ? 'Guardando…' : 'Confirmar cambio'}
                </Button>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
