import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import AppLayout from '@/components/layout/AppLayout';
import { Invoice } from '@/types/invoice';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { FileText, Upload, Loader2, Search } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import InvoiceUploadModal from '@/components/invoices/InvoiceUploadModal';

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

const statusLabel: Record<string, { text: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  sin_conciliar: { text: 'Sin conciliar', variant: 'destructive' },
  parcial: { text: 'Parcial', variant: 'secondary' },
  conciliada: { text: 'Conciliada', variant: 'default' },
};

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [uploadOpen, setUploadOpen] = useState(false);

  const fetchInvoices = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .order('issue_date', { ascending: false });
    if (!error) setInvoices((data as Invoice[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchInvoices(); }, []);

  const filtered = useMemo(() => {
    let result = invoices;
    if (typeFilter !== 'all') result = result.filter(i => i.type === typeFilter);
    if (statusFilter !== 'all') result = result.filter(i => i.status === statusFilter);
    return result;
  }, [invoices, typeFilter, statusFilter]);

  return (
    <AppLayout>
      <div className="max-w-full mx-auto space-y-4 px-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Facturas (DIAN)</h1>
            <p className="text-muted-foreground">Gestiona y concilia tus facturas electrónicas</p>
          </div>
          <Button onClick={() => setUploadOpen(true)} className="gap-2">
            <Upload className="h-4 w-4" />
            Subir factura PDF
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Tipo:</span>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="venta">Venta</SelectItem>
                <SelectItem value="compra">Compra</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Estado:</span>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="sin_conciliar">Sin conciliar</SelectItem>
                <SelectItem value="parcial">Parcial</SelectItem>
                <SelectItem value="conciliada">Conciliada</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Facturas ({filtered.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 sm:p-6 sm:pt-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-accent" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No hay facturas</p>
                <p className="text-sm mt-1">
                  Sube un PDF de factura para comenzar
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-[130px]">Número</TableHead>
                      <TableHead className="w-[80px]">Tipo</TableHead>
                      <TableHead className="w-[100px]">Fecha</TableHead>
                      <TableHead>Cliente / Proveedor</TableHead>
                      <TableHead className="text-right w-[130px]">Base</TableHead>
                      <TableHead className="text-right w-[110px]">IVA</TableHead>
                      <TableHead className="text-right w-[130px]">Total</TableHead>
                      <TableHead className="w-[120px]">Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((inv) => {
                      const s = statusLabel[inv.status] || statusLabel.sin_conciliar;
                      return (
                        <TableRow key={inv.id}>
                          <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                          <TableCell>
                            <Badge variant={inv.type === 'venta' ? 'default' : 'outline'} className="text-xs">
                              {inv.type === 'venta' ? 'Venta' : 'Compra'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {format(new Date(inv.issue_date), 'dd MMM yyyy', { locale: es })}
                          </TableCell>
                          <TableCell className="text-sm truncate max-w-[200px]">
                            {inv.type === 'venta' ? inv.buyer_name : inv.seller_name}
                          </TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(inv.subtotal_base)}</TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(inv.iva_amount)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(inv.total_amount)}</TableCell>
                          <TableCell>
                            <Badge variant={s.variant} className="text-xs">{s.text}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <InvoiceUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onInvoiceSaved={fetchInvoices}
      />
    </AppLayout>
  );
}
