import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { CheckCircle, Search, FileText, X } from 'lucide-react';

interface Props {
  remisionId: string;
  remisionNumber: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(value);
}

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export default function VincularFacturaModal({ remisionId, remisionNumber, open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  // Facturas disponibles
  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices-for-link', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('invoices')
        .select('id, invoice_number, issue_date, total_amount, counterparty_name, display_name')
        .eq('user_id', user.id)
        .eq('transaction_type', 'venta')
        .order('issue_date', { ascending: false });
      return data || [];
    },
    enabled: !!user?.id && open,
  });

  // Facturas ya vinculadas a esta remisión
  const { data: linked = [] } = useQuery({
    queryKey: ['remision-invoices', remisionId],
    queryFn: async () => {
      const { data } = await supabase
        .from('remision_invoices')
        .select('invoice_id')
        .eq('remision_id', remisionId);
      return (data || []).map((r: any) => r.invoice_id);
    },
    enabled: !!remisionId && open,
  });

  const filteredInvoices = invoices.filter((inv: any) => {
    const q = search.toLowerCase();
    return (
      inv.invoice_number?.toLowerCase().includes(q) ||
      inv.counterparty_name?.toLowerCase().includes(q) ||
      inv.display_name?.toLowerCase().includes(q)
    );
  });

  const handleToggle = async (invoiceId: string) => {
    if (!user?.id) return;
    setSaving(true);
    if (linked.includes(invoiceId)) {
      // Desvincular
      await supabase.from('remision_invoices')
        .delete()
        .eq('remision_id', remisionId)
        .eq('invoice_id', invoiceId);
      toast({ title: 'Factura desvinculada' });
    } else {
      // Vincular
      await supabase.from('remision_invoices')
        .insert({ remision_id: remisionId, invoice_id: invoiceId, user_id: user.id });
      toast({ title: 'Factura vinculada correctamente' });
    }
    queryClient.invalidateQueries({ queryKey: ['remision-invoices', remisionId] });
    queryClient.invalidateQueries({ queryKey: ['remisiones'] });
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Vincular facturas a {remisionNumber}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Seleccioná las facturas de venta que respaldan este despacho. Podés vincular más de una.
        </p>

        {linked.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Vinculadas:</span>
            {linked.map((id: string) => {
              const inv = invoices.find((i: any) => i.id === id) as any;
              return inv ? (
                <Badge key={id} variant="secondary" className="gap-1">
                  <CheckCircle className="h-3 w-3 text-green-500" />
                  {inv.invoice_number || inv.display_name}
                  <button onClick={() => handleToggle(id)} className="ml-1 hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ) : null;
            })}
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por número o cliente..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex-1 overflow-y-auto space-y-1 max-h-80">
          {filteredInvoices.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No hay facturas de venta disponibles.
            </div>
          ) : (
            filteredInvoices.map((inv: any) => {
              const isLinked = linked.includes(inv.id);
              return (
                <button
                  key={inv.id}
                  onClick={() => handleToggle(inv.id)}
                  disabled={saving}
                  className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                    isLinked ? 'border-green-500 bg-green-50 dark:bg-green-950/20' : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <FileText className={`h-4 w-4 shrink-0 ${isLinked ? 'text-green-500' : 'text-muted-foreground'}`} />
                    <div>
                      <p className="text-sm font-medium">{inv.invoice_number || inv.display_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {inv.counterparty_name} · {formatDate(inv.issue_date)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{formatCurrency(inv.total_amount || 0)}</span>
                    {isLinked && <CheckCircle className="h-4 w-4 text-green-500" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>
            {linked.length > 0 ? `Listo (${linked.length} vinculada${linked.length > 1 ? 's' : ''})` : 'Cerrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
