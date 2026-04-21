import { useState, useEffect, useMemo, useCallback, type CSSProperties } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSubscription } from '@/hooks/useSubscription';
import { useNavigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import { Invoice } from '@/types/invoice';
import { parseLocalDate } from '@/lib/dateUtils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { FileText, Upload, Loader2, Crown, Lock, Search, Eye, Trash2, PlayCircle, Pencil, Package, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import InvoiceUploadModal from '@/components/invoices/InvoiceUploadModal';

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

const statusLabel: Record<string, { text: string }> = {
  uploading: { text: 'Subiendo...' },
  processing: { text: 'Analizando...' },
  ready: { text: 'Pendiente de validar' },
  draft: { text: 'Pendiente por confirmar' },
  error: { text: 'Error - Reintentar' },
  confirmed: { text: 'Confirmada' },
};

const statusStyle: Record<string, CSSProperties> = {
  uploading: {
    background: 'oklch(0.52 0.16 240 / 0.08)',
    color: 'oklch(0.52 0.16 240)',
    borderRadius: 99,
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 600,
  },
  processing: {
    background: 'oklch(0.52 0.16 240 / 0.08)',
    color: 'oklch(0.52 0.16 240)',
    borderRadius: 99,
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 600,
  },
  ready: {
    background: 'oklch(0.65 0.15 65 / 0.10)',
    color: 'oklch(0.52 0.15 65)',
    borderRadius: 99,
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 600,
  },
  draft: {
    background: 'oklch(0.65 0.15 65 / 0.10)',
    color: 'oklch(0.52 0.15 65)',
    borderRadius: 99,
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 600,
  },
  error: {
    background: 'oklch(0.52 0.18 25 / 0.08)',
    color: 'oklch(0.52 0.18 25)',
    borderRadius: 99,
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 600,
  },
  confirmed: {
    background: 'oklch(0.43 0.14 155 / 0.10)',
    color: 'oklch(0.43 0.14 155)',
    borderRadius: 99,
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 600,
  },
};

interface Props {
  type: 'venta' | 'compra';
}

export default function InvoiceListPage({ type }: Props) {
  const { plan, loading: subLoading, isTrialing } = useSubscription();
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
  const [reExtractingId, setReExtractingId] = useState<string | null>(null);
  const [bulkReExtracting, setBulkReExtracting] = useState(false);

  const isEmpresarial = plan === 'empresarial' || plan === 'pro' || plan === 'admin' || isTrialing;

  const title = type === 'venta' ? 'Facturas de Venta' : 'Facturas de Compra';
  const counterpartyLabel = type === 'venta' ? 'Cliente' : 'Proveedor';

  const summary = useMemo(() => {
    const confirmed = invoices.filter(i => i.status === 'confirmed');
    return {
      count: confirmed.length,
      total: confirmed.reduce((s, i) => s + i.total_amount, 0),
      iva: confirmed.reduce((s, i) => s + i.iva_amount, 0),
    };
  }, [invoices]);

  const summaryLabel1 = type === 'venta' ? 'Total facturado' : 'Total comprado';
  const summaryLabel2 = type === 'venta' ? 'IVA generado' : 'IVA descontable';
  const summaryLabel3 = type === 'venta' ? 'Facturas emitidas' : 'Facturas recibidas';

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('type', type)
        .order('created_at', { ascending: false });
      if (error) {
        console.error('Error fetching invoices:', error);
        toast({ title: 'Error al cargar facturas', description: 'Intenta recargar la página.', variant: 'destructive' });
      } else {
        setInvoices((data as any as Invoice[]) || []);
      }
    } catch (err) {
      console.error('Unexpected error fetching invoices:', err);
    } finally {
      setLoading(false);
    }
  }, [toast, type]);

  useEffect(() => {
    if (isEmpresarial) fetchInvoices();
  }, [isEmpresarial, fetchInvoices]);

  const filtered = useMemo(() => {
    let result = invoices;
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

  const handleViewPDF = useCallback(async (storagePath: string | null) => {
    if (!storagePath) {
      toast({ title: 'No hay PDF asociado', variant: 'destructive' });
      return;
    }
    try {
      const { data, error } = await supabase.storage.from('invoices').createSignedUrl(storagePath, 300);
      if (error || !data?.signedUrl) {
        toast({ title: 'Error al generar enlace del PDF', variant: 'destructive' });
        return;
      }
      window.open(data.signedUrl, '_blank');
    } catch (err) {
      console.error('Error viewing PDF:', err);
      toast({ title: 'Error inesperado al abrir PDF', variant: 'destructive' });
    }
  }, [toast]);

  const handleResumeDraft = useCallback((inv: Invoice) => {
    setResumeDraft(inv);
    setUploadOpen(true);
  }, []);

  const handleDelete = useCallback(async () => {
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
      console.error('Error deleting invoice:', err);
      toast({ title: 'Error al eliminar', description: err.message, variant: 'destructive' });
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  }, [deleteId, invoices, toast]);

  const reExtractItems = useCallback(async (invoiceId: string): Promise<{ ok: boolean; count?: number; error?: string }> => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/start-invoice-processing`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ invoice_id: invoiceId, only_items: true }),
        }
      );
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        if (payload?.details) console.error('re-extract AI details:', payload.details);
        return { ok: false, error: payload?.error || `Error ${resp.status}` };
      }
      // If items_count is missing, the edge function wasn't redeployed (old version still live).
      if (typeof payload?.items_count !== 'number') {
        return {
          ok: false,
          error: 'La edge function no se actualizó. Pídele a Lovable que despliegue las funciones (start-invoice-processing).',
        };
      }
      return { ok: true, count: payload.items_count };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Error inesperado' };
    }
  }, []);

  const handleReExtractItems = useCallback(async (inv: Invoice) => {
    setReExtractingId(inv.id);
    const res = await reExtractItems(inv.id);
    setReExtractingId(null);
    if (res.ok) {
      toast({ title: 'Ítems re-extraídos', description: `${res.count} líneas guardadas para ${inv.invoice_number || inv.display_name || 'la factura'}.` });
    } else {
      toast({ title: 'No se pudo re-extraer', description: res.error, variant: 'destructive' });
    }
  }, [reExtractItems, toast]);

  const handleBulkReExtract = useCallback(async () => {
    const targets = invoices.filter(i => i.status === 'confirmed' && (i.storage_path || i.pdf_path));
    if (targets.length === 0) {
      toast({ title: 'No hay facturas confirmadas para procesar' });
      return;
    }
    setBulkReExtracting(true);
    let ok = 0, fail = 0, totalItems = 0;
    for (const inv of targets) {
      const res = await reExtractItems(inv.id);
      if (res.ok) { ok++; totalItems += res.count ?? 0; } else { fail++; }
    }
    setBulkReExtracting(false);
    toast({
      title: 'Re-extracción masiva completa',
      description: `${ok} facturas OK · ${totalItems} ítems · ${fail} errores`,
      variant: fail > 0 && ok === 0 ? 'destructive' : 'default',
    });
  }, [invoices, reExtractItems, toast]);

  const handleUploadClose = useCallback(() => {
    setUploadOpen(false);
    setResumeDraft(null);
  }, []);

  const handleOpenUpload = useCallback(() => {
    setResumeDraft(null);
    setUploadOpen(true);
  }, []);

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
      <div className="max-w-full mx-auto space-y-5 px-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              {title}
              <Badge variant="outline" className="text-xs font-medium gap-1 border-warning text-warning">
                <Crown className="h-3 w-3" /> Empresarial
              </Badge>
            </h1>
            <p className="text-muted-foreground text-sm">Gestiona tus facturas electrónicas</p>
          </div>
          <div className="flex items-center gap-2">
            {type === 'venta' && (
              <Button
                variant="outline"
                onClick={handleBulkReExtract}
                disabled={bulkReExtracting}
                className="gap-2"
                title="Re-extrae los ítems de todas las facturas confirmadas (para poblar el Top 3 Referencias)"
              >
                {bulkReExtracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                Re-extraer ítems
              </Button>
            )}
            <Button onClick={handleOpenUpload} className="gap-2">
              <Upload className="h-4 w-4" />
              Subir factura PDF
            </Button>
          </div>
        </div>

        {/* Micro summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div
            style={{
              background: '#fff',
              borderRadius: 14,
              padding: '18px 20px',
              border: '1.5px solid rgba(0,0,0,0.07)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.8px',
                textTransform: 'uppercase',
                color: '#a1a1a6',
              }}
            >
              {summaryLabel1}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: '-0.5px',
                color: '#1d1d1f',
                marginTop: 4,
              }}
            >
              {formatCurrency(summary.total)}
            </div>
          </div>
          <div
            style={{
              background: '#fff',
              borderRadius: 14,
              padding: '18px 20px',
              border: '1.5px solid rgba(0,0,0,0.07)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.8px',
                textTransform: 'uppercase',
                color: '#a1a1a6',
              }}
            >
              {summaryLabel2}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: '-0.5px',
                color: '#1d1d1f',
                marginTop: 4,
              }}
            >
              {formatCurrency(summary.iva)}
            </div>
          </div>
          <div
            style={{
              background: '#fff',
              borderRadius: 14,
              padding: '18px 20px',
              border: '1.5px solid rgba(0,0,0,0.07)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.8px',
                textTransform: 'uppercase',
                color: '#a1a1a6',
              }}
            >
              {summaryLabel3}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: '-0.5px',
                color: '#1d1d1f',
                marginTop: 4,
              }}
            >
              {summary.count}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap items-end">
          <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
            <Search
              className="h-4 w-4 text-muted-foreground"
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'none',
              }}
            />
            <input
              placeholder={`Buscar por nombre, ${counterpartyLabel.toLowerCase()} o número...`}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={e => {
                e.currentTarget.style.borderColor = 'oklch(0.43 0.14 155 / 0.22)';
                e.currentTarget.style.boxShadow = '0 0 0 3px oklch(0.43 0.14 155 / 0.08)';
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = 'rgba(0,0,0,0.07)';
                e.currentTarget.style.boxShadow = 'none';
              }}
              style={{
                width: '100%',
                height: 38,
                padding: '0 12px 0 38px',
                background: '#fff',
                border: '1.5px solid rgba(0,0,0,0.07)',
                borderRadius: 10,
                fontSize: 13,
                fontFamily: 'inherit',
                outline: 'none',
                transition: 'border-color 0.2s, box-shadow 0.2s',
              }}
            />
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

        {/* Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {title} ({filtered.length})
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
                <Button variant="outline" className="mt-4 gap-2" onClick={handleOpenUpload}>
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
                      <TableHead>{counterpartyLabel}</TableHead>
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
                            {format(parseLocalDate(displayDate), 'dd MMM yy', { locale: es })}
                          </TableCell>
                          <TableCell className="font-medium text-sm truncate max-w-[200px]">
                            {inv.display_name || inv.invoice_number || inv.original_filename || '—'}
                          </TableCell>
                          <TableCell className="text-sm truncate max-w-[180px]">
                            {inv.counterparty_name || (type === 'venta' ? inv.buyer_name : inv.seller_name) || '—'}
                          </TableCell>
                          <TableCell className="text-sm">{inv.invoice_number || '—'}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(inv.total_amount)}</TableCell>
                          <TableCell>
                            <span style={{ display: 'inline-block', ...(statusStyle[inv.status] || statusStyle.draft) }}>
                              {s.text}
                            </span>
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
                              {inv.status === 'confirmed' && (inv.storage_path || inv.pdf_path) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  title="Re-extraer ítems de línea"
                                  onClick={() => handleReExtractItems(inv)}
                                  disabled={reExtractingId === inv.id || bulkReExtracting}
                                >
                                  {reExtractingId === inv.id
                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                    : <RefreshCw className="h-4 w-4" />}
                                </Button>
                              )}
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
      </div>

      <InvoiceUploadModal
        open={uploadOpen}
        onClose={handleUploadClose}
        onInvoiceSaved={fetchInvoices}
        resumeDraft={resumeDraft}
      />

      <AlertDialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
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
