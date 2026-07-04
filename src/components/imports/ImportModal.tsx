import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useImports, sumImportCosts, type ImportRow, type ImportEstado, IMPORT_ESTADOS_ORDER, IMPORT_ESTADO_LABEL } from '@/hooks/useImports';
import { useImportPayments, fetchTrmForDate } from '@/hooks/useImportPayments';
import { computeStageDurations, computeTotalDays } from '@/lib/importStages';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Trash2, Clock, Ship, CalendarClock } from 'lucide-react';
import { cn } from '@/lib/utils';
import ImportPaymentsSection from './ImportPaymentsSection';
import ImportCostingSection from './ImportCostingSection';
import CosteoCsvTools from './CosteoCsvTools';
import ExchangeDiffPanel from './ExchangeDiffPanel';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: ImportRow | null;
}

const todayIso = () => new Date().toISOString().split('T')[0];

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromToday = (dateStr: string) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const now = new Date();
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / DAY_MS);
};

const fmtUSD0 = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const fmtFecha = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });

const OTRO_PROVEEDOR = '__otro__';

/** Proveedores conocidos = beneficiarios que aparecen en movimientos bancarios
 *  con categoría "Proveedores" (Conciliación bancaria). */
function useProveedoresConocidos(enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['proveedores-conocidos', user?.id],
    enabled: enabled && !!user?.id,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data: cat } = await supabase
        .from('categories')
        .select('id')
        .ilike('name', 'proveedores')
        .maybeSingle();
      if (!cat?.id) return [] as { id: string; name: string }[];

      const { data: txs } = await supabase
        .from('transactions')
        .select('responsible_id')
        .eq('category_id', cat.id)
        .not('responsible_id', 'is', null)
        .is('deleted_at', null);
      const ids = [...new Set((txs ?? []).map((t: any) => t.responsible_id as string))];
      if (!ids.length) return [] as { id: string; name: string }[];

      const { data: resps } = await supabase
        .from('responsibles')
        .select('id, name')
        .in('id', ids)
        .order('name');
      return ((resps ?? []) as { id: string; name: string }[]);
    },
  });
}

// Modal de importación, organizado alrededor del goal del usuario:
//   contenedor COSTEADO · TIEMPOS claros · SALDO fácil de ver ·
//   conciliar con extractos · saber cuándo montar el próximo pedido.
//
// Estructura: header con los 4 números que importan (saldo, pago, flete, ETA)
// + 4 pestañas (Resumen / Abonos / Costeo / Datos) en vez del formulario
// interminable de una sola corrida.
export default function ImportModal({ open, onOpenChange, editing }: Props) {
  const { create, update, remove, data: importsData } = useImports();
  const isEdit = !!editing;

  const [proveedorSel, setProveedorSel] = useState<string>(''); // responsible_id | __otro__
  const [proveedorLibre, setProveedorLibre] = useState('');
  const [estado, setEstado] = useState<ImportEstado>('cotizacion');
  const [estadoFecha, setEstadoFecha] = useState(todayIso()); // fecha real del cambio de estado
  const [cantidadTon, setCantidadTon] = useState<number | ''>('');
  const [precioSmm, setPrecioSmm] = useState<number | ''>('');
  const [montoTotal, setMontoTotal] = useState<number | ''>('');
  const [anticipo, setAnticipo] = useState<number | ''>('');
  // Fechas del flujo = una por ESTADO (mismos estados que el select).
  // Se guardan en import_estado_history; las columnas legacy se mapean al guardar.
  const [estadoFechas, setEstadoFechas] = useState<Record<string, string>>({});
  const [fechaEta, setFechaEta] = useState('');
  const [refPedido, setRefPedido] = useState('');
  const [notas, setNotas] = useState('');
  const [arancelPct, setArancelPct] = useState<number>(5);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // TRM oficial de hoy — para el costeo estimado cuando aún no hay abonos
  const { data: trmHoy = null } = useQuery({
    queryKey: ['trm-hoy'],
    queryFn: () => fetchTrmForDate(todayIso()),
    staleTime: 60 * 60_000,
  });

  const { data: proveedores = [] } = useProveedoresConocidos(open);
  // TRM causación = promedio ponderado de los abonos (imports_liquidation).
  const { liquidation, payments } = useImportPayments(isEdit ? editing?.id : null);
  const trmPonderada = liquidation?.trm_promedio_ponderada ?? null;

  const estadoCambio = isEdit && editing ? estado !== editing.estado : false;

  useEffect(() => {
    if (!open) return;
    if (editing) {
      // Si el proveedor guardado matchea uno conocido, seleccionarlo; si no, "otro"
      setProveedorSel(OTRO_PROVEEDOR);
      setProveedorLibre(editing.proveedor_nombre);
      setEstado(editing.estado);
      setEstadoFecha(todayIso());
      setCantidadTon(editing.cantidad_ton ?? '');
      setPrecioSmm(editing.precio_smm_cerrado_usd_ton ?? '');
      setMontoTotal(editing.monto_total_usd ?? '');
      setAnticipo(editing.anticipo_pagado_usd ?? '');
      // Fechas por estado: historial primero, columnas legacy como fallback
      const fechas: Record<string, string> = {};
      for (const h of editing.import_estado_history ?? []) fechas[h.estado] = h.fecha;
      if (!fechas.cotizacion && editing.fecha_cotizacion) fechas.cotizacion = editing.fecha_cotizacion;
      if (!fechas.transito && editing.fecha_embarque) fechas.transito = editing.fecha_embarque;
      if (!fechas.entregado && editing.fecha_arribo_real) fechas.entregado = editing.fecha_arribo_real;
      setEstadoFechas(fechas);
      setFechaEta(editing.fecha_estimada_llegada ?? '');
      setRefPedido(editing.ref_pedido ?? '');
      setNotas(editing.notas ?? '');
      setArancelPct(Number(editing.arancel_pct ?? 5));
    } else {
      setProveedorSel('');
      setProveedorLibre('');
      setEstado('cotizacion');
      setEstadoFecha(todayIso());
      setCantidadTon('');
      setPrecioSmm('');
      setMontoTotal('');
      setAnticipo('');
      setEstadoFechas({ cotizacion: todayIso() });
      setFechaEta('');
      setRefPedido('');
      setNotas('');
      setArancelPct(5);
    }
    setErrMsg(null);
  }, [open, editing]);

  // Al abrir en edición: si el nombre guardado coincide con un proveedor
  // conocido, pre-seleccionarlo en el dropdown (mejor UX que "otro").
  useEffect(() => {
    if (!open || !editing || !proveedores.length) return;
    const match = proveedores.find(
      p => p.name.trim().toLowerCase() === editing.proveedor_nombre.trim().toLowerCase(),
    );
    if (match) {
      setProveedorSel(match.id);
      setProveedorLibre('');
    }
  }, [open, editing, proveedores]);

  const proveedorNombre = proveedorSel && proveedorSel !== OTRO_PROVEEDOR
    ? (proveedores.find(p => p.id === proveedorSel)?.name ?? '')
    : proveedorLibre.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrMsg(null);
    if (!proveedorNombre) {
      setErrMsg('Tenés que elegir o escribir un proveedor');
      return;
    }
    const payload = {
      proveedor_nombre: proveedorNombre,
      responsible_id: proveedorSel && proveedorSel !== OTRO_PROVEEDOR ? proveedorSel : null,
      estado,
      cantidad_ton: cantidadTon === '' ? null : Number(cantidadTon),
      precio_smm_cerrado_usd_ton: precioSmm === '' ? null : Number(precioSmm),
      monto_total_usd: montoTotal === '' ? null : Number(montoTotal),
      // anticipo_pagado_usd SOLO al crear. En edición lo sincroniza el trigger
      // desde los abonos — mandarlo pisaba el valor real con el que estaba
      // cargado al ABRIR el modal.
      ...(isEdit ? {} : { anticipo_pagado_usd: anticipo === '' ? 0 : Number(anticipo) }),
      // Columnas legacy mapeadas desde las fechas por estado
      fecha_cotizacion: estadoFechas.cotizacion || null,
      fecha_embarque: estadoFechas.transito || null,
      fecha_arribo_real: estadoFechas.entregado || null,
      fecha_estimada_llegada: fechaEta || null,
      ref_pedido: refPedido.trim() || null,
      notas: notas.trim() || null,
      arancel_pct: arancelPct,
    };
    // Solo las fechas con valor — el historial se upsertea por estado.
    const fechasLlenas = Object.fromEntries(
      Object.entries(estadoFechas).filter(([, f]) => !!f),
    ) as Partial<Record<ImportEstado, string>>;
    try {
      if (isEdit && editing) {
        await update.mutateAsync({
          id: editing.id,
          ...payload,
          // Solo registra historial si el estado realmente cambió
          estado_fecha: estadoCambio ? estadoFecha : undefined,
          estado_fechas: fechasLlenas,
        });
      } else {
        await create.mutateAsync({ ...payload, estado_fecha: fechasLlenas[estado] ?? estadoFecha });
      }
      onOpenChange(false);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Error al guardar');
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    const ok = window.confirm(`¿Eliminar la importación de "${editing.proveedor_nombre}"? No se puede deshacer.`);
    if (!ok) return;
    await remove.mutateAsync(editing.id);
    onOpenChange(false);
  };

  const saving = create.isPending || update.isPending;
  // En edición, el pagado REAL viene de la liquidación (suma de abonos, en vivo).
  const pagadoVivo = isEdit
    ? Number(liquidation?.total_pagado_usd ?? editing?.anticipo_pagado_usd ?? 0)
    : (typeof anticipo === 'number' ? anticipo : 0);
  const totalNum = typeof montoTotal === 'number' ? montoTotal : 0;
  const saldoVivo = totalNum - pagadoVivo;
  const pagadoPct = totalNum > 0 ? Math.min(100, Math.round((pagadoVivo / totalNum) * 100)) : 0;

  // Flete del contenedor — EN VIVO (misma query key que la pestaña Costeo,
  // así agregar un costo ahí refresca el header al instante). El embebido
  // editing.import_costs era un snapshot congelado al abrir el modal: con
  // flete recién cargado, el total seguía mostrando solo la mercancía.
  const { data: costosVivos } = useQuery({
    queryKey: ['import_costs', editing?.id],
    enabled: !!editing?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('import_costs')
        .select('*')
        .eq('import_id', editing!.id)
        .order('orden');
      return data ?? [];
    },
  });
  const flete = sumImportCosts(
    (costosVivos as { tipo: never; monto: number; moneda: never }[] | undefined) ?? editing?.import_costs,
    'flete',
  );
  const totalUsdContenedor = totalNum + flete.usd;

  // ETA: días restantes (o atraso) para pedidos abiertos
  const etaDias = fechaEta && estado !== 'entregado' && estado !== 'cancelado'
    ? daysFromToday(fechaEta)
    : null;

  // Lead time promedio de pedidos ENTREGADOS → "¿cuándo monto el próximo?"
  const leadTimeProm = useMemo(() => {
    const rows = importsData?.all ?? [];
    const dias = rows
      .filter(r => r.estado === 'entregado' && (r.import_estado_history?.length ?? 0) > 0)
      .map(r => computeTotalDays(r.import_estado_history!, r.estado))
      .filter((t): t is { dias: number; enCurso: boolean } => !!t && !t.enCurso && t.dias > 0)
      .map(t => t.dias);
    if (!dias.length) return null;
    return Math.round(dias.reduce((a, b) => a + b, 0) / dias.length);
  }, [importsData]);

  const stages = isEdit && editing?.import_estado_history?.length
    ? computeStageDurations(editing.import_estado_history, editing.estado)
    : [];
  const totalDias = isEdit && editing?.import_estado_history?.length
    ? computeTotalDays(editing.import_estado_history, editing.estado)
    : null;

  // ── Bloques de formulario reutilizados entre "Datos" (edit) y creación ──
  const camposDatos = (
    <>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5 col-span-2">
          <Label className="text-sm">Proveedor *</Label>
          <Select value={proveedorSel} onValueChange={setProveedorSel}>
            <SelectTrigger>
              <SelectValue placeholder="Elegí un proveedor…" />
            </SelectTrigger>
            <SelectContent>
              {proveedores.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
              <SelectItem value={OTRO_PROVEEDOR}>Otro (escribir nombre)</SelectItem>
            </SelectContent>
          </Select>
          {proveedores.length === 0 && (
            <p className="text-[10px] text-muted-foreground">
              La lista sale de los beneficiarios con categoría "Proveedores" en Conciliación bancaria.
            </p>
          )}
          {proveedorSel === OTRO_PROVEEDOR && (
            <Input
              required
              value={proveedorLibre}
              onChange={e => setProveedorLibre(e.target.value)}
              placeholder="Ej: Shandong Mingxin, Aluminios JH"
            />
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Ref. interna</Label>
          <Input
            value={refPedido}
            onChange={e => setRefPedido(e.target.value)}
            placeholder="PO-2026-001"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label className="text-sm">Cantidad (ton)</Label>
          <Input
            type="number" step="0.001" min={0}
            value={cantidadTon}
            onChange={e => setCantidadTon(e.target.value === '' ? '' : +e.target.value)}
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Precio SMM (USD/ton)</Label>
          <Input
            type="number" step="0.01" min={0}
            value={precioSmm}
            onChange={e => setPrecioSmm(e.target.value === '' ? '' : +e.target.value)}
            placeholder="Ej: 2600"
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Mercancía (USD)</Label>
          <Input
            type="number" step="0.01" min={0}
            value={montoTotal}
            onChange={e => setMontoTotal(e.target.value === '' ? '' : +e.target.value)}
            className="font-mono"
            title="Valor de la mercancía facturada por el proveedor (sin flete). El total del contenedor = mercancía + flete, en el Resumen."
          />
        </div>
      </div>

      {/* Fechas del flujo — una por estado (con esto se miden las etapas) */}
      <div className="space-y-1.5">
        <Label className="text-sm font-semibold text-muted-foreground">Fechas del flujo (entrada a cada estado)</Label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {IMPORT_ESTADOS_ORDER.map(e => (
            <div key={e}>
              <Label className="text-xs">{IMPORT_ESTADO_LABEL[e]}</Label>
              <Input
                type="date"
                value={estadoFechas[e] ?? ''}
                max={todayIso()}
                onChange={ev => setEstadoFechas(prev => ({ ...prev, [e]: ev.target.value }))}
              />
            </div>
          ))}
          <div>
            <Label className="text-xs font-medium text-primary">ETA llegada (estimada)</Label>
            <Input type="date" value={fechaEta} onChange={e => setFechaEta(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">Notas</Label>
        <Textarea
          value={notas}
          onChange={e => setNotas(e.target.value)}
          placeholder="Detalles del pedido, contactos, condiciones..."
          rows={2}
        />
      </div>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto p-0">
        {/* ── HEADER: lo que importa, grande y con contraste ─────────────── */}
        <div className="px-6 pt-5 pb-4 border-b border-border bg-gradient-to-br from-white to-slate-50/70 dark:from-zinc-900 dark:to-zinc-950 rounded-t-lg">
          <DialogHeader className="space-y-0">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <DialogTitle className="flex items-center gap-2 text-lg truncate">
                  <Ship className="h-5 w-5 text-primary shrink-0" />
                  {isEdit ? editing!.proveedor_nombre : 'Nueva importación'}
                  {isEdit && editing!.ref_pedido && (
                    <span className="text-sm font-normal text-muted-foreground font-mono">· {editing!.ref_pedido}</span>
                  )}
                </DialogTitle>
                {!isEdit && (
                  <DialogDescription className="text-xs mt-1">
                    Pedido a proveedor del exterior. Cotización → producción → tránsito → aduana → entregado.
                  </DialogDescription>
                )}
              </div>
              {/* Estado — siempre a mano, con fecha del cambio si cambió */}
              <div className="shrink-0 w-[180px] space-y-1">
                <Select value={estado} onValueChange={(v) => setEstado(v as ImportEstado)}>
                  <SelectTrigger className="h-8 text-xs font-medium"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {IMPORT_ESTADOS_ORDER.map(e => (
                      <SelectItem key={e} value={e}>{IMPORT_ESTADO_LABEL[e]}</SelectItem>
                    ))}
                    {isEdit && editing!.estado === 'anticipo' && (
                      <SelectItem value="anticipo" disabled>Anticipo pagado (viejo)</SelectItem>
                    )}
                    <SelectItem value="cancelado">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
                {estadoCambio && (
                  <Input
                    type="date"
                    required
                    value={estadoFecha}
                    max={todayIso()}
                    onChange={e => setEstadoFecha(e.target.value)}
                    className="h-8 text-xs"
                    title="¿En qué fecha cambió de estado? Con esto se miden las etapas."
                  />
                )}
              </div>
            </div>
          </DialogHeader>

          {/* Strip de números grandes (solo edición — al crear no hay datos aún) */}
          {isEdit && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <div className={cn(
                'rounded-xl border px-3 py-2.5',
                saldoVivo > 0 ? 'border-destructive/25 bg-destructive/5' : 'border-success/25 bg-success/5',
              )}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">Saldo por pagar</p>
                <p className={cn('text-xl font-bold font-mono leading-tight', saldoVivo > 0 ? 'text-destructive' : 'text-success')}>
                  {fmtUSD0(saldoVivo)}
                </p>
                <p className="text-[10px] text-muted-foreground">de {fmtUSD0(totalNum)} mercancía</p>
              </div>
              <div className="rounded-xl border border-border bg-card px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">Pagado</p>
                <p className="text-xl font-bold font-mono leading-tight text-foreground">{fmtUSD0(pagadoVivo)}</p>
                <div className="h-1.5 rounded-full bg-muted mt-1.5 overflow-hidden">
                  <div className="h-full rounded-full bg-success" style={{ width: `${pagadoPct}%` }} />
                </div>
              </div>
              <div className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">Total USD (mercancía + flete)</p>
                <p className="text-xl font-bold font-mono leading-tight text-foreground">
                  {fmtUSD0(totalUsdContenedor)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {flete.usd > 0
                    ? `${fmtUSD0(totalNum)} mercancía + ${fmtUSD0(flete.usd)} flete`
                    : `${fmtUSD0(totalNum)} mercancía · flete: cargalo en Costeo`}
                </p>
              </div>
              <div className={cn(
                'rounded-xl border px-3 py-2.5',
                etaDias != null && etaDias < 0 ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/20' : 'border-border bg-card',
              )}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 flex items-center gap-1">
                  <CalendarClock className="h-3 w-3" /> ETA llegada
                </p>
                <p className="text-xl font-bold leading-tight text-foreground">
                  {fechaEta ? fmtFecha(fechaEta) : '—'}
                </p>
                <p className={cn('text-[10px]', etaDias != null && etaDias < 0 ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-muted-foreground')}>
                  {etaDias == null
                    ? (estado === 'entregado' ? 'entregado' : 'sin ETA — ponela en Datos')
                    : etaDias >= 0 ? `en ${etaDias} día${etaDias !== 1 ? 's' : ''}` : `atrasada ${-etaDias}d`}
                </p>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="px-6 pb-5 pt-3 space-y-4">
          {isEdit && editing ? (
            <Tabs defaultValue="resumen">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="resumen">Resumen</TabsTrigger>
                <TabsTrigger value="abonos">
                  Abonos{payments.length > 0 ? ` (${payments.length})` : ''}
                </TabsTrigger>
                <TabsTrigger value="costeo">Costeo</TabsTrigger>
                <TabsTrigger value="datos">Datos</TabsTrigger>
              </TabsList>

              {/* ── RESUMEN: tiempos + diferencia en cambio ── */}
              <TabsContent value="resumen" className="space-y-4 pt-3">
                {stages.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      Tiempos del contenedor
                      {totalDias && (
                        <span className="font-normal text-xs">
                          — {totalDias.dias} día{totalDias.dias !== 1 ? 's' : ''} {totalDias.enCurso ? 'en curso' : 'en total'}
                        </span>
                      )}
                    </Label>
                    <div className="flex flex-wrap gap-1.5">
                      {stages.map(s => (
                        <div
                          key={s.estado}
                          className={cn(
                            'px-2.5 py-1.5 rounded-lg border text-xs',
                            s.enCurso
                              ? 'border-primary/40 bg-primary/5 text-primary'
                              : 'border-border bg-muted/40 text-muted-foreground',
                          )}
                          title={`Desde ${s.desde}${s.hasta ? ` hasta ${s.hasta}` : ' (en curso)'}`}
                        >
                          <span className="font-medium">{IMPORT_ESTADO_LABEL[s.estado]}</span>
                          {s.estado !== 'entregado' && (
                            <span className="ml-1 font-mono">{s.dias}d{s.enCurso ? '…' : ''}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── COSTEO ESTIMADO: mercancía + flete → CIF → arancel → IVA ── */}
                {(() => {
                  const trmCosteo = trmPonderada != null ? Number(trmPonderada) : (trmHoy ?? null);
                  const totalUsdContenedor = totalNum + flete.usd;
                  if (totalUsdContenedor <= 0) return null;
                  const cifCop = trmCosteo ? totalUsdContenedor * trmCosteo + flete.cop : null;
                  const arancelCop = cifCop != null ? cifCop * (arancelPct / 100) : null;
                  const ivaCop = cifCop != null && arancelCop != null ? (cifCop + arancelCop) * 0.19 : null;
                  const cajaTotal = cifCop != null && arancelCop != null && ivaCop != null
                    ? cifCop + arancelCop + ivaCop : null;
                  const fmtCOP = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
                  return (
                    <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-semibold text-muted-foreground">Costeo estimado del contenedor</Label>
                        <span className="text-[10px] text-muted-foreground">
                          TRM {trmCosteo ? `$${Number(trmCosteo).toLocaleString('es-CO', { maximumFractionDigits: 0 })}` : '—'}
                          {trmPonderada != null ? ' (abonos)' : trmHoy ? ' (hoy)' : ''}
                        </span>
                      </div>
                      <div className="text-xs space-y-1 font-mono">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground font-sans">Mercancía + flete (Total USD)</span>
                          <span className="font-semibold">{fmtUSD0(totalNum)} + {fmtUSD0(flete.usd)} = {fmtUSD0(totalUsdContenedor)}</span>
                        </div>
                        {cifCop != null && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground font-sans">CIF en pesos</span>
                            <span>{fmtCOP(cifCop)}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground font-sans flex items-center gap-1.5">
                            Arancel
                            <Input
                              type="number" step="0.5" min={0} max={40}
                              value={arancelPct}
                              onChange={e => setArancelPct(e.target.value === '' ? 0 : +e.target.value)}
                              className="h-6 w-16 text-xs font-mono px-1.5 inline-block"
                              title="% de arancel según partida arancelaria — se guarda con el pedido"
                            />
                            <span className="font-sans">%</span>
                          </span>
                          <span>{arancelCop != null ? fmtCOP(arancelCop) : '—'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground font-sans">IVA importación 19% (CIF + arancel)</span>
                          <span>{ivaCop != null ? fmtCOP(ivaCop) : '—'}</span>
                        </div>
                        {cajaTotal != null && (
                          <div className="flex justify-between border-t border-border pt-1 mt-1">
                            <span className="font-sans font-semibold text-foreground">Caja necesaria (nacionalizar)</span>
                            <span className="font-semibold">{fmtCOP(cajaTotal)}</span>
                          </div>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        El IVA de importación es <strong>descontable</strong>: afecta la caja pero NO entra al costeo
                        de la mercancía. Al costeo van mercancía + flete + arancel (+ agencia). Estimación — los
                        valores reales van en la pestaña Costeo.
                      </p>
                    </div>
                  );
                })()}

                {/* ¿Cuándo montar el próximo pedido? Lead time real de tus entregas */}
                {leadTimeProm != null && (
                  <div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-xs leading-relaxed">
                    <span className="font-semibold text-primary">Próximo pedido:</span>{' '}
                    tus contenedores entregados demoraron en promedio <strong>{leadTimeProm} días</strong> de
                    cotización a entrega. Un pedido montado hoy llegaría alrededor del{' '}
                    <strong>
                      {new Date(Date.now() + leadTimeProm * DAY_MS).toLocaleDateString('es-CO', { day: '2-digit', month: 'long' })}
                    </strong>. Restale tu inventario de seguridad y esa es la fecha límite para ordenar.
                  </div>
                )}

                <ExchangeDiffPanel
                  importId={editing.id}
                  trmCausacion={editing.trm_causacion ?? null}
                  montoTotalUsd={totalNum}
                  anticipoPagadoUsd={Number(editing.anticipo_pagado_usd) || 0}
                  estado={estado}
                />
              </TabsContent>

              {/* ── ABONOS: pagos + conciliación con extractos ── */}
              <TabsContent value="abonos" className="pt-3">
                <ImportPaymentsSection importId={editing.id} />
              </TabsContent>

              {/* ── COSTEO: flete, arancel, IVA, agencia + landed cost ── */}
              <TabsContent value="costeo" className="pt-3">
                <CosteoCsvTools importId={editing.id} montoTotalUsd={editing.monto_total_usd} />
                <ImportCostingSection importId={editing.id} montoTotalUsd={editing.monto_total_usd} />
              </TabsContent>

              {/* ── DATOS: el formulario clásico ── */}
              <TabsContent value="datos" className="space-y-4 pt-3">
                {camposDatos}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDelete}
                  disabled={remove.isPending}
                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Eliminar importación
                </Button>
              </TabsContent>
            </Tabs>
          ) : (
            <div className="space-y-4">
              {camposDatos}
              <div className="space-y-1.5">
                <Label className="text-sm">Anticipo ya pagado (USD, opcional)</Label>
                <Input
                  type="number" step="0.01" min={0}
                  value={anticipo}
                  onChange={e => setAnticipo(e.target.value === '' ? '' : +e.target.value)}
                  className="font-mono"
                />
              </div>
            </div>
          )}

          {errMsg && <p className="text-xs text-destructive">{errMsg}</p>}

          <Button type="submit" disabled={saving || !proveedorNombre} className="w-full">
            {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear importación'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
