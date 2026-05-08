import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Pencil, Save, X, FileText, CheckCircle, Link as LinkIcon, Trash2 } from 'lucide-react';

interface Props {
  remisionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', minimumFractionDigits: 0,
  }).format(value);
}

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  pendiente: { label: 'Pendiente', variant: 'secondary' },
  despachado: { label: 'Despachado', variant: 'default' },
  cancelado: { label: 'Cancelado', variant: 'destructive' },
};

export default function RemisionDetailModal({ remisionId, open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state (solo se llena al entrar a edicion)
  const [date, setDate] = useState('');
  const [responsibleId, setResponsibleId] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('');

  // Items editables (units / unit_cost / eliminar). Las refs y product_name
  // siguen siendo solo lectura — para reescribirlas, se borra y se re-sube
  // la remisión desde Excel.
  type EditableItem = {
    id: string;
    reference: string;
    product_name: string;
    units: number;
    unit_cost: number;
    deleted: boolean; // marcado para eliminar al guardar
  };
  const [editableItems, setEditableItems] = useState<EditableItem[]>([]);

  const { data: remision, isLoading } = useQuery({
    queryKey: ['remision-detail', remisionId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('remisiones') as any)
        .select(`id, date, number, beneficiary, responsible_id, notes, status, total_manual, module_origin, remision_type,
          remision_items(id, reference, product_name, units, unit_cost, total_cost),
          remision_invoices(invoice_id, invoices(id, invoice_number, total_amount, issue_date, counterparty_name))`)
        .eq('id', remisionId)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!remisionId,
  });

  const { data: responsibles = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['responsibles-remision-detail', user?.id],
    enabled: !!user?.id && editing,
    queryFn: async () => {
      // RLS filtra por owner — sin .eq('user_id', user.id) que rompía a
      // colaboradores (user.id ≠ current_data_owner()).
      const { data, error } = await supabase
        .from('responsibles')
        .select('id, name, responsible_type')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return ((data ?? []) as unknown as Array<{ id: string; name: string; responsible_type: string }>)
        .filter((r) => r.responsible_type === 'banking' || r.responsible_type === 'both' || !r.responsible_type)
        .map((r) => ({ id: r.id, name: r.name }));
    },
  });

  // Sync form state cuando entra a edicion
  useEffect(() => {
    if (editing && remision) {
      setDate(remision.date ?? '');
      setResponsibleId(remision.responsible_id ?? '');
      setNotes(remision.notes ?? '');
      setStatus(remision.status ?? 'pendiente');
      const items = (remision as any)?.remision_items ?? [];
      setEditableItems(
        items.map((i: any) => ({
          id: i.id,
          reference: i.reference,
          product_name: i.product_name,
          units: Number(i.units) || 0,
          unit_cost: Number(i.unit_cost) || 0,
          deleted: false,
        })),
      );
    }
  }, [editing, remision]);

  const handleSave = async () => {
    if (!remision) return;
    setSaving(true);
    try {
      const respName = responsibles.find((r) => r.id === responsibleId)?.name;
      const { error } = await (supabase.from('remisiones') as any).update({
        date,
        responsible_id: responsibleId || null,
        beneficiary: respName ?? remision.beneficiary,
        notes: notes.trim() || null,
        status,
      }).eq('id', remision.id);
      if (error) throw error;

      // Items: aplicar diff. UPDATE para los modificados, DELETE para los
      // marcados como deleted. El trigger remision_items_set_total_cost
      // recalcula total_cost automáticamente.
      const toDelete = editableItems.filter((i) => i.deleted).map((i) => i.id);
      const toUpdate = editableItems.filter((i) => !i.deleted);

      if (toDelete.length > 0) {
        const { error: delErr } = await supabase
          .from('remision_items')
          .delete()
          .in('id', toDelete);
        if (delErr) throw delErr;
      }

      // Update por id — secuencial pero típicamente son <30 items.
      for (const it of toUpdate) {
        const { error: upErr } = await supabase
          .from('remision_items')
          .update({
            units: it.units,
            unit_cost: it.unit_cost,
          })
          .eq('id', it.id);
        if (upErr) throw upErr;
      }

      await queryClient.invalidateQueries({ queryKey: ['remision-detail', remisionId] });
      await queryClient.invalidateQueries({ queryKey: ['remisiones'] });
      toast({ title: 'Remisión actualizada' });
      setEditing(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const items = (remision as any)?.remision_items || [];
  const totalUnidades = items.reduce((s: number, i: any) => s + Number(i.units), 0);
  const totalValor = remision?.total_manual
    ? Number(remision.total_manual)
    : items.reduce((s: number, i: any) => s + Number(i.total_cost || 0), 0);
  const statusInfo = remision ? STATUS_LABELS[remision.status] || STATUS_LABELS.pendiente : null;
  const linkedInvoices = ((remision as any)?.remision_invoices || []).map((ri: any) => ri.invoices).filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>
              {isLoading ? 'Cargando...' : `Remisión ${(remision as any)?.number}`}
            </DialogTitle>
            {remision && !editing && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)} className="gap-1.5">
                <Pencil className="h-3.5 w-3.5" />
                Editar
              </Button>
            )}
          </div>
        </DialogHeader>

        {remision && (
          <div className="space-y-4">
            {/* Metadata: editable o read-only */}
            {editing ? (
              <div className="grid grid-cols-2 gap-3 text-sm border rounded-lg p-3 bg-muted/20">
                <div className="space-y-1.5">
                  <Label className="text-xs">Fecha</Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Estado</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pendiente">Pendiente</SelectItem>
                      <SelectItem value="despachado">Despachado</SelectItem>
                      <SelectItem value="cancelado">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs">Beneficiario / Cliente</Label>
                  <Select value={responsibleId} onValueChange={setResponsibleId}>
                    <SelectTrigger>
                      <SelectValue placeholder={remision.beneficiary || 'Seleccionar cliente'} />
                    </SelectTrigger>
                    <SelectContent>
                      {responsibles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    Crear nuevos clientes desde Conciliación bancaria.
                  </p>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs">Notas</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Fecha:</span>{' '}
                  <strong>{formatDate(remision.date)}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Estado:</span>{' '}
                  {statusInfo && <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>}
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">Beneficiario:</span>{' '}
                  <strong>{remision.beneficiary || '—'}</strong>
                  {remision.responsible_id && (
                    <span className="ml-2 text-[10px] text-muted-foreground">(vinculado a cliente)</span>
                  )}
                </div>
                {remision.notes && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Notas:</span>{' '}
                    {remision.notes}
                  </div>
                )}
              </div>
            )}

            {/* Items */}
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Referencia</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Unidades</TableHead>
                    <TableHead className="text-right">Costo unit.</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    {editing && <TableHead className="w-10"></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {editing
                    ? editableItems.filter((i) => !i.deleted).map((item, idx) => {
                        const realIdx = editableItems.findIndex((x) => x.id === item.id);
                        const total = item.units * item.unit_cost;
                        return (
                          <TableRow key={item.id}>
                            <TableCell className="font-mono text-xs">{item.reference}</TableCell>
                            <TableCell className="text-xs">{item.product_name}</TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={item.units}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value) || 0;
                                  setEditableItems((prev) => prev.map((it, i) => (i === realIdx ? { ...it, units: v } : it)));
                                }}
                                className="h-8 text-right text-xs w-24 ml-auto"
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={item.unit_cost}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value) || 0;
                                  setEditableItems((prev) => prev.map((it, i) => (i === realIdx ? { ...it, unit_cost: v } : it)));
                                }}
                                className="h-8 text-right text-xs w-32 ml-auto"
                              />
                            </TableCell>
                            <TableCell className="text-right text-xs tabular-nums">
                              {total > 0 ? formatCurrency(total) : '—'}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive"
                                onClick={() => {
                                  setEditableItems((prev) => prev.map((it, i) => (i === realIdx ? { ...it, deleted: true } : it)));
                                }}
                                title="Eliminar fila"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    : items.map((item: any) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono text-xs">{item.reference}</TableCell>
                          <TableCell className="text-xs">{item.product_name}</TableCell>
                          <TableCell className="text-right">{Number(item.units).toLocaleString('es-CO')}</TableCell>
                          <TableCell className="text-right">{item.unit_cost > 0 ? formatCurrency(Number(item.unit_cost)) : '—'}</TableCell>
                          <TableCell className="text-right">{item.total_cost > 0 ? formatCurrency(Number(item.total_cost)) : '—'}</TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-between text-sm border-t pt-3">
              <span className="text-muted-foreground">
                Total unidades:{' '}
                <strong>
                  {(editing
                    ? editableItems.filter((i) => !i.deleted).reduce((s, i) => s + i.units, 0)
                    : totalUnidades
                  ).toLocaleString('es-CO')}
                </strong>
              </span>
              {(() => {
                const valorActual = editing
                  ? editableItems.filter((i) => !i.deleted).reduce((s, i) => s + i.units * i.unit_cost, 0)
                  : totalValor;
                return valorActual > 0 ? (
                  <span className="text-muted-foreground">Valor total: <strong>{formatCurrency(valorActual)}</strong></span>
                ) : null;
              })()}
            </div>

            {/* Facturas vinculadas (solo DIAN, ventas) */}
            {remision.module_origin === 'dian' && remision.remision_type !== 'compra' && (
              <div className="space-y-2 pt-2 border-t">
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  Facturas vinculadas
                  <Badge variant="outline" className="text-[10px]">{linkedInvoices.length}</Badge>
                </div>
                {linkedInvoices.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Sin facturas vinculadas. Cerrá este modal y usá el botón de enlace en la fila para vincular.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {linkedInvoices.map((inv: any) => (
                      <div key={inv.id} className="flex items-center justify-between text-xs p-2 rounded-lg border bg-muted/20">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium">{inv.invoice_number}</span>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">{inv.counterparty_name}</span>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">{formatDate(inv.issue_date)}</span>
                        </div>
                        <span className="font-semibold tabular-nums">{formatCurrency(Number(inv.total_amount) || 0)}</span>
                      </div>
                    ))}
                    <p className="text-[10px] text-muted-foreground pt-1">
                      Total facturado: <strong>{formatCurrency(linkedInvoices.reduce((s: number, i: any) => s + Number(i.total_amount || 0), 0))}</strong>
                      {totalValor > 0 && (
                        <span> · Cobertura: <strong>{Math.round((linkedInvoices.reduce((s: number, i: any) => s + Number(i.total_amount || 0), 0) / totalValor) * 100)}%</strong></span>
                      )}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {editing && (
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditing(false)} disabled={saving} className="gap-1.5">
              <X className="h-3.5 w-3.5" />
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-1.5">
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
