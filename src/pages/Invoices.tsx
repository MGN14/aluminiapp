import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSubscription } from '@/hooks/useSubscription';
import { useNavigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import { Invoice } from '@/types/invoice';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Upload, Loader2, Crown, Lock, Search, Eye, Trash2, PlayCircle, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import InvoiceUploadModal from '@/components/invoices/InvoiceUploadModal';
import DIANSummary from '@/components/invoices/DIANSummary';

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

const statusLabel: Record<string, { text: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  uploading: { text: 'Subiendo...', variant: 'outline' },
  processing: { text: 'Analizando...', variant: 'secondary' },
  ready: { text: 'Pendiente de validar', variant: 'outline' },
  draft: { text: 'Pendiente por confirmar', variant: 'outline' },
  error: { text: 'Error - Reintentar', variant: 'destructive' },
  confirmed: { text: 'Confirmada', variant: 'default' },
};

export default function Invoices() {
  const { plan, loading: subLoading, isTrialing, trialExpired } = useSubscription();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [resumeDraft, setResumeDraft] = useState<Invoice | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isEmpresarial = plan === 'empresarial' || plan === 'pro' || plan === 'admin' || isTrialing;

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error) setInvoices((data as any as Invoice[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isEmpresarial) fetchInvoices();
  }, [isEmpresarial, fetchInvoices]);

  const filteredByTab = useCallback((type: 'venta' | 'compra') => {
    let result = invoices.filter(i => i.type === type);
    if (statusFilter !== 'all') result = result.filter(i => i.status === statusFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(i =>
        (i.display_name || '').toLowerCase().includes(q) ||
        (i.counterparty_name || '').toLowerCase().includes(q) ||
        (i.seller_name || '').toLowerCase().includes(q) ||
        (i.buyer_name || '').toLowerCase().includes(q) ||
        (i.invoice_number || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [invoices, statusFilter, searchQuery]);

  const handleViewPDF = async (storagePath: string | null) => {
    if (!storagePath) {
      toast({ title: 'No hay PDF asociado', variant: 'destructive' });
      return;
    }
    const { data, error } = await supabase.storage.from('invoices').createSignedUrl(storagePath, 300);
    if (error || !data?.signedUrl) {
      toast({ title: 'Error al generar enlace del PDF', variant: 'destructive' });
      return;
    }
    window.open(data.signedUrl, '_blank');
  };

  const handleResumeDraft = (inv: Invoice) => {
    setResumeDraft(inv);
    setUploadOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const inv = invoices.find(i => i.id === deleteId);
      await supabase.from('invoice_items').delete().eq('invoice_id', deleteId);
      const { error } = await supabase.from('invoices').delete().eq('id', deleteId);
      if (error) throw error;
      if (inv?.storage_path) {
        await supabase.storage.from('invoices').remove([inv.storage_path]);
      }
      toast({ title: 'Factura eliminada' });
      setInvoices(prev => prev.filter(i => i.id !== deleteId));
    } catch (err: any) {
      toast({ title: 'Error al eliminar', description: err.message, variant: 'destructive' });
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  };

  const renderFilters = () => (
    <div className="flex gap-3 flex-wrap items-end">
      <div className="flex-1 min-w-[200px] max-w-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, proveedor o número..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Estado:</span>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="draft">Pendiente</SelectItem>
            <SelectItem value="processing">Analizando</SelectItem>
            <SelectItem value="ready">Por validar</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="confirmed">Confirmada</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  const renderInvoiceTable = (filtered: Invoice[]) => (
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
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="font-medium">No hay facturas</p>
            <p className="text-sm mt-1">Sube tu primera factura electrónica</p>
            <Button variant="outline" className="mt-4 gap-2" onClick={() => { setResumeDraft(null); setUploadOpen(true); }}>
              <Upload className="h-4 w-4" />
              Subir factura PDF
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-[100px]">Fecha</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Proveedor / Cliente</TableHead>
                  <TableHead className="w-[120px]">Número</TableHead>
                  <TableHead className="text-right w-[130px]">Total</TableHead>
                  <TableHead className="w-[160px]">Estado</TableHead>
                  <TableHead className="w-[150px] text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((inv) => {
                  const s = statusLabel[inv.status] || statusLabel.draft;
                  const displayDate = inv.issue_date || inv.created_at;
                  const isDraftOrError = ['draft', 'error', 'uploading', 'processing', 'ready'].includes(inv.status);
                  return (
                    <TableRow key={inv.id} className={isDraftOrError ? 'bg-warning/5' : ''}>
                      <TableCell className="text-sm">
                        {format(new Date(displayDate), 'dd MMM yy', { locale: es })}
                      </TableCell>
                      <TableCell className="font-medium text-sm truncate max-w-[200px]">
                        {inv.display_name || inv.invoice_number || inv.original_filename || '—'}
                      </TableCell>
                      <TableCell className="text-sm truncate max-w-[180px]">
                        {inv.counterparty_name || (inv.type === 'venta' ? inv.buyer_name : inv.seller_name) || '—'}
                      </TableCell>
                      <TableCell className="text-sm">{inv.invoice_number || '—'}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(inv.total_amount)}</TableCell>
                      <TableCell>
                        <Badge variant={s.variant} className="text-xs">{s.text}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isDraftOrError && (
                            <Button variant="default" size="sm" className="h-8 gap-1 text-xs" title="Continuar configuración" onClick={() => handleResumeDraft(inv)}>
                              <PlayCircle className="h-3.5 w-3.5" />
                              Continuar
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Editar" onClick={() => handleResumeDraft(inv)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Ver PDF" onClick={() => handleViewPDF(inv.storage_path || inv.pdf_path)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="Eliminar" onClick={() => setDeleteId(inv.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
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
  );

  if (subLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isEmpresarial) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-6">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Facturación DIAN</h1>
          <p className="text-muted-foreground max-w-md mb-6">
            El módulo Facturación DIAN está disponible en el Plan Empresarial.
            Gestiona facturas electrónicas, calcula impuestos y genera resúmenes fiscales.
          </p>
          <Button onClick={() => navigate('/pricing')} className="gap-2">
            <Crown className="h-4 w-4" />
            Activar Empresarial
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-full mx-auto space-y-4 px-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              Facturas (DIAN)
              <Badge variant="outline" className="text-xs font-medium gap-1 border-warning text-warning">
                <Crown className="h-3 w-3" /> Empresarial
              </Badge>
            </h1>
            <p className="text-muted-foreground">Gestiona tus facturas electrónicas colombianas</p>
          </div>
          <Button onClick={() => { setResumeDraft(null); setUploadOpen(true); }} className="gap-2">
            <Upload className="h-4 w-4" />
            Subir factura PDF
          </Button>
        </div>

        <Tabs defaultValue="ventas">
          <TabsList>
            <TabsTrigger value="ventas">Ventas</TabsTrigger>
            <TabsTrigger value="compras">Compras</TabsTrigger>
            <TabsTrigger value="resumen">Resumen DIAN</TabsTrigger>
          </TabsList>

          <TabsContent value="ventas" className="space-y-4">
            {renderFilters()}
            {renderInvoiceTable(filteredByTab('venta'))}
          </TabsContent>

          <TabsContent value="compras" className="space-y-4">
            {renderFilters()}
            {renderInvoiceTable(filteredByTab('compra'))}
          </TabsContent>

          <TabsContent value="resumen">
            <DIANSummary invoices={invoices.filter(i => i.status === 'confirmed')} />
          </TabsContent>
        </Tabs>
      </div>

      <InvoiceUploadModal
        open={uploadOpen}
        onClose={() => { setUploadOpen(false); setResumeDraft(null); }}
        onInvoiceSaved={fetchInvoices}
        resumeDraft={resumeDraft}
      />

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta factura?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará la factura, sus ítems y el archivo PDF asociado. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
