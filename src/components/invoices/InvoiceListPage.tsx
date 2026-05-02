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
import { FileText, Upload, Loader2, Crown, Lock, Search, Eye, Trash2, PlayCircle, Pencil, Package, RefreshCw, CheckCircle2, Plug } from 'lucide-react';
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
  const currentYear = new Date().getFullYear();
  const { plan, loading: subLoading, isTrialing } = useSubscription();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState<string>(String(currentYear));
  const [uploadOpen, setUploadOpen] = useState(false);
  const [resumeDraft, setResumeDraft] = useState<Invoice | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reExtractingId, setReExtractingId] = useState<string | null>(null);
  const [bulkReExtracting, setBulkReExtracting] = useState(false);
  const [confirmBulkDeleteErrors, setConfirmBulkDeleteErrors] = useState(false);
  const [bulkDeletingErrors, setBulkDeletingErrors] = useState(false);
  const [siigoSyncing, setSiigoSyncing] = useState(false);
  // Progreso visible mientras corre la re-extracción (single o bulk).
  // current=1/total=1 para single; current=k/total=N para bulk.
  const [reExtractProgress, setReExtractProgress] = useState<{ current: number; total: number; name: string } | null>(null);

  const isEmpresarial = plan === 'empresarial' || plan === 'pro' || plan === 'admin' || isTrialing;

  const title = type === 'venta' ? 'Facturas de Venta' : 'Facturas de Compra';
  const counterpartyLabel = type === 'venta' ? 'Cliente' : 'Proveedor';

  // Si el usuario sube un archivo que abarca varios años, sólo mostramos el año
  // seleccionado (default = año actual). El selector permite ver previos.
  const yearScoped = useMemo(() => {
    if (selectedYear === 'all') return invoices;
    const year = Number(selectedYear);
    return invoices.filter(i => {
      const dateStr = i.issue_date || i.created_at;
      if (!dateStr) return false;
      try {
        return parseLocalDate(dateStr).getFullYear() === year;
      } catch {
        return false;
      }
    });
  }, [invoices, selectedYear]);

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    invoices.forEach(i => {
      const dateStr = i.issue_date || i.created_at;
      if (!dateStr) return;
      try {
        const y = parseLocalDate(dateStr).getFullYear();
        if (!isNaN(y)) years.add(y);
      } catch { /* ignore */ }
    });
    years.add(currentYear);
    return Array.from(years).sort((a, b) => b - a);
  }, [invoices, currentYear]);

  const summary = useMemo(() => {
    const confirmed = yearScoped.filter(i => i.status === 'confirmed');
    return {
      count: confirmed.length,
      total: confirmed.reduce((s, i) => s + i.total_amount, 0),
      iva: confirmed.reduce((s, i) => s + i.iva_amount, 0),
    };
  }, [yearScoped]);

  // Ranking de facturación agrupada por contraparte (cliente para 'venta',
  // proveedor para 'compra'), ordenado de mayor a menor.
  // Normaliza por name.toLowerCase() para unificar duplicados por casing/espacios.
  const counterpartyRanking = useMemo(() => {
    const confirmed = yearScoped.filter(i => i.status === 'confirmed');
    const map = new Map<string, { name: string; total: number; count: number }>();
    for (const i of confirmed) {
      const rawName = (i.counterparty_name
        || (type === 'venta' ? i.buyer_name : i.seller_name)
        || '').trim();
      const displayName = rawName || 'Sin identificar';
      const key = displayName.toLowerCase();
      const prev = map.get(key);
      if (prev) {
        prev.total += i.total_amount;
        prev.count += 1;
      } else {
        map.set(key, { name: displayName, total: i.total_amount, count: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [yearScoped, type]);

  const summaryLabel1 = type === 'venta' ? 'Total facturado' : 'Total comprado';
  const summaryLabel2 = type === 'venta' ? 'IVA generado' : 'IVA descontable';
  const rankingTitle = type === 'venta' ? 'Facturación por cliente' : 'Facturación por proveedor';

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
    let result = yearScoped;
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
  }, [yearScoped, statusFilter, searchQuery]);

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

  const reExtractItems = useCallback(async (invoiceId: string): Promise<{ ok: boolean; count?: number; reextractedAt?: string; error?: string }> => {
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
      return {
        ok: true,
        count: payload.items_count,
        reextractedAt: typeof payload?.items_reextracted_at === 'string' ? payload.items_reextracted_at : undefined,
      };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Error inesperado' };
    }
  }, []);

  // Merge optimista del marker items_reextracted_at en la factura local, para
  // evitar un refetch completo tras cada re-extracción.
  const markReextractedLocally = useCallback((invoiceId: string, reextractedAt: string) => {
    setInvoices(prev => prev.map(i => {
      if (i.id !== invoiceId) return i;
      // Marker optimist — si no había extracted_data, lo dejamos como null
      // (el merge no aplica). Si había, agregamos el flag.
      if (!i.extracted_data) return i;
      const nextExtractedData = { ...i.extracted_data, items_reextracted_at: reextractedAt };
      return { ...i, extracted_data: nextExtractedData };
    }));
  }, []);

  const handleReExtractItems = useCallback(async (inv: Invoice) => {
    const displayName = inv.invoice_number || inv.display_name || inv.original_filename || 'la factura';
    setReExtractingId(inv.id);
    setReExtractProgress({ current: 1, total: 1, name: displayName });
    const res = await reExtractItems(inv.id);
    setReExtractingId(null);
    setReExtractProgress(null);
    if (res.ok) {
      // Fallback: si la edge function vieja no devuelve items_reextracted_at,
      // igual marcamos con timestamp local para que el check verde aparezca
      // inmediatamente en esta sesión. El refetch/recarga la perdería, pero
      // una vez que Lovable despliegue la nueva versión quedará persistida en DB.
      const stamp = res.reextractedAt || new Date().toISOString();
      markReextractedLocally(inv.id, stamp);
      toast({ title: 'Ítems re-extraídos', description: `${res.count} líneas guardadas para ${displayName}.` });
    } else {
      toast({ title: 'No se pudo re-extraer', description: res.error, variant: 'destructive' });
    }
  }, [reExtractItems, toast, markReextractedLocally]);

  const handleBulkReExtract = useCallback(async () => {
    const targets = invoices.filter(i => i.status === 'confirmed' && (i.storage_path || i.pdf_path));
    if (targets.length === 0) {
      toast({ title: 'No hay facturas confirmadas para procesar' });
      return;
    }
    setBulkReExtracting(true);
    let ok = 0, fail = 0, totalItems = 0;
    for (let idx = 0; idx < targets.length; idx++) {
      const inv = targets[idx];
      const displayName = inv.invoice_number || inv.display_name || inv.original_filename || 'factura';
      setReExtractingId(inv.id);
      setReExtractProgress({ current: idx + 1, total: targets.length, name: displayName });
      const res = await reExtractItems(inv.id);
      if (res.ok) {
        ok++;
        totalItems += res.count ?? 0;
        const stamp = res.reextractedAt || new Date().toISOString();
        markReextractedLocally(inv.id, stamp);
      } else {
        fail++;
      }
    }
    setReExtractingId(null);
    setReExtractProgress(null);
    setBulkReExtracting(false);
    toast({
      title: 'Re-extracción masiva completa',
      description: `${ok} facturas OK · ${totalItems} ítems · ${fail} errores`,
      variant: fail > 0 && ok === 0 ? 'destructive' : 'default',
    });
  }, [invoices, reExtractItems, toast, markReextractedLocally]);

  // Bulk-delete every invoice in status 'error'. Useful to clean up rows that
  // accumulated when Gemini was rate-limited or parsing failed repeatedly.
  // Also removes associated invoice_items rows + storage files.
  const handleBulkDeleteErrors = useCallback(async () => {
    const targets = invoices.filter(i => i.status === 'error');
    if (targets.length === 0) {
      toast({ title: 'No hay facturas en error para limpiar' });
      setConfirmBulkDeleteErrors(false);
      return;
    }
    setBulkDeletingErrors(true);
    let deleted = 0;
    let failed = 0;
    try {
      const ids = targets.map(i => i.id);
      const storagePaths = targets.map(i => i.storage_path).filter(Boolean) as string[];

      // 1. Delete invoice_items for all targets (single query).
      const { error: itemsErr } = await supabase
        .from('invoice_items')
        .delete()
        .in('invoice_id', ids);
      if (itemsErr) console.warn('Error deleting invoice_items bulk:', itemsErr);

      // 2. Delete invoices row-by-row so a single RLS failure doesn't roll back all.
      for (const id of ids) {
        const { error } = await supabase.from('invoices').delete().eq('id', id);
        if (error) failed++;
        else deleted++;
      }

      // 3. Remove storage files (best-effort).
      if (storagePaths.length > 0) {
        await supabase.storage.from('invoices').remove(storagePaths).catch(() => {});
      }

      // Optimistic update: remove the successfully deleted error rows.
      // If some failed we just drop the confirmed-deleted subset; a manual
      // refresh will reconcile anything out of sync.
      setInvoices(prev => prev.filter(i => !(i.status === 'error' && ids.includes(i.id))));

      toast({
        title: 'Limpieza completa',
        description: `${deleted} facturas eliminadas${failed > 0 ? ` · ${failed} errores` : ''}.`,
        variant: failed > 0 && deleted === 0 ? 'destructive' : 'default',
      });
    } catch (err: any) {
      console.error('Bulk delete errors:', err);
      toast({ title: 'Error al limpiar', description: err.message, variant: 'destructive' });
    } finally {
      setBulkDeletingErrors(false);
      setConfirmBulkDeleteErrors(false);
    }
  }, [invoices, toast]);

  const errorCount = useMemo(() => yearScoped.filter(i => i.status === 'error').length, [yearScoped]);

  const handleUploadClose = useCallback(() => {
    setUploadOpen(false);
    setResumeDraft(null);
  }, []);

  const handleOpenUpload = useCallback(() => {
    setResumeDraft(null);
    setUploadOpen(true);
  }, []);

  const handleSiigoSync = useCallback(async () => {
    setSiigoSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('siigo-sync-invoices', {
        body: { kinds: [type] },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'No se pudo sincronizar');
      toast({
        title: 'Siigo sincronizado',
        description: `${data.synced ?? 0} facturas procesadas${data.skipped ? `, ${data.skipped} omitidas` : ''}.`,
      });
      await fetchInvoices();
    } catch (e: any) {
      toast({
        title: 'Error sincronizando Siigo',
        description: e.message ?? 'Conecta primero en Configuración.',
        variant: 'destructive',
      });
    } finally {
      setSiigoSyncing(false);
    }
  }, [type, toast, fetchInvoices]);

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
            {errorCount > 0 && (
              <Button
                variant="outline"
                onClick={() => setConfirmBulkDeleteErrors(true)}
                disabled={bulkDeletingErrors}
                className="gap-2 border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive"
                title="Elimina todas las facturas en estado Error"
              >
                {bulkDeletingErrors ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Limpiar errores ({errorCount})
              </Button>
            )}
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
            <Button
              variant="outline"
              onClick={handleSiigoSync}
              disabled={siigoSyncing}
              className="gap-2"
              title={`Importar ${type === 'venta' ? 'facturas de venta' : 'facturas de compra'} desde Siigo`}
            >
              {siigoSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
              Traer de Siigo
            </Button>
            <Button onClick={handleOpenUpload} className="gap-2">
              <Upload className="h-4 w-4" />
              Subir factura PDF
            </Button>
          </div>
        </div>

        {/* Banner de progreso de re-extracción (visible durante single o bulk) */}
        {reExtractProgress && (
          <div
            style={{
              background: 'oklch(0.52 0.16 240 / 0.06)',
              border: '1.5px solid oklch(0.52 0.16 240 / 0.18)',
              borderRadius: 12,
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'oklch(0.52 0.16 240)', flexShrink: 0 }} />
            <div style={{ fontSize: 13, color: '#1d1d1f' }}>
              <span style={{ fontWeight: 600 }}>
                Re-extrayendo {reExtractProgress.total > 1 ? `${reExtractProgress.current} de ${reExtractProgress.total}` : 'factura'}:
              </span>{' '}
              <span style={{ color: '#6e6e73' }}>{reExtractProgress.name}</span>
            </div>
          </div>
        )}

        {/* Micro summary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        </div>

        {/* Ranking de facturación agrupada por cliente/proveedor (mayor a menor) */}
        {counterpartyRanking.length > 0 && (
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
                marginBottom: 12,
              }}
            >
              {rankingTitle} · {counterpartyRanking.length} {counterpartyRanking.length === 1 ? (type === 'venta' ? 'cliente' : 'proveedor') : (type === 'venta' ? 'clientes' : 'proveedores')}
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {counterpartyRanking.map((r, idx) => {
                const pct = summary.total > 0 ? (r.total / summary.total) * 100 : 0;
                return (
                  <div
                    key={`${r.name}-${idx}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '28px 1fr auto',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 0',
                      borderBottom: idx < counterpartyRanking.length - 1 ? '1px solid rgba(0,0,0,0.05)' : 'none',
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#a1a1a6',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      #{idx + 1}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: '#1d1d1f',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {r.name}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: '#6e6e73',
                          marginTop: 2,
                        }}
                      >
                        {r.count} {r.count === 1 ? 'factura' : 'facturas'} · {pct.toFixed(1)}%
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: '#1d1d1f',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatCurrency(r.total)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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
            <span className="text-sm text-muted-foreground">Año:</span>
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {availableYears.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                      const reextractedAtRaw = (inv.extracted_data as { items_reextracted_at?: unknown } | null)?.items_reextracted_at;
                      const reextractedAt = typeof reextractedAtRaw === 'string' ? reextractedAtRaw : null;
                      const reextractedLabel = reextractedAt
                        ? (() => {
                            try {
                              return format(new Date(reextractedAt), "d MMM yy HH:mm", { locale: es });
                            } catch {
                              return null;
                            }
                          })()
                        : null;
                      return (
                        <TableRow key={inv.id} className={isDraftOrError ? 'bg-warning/5' : ''}>
                          <TableCell className="text-sm">
                            {format(parseLocalDate(displayDate), 'dd MMM yy', { locale: es })}
                          </TableCell>
                          <TableCell className="font-medium text-sm max-w-[260px]">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="truncate">
                                {inv.counterparty_name || (type === 'venta' ? inv.buyer_name : inv.seller_name) || '—'}
                              </span>
                              {inv.source === 'siigo' && (
                                <Badge variant="secondary" className="h-4 px-1.5 text-[10px] gap-0.5 flex-shrink-0" title="Importada desde Siigo">
                                  <Plug className="h-2.5 w-2.5" />
                                  Siigo
                                </Badge>
                              )}
                              {reextractedAt && (
                                <CheckCircle2
                                  className="h-3.5 w-3.5 flex-shrink-0"
                                  style={{ color: 'oklch(0.43 0.14 155)' }}
                                  aria-label="Ítems re-extraídos"
                                />
                              )}
                            </div>
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
                              {/* Las facturas importadas de Siigo no tienen PDF asociado, ocultamos el botón. */}
                              {inv.source !== 'siigo' && (inv.storage_path || inv.pdf_path) && (
                                <Button variant="ghost" size="icon" className="h-8 w-8" title="Ver PDF" onClick={() => handleViewPDF(inv.storage_path || inv.pdf_path)}>
                                  <Eye className="h-4 w-4" />
                                </Button>
                              )}
                              {inv.status === 'confirmed' && (inv.storage_path || inv.pdf_path) && (
                                <div className="flex items-center gap-1">
                                  {reextractedLabel && (
                                    <span
                                      className="text-[10px] text-muted-foreground whitespace-nowrap"
                                      title={`Última re-extracción: ${reextractedLabel}`}
                                    >
                                      re-ext. {reextractedLabel}
                                    </span>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    title={reextractedLabel
                                      ? `Re-extraer ítems de línea (última: ${reextractedLabel})`
                                      : 'Re-extraer ítems de línea'}
                                    onClick={() => handleReExtractItems(inv)}
                                    disabled={reExtractingId === inv.id || bulkReExtracting}
                                  >
                                    {reExtractingId === inv.id
                                      ? <Loader2 className="h-4 w-4 animate-spin" />
                                      : <RefreshCw className="h-4 w-4" />}
                                  </Button>
                                </div>
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

      <AlertDialog
        open={confirmBulkDeleteErrors}
        onOpenChange={(open) => { if (!open && !bulkDeletingErrors) setConfirmBulkDeleteErrors(false); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Limpiar {errorCount} factura{errorCount === 1 ? '' : 's'} en error?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán <strong>{errorCount}</strong> fila{errorCount === 1 ? '' : 's'} en estado "Error - Reintentar",
              junto con sus ítems y archivos PDF. Las facturas confirmadas y pendientes no se tocan.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeletingErrors}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDeleteErrors}
              disabled={bulkDeletingErrors}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeletingErrors ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Limpiar {errorCount}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
