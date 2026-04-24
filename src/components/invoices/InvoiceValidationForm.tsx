import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { ExtractedInvoiceData } from '@/types/invoice';
import { parseLocalDate } from '@/lib/dateUtils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Loader2, Save, X, CheckCircle, Info } from 'lucide-react';

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);

interface FormData extends ExtractedInvoiceData {
  autoretefuente_rate: number;
  autoretefuente_amount: number;
  reteica_rate: number;
  reteica_amount: number;
  retefuente_cliente_rate: number;
  retefuente_cliente_amount: number;
  status: string;
  display_name: string;
  dias_credito: number;
}

interface Props {
  data: ExtractedInvoiceData;
  originalFilename?: string;
  onSave: (data: FormData) => void;
  onCancel: () => void;
  saving: boolean;
}

export default function InvoiceValidationForm({ data, originalFilename, onSave, onCancel, saving }: Props) {
  const { user } = useAuth();
  const settingsLoadedRef = useRef(false);

  const suggestedName = [
    data.type === 'venta' ? data.buyer_name : data.seller_name,
    data.invoice_number ? `#${data.invoice_number}` : null,
    data.issue_date ? parseLocalDate(data.issue_date).toLocaleDateString('es-CO', { month: 'short', year: 'numeric' }) : null,
  ].filter(Boolean).join(' - ') || '';

  const [form, setForm] = useState<FormData>({
    ...data,
    autoretefuente_rate: 0,
    autoretefuente_amount: 0,
    reteica_rate: 0,
    reteica_amount: 0,
    retefuente_cliente_rate: 2.5,
    retefuente_cliente_amount: Math.round(data.subtotal_base * 2.5 / 100),
    status: 'draft',
    display_name: suggestedName || (originalFilename?.replace('.pdf', '') || ''),
    dias_credito: 0,
  });

  // Fetch tax_settings once and auto-populate rates + recalculate amounts
  useEffect(() => {
    if (!user || settingsLoadedRef.current) return;
    settingsLoadedRef.current = true;

    const loadSettings = async () => {
      try {
        const { data: settings } = await supabase
          .from('tax_settings')
          .select('autoretefuente_rate, reteica_rate, retefuente_compra_rate')
          .eq('user_id', user.id)
          .maybeSingle();

        if (settings) {
          setForm(prev => {
            const autoRate = (settings.autoretefuente_rate || 0) * 100;
            const reteicaRate = (settings.reteica_rate || 0) * 100;
            const retefuenteClienteRate = (settings.retefuente_compra_rate || 0.025) * 100;
            return {
              ...prev,
              autoretefuente_rate: autoRate,
              autoretefuente_amount: Math.round(prev.subtotal_base * autoRate / 100),
              reteica_rate: reteicaRate,
              reteica_amount: Math.round(prev.subtotal_base * reteicaRate / 100),
              retefuente_cliente_rate: retefuenteClienteRate,
              retefuente_cliente_amount: Math.round(prev.subtotal_base * retefuenteClienteRate / 100),
            };
          });
        }
      } catch (err) {
        console.error('Error loading tax settings:', err);
      }
    };
    loadSettings();
  }, [user]);

  const update = useCallback((field: keyof FormData, value: any) => {
    setForm(prev => {
      const next = { ...prev, [field]: value };

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
      if (field === 'retefuente_cliente_rate' || field === 'subtotal_base') {
        const rate = field === 'retefuente_cliente_rate' ? (value as number) : next.retefuente_cliente_rate;
        const base = field === 'subtotal_base' ? (value as number) : next.subtotal_base;
        next.retefuente_cliente_amount = Math.round(base * rate / 100);
      }

      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (!form.display_name.trim()) return;
    onSave({ ...form, status: 'confirmed' });
  }, [form, onSave]);

  const handleDraft = useCallback(() => {
    if (!form.display_name.trim()) return;
    onSave({ ...form, status: 'draft' });
  }, [form, onSave]);

  return (
    <div className="space-y-6">
      {/* Display name - required */}
      <div className="p-4 rounded-md border-2 border-primary/30 bg-primary/5">
        <Label className="text-base font-semibold">Nombre visible del PDF *</Label>
        <Input
          value={form.display_name}
          onChange={e => update('display_name', e.target.value)}
          placeholder="Ej: Factura Proveedor - #123 - Ene 2026"
          className="mt-2"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Recomendado: Proveedor + No. factura + Mes/Año
        </p>
        {!form.display_name.trim() && (
          <p className="text-xs text-destructive mt-1">Este campo es obligatorio</p>
        )}
      </div>

      {/* Header info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
        <div>
          <Label>Condiciones de pago</Label>
          <Select
            value={String(form.dias_credito)}
            onValueChange={v => {
              if (v === 'custom') return;
              update('dias_credito', Number(v));
            }}
          >
            <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Contado (0 días)</SelectItem>
              <SelectItem value="15">15 días</SelectItem>
              <SelectItem value="30">30 días</SelectItem>
              <SelectItem value="45">45 días</SelectItem>
              <SelectItem value="60">60 días</SelectItem>
              <SelectItem value="90">90 días</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={0}
            value={form.dias_credito}
            onChange={e => update('dias_credito', parseInt(e.target.value) || 0)}
            className="mt-1"
            placeholder="Días personalizados"
          />
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
          <Input type="number" value={form.subtotal_base} onChange={e => update('subtotal_base', parseFloat(e.target.value) || 0)} />
        </div>
        <div>
          <Label>% IVA</Label>
          <Input type="number" step="0.01" value={form.iva_rate} onChange={e => update('iva_rate', parseFloat(e.target.value) || 0)} />
        </div>
        <div>
          <Label>$ IVA</Label>
          <Input type="number" value={form.iva_amount} onChange={e => update('iva_amount', parseFloat(e.target.value) || 0)} />
        </div>
        <div>
          <Label>Total</Label>
          <Input type="number" value={form.total_amount} onChange={e => update('total_amount', parseFloat(e.target.value) || 0)} className="font-semibold" />
        </div>
      </div>

      {/* Tax fields for VENTAS — auto-calculated from settings */}
      {form.type === 'venta' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 rounded-md border border-warning/30 bg-warning/5">
          <div className="sm:col-span-2 lg:col-span-3">
            <p className="text-sm font-medium text-foreground mb-1">Retenciones (sobre base gravable)</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" />
              Calculadas automáticamente desde tu configuración fiscal. Puedes ajustarlas si es necesario.
            </p>
          </div>
          <div>
            <Label>% Autorretefuente</Label>
            <Input type="number" step="0.01" value={form.autoretefuente_rate} onChange={e => update('autoretefuente_rate', parseFloat(e.target.value) || 0)} placeholder="Ej: 0.4" />
          </div>
          <div>
            <Label>$ Autorretefuente</Label>
            <Input type="number" value={form.autoretefuente_amount} readOnly className="bg-muted" />
          </div>
          <div>
            <Label>% ReteICA</Label>
            <Input type="number" step="0.01" value={form.reteica_rate} onChange={e => update('reteica_rate', parseFloat(e.target.value) || 0)} placeholder="Ej: 0.966" />
          </div>
          <div>
            <Label>$ ReteICA</Label>
            <Input type="number" value={form.reteica_amount} readOnly className="bg-muted" />
          </div>
          <div>
            <Label>% Retefuente cliente</Label>
            <Input type="number" step="0.01" value={form.retefuente_cliente_rate} onChange={e => update('retefuente_cliente_rate', parseFloat(e.target.value) || 0)} placeholder="Ej: 2.5" />
          </div>
          <div>
            <Label>$ Retefuente cliente</Label>
            <Input type="number" value={form.retefuente_cliente_amount} readOnly className="bg-muted" />
            <p className="text-xs text-muted-foreground mt-1">Se descuenta de lo que me deben</p>
          </div>
        </div>
      )}

      {/* Notas */}
      <div>
        <Label>Notas (opcional)</Label>
        <Textarea
          value={(form as any).notes || ''}
          onChange={e => update('notes' as any, e.target.value)}
          placeholder="Notas adicionales sobre esta factura..."
          rows={2}
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
        <Button variant="secondary" onClick={handleDraft} disabled={saving || !form.display_name.trim()}>
          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
          Guardar borrador
        </Button>
        <Button onClick={handleConfirm} disabled={saving || !form.display_name.trim()}>
          {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1" />}
          Confirmar factura
        </Button>
      </div>
    </div>
  );
}
