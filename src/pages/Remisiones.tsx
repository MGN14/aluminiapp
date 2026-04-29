import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useModuleContext } from '@/hooks/useModuleContext';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Package, Eye, Trash2, Pencil, ArrowRightLeft, AlertTriangle, CheckCircle, AlertCircle, XCircle, Link, ArrowUp, ArrowDown, ArrowUpDown, Search } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import NewRemisionModal from '@/components/remisiones/NewRemisionModal';
import RemisionDetailModal from '@/components/remisiones/RemisionDetailModal';
import VincularFacturaModal from '@/components/remisiones/VincularFacturaModal';
import { reverseRemisionInventory } from '@/lib/remisionInventory';

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

function calcScore(remision: any): { score: number; label: string; color: string; icon: any; detail: string } {
  const remItems = remision.remision_items || [];
  const remTotal = remision.total_manual ? Number(remision.total_manual) : remItems.reduce((s: number, i: any) => s + Number(i.total_cost || 0), 0);
  const remUnits = remItems.reduce((s: number, i: any) => s + Number(i.units), 0);
  const remRefs = new Set(remItems.map((i: any) => String(i.reference).toLowerCase().trim()));

  // Usar SOLO las facturas vinculadas específicamente
  const linkedInvoices = (remision.remision_invoices || []).map((ri: any) => ri.invoices).filter(Boolean);

  if (linkedInvoices.length === 0) {
    return { score: 0, label: 'Sin factura vinculada', color: 'text-red-600', icon: XCircle, detail: 'No hay facturas vinculadas a esta remisión. Usá el botón de enlace para asociar las facturas correspondientes.' };
  }

  // Items de todas las facturas vinculadas
  const allLinkedItems = linkedInvoices.flatMap((inv: any) => inv.invoice_items || []);

  // Score de valor (50%) — suma total de facturas vinculadas vs total remisión
  const invoicedTotal = linkedInvoices.reduce((s: number, inv: any) => s + Number(inv.total_amount || 0), 0);
  const valueRatio = remTotal > 0 ? Math.min(invoicedTotal / remTotal, 1) : 0;
  const valueScore = valueRatio * 50;

  // Score de unidades (50%) — unidades en items de facturas vinculadas
  const invoicedUnits = allLinkedItems.reduce((s: number, i: any) => s + Number(i.quantity || 0), 0);
  const unitsRatio = remUnits > 0 ? Math.min(invoicedUnits / remUnits, 1) : 0;
  const unitsScore = unitsRatio * 50;

  const score = Math.round(valueScore + unitsScore);

  // Detectar: valor ok pero referencias no coinciden
  const invRefs = new Set(allLinkedItems.map((i: any) => String(i.reference || i.item_code || '').toLowerCase().trim()).filter(Boolean));
  const refMatch = remRefs.size > 0 ? [...remRefs].filter(r => invRefs.has(r)).length / remRefs.size : 0;
  const valueOkRefsNot = valueRatio >= 0.8 && refMatch < 0.5 && allLinkedItems.length > 0;

  let label: string, color: string, icon: any, detail: string;
  const facturas = linkedInvoices.length;

  if (valueOkRefsNot) {
    label = 'Valor cubierto, refs. distintas'; color = 'text-yellow-600'; icon = AlertTriangle;
    detail = `${facturas} factura(s) vinculada(s). El valor está cubierto (${Math.round(valueRatio * 100)}%) pero las referencias no coinciden con la remisión. Puede ser válido — documentá la justificación ante una revisión DIAN.`;
  } else if (score >= 80) {
    label = 'Bien respaldada'; color = 'text-green-600'; icon = CheckCircle;
    detail = `${facturas} factura(s) vinculada(s). Valor cubierto: ${Math.round(valueRatio * 100)}%, unidades: ${Math.round(unitsRatio * 100)}%. Remisión bien respaldada fiscalmente.`;
  } else if (score >= 50) {
    label = 'Respaldo parcial'; color = 'text-yellow-600'; icon = AlertCircle;
    detail = `${facturas} factura(s) vinculada(s). Valor cubierto: ${Math.round(valueRatio * 100)}%, unidades: ${Math.round(unitsRatio * 100)}%. Revisá si hay facturas complementarias pendientes.`;
  } else if (score >= 20) {
    label = 'Alerta fiscal'; color = 'text-orange-600'; icon = AlertTriangle;
    detail = `${facturas} factura(s) vinculada(s). Valor cubierto: ${Math.round(valueRatio * 100)}%, unidades: ${Math.round(unitsRatio * 100)}%. Esta remisión tiene poco respaldo fiscal.`;
  } else {
    label = 'Cobertura insuficiente'; color = 'text-red-600'; icon = XCircle;
    detail = `${facturas} factura(s) vinculada(s) pero la cobertura es muy baja. Valor cubierto: ${Math.round(valueRatio * 100)}%. Vinculá más facturas o verificá los montos.`;
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
  const [vincularRemision, setVincularRemision] = useState<{ id: string; number: string } | null>(null);
  const [moverGerencialId, setMoverGerencialId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'date' | 'value' | 'score'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const effectiveGerencial = mode === 'gerencial';
  const moduleOrigin = effectiveGerencial ? 'gerencial' : 'dian';

  // Re-fetch cuando cambia el módulo
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['remisiones', user?.id] });
  }, [moduleOrigin, user?.id]);

  const { data: remisiones = [], isLoading } = useQuery({
    queryKey: ['remisiones', user?.id, moduleOrigin],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await (supabase
        .from('remisiones') as any)
        .select(`id, date, number, beneficiary, notes, status, created_at, total_manual, module_origin, remision_type,
          remision_items(id, reference, product_name, units, unit_cost, total_cost),
          remision_invoices(invoice_id, invoices(id, invoice_number, total_amount, invoice_items(quantity, reference, item_code, line_total)))`)
        .eq('user_id', user.id)
        .eq('module_origin', moduleOrigin)
        .order('date', { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!user?.id,
  });


  const handleDelete = async (id: string, number: string) => {
    if (!confirm(`¿Querés eliminar la ${number}? Se revertirán los movimientos de inventario que generó.`)) return;
    try {
      await reverseRemisionInventory(id);
    } catch (e) {
      toast({ title: 'No se pudo revertir el inventario', description: 'La remisión no fue eliminada.', variant: 'destructive' });
      return;
    }
    const { error } = await supabase.from('remisiones').delete().eq('id', id);
    if (error) {
      toast({ title: 'No se pudo eliminar', description: 'Intentá de nuevo en un momento.', variant: 'destructive' });
    } else {
      toast({ title: `${number} eliminada correctamente` });
      queryClient.invalidateQueries({ queryKey: ['remisiones'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-products'] });
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
    const { error } = await (supabase.from('remisiones') as any).update({ module_origin: 'dian' }).eq('id', moverId);
    if (error) {
      toast({ title: 'No se pudo mover', variant: 'destructive' });
    } else {
      toast({ title: 'Remisión movida al Módulo DIAN', description: 'El sistema comenzará a monitorear su cobertura fiscal.' });
      queryClient.invalidateQueries({ queryKey: ['remisiones'] });
    }
    setMoverId(null);
  };

  const handleMoverGerencial = async () => {
    if (!moverGerencialId) return;
    const { error } = await (supabase.from('remisiones') as any).update({ module_origin: 'gerencial' }).eq('id', moverGerencialId);
    if (error) {
      toast({ title: 'No se pudo mover', variant: 'destructive' });
    } else {
      toast({ title: 'Remisión movida al Módulo Gerencial', description: 'Ya no se monitoreará su cobertura fiscal.' });
      queryClient.invalidateQueries({ queryKey: ['remisiones'] });
    }
    setMoverGerencialId(null);
  };

  // Filter + sort en JS sobre el array ya cargado
  const filteredRemisiones = useMemo(() => {
    const q = search.trim().toLowerCase();
    let arr = remisiones.filter((r: any) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (typeFilter !== 'all' && r.remision_type !== typeFilter) return false;
      if (q) {
        const blob = `${r.number ?? ''} ${r.beneficiary ?? ''} ${r.notes ?? ''}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
    arr = [...arr].sort((a: any, b: any) => {
      let aVal: number = 0;
      let bVal: number = 0;
      if (sortBy === 'date') {
        aVal = new Date(a.date).getTime();
        bVal = new Date(b.date).getTime();
      } else if (sortBy === 'value') {
        const aItems = a.remision_items || [];
        const bItems = b.remision_items || [];
        aVal = a.total_manual ? Number(a.total_manual) : aItems.reduce((s: number, i: any) => s + Number(i.total_cost || 0), 0);
        bVal = b.total_manual ? Number(b.total_manual) : bItems.reduce((s: number, i: any) => s + Number(i.total_cost || 0), 0);
      } else if (sortBy === 'score') {
        aVal = !effectiveGerencial && a.remision_type !== 'compra' ? calcScore(a).score : -1;
        bVal = !effectiveGerencial && b.remision_type !== 'compra' ? calcScore(b).score : -1;
      }
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return arr;
  }, [remisiones, search, statusFilter, typeFilter, sortBy, sortDir, effectiveGerencial]);

  const toggleSort = (col: 'date' | 'value' | 'score') => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  };

  const sortIcon = (col: 'date' | 'value' | 'score') => {
    if (sortBy !== col) return <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />;
    return sortDir === 'asc' ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />;
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
              Módulo activo: {mode}
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
          <CardHeader className="space-y-3">
            <CardTitle className="text-base">Historial de Remisiones</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar por número, cliente, nota..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-8 text-sm"
                />
              </div>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[120px] h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="venta">Venta</SelectItem>
                  <SelectItem value="compra">Compra</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px] h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados</SelectItem>
                  <SelectItem value="pendiente">Pendiente</SelectItem>
                  <SelectItem value="despachado">Despachado</SelectItem>
                  <SelectItem value="cancelado">Cancelado</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground ml-auto">
                {filteredRemisiones.length} de {remisiones.length}
              </span>
            </div>
          </CardHeader>
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
                    <TableHead>Tipo</TableHead>
                    <TableHead className="cursor-pointer select-none hover:bg-muted/70" onClick={() => toggleSort('date')}>
                      <span className="inline-flex items-center gap-1">Fecha {sortIcon('date')}</span>
                    </TableHead>
                    <TableHead>Beneficiario / Proveedor</TableHead>
                    <TableHead className="text-right">Refs.</TableHead>
                    <TableHead className="text-right">Unidades</TableHead>
                    <TableHead className="text-right cursor-pointer select-none hover:bg-muted/70" onClick={() => toggleSort('value')}>
                      <span className="inline-flex items-center gap-1 justify-end w-full">Valor {sortIcon('value')}</span>
                    </TableHead>
                    <TableHead>Estado</TableHead>
                    {!effectiveGerencial && (
                      <TableHead className="cursor-pointer select-none hover:bg-muted/70" onClick={() => toggleSort('score')}>
                        <span className="inline-flex items-center gap-1">Score Fiscal {sortIcon('score')}</span>
                      </TableHead>
                    )}
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRemisiones.map((r: any) => {
                    const items = r.remision_items || [];
                    const unidades = items.reduce((s: number, i: any) => s + Number(i.units), 0);
                    const itemsValor = items.reduce((s: number, i: any) => s + Number(i.total_cost || 0), 0);
                    const valor = r.total_manual ? Number(r.total_manual) : itemsValor;
                    const status = STATUS_LABELS[r.status] || STATUS_LABELS.pendiente;
                    const score = !effectiveGerencial && r.remision_type !== 'compra' ? calcScore(r) : null;
                    const ScoreIcon = score?.icon;

                    const isCompra = r.remision_type === 'compra';
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.number}</TableCell>
                        <TableCell>
                          <Badge variant={isCompra ? 'default' : 'secondary'} className={isCompra ? 'bg-blue-100 text-blue-700 hover:bg-blue-100' : ''}>
                            {isCompra ? 'Compra' : 'Venta'}
                          </Badge>
                        </TableCell>
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
                        {!effectiveGerencial && (
                          <TableCell>
                            {score ? (
                              <button
                                onClick={() => setScoreDetail({ label: score.label, detail: score.detail, color: score.color })}
                                className={`flex items-center gap-1 text-xs font-medium ${score.color} hover:opacity-70`}
                              >
                                {ScoreIcon && <ScoreIcon className="h-3.5 w-3.5" />}
                                <span>{score.score}% — {score.label}</span>
                              </button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
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
                            {effectiveGerencial && !isCompra && (
                              <Button variant="ghost" size="icon" onClick={() => setMoverId(r.id)} title="Mover a Módulo DIAN">
                                <ArrowRightLeft className="h-4 w-4 text-blue-500" />
                              </Button>
                            )}
                            {!effectiveGerencial && !isCompra && (
                              <Button variant="ghost" size="icon" onClick={() => setVincularRemision({ id: r.id, number: r.number })} title="Vincular a factura">
                                <Link className="h-4 w-4 text-blue-500" />
                              </Button>
                            )}
                            {!effectiveGerencial && (
                              <Button variant="ghost" size="icon" onClick={() => setMoverGerencialId(r.id)} title="Mover a Módulo Gerencial">
                                <ArrowRightLeft className="h-4 w-4 text-amber-500" />
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

      {/* Modal mover a Gerencial (desde DIAN) */}
      <Dialog open={!!moverGerencialId} onOpenChange={(o) => { if (!o) setMoverGerencialId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mover al Módulo Gerencial</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>Esta remisión saldrá del módulo DIAN y dejará de ser monitoreada por cobertura fiscal.</p>
            <p className="text-amber-600 font-medium">¿Confirmás el cambio?</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoverGerencialId(null)}>Cancelar</Button>
            <Button onClick={handleMoverGerencial}>Sí, mover a Gerencial</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {vincularRemision && (
        <VincularFacturaModal
          remisionId={vincularRemision.id}
          remisionNumber={vincularRemision.number}
          open={!!vincularRemision}
          onOpenChange={(o) => { if (!o) setVincularRemision(null); }}
        />
      )}
    </AppLayout>
  );
}
