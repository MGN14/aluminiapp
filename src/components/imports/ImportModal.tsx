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
import { computeStageDurations, computeTotalDays, computeStageAverages } from '@/lib/importStages';
import { computeImportBreakdown } from '@/lib/importCosting';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { Trash2, Clock, Ship, CalendarClock, ArrowRight, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import ImportPaymentsSection from './ImportPaymentsSection';
import ImportCostingSection from './ImportCostingSection';
import ImportCostsTable from './ImportCostsTable';
import { useImportItems } from '@/hooks/useImportItems';
import ImportCierreSection from './ImportCierreSection';
import AduanaRealCosts from './AduanaRealCosts';
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
// Estructura: header con los 4 números que importan + 3 pestañas con el
// RESUMEN como protagonista (cierre + tiempos + costeo casilla por casilla),
// Costeo = abonos + landed cost por referencia, Datos = formulario.
export default function ImportModal({ open, onOpenChange, editing }: Props) {
  const { create, update, remove, data: importsData } = useImports();
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  const isEdit = !!editing;
  // "Admin" del cierre = dueño de la cuenta (los colaboradores no cierran/reabren)
  const esAdmin = isAdmin || (isEdit && user?.id === editing?.user_id);
  const cerrada = isEdit ? !!editing?.cerrada : false;
  const bloqueada = cerrada && !esAdmin;

  const [proveedorSel, setProveedorSel] = useState<string>(''); // responsible_id | __otro__
  const [proveedorLibre, setProveedorLibre] = useState('');
  const [estado, setEstado] = useState<ImportEstado>('cotizacion');
  // Ítems del pedido (proforma/packing) — para alertar cuando falta el
  // proforma: un pedido sin ítems es invisible para la cobertura.
  const { items: itemsDelPedido } = useImportItems(editing?.id ?? null);
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
  const [ivaPct, setIvaPct] = useState<number>(19);
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
      // Fechas por estado: historial primero, columnas legacy como fallback.
      // Regla de flujo: fecha_arribo_real solo mapea a 'entregado' si el
      // pedido REALMENTE está entregado (mapearlo siempre creaba un
      // 'entregado' fantasma en pedidos aún en tránsito).
      const fechas: Record<string, string> = {};
      for (const h of editing.import_estado_history ?? []) fechas[h.estado] = h.fecha;
      if (!fechas.cotizacion && editing.fecha_cotizacion) fechas.cotizacion = editing.fecha_cotizacion;
      if (!fechas.transito && editing.fecha_embarque) fechas.transito = editing.fecha_embarque;
      if (!fechas.entregado && editing.fecha_arribo_real && (editing.estado === 'entregado' || editing.estado === 'cerrado')) {
        fechas.entregado = editing.fecha_arribo_real;
      }
      setEstadoFechas(fechas);
      setFechaEta(editing.fecha_estimada_llegada ?? '');
      setRefPedido(editing.ref_pedido ?? '');
      setNotas(editing.notas ?? '');
      setArancelPct(Number(editing.arancel_pct ?? 5));
      setIvaPct(Number(editing.iva_pct ?? 19));
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
      setIvaPct(19);
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

  // Regla de flujo: las etapas DESPUÉS del estado actual no llevan fecha.
  const idxEstado = IMPORT_ESTADOS_ORDER.indexOf(estado);
  const etapaFutura = (e: ImportEstado) =>
    idxEstado !== -1 && IMPORT_ESTADOS_ORDER.indexOf(e) > idxEstado;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrMsg(null);
    if (!proveedorNombre) {
      setErrMsg('Tenés que elegir o escribir un proveedor');
      return;
    }
    // Regla de flujo: fechas en orden cronológico según las etapas
    // (cotización ≤ producción ≤ tránsito ≤ aduana ≤ entregado).
    let prevEtapa: { estado: ImportEstado; fecha: string } | null = null;
    for (const et of IMPORT_ESTADOS_ORDER) {
      if (etapaFutura(et)) continue;
      const f = estadoFechas[et];
      if (!f) continue;
      if (prevEtapa && f < prevEtapa.fecha) {
        setErrMsg(
          `Las fechas del flujo deben ir en orden: ${IMPORT_ESTADO_LABEL[et]} (${f}) no puede ser anterior a ${IMPORT_ESTADO_LABEL[prevEtapa.estado]} (${prevEtapa.fecha}).`,
        );
        return;
      }
      prevEtapa = { estado: et, fecha: f };
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
      // Columnas legacy mapeadas desde las fechas por estado (respetando la
      // regla de flujo: nada de fechas para etapas que aún no llegaron)
      fecha_cotizacion: estadoFechas.cotizacion || null,
      fecha_embarque: (etapaFutura('transito') ? null : estadoFechas.transito) || null,
      fecha_arribo_real: (estado === 'entregado' || estado === 'cerrado') ? (estadoFechas.entregado || null) : null,
      fecha_estimada_llegada: fechaEta || null,
      ref_pedido: refPedido.trim() || null,
      notas: notas.trim() || null,
      arancel_pct: arancelPct,
      iva_pct: ivaPct,
    };
    // Todas las etapas del flujo: con valor = upsert, vacía = borrar del
    // historial (así se corrige una fecha mal puesta). Las etapas futuras
    // van vacías → se limpian.
    const fechasFlujo = Object.fromEntries(
      IMPORT_ESTADOS_ORDER.map(et => [et, etapaFutura(et) ? '' : (estadoFechas[et] ?? '')]),
    ) as Partial<Record<ImportEstado, string>>;
    try {
      if (isEdit && editing) {
        await update.mutateAsync({
          id: editing.id,
          ...payload,
          // Solo registra historial si el estado realmente cambió
          estado_fecha: estadoCambio ? estadoFecha : undefined,
          estado_fechas: fechasFlujo,
        });
      } else {
        // estado_fechas: todas las fechas de flujo puestas al crear — el total
        // de días arranca desde la primera etapa, no desde el estado actual.
        await create.mutateAsync({ ...payload, estado_fecha: fechasFlujo[estado] || estadoFecha, estado_fechas: fechasFlujo });
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
  // Costos por tipo — CADA CASILLA APARTE (mercancía, flete, seguro, arancel,
  // IVA, agencia, bancarios, otros). CIF = mercancía + flete + seguro.
  const costosArr = (costosVivos as { tipo: never; monto: number; moneda: never }[] | undefined) ?? editing?.import_costs;
  const flete = sumImportCosts(costosArr, 'flete');
  const seguro = sumImportCosts(costosArr, 'seguro');
  const totalUsdContenedor = totalNum + flete.usd + seguro.usd;

  // ETA: días restantes (o atraso) para pedidos abiertos
  const etaDias = fechaEta && estado !== 'entregado' && estado !== 'cerrado' && estado !== 'cancelado'
    ? daysFromToday(fechaEta)
    : null;

  // Lead time promedio de pedidos ENTREGADOS → "¿cuándo monto el próximo?"
  const leadTimeProm = useMemo(() => {
    const rows = importsData?.all ?? [];
    const dias = rows
      .filter(r => (r.estado === 'entregado' || r.estado === 'cerrado') && (r.import_estado_history?.length ?? 0) > 0)
      .map(r => computeTotalDays(r.import_estado_history!, r.estado))
      .filter((t): t is { dias: number; enCurso: boolean } => !!t && !t.enCurso && t.dias > 0)
      .map(t => t.dias);
    if (!dias.length) return null;
    return Math.round(dias.reduce((a, b) => a + b, 0) / dias.length);
  }, [importsData]);

  // Promedio histórico por etapa (todas las importaciones) → análisis de tiempo
  const stageProm = useMemo(() => {
    const rows = (importsData?.all ?? []).filter(r => (r.import_estado_history?.length ?? 0) > 0);
    if (!rows.length) return null;
    const avgs = computeStageAverages(rows.map(r => ({ history: r.import_estado_history!, estado: r.estado })));
    return Object.keys(avgs).length ? avgs : null;
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

      {/* Fechas del flujo — una por estado, en orden: Cotización → En producción
          → En tránsito → En aduana → Entregado (Entregado SIEMPRE la última).
          Regla de flujo: las etapas posteriores al estado actual quedan
          bloqueadas (se desbloquean al avanzar el estado) y las fechas deben
          ir en orden cronológico. La ETA no va acá: vive en el Resumen. */}
      <div className="space-y-1.5">
        <Label className="text-sm font-semibold text-muted-foreground">Fechas del flujo (entrada a cada estado)</Label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {IMPORT_ESTADOS_ORDER.map(e => {
            const futura = etapaFutura(e);
            return (
              <div key={e}>
                <Label className={cn('text-xs', futura && 'text-muted-foreground/60')}>{IMPORT_ESTADO_LABEL[e]}</Label>
                <Input
                  type="date"
                  value={futura ? '' : (estadoFechas[e] ?? '')}
                  max={todayIso()}
                  disabled={futura}
                  title={futura ? `El pedido está en "${IMPORT_ESTADO_LABEL[estado]}" — esta etapa se desbloquea al avanzar el estado` : undefined}
                  onChange={ev => setEstadoFechas(prev => ({ ...prev, [e]: ev.target.value }))}
                />
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Solo hasta la etapa actual ({IMPORT_ESTADO_LABEL[estado]}) — las fechas deben ir en orden y las etapas futuras se desbloquean al avanzar el estado.
        </p>
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
                  {cerrada && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-success bg-success/10 border border-success/30 rounded-full px-2 py-0.5">
                      <Lock className="h-3 w-3" /> Cerrada
                    </span>
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
                <Select value={estado} onValueChange={(v) => setEstado(v as ImportEstado)} disabled={bloqueada}>
                  <SelectTrigger className="h-8 text-xs font-medium"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {IMPORT_ESTADOS_ORDER.map(e => (
                      <SelectItem key={e} value={e}>{IMPORT_ESTADO_LABEL[e]}</SelectItem>
                    ))}
                    {isEdit && editing!.estado === 'anticipo' && (
                      <SelectItem value="anticipo" disabled>Anticipo pagado (viejo)</SelectItem>
                    )}
                    {/* Cerrado no se elige a mano: se llega vía el checklist de cierre */}
                    {estado === 'cerrado' && (
                      <SelectItem value="cerrado" disabled>Cerrado (vía checklist)</SelectItem>
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
                {/* TRM promedio REALMENTE pagada (ponderada de los abonos) — el
                    dato que Nico no veía en ningún lado */}
                <p className="text-[10px] text-muted-foreground">
                  {trmPonderada != null
                    ? <>TRM prom. pagada <span className="font-mono font-semibold text-foreground">${Number(trmPonderada).toLocaleString('es-CO', { maximumFractionDigits: 0 })}</span></>
                    : 'TRM pagada: registrá abonos'}
                </p>
                <div className="h-1.5 rounded-full bg-muted mt-1.5 overflow-hidden">
                  <div className="h-full rounded-full bg-success" style={{ width: `${pagadoPct}%` }} />
                </div>
              </div>
              <div className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">Total contenedor (USD)</p>
                <p className="text-xl font-bold font-mono leading-tight text-foreground">
                  {fmtUSD0(totalUsdContenedor)}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {flete.usd > 0 || seguro.usd > 0
                    ? 'mercancía + flete + seguro — desglose en Resumen'
                    : `${fmtUSD0(totalNum)} mercancía · flete/seguro: cargalos en Resumen`}
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
                    ? (estado === 'entregado' ? 'entregado' : 'sin ETA — ponela en Resumen')
                    : etaDias >= 0 ? `en ${etaDias} día${etaDias !== 1 ? 's' : ''}` : `atrasada ${-etaDias}d`}
                </p>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="px-6 pb-5 pt-3 space-y-4">
          {isEdit && editing ? (
            <Tabs defaultValue="resumen">
              {/* Resumen es el protagonista: pestaña destacada, todo lo importante vive ahí */}
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger
                  value="resumen"
                  className="font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  Resumen
                </TabsTrigger>
                <TabsTrigger value="costeo">
                  Costeo{payments.length > 0 ? ` (${payments.length})` : ''}
                </TabsTrigger>
                <TabsTrigger value="datos">Datos</TabsTrigger>
              </TabsList>

              {/* ── RESUMEN: cierre + tiempos + costeo casilla por casilla ── */}
              <TabsContent value="resumen" className="space-y-4 pt-3">
                {/* Cierre con checklist (aparece al llegar a 'entregado') */}
                <ImportCierreSection
                  importId={editing.id}
                  cerrada={cerrada}
                  cerradaAt={editing.cerrada_at ?? null}
                  estado={estado}
                  esAdmin={!!esAdmin}
                  paymentsCount={payments.length}
                />

                {/* Liquidación de aduana REAL — se habilita desde 'en aduana':
                    lo pagado manda sobre el estimado por TRM (pedido de Nico) */}
                {(estado === 'aduana' || estado === 'entregado' || estado === 'cerrado') && (
                  <AduanaRealCosts importId={editing.id} disabled={bloqueada} />
                )}

                {/* ── TIEMPOS DEL CONTENEDOR: legibles, con análisis vs histórico ── */}
                <div className="rounded-xl border border-border bg-card px-4 py-3 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <Label className="text-sm font-semibold flex items-center gap-1.5">
                      <Clock className="h-4 w-4 text-primary" />
                      Tiempos del contenedor
                    </Label>
                    {totalDias && (
                      <span className="text-sm font-bold font-mono">
                        {totalDias.dias} día{totalDias.dias !== 1 ? 's' : ''}
                        <span className="font-sans font-normal text-xs text-muted-foreground"> {totalDias.enCurso ? 'en curso' : 'en total'}</span>
                        {leadTimeProm != null && (
                          <span className="font-sans font-normal text-xs text-muted-foreground"> · prom. histórico {leadTimeProm}d</span>
                        )}
                      </span>
                    )}
                  </div>

                  {stages.length > 0 ? (
                    <div className="flex flex-wrap items-stretch gap-1">
                      {stages.map((s, i) => {
                        const prom = s.estado !== 'entregado' ? stageProm?.[s.estado]?.promedio : undefined;
                        const delta = prom != null && !s.enCurso ? s.dias - prom : null;
                        return (
                          <div key={s.estado} className="flex items-center gap-1">
                            <div
                              className={cn(
                                'rounded-lg border px-2.5 py-1.5 min-w-[92px]',
                                s.enCurso ? 'border-primary/50 bg-primary/5' : 'border-border bg-muted/30',
                              )}
                              title={`Desde ${s.desde}${s.hasta && s.hasta !== s.desde ? ` hasta ${s.hasta}` : s.enCurso ? ' (en curso)' : ''}`}
                            >
                              <p className={cn('text-[10px] font-semibold uppercase tracking-wide', s.enCurso ? 'text-primary' : 'text-muted-foreground')}>
                                {IMPORT_ESTADO_LABEL[s.estado]}
                              </p>
                              {s.estado === 'entregado' ? (
                                <p className="text-base font-bold leading-tight">{fmtFecha(s.desde)}</p>
                              ) : (
                                <p className={cn('text-base font-bold font-mono leading-tight', s.enCurso ? 'text-primary' : 'text-foreground')}>
                                  {s.dias}d
                                </p>
                              )}
                              {/* Fecha de inicio de la etapa SIEMPRE visible (pedido de Nico) */}
                              <p className="text-[9.5px] text-muted-foreground leading-tight">
                                {s.estado === 'entregado'
                                  ? 'entrega'
                                  : `${fmtFecha(s.desde)}${s.enCurso ? ' → hoy' : s.hasta && s.hasta !== s.desde ? ` → ${fmtFecha(s.hasta)}` : ''}`}
                              </p>
                              {s.estado !== 'entregado' && prom != null && (
                                <p className="text-[9.5px] leading-tight">
                                  {s.enCurso
                                    ? <span className="text-muted-foreground">prom {prom}d</span>
                                    : delta != null && delta !== 0
                                      ? <span className={delta > 0 ? 'text-destructive font-medium' : 'text-success font-medium'}>{delta > 0 ? '+' : '−'}{Math.abs(delta)}d vs prom</span>
                                      : <span className="text-muted-foreground">igual al prom</span>}
                                </p>
                              )}
                            </div>
                            {i < stages.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Sin fechas del flujo todavía — cargalas en la pestaña Datos y acá se miden las etapas.
                    </p>
                  )}

                  {/* Análisis de la etapa en curso vs promedio histórico */}
                  {(() => {
                    const enCurso = stages.find(s => s.enCurso);
                    const prom = enCurso ? stageProm?.[enCurso.estado]?.promedio : undefined;
                    if (!enCurso || prom == null) return null;
                    const resto = prom - enCurso.dias;
                    return (
                      <p className={cn('text-[11px] leading-relaxed', enCurso.dias > prom ? 'text-amber-600 font-medium' : 'text-muted-foreground')}>
                        {IMPORT_ESTADO_LABEL[enCurso.estado]} lleva <strong>{enCurso.dias} día{enCurso.dias !== 1 ? 's' : ''}</strong> — tu promedio
                        histórico en esa etapa es {prom}d{resto > 0
                          ? ` (quedarían ~${resto}d si se comporta como siempre).`
                          : ` — ya se pasó ${enCurso.dias - prom}d del promedio, vale la pena averiguar por qué.`}
                      </p>
                    );
                  })()}

                  {/* ETA — estimada, vive acá en el Resumen (la real de aduana va en Datos) */}
                  <div className="flex items-center gap-2 flex-wrap border-t border-border pt-2.5">
                    <Label className="text-xs font-medium flex items-center gap-1">
                      <CalendarClock className="h-3.5 w-3.5 text-primary" /> ETA llegada (estimada)
                    </Label>
                    <Input
                      type="date"
                      value={fechaEta}
                      onChange={e => setFechaEta(e.target.value)}
                      disabled={bloqueada}
                      className="h-8 w-40 text-xs"
                    />
                    {etaDias != null && (
                      <span className={cn('text-xs font-medium', etaDias < 0 ? 'text-amber-600' : 'text-muted-foreground')}>
                        {etaDias >= 0 ? `en ${etaDias} día${etaDias !== 1 ? 's' : ''}` : `atrasada ${-etaDias}d`}
                      </span>
                    )}
                  </div>
                </div>

                {/* Sin proforma/packing = pedido invisible para la cobertura.
                    Es incoherente tener una importación sin proforma (Nico). */}
                {editing && itemsDelPedido.length === 0 && estado !== 'entregado' && estado !== 'cerrado' && estado !== 'cancelado' && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                    ⚠️ <strong>Este pedido no tiene proforma ni packing list.</strong> Sin él, su carga NO cuenta
                    como cobertura (el análisis de reorden lo ignora) y no hay costeo por referencia. Subí el
                    proforma en la pestaña <strong>Costeo</strong> apenas mandes a producción — cuando llegue el
                    packing list definitivo, lo subís también y la app te muestra las diferencias.
                  </div>
                )}

                {/* ── COSTEO DEL CONTENEDOR: cada casilla aparte ── */}
                {(() => {
                  const trmCosteo = trmPonderada != null ? Number(trmPonderada) : (trmHoy ?? null);
                  const fmtCOP = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
                  // Misma lib que la lista y los KPIs — arancel/IVA real manda
                  // sobre el estimado por %.
                  const bd = computeImportBreakdown({
                    mercanciaUsd: totalNum,
                    costs: costosArr,
                    trm: trmCosteo,
                    arancelPct,
                    ivaPct,
                    cantidadKg: cantidadTon === '' ? null : Number(cantidadTon) * 1000,
                  });
                  const { cifUsd, cifCop, arancelCop, usaArancelReal, ivaCop, usaIvaReal, otrosCop, totalImportacionCop: totalImportacion, fobUsdKg, pisoAplicado, pisoFobUsdKg, cifAduanaCop } = bd;
                  const rowUsd = (v: { usd: number; cop: number }) => (
                    <span>
                      {v.usd > 0 ? fmtUSD0(v.usd) : v.cop > 0 ? '' : '—'}
                      {v.cop > 0 && <span className="text-muted-foreground">{v.usd > 0 ? ' + ' : ''}{fmtCOP(v.cop)} COP</span>}
                    </span>
                  );
                  return (
                    <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-semibold">Costeo del contenedor</Label>
                        <span className="text-[10px] text-muted-foreground">
                          {trmCosteo
                            ? `TRM $${Number(trmCosteo).toLocaleString('es-CO', { maximumFractionDigits: 0 })}${trmPonderada != null ? ' (promediada de abonos)' : ' (hoy — sin abonos aún)'}`
                            : 'sin TRM — registrá abonos'}
                        </span>
                      </div>

                      <div className="text-xs space-y-1 font-mono">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground font-sans">Mercancía (FOB)</span>
                          <span className="font-semibold">{fmtUSD0(totalNum)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground font-sans">Flete internacional</span>
                          {rowUsd(flete)}
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground font-sans">Seguro</span>
                          {rowUsd(seguro)}
                        </div>
                        <div className="flex justify-between border-t border-border pt-1">
                          <span className="font-sans font-medium text-foreground">Total USD</span>
                          <span className="font-semibold">{fmtUSD0(cifUsd)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground font-sans">× TRM promediada de abonos</span>
                          <span>{trmCosteo ? `$${Number(trmCosteo).toLocaleString('es-CO', { maximumFractionDigits: 2 })}` : '—'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-sans font-medium text-foreground">CIF en pesos</span>
                          <span className="font-semibold">{cifCop != null ? fmtCOP(cifCop) : '—'}</span>
                        </div>
                        {/* Piso FOB aduanero: si el precio del pedido quedó bajo el umbral
                            legal (pasa cuando baja el SMM), la DIAN liquida arancel e IVA
                            sobre la base mínima — no sobre el valor factura. */}
                        {pisoAplicado && cifAduanaCop != null && (
                          <div className="font-sans rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 my-1 text-[11px] leading-relaxed text-foreground">
                            ⚖️ <strong>Piso FOB aplicado:</strong> tu precio es{' '}
                            <strong>{fobUsdKg?.toFixed(2)} USD/kg</strong>, bajo el mínimo legal de{' '}
                            <strong>{pisoFobUsdKg.toFixed(2)} USD/kg</strong>. Arancel e IVA estimados
                            sobre la base aduanera mínima: <strong>{fmtCOP(cifAduanaCop)}</strong> (no
                            sobre tu CIF factura).
                          </div>
                        )}
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground font-sans flex items-center gap-1.5">
                            Arancel
                            <Input
                              type="number" step="0.5" min={0} max={40}
                              value={arancelPct}
                              onChange={e => setArancelPct(e.target.value === '' ? 0 : +e.target.value)}
                              disabled={bloqueada || usaArancelReal}
                              className="h-6 w-16 text-xs font-mono px-1.5 inline-block"
                              title="% de arancel según partida arancelaria — se guarda con el pedido"
                            />
                            <span className="font-sans">%</span>
                            {usaArancelReal && <span className="font-sans text-[9px] text-success font-medium">real cargado</span>}
                          </span>
                          <span>{arancelCop != null ? fmtCOP(arancelCop) : '—'}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground font-sans flex items-center gap-1.5">
                            IVA
                            <Input
                              type="number" step="0.5" min={0} max={30}
                              value={ivaPct}
                              onChange={e => setIvaPct(e.target.value === '' ? 0 : +e.target.value)}
                              disabled={bloqueada || usaIvaReal}
                              className="h-6 w-16 text-xs font-mono px-1.5 inline-block"
                              title="% de IVA de importación (base: CIF + arancel) — se guarda con el pedido"
                            />
                            <span className="font-sans">% (CIF + arancel)</span>
                            {usaIvaReal && <span className="font-sans text-[9px] text-success font-medium">real cargado</span>}
                          </span>
                          <span>{ivaCop != null ? fmtCOP(ivaCop) : '—'}</span>
                        </div>
                        {otrosCop > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground font-sans">Otros costos (agencia, bancarios, otros)</span>
                            <span>{fmtCOP(otrosCop)}</span>
                          </div>
                        )}
                      </div>

                      {/* Módulo de costos: se cargan acá mismo, donde se ven */}
                      <div className="pt-1">
                        <ImportCostsTable importId={editing.id} disabled={bloqueada} />
                      </div>

                      <div className="flex justify-between items-center border-t-2 border-border pt-2">
                        <span className="text-sm font-bold">
                          Total Importación{editing.ref_pedido ? <span className="font-mono font-semibold text-muted-foreground"> · {editing.ref_pedido}</span> : ''}
                        </span>
                        <span className="text-base font-bold font-mono">
                          {totalImportacion != null ? fmtCOP(totalImportacion) : '—'}
                        </span>
                      </div>

                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        El IVA de importación es <strong>descontable</strong>: afecta la caja pero NO entra al costeo
                        de la mercancía. Al costo del inventario van mercancía + flete + seguro + arancel (+ agencia) —
                        el detalle por referencia está en la pestaña Costeo.
                      </p>
                    </div>
                  );
                })()}

                {/* ¿Cuándo montar el próximo pedido? Lead time real de tus entregas */}
                {leadTimeProm != null && estado !== 'entregado' && estado !== 'cerrado' && (
                  <div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-xs leading-relaxed">
                    <span className="font-semibold text-primary">Próximo pedido:</span>{' '}
                    tus contenedores entregados demoraron en promedio <strong>{leadTimeProm} días</strong> de
                    cotización a entrega. Un pedido montado hoy llegaría alrededor del{' '}
                    <strong>
                      {new Date(Date.now() + leadTimeProm * DAY_MS).toLocaleDateString('es-CO', { day: '2-digit', month: 'long' })}
                    </strong>. La <strong>fecha límite</strong> calculada con tu stock físico, consumo real y
                    lo que viene en tránsito está en la card de arriba de la página de Importaciones.
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

              {/* ── COSTEO: abonos (TRM real) + landed cost referencia a referencia ── */}
              <TabsContent value="costeo" className="space-y-4 pt-3">
                <ImportPaymentsSection importId={editing.id} />
                <div>
                  <CosteoCsvTools importId={editing.id} montoTotalUsd={editing.monto_total_usd} />
                  <ImportCostingSection importId={editing.id} montoTotalUsd={editing.monto_total_usd} />
                </div>
              </TabsContent>

              {/* ── DATOS: el formulario clásico ── */}
              <TabsContent value="datos" className="space-y-4 pt-3">
                {camposDatos}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDelete}
                  disabled={remove.isPending || bloqueada}
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
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-sm">Anticipo ya pagado (USD, opcional)</Label>
                  <Input
                    type="number" step="0.01" min={0}
                    value={anticipo}
                    onChange={e => setAnticipo(e.target.value === '' ? '' : +e.target.value)}
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm">ETA llegada (estimada)</Label>
                  <Input type="date" value={fechaEta} onChange={e => setFechaEta(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {errMsg && <p className="text-xs text-destructive">{errMsg}</p>}

          {bloqueada ? (
            <p className="text-xs text-muted-foreground text-center border border-border rounded-lg py-2.5 flex items-center justify-center gap-1.5">
              <Lock className="h-3.5 w-3.5" /> Importación cerrada — solo el administrador puede modificarla.
            </p>
          ) : (
            <Button type="submit" disabled={saving || !proveedorNombre} className="w-full">
              {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear importación'}
            </Button>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
