import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useImports, type ImportRow, type ImportEstado, IMPORT_ESTADOS_ORDER, IMPORT_ESTADO_LABEL } from '@/hooks/useImports';
import { Trash2 } from 'lucide-react';
import ImportPaymentsSection from './ImportPaymentsSection';
import ImportCostingSection from './ImportCostingSection';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: ImportRow | null;
}

const todayIso = () => new Date().toISOString().split('T')[0];

// Modal para crear / editar una importación. Maneja todos los campos del flujo
// cotización→entregado. saldo_pendiente_usd se computa en DB, no aparece acá.
export default function ImportModal({ open, onOpenChange, editing }: Props) {
  const { create, update, remove } = useImports();
  const isEdit = !!editing;

  const [proveedor, setProveedor] = useState('');
  const [estado, setEstado] = useState<ImportEstado>('cotizacion');
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

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setProveedor(editing.proveedor_nombre);
      setEstado(editing.estado);
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
      setProveedor('');
      setEstado('cotizacion');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrMsg(null);
    if (!proveedor.trim()) {
      setErrMsg('Tenés que poner un proveedor');
      return;
    }
    const payload = {
      proveedor_nombre: proveedor.trim(),
      estado,
      cantidad_ton: cantidadTon === '' ? null : Number(cantidadTon),
      precio_smm_cerrado_usd_ton: precioSmm === '' ? null : Number(precioSmm),
      monto_total_usd: montoTotal === '' ? null : Number(montoTotal),
      anticipo_pagado_usd: anticipo === '' ? 0 : Number(anticipo),
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
        await update.mutateAsync({ id: editing.id, ...payload });
      } else {
        await create.mutateAsync(payload);
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
  // saldo computado en vivo para mostrarlo al usuario
  const saldoPreview =
    (typeof montoTotal === 'number' ? montoTotal : 0)
    - (typeof anticipo === 'number' ? anticipo : 0);

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
              <Input
                required
                value={proveedor}
                onChange={e => setProveedor(e.target.value)}
                placeholder="Ej: Shandong Mingxin, Aluminios JH"
                autoFocus
              />
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
            </div>
          </div>

          {/* Cantidad + precio SMM */}
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
              <Label className="text-sm">Ref. interna</Label>
              <Input
                value={refPedido}
                onChange={e => setRefPedido(e.target.value)}
                placeholder="PO-2026-001"
              />
            </div>
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
                value={anticipo}
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

          {/* Abonos (solo al editar — necesita id) */}
          {isEdit && editing && (
            <ImportPaymentsSection importId={editing.id} />
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
            <Button type="submit" disabled={saving || !proveedor.trim()} className="flex-1">
              {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear importación'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
