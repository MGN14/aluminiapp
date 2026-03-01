import { useState } from 'react';
import { ExtractedInvoiceData, ExtractedInvoiceItem } from '@/types/invoice';
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
import { Loader2, Save, X } from 'lucide-react';

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);

interface Props {
  data: ExtractedInvoiceData;
  onSave: (data: ExtractedInvoiceData) => void;
  onCancel: () => void;
  saving: boolean;
}

export default function InvoiceValidationForm({ data, onSave, onCancel, saving }: Props) {
  const [form, setForm] = useState<ExtractedInvoiceData>({ ...data });

  const update = (field: keyof ExtractedInvoiceData, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
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
          <Label>Método de pago</Label>
          <Input value={form.payment_method || ''} onChange={e => update('payment_method', e.target.value)} />
        </div>
        <div>
          <Label>Fecha emisión</Label>
          <Input type="date" value={form.issue_date} onChange={e => update('issue_date', e.target.value)} />
        </div>
        <div>
          <Label>Fecha vencimiento</Label>
          <Input type="date" value={form.due_date || ''} onChange={e => update('due_date', e.target.value || null)} />
        </div>
        <div>
          <Label>Ciudad</Label>
          <Input value={form.city || ''} onChange={e => update('city', e.target.value)} />
        </div>
      </div>

      {/* Seller / Buyer */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-3 p-3 rounded-md border border-border">
          <p className="text-sm font-medium text-muted-foreground">Vendedor</p>
          <div>
            <Label>Nombre</Label>
            <Input value={form.seller_name || ''} onChange={e => update('seller_name', e.target.value)} />
          </div>
          <div>
            <Label>NIT</Label>
            <Input value={form.seller_nit || ''} onChange={e => update('seller_nit', e.target.value)} />
          </div>
        </div>
        <div className="space-y-3 p-3 rounded-md border border-border">
          <p className="text-sm font-medium text-muted-foreground">Comprador</p>
          <div>
            <Label>Nombre</Label>
            <Input value={form.buyer_name || ''} onChange={e => update('buyer_name', e.target.value)} />
          </div>
          <div>
            <Label>NIT</Label>
            <Input value={form.buyer_nit || ''} onChange={e => update('buyer_nit', e.target.value)} />
          </div>
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

      {/* CUFE */}
      <div>
        <Label>CUFE</Label>
        <Input
          value={form.cufe || ''}
          onChange={e => update('cufe', e.target.value)}
          className="text-xs font-mono"
          placeholder="Código CUFE de la factura"
        />
      </div>

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
        <Button onClick={() => onSave(form)} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
          Guardar factura
        </Button>
      </div>
    </div>
  );
}
