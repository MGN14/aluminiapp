import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useImports, type ImportRow, type ImportEstado, IMPORT_ESTADOS_ORDER, IMPORT_ESTADO_LABEL } from '@/hooks/useImports';
import { useImportPayments } from '@/hooks/useImportPayments';
import { computeStageDurations, computeTotalDays } from '@/lib/importStages';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Trash2, Clock } from 'lucide-react';
import ImportPaymentsSection from './ImportPaymentsSection';
import ImportCostingSection from './ImportCostingSection';
import ExchangeDiffPanel from './ExchangeDiffPanel';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: ImportRow | null;
}

const todayIso = () => new Date().toISOString().split('T')[0];

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

// Modal para crear / editar una importación. Maneja todos los campos del flujo
// cotización→entregado. saldo_pendiente_usd se computa en DB, no aparece acá.
export default function ImportModal({ open, onOpenChange, editing }: Props) {
  const { create, update, remove } = useImports();
  const isEdit = !!editing;

  const [proveedorSel, setProveedorSel] = useState<string>(''); // responsible_id | __otro__
  const [proveedorLibre, setProveedorLibre] = useState('');
  const [estado, setEstado] = useState<ImportEstado>('cotizacion');
  const [estadoFecha, setEstadoFecha] = useState(todayIso()); // fecha real del cambio de estado
  const [cantidadTon, setCantidadTon] = useState<number | ''>('');
  const [precioSmm, setPrecioSmm] = useState<number | ''>('');
  const [montoTotal, setMontoTotal] = useState<number | ''>('');
  const [anticipo, setAnticipo] = useState<number | ''>('');
  const [fechaCotizacion, setFechaCotizacion] = useState('');
  const [fechaAnticipo, setFechaAnticipo] = useState('');
  const [fechaEmbarque, setFechaEmbarque] = useState('');
  const [fechaEta, setFechaEta] = useState('');
  const [fechaArribo, setFechaArribo] = useState('');
  const [refPedido, setRefPedido] = useState('');
  const [notas, setNotas] = useState('');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const { data: proveedores = [] } = useProveedoresConocidos(open);
  // TRM causación: ya no la ingresa el usuario — es el promedio ponderado de
  // los abonos del contenedor (imports_liquidation.trm_promedio_ponderada).
  const { liquidation } = useImportPayments(isEdit ? editing?.id : null);
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
      setFechaCotizacion(editing.fecha_cotizacion ?? '');
      setFechaAnticipo(editing.fecha_anticipo ?? '');
      setFechaEmbarque(editing.fecha_embarque ?? '');
      setFechaEta(editing.fecha_estimada_llegada ?? '');
      setFechaArribo(editing.fecha_arribo_real ?? '');
      setRefPedido(editing.ref_pedido ?? '');
      setNotas(editing.notas ?? '');
    } else {
      setProveedorSel('');
      setProveedorLibre('');
      setEstado('cotizacion');
      setEstadoFecha(todayIso());
      setCantidadTon('');
      setPrecioSmm('');
      setMontoTotal('');
      setAnticipo('');
      setFechaCotizacion(todayIso());
      setFechaAnticipo('');
      setFechaEmbarque('');
      setFechaEta('');
      setFechaArribo('');
      setRefPedido('');
      setNotas('');
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
      // desde los abonos — mandarlo acá pisaba el valor real con el que estaba
      // cargado al ABRIR el modal (agregabas un abono adentro, guardabas, y el
      // anticipo/saldo retrocedían al valor viejo).
      ...(isEdit ? {} : { anticipo_pagado_usd: anticipo === '' ? 0 : Number(anticipo) }),
      fecha_cotizacion: fechaCotizacion || null,
      fecha_anticipo: fechaAnticipo || null,
      fecha_embarque: fechaEmbarque || null,
      fecha_estimada_llegada: fechaEta || null,
      fecha_arribo_real: fechaArribo || null,
      ref_pedido: refPedido.trim() || null,
      notas: notas.trim() || null,
    };
    try {
      if (isEdit && editing) {
        await update.mutateAsync({
          id: editing.id,
          ...payload,
          // Solo registra historial si el estado realmente cambió
          estado_fecha: estadoCambio ? estadoFecha : undefined,
        });
      } else {
        await create.mutateAsync({ ...payload, estado_fecha: estadoFecha });
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
  // En edición, el anticipo REAL viene de la liquidación (suma de abonos, se
  // actualiza en vivo al agregar uno adentro del modal). El state `anticipo`
  // solo aplica al crear.
  const anticipoVivo = isEdit
    ? Number(liquidation?.total_pagado_usd ?? editing?.anticipo_pagado_usd ?? 0)
    : (typeof anticipo === 'number' ? anticipo : 0);
  // saldo computado en vivo para mostrarlo al usuario
  const saldoPreview =
    (typeof montoTotal === 'number' ? montoTotal : 0) - anticipoVivo;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar importación' : 'Nueva importación'}</DialogTitle>
          <DialogDescription className="text-xs">
            Pedido a proveedor del exterior. El flujo es cotización → anticipo → producción → tránsito → aduana → entregado.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Proveedor + estado + ref */}
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
                  autoFocus
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Estado *</Label>
              <Select value={estado} onValueChange={(v) => setEstado(v as ImportEstado)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {IMPORT_ESTADOS_ORDER.map(e => (
                    <SelectItem key={e} value={e}>{IMPORT_ESTADO_LABEL[e]}</SelectItem>
                  ))}
                  <SelectItem value="cancelado">Cancelado</SelectItem>
                </SelectContent>
              </Select>
              {estadoCambio && (
                <div className="pt-1">
                  <Label className="text-xs text-muted-foreground">Fecha del cambio *</Label>
                  <Input
                    type="date"
                    required
                    value={estadoFecha}
                    max={todayIso()}
                    onChange={e => setEstadoFecha(e.target.value)}
                    title="Día en que la importación pasó a este estado. Con esto se calculan las duraciones de cada etapa."
                  />
                </div>
              )}
            </div>
          </div>

          {/* Cantidad + precio SMM + TRM causación (automática) */}
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
              <Label className="text-sm">Precio SMM cerrado (USD/ton)</Label>
              <Input
                type="number" step="0.01" min={0}
                value={precioSmm}
                onChange={e => setPrecioSmm(e.target.value === '' ? '' : +e.target.value)}
                placeholder="Ej: 2600"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">
                TRM causación
                <span className="ml-1 text-[10px] text-muted-foreground font-normal">(auto)</span>
              </Label>
              <Input
                value={trmPonderada != null ? `$${Number(trmPonderada).toLocaleString('es-CO', { maximumFractionDigits: 2 })}` : isEdit ? 'Sin abonos aún' : 'Se calcula con los abonos'}
                readOnly
                disabled
                className="font-mono bg-muted"
                title="Promedio ponderado de las TRM de los abonos de este contenedor. Se actualiza solo con cada abono."
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Ref. interna</Label>
            <Input
              value={refPedido}
              onChange={e => setRefPedido(e.target.value)}
              placeholder="PO-2026-001"
            />
          </div>

          {/* Montos USD */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm">Monto total (USD)</Label>
              <Input
                type="number" step="0.01" min={0}
                value={montoTotal}
                onChange={e => setMontoTotal(e.target.value === '' ? '' : +e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">
                Anticipo pagado (USD)
                {isEdit && (
                  <span className="ml-1 text-[10px] text-muted-foreground font-normal">
                    (se calcula desde abonos)
                  </span>
                )}
              </Label>
              <Input
                type="number" step="0.01" min={0}
                value={isEdit ? anticipoVivo : anticipo}
                onChange={e => setAnticipo(e.target.value === '' ? '' : +e.target.value)}
                disabled={isEdit}
                title={isEdit ? 'Editá los abonos abajo para cambiar el total. Este campo se sincroniza solo.' : ''}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Saldo pendiente</Label>
              <Input
                value={`$${saldoPreview.toLocaleString('es-CO', { maximumFractionDigits: 2 })}`}
                readOnly
                disabled
                className="font-mono bg-muted"
              />
            </div>
          </div>

          {/* Fechas */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-muted-foreground">Fechas del flujo</Label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Cotización</Label>
                <Input type="date" value={fechaCotizacion} onChange={e => setFechaCotizacion(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Anticipo</Label>
                <Input type="date" value={fechaAnticipo} onChange={e => setFechaAnticipo(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Embarque</Label>
                <Input type="date" value={fechaEmbarque} onChange={e => setFechaEmbarque(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">ETA llegada</Label>
                <Input type="date" value={fechaEta} onChange={e => setFechaEta(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Arribo real</Label>
                <Input type="date" value={fechaArribo} onChange={e => setFechaArribo(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Duración de etapas (historial de cambios de estado) */}
          {isEdit && editing && (editing.import_estado_history?.length ?? 0) > 0 && (() => {
            const stages = computeStageDurations(editing.import_estado_history!, editing.estado);
            const total = computeTotalDays(editing.import_estado_history!, editing.estado);
            if (!stages.length) return null;
            return (
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Duración de etapas
                  {total && (
                    <span className="font-normal text-xs">
                      — {total.dias} día{total.dias !== 1 ? 's' : ''} {total.enCurso ? 'en curso' : 'en total'}
                    </span>
                  )}
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {stages.map(s => (
                    <div
                      key={s.estado}
                      className={`px-2.5 py-1.5 rounded-lg border text-xs ${
                        s.enCurso
                          ? 'border-primary/40 bg-primary/5 text-primary'
                          : 'border-border bg-muted/40 text-muted-foreground'
                      }`}
                      title={`Desde ${s.desde}${s.hasta ? ` hasta ${s.hasta}` : ' (en curso)'}`}
                    >
                      <span className="font-medium">{IMPORT_ESTADO_LABEL[s.estado]}</span>
                      {s.estado !== 'entregado' && (
                        <span className="ml-1 font-mono">
                          {s.dias}d{s.enCurso ? '…' : ''}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Abonos (solo al editar — necesita id) */}
          {isEdit && editing && (
            <ImportPaymentsSection importId={editing.id} />
          )}

          {/* Diferencia en cambio. Todo en vivo (monto total + TRM causación del
              form, abonos del hook) para no mezclar valores guardados con editados. */}
          {isEdit && editing && (
            <ExchangeDiffPanel
              importId={editing.id}
              trmCausacion={editing.trm_causacion ?? null}
              montoTotalUsd={montoTotal === '' ? 0 : Number(montoTotal)}
              anticipoPagadoUsd={Number(editing.anticipo_pagado_usd) || 0}
              estado={estado}
            />
          )}

          {/* Costeo referencia a referencia (packing list + landed cost).
              Necesita import_id, por eso solo en modo edición. */}
          {isEdit && editing && (
            <ImportCostingSection importId={editing.id} montoTotalUsd={editing.monto_total_usd} />
          )}

          {/* Notas */}
          <div className="space-y-1.5">
            <Label className="text-sm">Notas</Label>
            <Textarea
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="Detalles del pedido, contactos, condiciones..."
              rows={2}
            />
          </div>

          {errMsg && <p className="text-xs text-destructive">{errMsg}</p>}

          <div className="flex items-center gap-2">
            {isEdit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDelete}
                disabled={remove.isPending}
                className="text-destructive border-destructive/30 hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Eliminar
              </Button>
            )}
            <Button type="submit" disabled={saving || !proveedorNombre} className="flex-1">
              {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear importación'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
