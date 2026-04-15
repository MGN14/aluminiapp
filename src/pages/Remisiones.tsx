import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useModuleContext } from '@/hooks/useModuleContext';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Package, Eye, Trash2, Pencil, ArrowRightLeft, AlertTriangle, CheckCircle, AlertCircle, XCircle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import NewRemisionModal from '@/components/remisiones/NewRemisionModal';
import RemisionDetailModal from '@/components/remisiones/RemisionDetailModal';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(value);
}
function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-'); return `${d}/${m}/${y}`;
}

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  pendiente: { label: 'Pendiente', variant: 'secondary' },
  despachado: { label: 'Despachado', variant: 'default' },
  cancelado: { label: 'Cancelado', variant: 'destructive' },
};

function calcScore(remision: any, invoiceItems: any[]): { score: number; label: string; color: string; icon: any; detail: string } {
  const remItems = remision.remision_items || [];
  const remTotal = remision.total_manual ? Number(remision.total_manual) : remItems.reduce((s: number, i: any) => s + Number(i.total_cost || 0), 0);
  const remUnits = remItems.reduce((s: number, i: any) => s + Number(i.units), 0);
  const remRefs = new Set(remItems.map((i: any) => String(i.reference).toLowerCase().trim()));

  // Filtrar invoice_items del mismo año de la remisión
  const remYear = remision.date?.slice(0, 4);
  const relevantInv = invoiceItems.filter(i => i.issue_date?.slice(0, 4) === remYear);

  // Score de valor (50%)
  const invoicedTotal = relevantInv.reduce((s: number, i: any) => s + Number(i.line_total || 0), 0);
  const valueRatio = remTotal > 0 ? Math.min(invoicedTotal / remTotal, 1) : 0;
  const valueScore = valueRatio * 50;

  // Score de unidades (50%)
  const invoicedUnits = relevantInv.reduce((s: number, i: any) => s + Number(i.quantity || 0), 0);
  const unitsRatio = remUnits > 0 ? Math.min(invoicedUnits / remUnits, 1) : 0;
  const unitsScore = unitsRatio * 50;

  const score = Math.round(valueScore + unitsScore);

  // Detectar caso especial: valor ok pero referencias no coinciden
  const invRefs = new Set(relevantInv.map((i: any) => String(i.reference || i.item_code || '').toLowerCase().trim()).filter(Boolean));
  const refMatch = remRefs.size > 0 ? [...remRefs].filter(r => invRefs.has(r)).length / remRefs.size : 0;
  const valueOkRefsNot = valueRatio >= 0.8 && refMatch < 0.5;

  let label: string, color: string, icon: any, detail: string;

  if (valueOkRefsNot) {
    label = 'Valor cubierto, refs. distintas'; color = 'text-yellow-600'; icon = AlertTriangle;
    detail = `El valor total está cubierto (${Math.round(valueRatio * 100)}%) pero las referencias no coinciden. Puede ser válido si facturaste productos equivalentes — documentá la justificación ante una revisión DIAN.`;
  } else if (score >= 80) {
    label = 'Bien respaldada'; color = 'text-green-600'; icon = CheckCircle;
    detail = `Remisión bien respaldada fiscalmente. Valor cubierto: ${Math.round(valueRatio * 100)}%, unidades: ${Math.round(unitsRatio * 100)}%.`;
  } else if (score >= 50) {
    label = 'Respaldo parcial'; color = 'text-yellow-600'; icon = AlertCircle;
    detail = `Respaldo parcial. Valor cubierto: ${Math.round(valueRatio * 100)}%, unidades: ${Math.round(unitsRatio * 100)}%. Revisá si hay facturas complementarias pendientes.`;
  } else if (score >= 20) {
    label = 'Alerta fiscal'; color = 'text-orange-600'; icon = AlertTriangle;
    detail = `Alerta fiscal — esta remisión tiene poco respaldo en facturas. Valor cubierto: ${Math.round(valueRatio * 100)}%, unidades: ${Math.round(unitsRatio * 100)}%.`;
  } else {
    label = 'Sin factura'; color = 'text-red-600'; icon = XCircle;
    detail = `Remisión sin factura asociada — riesgo alto ante la DIAN. No se encontraron facturas que respalden este despacho.`;
  }

  return { score, label, color, icon, detail };
}

export default function Remisiones() {
  const { user } = useAuth();
  const { isGerencial, mode } = useModuleContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
  const [moverId, setMoverId] = useState<string | null>(null);
  const [scoreDetail, setScoreDetail] = useState<{ label: string; detail: string; color: string } | null>(null);

  // Leer módulo directamente del localStorage como fuente de verdad
  const savedMode = localStorage.getItem('aluminia_module_mode');
  const effectiveGerencial = isGerencial || mode === 'gerencial' || savedMode === 'gerencial';
  const moduleOrigin = effectiveGerencial ? 'gerencial' : 'dian';

  // Re-fetch cuando cambia el módulo
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['remisiones', user?.id] });
  }, [moduleOrigin, user?.id]);

  const { data: remisiones = [], isLoading } = useQuery({
    queryKey: ['remisiones', user?.id, moduleOrigin],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('remisiones')
        .select(`id, date, number, beneficiary, notes, status, created_at, total_manual, module_origin,
          remision_items(id, reference, product_name, units, unit_cost, total_cost)`)
        .eq('user_id', user.id)
        .eq('module_origin', moduleOrigin)
        .order('date', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  // En módulo DIAN, traer invoice_items para el score
  const { data: invoiceItems = [] } = useQuery({
    queryKey: ['invoice-items-score', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('invoice_items')
        .select('reference, item_code, quantity, line_total, invoices!inner(issue_date, user_id)')
        .eq('user_id', user.id);
      return (data || []).map((i: any) => ({
        reference: i.reference,
        item_code: i.item_code,
        quantity: i.quantity,
        line_total: i.line_total,
        issue_date: i.invoices?.issue_date,
      }));
    },
    enabled: !!user?.id && !effectiveGerencial,
  });

  const handleDelete = async (id: string, number: string) => {
    if (!confirm(`¿Querés eliminar la ${number}? Esta acción no se puede deshacer.`)) return;
    const { error } = await supabase.from('remisiones').delete().eq('id', id);
    if (error) {
      toast({ title: 'No se pudo eliminar', description: 'Intentá de nuevo en un momento.', variant: 'destructive' });
    } else {
      toast({ title: `${number} eliminada correctamente` });
      queryClient.invalidateQueries({ queryKey: ['remisiones'] });
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    const { error } = await supabase.from('remisiones').update({ status: newStatus }).eq('id', id);
    if (error) {
      toast({ title: 'No se pudo actualizar el estado', variant: 'destructive' });
    } else {
      toast({ title: `Estado actualizado a ${STATUS_LABELS[newStatus]?.label}` });
      queryClient.invalidateQueries({ queryKey: ['remisiones'] });
    }
    setEditingStatusId(null);
  };

  const handleMoverDIAN = async () => {
    if (!moverId) return;
    const { error } = await supabase.from('remisiones').update({ module_origin: 'dian' }).eq('id', moverId);
    if (error) {
      toast({ title: 'No se pudo mover', variant: 'destructive' });
    } else {
      toast({ title: 'Remisión movida al Módulo DIAN', description: 'El sistema comenzará a monitorear su cobertura fiscal.' });
      queryClient.invalidateQueries({ queryKey: ['remisiones'] });
    }
    setMoverId(null);
  };

  const totalRemisiones = remisiones.length;
  const totalUnidades = remisiones.reduce((s, r: any) => s + (r.remision_items?.reduce((si: number, i: any) => si + Number(i.units), 0) || 0), 0);
  const totalValor = remisiones.reduce((s, r: any) => {
    const itemsValor = r.remision_items?.reduce((si: number, i: any) => si + Number(i.total_cost || 0), 0) || 0;
    return s + (r.total_manual ? Number(r.total_manual) : itemsValor);
  }, 0);

  const moverRemision = remisiones.find((r: any) => r.id === moverId) as any;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Remisiones</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {effectiveGerencial ? 'Despachos con seguimiento interno' : 'Despachos con seguimiento fiscal — cruzados contra facturas emitidas'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
              Módulo: {moduleOrigin} | localStorage: {localStorage.getItem('aluminia_module_mode') || 'null'}
            </span>
            <Button onClick={() => setNewOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />Nueva Remisión
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-0 shadow-sm"><CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Remisiones</p>
            <p className="text-2xl font-bold">{totalRemisiones}</p>
          </CardContent></Card>
          <Card className="border-0 shadow-sm"><CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Unidades</p>
            <p className="text-2xl font-bold">{totalUnidades.toLocaleString('es-CO')}</p>
          </CardContent></Card>
          <Card className="border-0 shadow-sm"><CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Valor Total</p>
            <p className="text-2xl font-bold">{formatCurrency(totalValor)}</p>
          </CardContent></Card>
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-base">Historial de Remisiones</CardTitle></CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">Cargando...</div>
            ) : remisiones.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                <Package className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-muted-foreground">No hay remisiones en este módulo aún.</p>
                <Button variant="outline" onClick={() => setNewOpen(true)} className="gap-2">
                  <Plus className="h-4 w-4" />Crear primera remisión
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead># Remisión</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Beneficiario</TableHead>
                    <TableHead className="text-right">Refs.</TableHead>
                    <TableHead className="text-right">Unidades</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Estado</TableHead>
                    {!effectiveGerencial && <TableHead>Score Fiscal</TableHead>}
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {remisiones.map((r: any) => {
                    const items = r.remision_items || [];
                    const unidades = items.reduce((s: number, i: any) => s + Number(i.units), 0);
                    const itemsValor = items.reduce((s: number, i: any) => s + Number(i.total_cost || 0), 0);
                    const valor = r.total_manual ? Number(r.total_manual) : itemsValor;
                    const status = STATUS_LABELS[r.status] || STATUS_LABELS.pendiente;
                    const score = !effectiveGerencial ? calcScore(r, invoiceItems) : null;
                    const ScoreIcon = score?.icon;

                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.number}</TableCell>
                        <TableCell>{formatDate(r.date)}</TableCell>
                        <TableCell>{r.beneficiary}</TableCell>
                        <TableCell className="text-right">{items.length}</TableCell>
                        <TableCell className="text-right">{unidades.toLocaleString('es-CO')}</TableCell>
                        <TableCell className="text-right">{formatCurrency(valor)}</TableCell>
                        <TableCell>
                          {editingStatusId === r.id ? (
                            <Select defaultValue={r.status} onValueChange={(v) => handleStatusChange(r.id, v)}>
                              <SelectTrigger className="h-7 text-xs w-36"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pendiente">Pendiente</SelectItem>
                                <SelectItem value="despachado">Despachado</SelectItem>
                                <SelectItem value="cancelado">Cancelado</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant={status.variant}>{status.label}</Badge>
                          )}
                        </TableCell>
                        {!effectiveGerencial && score && (
                          <TableCell>
                            <button
                              onClick={() => setScoreDetail({ label: score.label, detail: score.detail, color: score.color })}
                              className={`flex items-center gap-1 text-xs font-medium ${score.color} hover:opacity-70`}
                            >
                              {ScoreIcon && <ScoreIcon className="h-3.5 w-3.5" />}
                              <span>{score.score}% — {score.label}</span>
                            </button>
                          </TableCell>
                        )}
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => setDetailId(r.id)} title="Ver detalle">
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setEditingStatusId(editingStatusId === r.id ? null : r.id)} title="Cambiar estado">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {effectiveGerencial && (
                              <Button variant="ghost" size="icon" onClick={() => setMoverId(r.id)} title="Mover a Módulo DIAN">
                                <ArrowRightLeft className="h-4 w-4 text-blue-500" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id, r.number)} title="Eliminar">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Modal mover a DIAN */}
      <Dialog open={!!moverId} onOpenChange={(o) => { if (!o) setMoverId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mover al Módulo DIAN</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>Al mover la <strong>{moverRemision?.number}</strong> al Módulo DIAN, estás indicando que <strong>vas a facturarla</strong>.</p>
            <p>El sistema comenzará a monitorear su cobertura fiscal y te alertará si hay brechas entre lo despachado y lo facturado.</p>
            <p className="text-orange-600 font-medium">¿Confirmás que esta remisión será vinculada a una factura?</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoverId(null)}>Cancelar</Button>
            <Button onClick={handleMoverDIAN}>Sí, mover a DIAN</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal detalle score */}
      <Dialog open={!!scoreDetail} onOpenChange={(o) => { if (!o) setScoreDetail(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className={scoreDetail?.color}>Score Fiscal — {scoreDetail?.label}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{scoreDetail?.detail}</p>
          <DialogFooter>
            <Button onClick={() => setScoreDetail(null)}>Entendido</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewRemisionModal
        open={newOpen}
        onOpenChange={setNewOpen}
        onComplete={() => queryClient.invalidateQueries({ queryKey: ['remisiones'] })}
      />
      {detailId && (
        <RemisionDetailModal
          remisionId={detailId}
          open={!!detailId}
          onOpenChange={(o) => { if (!o) setDetailId(null); }}
        />
      )}
    </AppLayout>
  );
}
