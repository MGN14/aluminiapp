import { useState, useCallback } from 'react';
import { ExtractedInvoiceData } from '@/types/invoice';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Loader2, Save, X, CheckCircle } from 'lucide-react';

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);

interface FormData extends ExtractedInvoiceData {
  autoretefuente_rate: number;
  autoretefuente_amount: number;
  reteica_rate: number;
  reteica_amount: number;
  status: string;
}

interface Props {
  data: ExtractedInvoiceData;
  onSave: (data: FormData) => void;
  onCancel: () => void;
  saving: boolean;
}

export default function InvoiceValidationForm({ data, onSave, onCancel, saving }: Props) {
  const [form, setForm] = useState<FormData>({
    ...data,
    autoretefuente_rate: 0,
    autoretefuente_amount: 0,
    reteica_rate: 0,
    reteica_amount: 0,
    status: 'draft',
  });

  const update = useCallback((field: keyof FormData, value: any) => {
    setForm(prev => {
      const next = { ...prev, [field]: value };

      // Auto-recalc tax amounts when rates or base change
      if (field === 'autoretefuente_rate' || field === 'subtotal_base') {
        const rate = field === 'autoretefuente_rate' ? (value as number) : next.autoretefuente_rate;
        const base = field === 'subtotal_base' ? (value as number) : next.subtotal_base;
        next.autoretefuente_amount = Math.round(base * rate / 100);
      }
      if (field === 'reteica_rate' || field === 'subtotal_base') {
        const rate = field === 'reteica_rate' ? (value as number) : next.reteica_rate;
        const base = field === 'subtotal_base' ? (value as number) : next.subtotal_base;
        next.reteica_amount = Math.round(base * rate / 100);
      }

      return next;
    });
  }, []);

  const handleConfirm = () => {
    onSave({ ...form, status: 'confirmed' });
  };

  const handleDraft = () => {
    onSave({ ...form, status: 'draft' });
  };

  return (
    <div className="space-y-6">
      {/* Header info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <Label>Número factura</Label>
          <Input value={form.invoice_number} onChange={e => update('invoice_number', e.target.value)} />
        </div>
        <div>
          <Label>Tipo</Label>
          <Select value={form.type} onValueChange={v => update('type', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="venta">Venta</SelectItem>
              <SelectItem value="compra">Compra</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Fecha emisión</Label>
          <Input type="date" value={form.issue_date} onChange={e => update('issue_date', e.target.value)} />
        </div>
      </div>

      {/* Counterparty */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 rounded-md border border-border">
        <div>
          <Label>{form.type === 'venta' ? 'Cliente' : 'Proveedor'}</Label>
          <Input value={form.counterparty_name} onChange={e => update('counterparty_name', e.target.value)} />
        </div>
        <div>
          <Label>NIT</Label>
          <Input value={form.counterparty_nit} onChange={e => update('counterparty_nit', e.target.value)} />
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 p-4 rounded-md bg-muted/50">
        <div>
          <Label>Base gravable</Label>
          <Input
            type="number"
            value={form.subtotal_base}
            onChange={e => update('subtotal_base', parseFloat(e.target.value) || 0)}
          />
        </div>
        <div>
          <Label>% IVA</Label>
          <Input
            type="number"
            step="0.01"
            value={form.iva_rate}
            onChange={e => update('iva_rate', parseFloat(e.target.value) || 0)}
          />
        </div>
        <div>
          <Label>$ IVA</Label>
          <Input
            type="number"
            value={form.iva_amount}
            onChange={e => update('iva_amount', parseFloat(e.target.value) || 0)}
          />
        </div>
        <div>
          <Label>Total</Label>
          <Input
            type="number"
            value={form.total_amount}
            onChange={e => update('total_amount', parseFloat(e.target.value) || 0)}
            className="font-semibold"
          />
        </div>
      </div>

      {/* Tax fields for VENTAS */}
      {form.type === 'venta' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-md border border-warning/30 bg-warning/5">
          <div className="sm:col-span-2 lg:col-span-4">
            <p className="text-sm font-medium text-foreground mb-1">Retenciones (sobre base gravable)</p>
            <p className="text-xs text-muted-foreground">Estos valores se usan para el resumen DIAN mensual</p>
          </div>
          <div>
            <Label>% Autorretefuente</Label>
            <Input
              type="number"
              step="0.01"
              value={form.autoretefuente_rate}
              onChange={e => update('autoretefuente_rate', parseFloat(e.target.value) || 0)}
              placeholder="Ej: 0.4"
            />
          </div>
          <div>
            <Label>$ Autorretefuente</Label>
            <Input
              type="number"
              value={form.autoretefuente_amount}
              readOnly
              className="bg-muted"
            />
          </div>
          <div>
            <Label>% ReteICA</Label>
            <Input
              type="number"
              step="0.01"
              value={form.reteica_rate}
              onChange={e => update('reteica_rate', parseFloat(e.target.value) || 0)}
              placeholder="Ej: 0.966"
            />
          </div>
          <div>
            <Label>$ ReteICA</Label>
            <Input
              type="number"
              value={form.reteica_amount}
              readOnly
              className="bg-muted"
            />
          </div>
        </div>
      )}

      {/* Items table */}
      {form.items.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">Detalle de ítems ({form.items.length})</p>
          <div className="overflow-x-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Código</TableHead>
                  <TableHead>Referencia</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="text-right">Cant.</TableHead>
                  <TableHead className="text-right">Precio Unit.</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">IVA</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {form.items.map((item, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="text-xs">{item.item_code}</TableCell>
                    <TableCell className="text-xs">{item.reference}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{item.description}</TableCell>
                    <TableCell className="text-right text-xs">{item.quantity}</TableCell>
                    <TableCell className="text-right text-xs">{formatCurrency(item.unit_price)}</TableCell>
                    <TableCell className="text-right text-xs">{formatCurrency(item.line_base)}</TableCell>
                    <TableCell className="text-right text-xs">{formatCurrency(item.iva_amount)}</TableCell>
                    <TableCell className="text-right text-xs font-medium">{formatCurrency(item.line_total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          <X className="h-4 w-4 mr-1" /> Cancelar
        </Button>
        <Button variant="secondary" onClick={handleDraft} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
          Guardar borrador
        </Button>
        <Button onClick={handleConfirm} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1" />}
          Confirmar factura
        </Button>
      </div>
    </div>
  );
}
