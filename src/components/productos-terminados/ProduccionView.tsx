import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Factory, Plus, Play, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProductTemplates, useInventoryByIds } from '@/hooks/useProductTemplates';
import { useProductionOrders, type ProductionOrderLine } from '@/hooks/useProductionOrders';
import { computeDespiece } from '@/types/productTemplate';

const fmtCOP = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

const ESTADO_BADGE: Record<string, string> = {
  planificada: 'bg-slate-100 text-slate-700 border-slate-300',
  en_proceso: 'bg-blue-100 text-blue-700 border-blue-300',
  terminada: 'bg-green-100 text-green-700 border-green-300',
  cancelada: 'bg-red-100 text-red-700 border-red-300',
};
const ESTADO_LABEL: Record<string, string> = {
  planificada: 'Planificada',
  en_proceso: 'En proceso',
  terminada: 'Terminada',
  cancelada: 'Cancelada',
};

/**
 * Órdenes de producción: plantilla + dimensiones + cantidad → despiece
 * congelado → consumir materiales del inventario → terminar y sumar el
 * producto terminado con su costo real. El ciclo completo del taller.
 */
export default function ProduccionView() {
  const { orders, isLoading, createOrder, applyAction } = useProductionOrders();
  const { data: templates = [] } = useProductTemplates({ onlyActive: true });

  const [modalOpen, setModalOpen] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [ancho, setAncho] = useState<number | ''>('');
  const [alto, setAlto] = useState<number | ''>('');
  const [cantidad, setCantidad] = useState<number | ''>(1);
  const [manoObra, setManoObra] = useState<number | ''>('');
  const [productoRef, setProductoRef] = useState('');

  const template = templates.find(t => t.id === templateId) ?? null;
  const pieceIds = useMemo(
    () => (template?.piezas ?? []).map(p => p.product_id).filter(Boolean),
    [template],
  );
  const { byId: productsById } = useInventoryByIds(pieceIds);

  const despiece = useMemo(() => {
    if (!template || typeof ancho !== 'number' || typeof alto !== 'number' || ancho <= 0 || alto <= 0) return null;
    return computeDespiece(template, ancho, alto, productsById);
  }, [template, ancho, alto, productsById]);

  const qty = typeof cantidad === 'number' && cantidad > 0 ? cantidad : 0;
  const costoMateriales = despiece ? despiece.costTotal * qty : 0;

  const handleCreate = async () => {
    if (!template || !despiece || qty <= 0 || !productoRef.trim()) return;
    const lines: ProductionOrderLine[] = despiece.lines
      .filter(l => l.product)
      .map(l => ({
        reference: l.product!.reference,
        descripcion: l.product!.name,
        qty: Math.round(l.qty * qty * 1000) / 1000,
        unidad: l.unidad,
        costo_unit: l.unitCost,
        costo_linea: Math.round(l.lineCost * qty),
      }));
    await createOrder.mutateAsync({
      template_id: template.id,
      template_name: `${template.name} ${ancho}×${alto}m`,
      ancho_m: Number(ancho),
      alto_m: Number(alto),
      cantidad: qty,
      despiece: lines,
      costo_materiales: Math.round(costoMateriales),
      costo_mano_obra: manoObra === '' ? 0 : Number(manoObra),
      producto_ref: productoRef.trim(),
      notas: null,
    } as never);
    setModalOpen(false);
    setTemplateId(''); setAncho(''); setAlto(''); setCantidad(1); setManoObra(''); setProductoRef('');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Plantilla + medidas + cantidad → consume materiales del inventario y suma el producto terminado con su costo real.
        </p>
        <Button size="sm" className="gap-1" onClick={() => setModalOpen(true)} disabled={!templates.length}>
          <Plus className="h-4 w-4" /> Orden
        </Button>
      </div>

      {!templates.length && (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          Primero creá una plantilla en Configuración — la orden de producción usa su despiece.
        </CardContent></Card>
      )}

      <div className="space-y-2">
        {orders.map(o => (
          <Card key={o.id}>
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-3 flex-wrap">
                <Factory className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {o.cantidad} × {o.template_name}
                    <span className="ml-2 text-xs font-normal text-muted-foreground font-mono">→ {o.producto_ref}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Materiales {fmtCOP(Number(o.costo_materiales))}
                    {Number(o.costo_mano_obra) > 0 && ` + MO ${fmtCOP(Number(o.costo_mano_obra))}`}
                    {' '}= <strong>{fmtCOP(Number(o.costo_total))}</strong>
                    {' '}({fmtCOP(o.cantidad > 0 ? Number(o.costo_total) / o.cantidad : 0)}/und) · {o.despiece.length} referencias
                  </p>
                </div>
                <Badge variant="outline" className={cn('text-[10px]', ESTADO_BADGE[o.estado])}>
                  {ESTADO_LABEL[o.estado]}
                </Badge>
                <div className="flex gap-1.5">
                  {o.estado === 'planificada' && (
                    <Button
                      size="sm" variant="outline" className="h-7 text-xs gap-1"
                      disabled={applyAction.isPending}
                      onClick={() => applyAction.mutate({ orderId: o.id, action: 'consumir' })}
                      title="Descuenta los materiales del despiece del inventario"
                    >
                      <Play className="h-3 w-3" /> Iniciar (consumir)
                    </Button>
                  )}
                  {o.estado === 'en_proceso' && (
                    <Button
                      size="sm" className="h-7 text-xs gap-1"
                      disabled={applyAction.isPending}
                      onClick={() => applyAction.mutate({ orderId: o.id, action: 'terminar' })}
                      title="Suma las unidades terminadas al inventario con su costo real"
                    >
                      <CheckCircle2 className="h-3 w-3" /> Terminar
                    </Button>
                  )}
                  {(o.estado === 'planificada' || o.estado === 'en_proceso') && (
                    <Button
                      size="sm" variant="ghost" className="h-7 text-xs text-destructive"
                      disabled={applyAction.isPending}
                      onClick={() => applyAction.mutate({ orderId: o.id, action: 'cancelar' })}
                      title="Cancela la orden (devuelve materiales si ya se consumieron)"
                    >
                      <XCircle className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {!isLoading && orders.length === 0 && templates.length > 0 && (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
            Sin órdenes todavía. Creá la primera para producir con costo real.
          </CardContent></Card>
        )}
      </div>

      {/* Modal nueva orden */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nueva orden de producción</DialogTitle>
            <DialogDescription className="text-xs">
              El despiece se congela al crear la orden con los costos actuales del inventario.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-sm">Plantilla *</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger><SelectValue placeholder="Elegí una plantilla…" /></SelectTrigger>
                <SelectContent>
                  {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Ancho (m) *</Label>
                <Input type="number" step="0.01" min={0} value={ancho} onChange={e => setAncho(e.target.value === '' ? '' : +e.target.value)} className="font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Alto (m) *</Label>
                <Input type="number" step="0.01" min={0} value={alto} onChange={e => setAlto(e.target.value === '' ? '' : +e.target.value)} className="font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cantidad *</Label>
                <Input type="number" min={1} value={cantidad} onChange={e => setCantidad(e.target.value === '' ? '' : +e.target.value)} className="font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Ref. del producto terminado *</Label>
                <Input value={productoRef} onChange={e => setProductoRef(e.target.value)} placeholder="Ej: VENT-CORR-120x150" className="font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Mano de obra total (opcional)</Label>
                <Input type="number" min={0} value={manoObra} onChange={e => setManoObra(e.target.value === '' ? '' : +e.target.value)} className="font-mono" />
              </div>
            </div>

            {despiece && qty > 0 && (
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs space-y-1">
                <p className="font-semibold">
                  Materiales para {qty} und: {fmtCOP(costoMateriales)}
                  {manoObra !== '' && Number(manoObra) > 0 && <> + MO {fmtCOP(Number(manoObra))} = <strong>{fmtCOP(costoMateriales + Number(manoObra))}</strong></>}
                </p>
                {despiece.lines.filter(l => l.product).slice(0, 6).map((l, i) => (
                  <p key={i} className="text-muted-foreground font-mono">
                    {l.product!.reference} · {(l.qty * qty).toFixed(2)} {l.unidad} · {fmtCOP(l.lineCost * qty)}
                  </p>
                ))}
                {despiece.lines.length > 6 && <p className="text-muted-foreground">… y {despiece.lines.length - 6} más</p>}
                {despiece.missingCount > 0 && (
                  <p className="text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> {despiece.missingCount} pieza(s) sin producto en inventario — no se consumirán ni costearán.
                  </p>
                )}
              </div>
            )}

            <Button
              className="w-full"
              onClick={handleCreate}
              disabled={createOrder.isPending || !template || !despiece || qty <= 0 || !productoRef.trim()}
            >
              {createOrder.isPending ? 'Creando…' : 'Crear orden'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
