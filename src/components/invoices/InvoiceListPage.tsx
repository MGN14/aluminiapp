import { useState, useEffect, useMemo, useCallback, type CSSProperties } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useSubscription } from '@/hooks/useSubscription';
import { useNavigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import { Invoice } from '@/types/invoice';
import { MONTH_NAMES } from '@/types/transaction';
import { parseLocalDate } from '@/lib/dateUtils';
import { useCounterpartyResolver, resolveCounterpartyName } from '@/lib/counterpartyResolver';
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
import { FileText, Upload, Loader2, Crown, Lock, Search, Eye, Trash2, PlayCircle, Pencil, RefreshCw, Plug, ArrowDownNarrowWide, ArrowUpNarrowWide, ShieldCheck, ShieldX, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import InvoiceUploadModal from '@/components/invoices/InvoiceUploadModal';
import BulkPurchaseUploadModal from '@/components/invoices/BulkPurchaseUploadModal';

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
  // Filtro acumulado "hasta el mes N" (enero→N). null = usar el default (último
  // mes con facturas). Se resetea al cambiar de año.
  const [monthOverride, setMonthOverride] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [resumeDraft, setResumeDraft] = useState<Invoice | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmBulkDeleteErrors, setConfirmBulkDeleteErrors] = useState(false);
  const [bulkDeletingErrors, setBulkDeletingErrors] = useState(false);
  const [siigoSyncing, setSiigoSyncing] = useState(false);
  const [dianValidating, setDianValidating] = useState(false);
  type SortField = 'date' | 'invoice_number' | 'total';
  type SortConfig = { field: SortField; direction: 'asc' | 'desc' };
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'date', direction: 'desc' });

  const toggleSort = useCallback((field: SortField) => {
    setSortConfig(prev =>
      prev.field === field
        ? { field, direction: prev.direction === 'desc' ? 'asc' : 'desc' }
        : { field, direction: field === 'invoice_number' ? 'asc' : 'desc' },
    );
  }, []);

  // Extrae el primer número entero de un string para sortear "FMGN 281" como 281.
  // Fallback: localeCompare numérico si no se puede extraer.
  const numericOf = (s: string | null | undefined): number => {
    const m = (s ?? '').match(/\d+/);
    return m ? Number(m[0]) : NaN;
  };
  const counterpartyResolver = useCounterpartyResolver();

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

  const monthOf = (i: Invoice): number => {
    const dateStr = i.issue_date || i.created_at;
    try { return dateStr ? parseLocalDate(dateStr).getMonth() + 1 : 0; } catch { return 0; }
  };

  // Default del filtro: último mes con facturas en el año (el "actualizado");
  // si no hay, el mes actual (año en curso) o diciembre (años pasados).
  const lastMonthWithData = useMemo(() => {
    let maxM = 0;
    for (const i of yearScoped) { const m = monthOf(i); if (m > maxM) maxM = m; }
    if (maxM > 0) return maxM;
    return selectedYear === String(currentYear) ? new Date().getMonth() + 1 : 12;
  }, [yearScoped, selectedYear, currentYear]);

  const monthCut = monthOverride ?? lastMonthWithData;

  // Acumulado enero → mes de corte. Con año 'all' no aplica el filtro mensual.
  const monthScoped = useMemo(() => {
    if (selectedYear === 'all') return yearScoped;
    return yearScoped.filter(i => { const m = monthOf(i); return m > 0 && m <= monthCut; });
  }, [yearScoped, selectedYear, monthCut]);

  const summary = useMemo(() => {
    // Excluir facturas totalmente anuladas por NC: no son facturación válida.
    const confirmed = monthScoped.filter(i => i.status === 'confirmed' && i.void_type !== 'total');
    const total = confirmed.reduce((s, i) => s + i.total_amount, 0);
    const iva = confirmed.reduce((s, i) => s + i.iva_amount, 0);
    return {
      count: confirmed.length,
      total,
      iva,
      sinIva: total - iva, // base gravable: total factura sin IVA
    };
  }, [monthScoped]);

  // Ranking de facturación agrupada por contraparte (cliente para 'venta',
  // proveedor para 'compra'), ordenado de mayor a menor.
  // Usa el resolver para unificar variantes via responsible_id + aliases
  // de Conciliación Bancaria.
  const counterpartyRanking = useMemo(() => {
    const confirmed = monthScoped.filter(i => i.status === 'confirmed' && i.void_type !== 'total');
    const map = new Map<string, { name: string; total: number; count: number }>();
    for (const i of confirmed) {
      const raw = i.counterparty_name || (type === 'venta' ? i.buyer_name : i.seller_name);
      const displayName = resolveCounterpartyName(raw, i.responsible_id, counterpartyResolver);
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
  }, [monthScoped, type, counterpartyResolver]);

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

  // Al cambiar de año, volver el filtro de mes al default (último con datos).
  useEffect(() => { setMonthOverride(null); }, [selectedYear]);

  // Auto-sync con Siigo al entrar a la página, si pasó > 10 min desde la
  // última sync. Evita la fricción de tener que clickear "Sincronizar"
  // cada vez que se carga la página para ver facturas nuevas.
  useEffect(() => {
    if (!isEmpresarial) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { data: creds } = await supabase
          .from('user_siigo_credentials')
          .select('connection_status, last_invoice_pulled_at')
          .eq('user_id', user.id)
          .maybeSingle();
        if (cancelled) return;
        if (!creds || creds.connection_status !== 'connected') return;
        const lastIso = creds.last_invoice_pulled_at;
        const minutesSince = lastIso
          ? (Date.now() - new Date(lastIso).getTime()) / 60_000
          : Infinity;
        if (minutesSince < 10) return; // fresco, no resync
        // Dispara silenciosamente; cuando termina, refresca la lista.
        setSiigoSyncing(true);
        const { data, error } = await supabase.functions.invoke('siigo-sync-invoices', {
          body: { kinds: [type] },
        });
        if (cancelled) return;
        if (error || !data?.ok) {
          // No mostrar toast en auto-sync para no molestar; el botón manual
          // sigue disponible si el usuario quiere reintentar.
          console.warn('[siigo auto-sync]', error?.message ?? data?.error);
        } else if ((data.synced ?? 0) > 0) {
          await fetchInvoices();
          toast({
            title: 'Siigo actualizado',
            description: `${data.synced} facturas nuevas o actualizadas.`,
          });
        }
      } catch (e) {
        console.warn('[siigo auto-sync] error', e);
      } finally {
        if (!cancelled) setSiigoSyncing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEmpresarial, type, fetchInvoices, toast]);

  const filtered = useMemo(() => {
    // Parte de monthScoped para que la lista respete el filtro "Hasta: mes" y
    // sea coherente con las tarjetas de resumen (antes mostraba todo el año).
    let result = monthScoped;
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
    const sign = sortConfig.direction === 'desc' ? -1 : 1;
    const sorted = [...result].sort((a, b) => {
      if (sortConfig.field === 'date') {
        const da = a.issue_date || a.created_at || '';
        const db = b.issue_date || b.created_at || '';
        return sign * da.localeCompare(db);
      }
      if (sortConfig.field === 'invoice_number') {
        const na = numericOf(a.invoice_number);
        const nb = numericOf(b.invoice_number);
        // Si ambos son números válidos, sort numérico. Si no, lexicográfico.
        if (Number.isFinite(na) && Number.isFinite(nb)) return sign * (na - nb);
        return sign * (a.invoice_number ?? '').localeCompare(b.invoice_number ?? '');
      }
      // total
      const ta = Number(a.total_amount ?? 0);
      const tb = Number(b.total_amount ?? 0);
      return sign * (ta - tb);
    });
    return sorted;
  }, [monthScoped, statusFilter, searchQuery, sortConfig]);

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

  const handleSiigoSync = useCallback(async (full = false) => {
    setSiigoSyncing(true);
    try {
      // full=true ignora last_invoice_pulled_at y trae desde 1 ene del año
      // actual. Se usa cuando el user borró una factura y necesita re-traerla
      // (típicamente facturas anteriores a 30 días que el sync regular no
      // re-importa) o tras cambios estructurales.
      const { data, error } = await supabase.functions.invoke('siigo-sync-invoices', {
        body: { kinds: [type], full },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'No se pudo sincronizar');
      toast({
        title: full ? 'Sincronización completa terminada' : 'Siigo sincronizado',
        description: `${data.synced ?? 0} facturas procesadas${data.skipped ? `, ${data.skipped} omitidas` : ''}${full ? ' (desde 1 ene del año)' : ''}.`,
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
            <Button
              variant="outline"
              onClick={() => handleSiigoSync(false)}
              disabled={siigoSyncing}
              className="gap-2 h-auto py-2 flex-col items-start"
              title={`Importar ${type === 'venta' ? 'facturas de venta' : 'facturas de compra'} desde Siigo (últimos 30 días). Rápido — usalo a diario.`}
            >
              <span className="flex items-center gap-2">
                {siigoSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                Traer de Siigo
              </span>
              <span className="text-[10px] text-muted-foreground font-normal leading-none">Últimos 30 días · uso diario</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => handleSiigoSync(true)}
              disabled={siigoSyncing}
              className="gap-2 h-auto py-2 flex-col items-start"
              title={`Re-importa TODO desde el 1 de enero del ${currentYear}. Más lento. Usalo solo si borraste una factura y necesitás recuperarla.`}
            >
              <span className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                Sincronización completa
              </span>
              <span className="text-[10px] text-muted-foreground font-normal leading-none">Año {currentYear} completo · si borraste algo</span>
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                setDianValidating(true);
                try {
                  const { data, error } = await supabase.functions.invoke('validate-cufe', {
                    body: { batch: true },
                  });
                  if (error) throw error;
                  if (!data?.ok) throw new Error(data?.error || 'No se pudo validar');
                  await fetchInvoices();
                  toast({
                    title: 'Validación contra DIAN',
                    description: `${data.validated ?? 0} validadas, ${data.not_found ?? 0} no encontradas, ${data.errors ?? 0} con error (de ${data.count ?? 0}).`,
                  });
                } catch (e) {
                  const msg = e instanceof Error ? e.message : 'Intentá de nuevo';
                  toast({ title: 'Error validando contra DIAN', description: msg, variant: 'destructive' });
                } finally {
                  setDianValidating(false);
                }
              }}
              disabled={dianValidating}
              className="gap-2 h-auto py-2 flex-col items-start"
              title="Consulta el catálogo público DIAN para confirmar que cada CUFE existe y está validado. Procesa hasta 50 facturas pendientes por click."
            >
              <span className="flex items-center gap-2">
                {dianValidating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Validar contra DIAN
              </span>
              <span className="text-[10px] text-muted-foreground font-normal leading-none">Verifica CUFE en el catálogo oficial</span>
            </Button>
            {type === 'compra' && (
              <Button
                variant="outline"
                onClick={() => setBulkUploadOpen(true)}
                className="gap-2 h-auto py-2 flex-col items-start"
                title="Sube en lote los ZIP/XML de factura electrónica DIAN que te mandan tus proveedores. Los XML se leen al instante sin IA y se dedupean por CUFE."
              >
                <span className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  Subir facturas (ZIP/XML/PDF)
                </span>
                <span className="text-[10px] text-muted-foreground font-normal leading-none">Lote · XML directo sin IA</span>
              </Button>
            )}
            <Button onClick={handleOpenUpload} className="gap-2">
              <Upload className="h-4 w-4" />
              Subir factura PDF
            </Button>
          </div>
        </div>

        {/* Micro summary */}
        {selectedYear !== 'all' && (
          <p className="text-xs text-muted-foreground -mb-1">
            Acumulado {MONTH_NAMES[0]}–{MONTH_NAMES[monthCut - 1]} {selectedYear}
          </p>
        )}
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
          {/* Total sin IVA (base gravable) = total factura − IVA */}
          <div
            style={{
              background: '#fff',
              borderRadius: 14,
              padding: '18px 20px',
              border: '1.5px solid oklch(0.43 0.14 155 / 0.22)',
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
              Total sin IVA
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: '-0.5px',
                color: 'oklch(0.43 0.14 155)',
                marginTop: 4,
              }}
            >
              {formatCurrency(summary.sinIva)}
            </div>
            <div style={{ fontSize: 11, color: '#a1a1a6', marginTop: 2 }}>base gravable</div>
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
          {selectedYear !== 'all' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Hasta:</span>
              <Select value={String(monthCut)} onValueChange={(v) => setMonthOverride(Number(v))}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((m, i) => (
                    <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
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
                      <TableHead className="w-[100px] cursor-pointer select-none" onClick={() => toggleSort('date')}>
                        <span className="inline-flex items-center gap-1">
                          Fecha
                          {sortConfig.field === 'date' && (
                            sortConfig.direction === 'desc'
                              ? <ArrowDownNarrowWide className="h-3 w-3" />
                              : <ArrowUpNarrowWide className="h-3 w-3" />
                          )}
                        </span>
                      </TableHead>
                      <TableHead>{counterpartyLabel}</TableHead>
                      <TableHead className="w-[120px] cursor-pointer select-none" onClick={() => toggleSort('invoice_number')}>
                        <span className="inline-flex items-center gap-1">
                          Número
                          {sortConfig.field === 'invoice_number' && (
                            sortConfig.direction === 'desc'
                              ? <ArrowDownNarrowWide className="h-3 w-3" />
                              : <ArrowUpNarrowWide className="h-3 w-3" />
                          )}
                        </span>
                      </TableHead>
                      <TableHead className="text-right w-[130px] cursor-pointer select-none" onClick={() => toggleSort('total')}>
                        <span className="inline-flex items-center gap-1 justify-end w-full">
                          Total
                          {sortConfig.field === 'total' && (
                            sortConfig.direction === 'desc'
                              ? <ArrowDownNarrowWide className="h-3 w-3" />
                              : <ArrowUpNarrowWide className="h-3 w-3" />
                          )}
                        </span>
                      </TableHead>
                      <TableHead className="w-[160px]">Estado</TableHead>
                      <TableHead className="w-[150px] text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((inv) => {
                      const s = statusLabel[inv.status] || statusLabel.draft;
                      const displayDate = inv.issue_date || inv.created_at;
                      const isDraftOrError = ['draft', 'error', 'uploading', 'processing', 'ready'].includes(inv.status);
                      const isVoidedTotal = inv.void_type === 'total';
                      const isVoidedPartial = inv.void_type === 'partial';
                      const rowClass = isVoidedTotal
                        ? 'bg-destructive/5 opacity-60'
                        : isDraftOrError
                          ? 'bg-warning/5'
                          : '';
                      return (
                        <TableRow key={inv.id} className={rowClass}>
                          <TableCell className="text-sm">
                            {format(parseLocalDate(displayDate), 'dd MMM yy', { locale: es })}
                          </TableCell>
                          <TableCell className={`font-medium text-sm max-w-[260px] ${isVoidedTotal ? 'line-through' : ''}`}>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="truncate">
                                {resolveCounterpartyName(
                                  inv.counterparty_name || (type === 'venta' ? inv.buyer_name : inv.seller_name),
                                  inv.responsible_id,
                                  counterpartyResolver,
                                )}
                              </span>
                              {inv.source === 'siigo' && (
                                <Badge variant="secondary" className="h-4 px-1.5 text-[10px] gap-0.5 flex-shrink-0" title="Importada desde Siigo">
                                  <Plug className="h-2.5 w-2.5" />
                                  Siigo
                                </Badge>
                              )}
                              {inv.dian_validation_status === 'validated' && (
                                <Badge className="h-4 px-1.5 text-[10px] gap-0.5 flex-shrink-0 bg-success/15 text-success border-success/30" title="DIAN confirma que esta factura está registrada y validada">
                                  <ShieldCheck className="h-2.5 w-2.5" />
                                  DIAN ✓
                                </Badge>
                              )}
                              {inv.dian_validation_status === 'not_found' && (
                                <Badge variant="destructive" className="h-4 px-1.5 text-[10px] gap-0.5 flex-shrink-0" title="DIAN no encontró este CUFE — revisá con el proveedor">
                                  <ShieldX className="h-2.5 w-2.5" />
                                  No en DIAN
                                </Badge>
                              )}
                              {inv.dian_validation_status === 'error' && (
                                <Badge variant="outline" className="h-4 px-1.5 text-[10px] gap-0.5 flex-shrink-0 border-warning text-warning" title="No se pudo validar contra DIAN — sin CUFE o error de red">
                                  <ShieldAlert className="h-2.5 w-2.5" />
                                  DIAN ?
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className={`text-sm ${isVoidedTotal ? 'line-through' : ''}`}>{inv.invoice_number || '—'}</TableCell>
                          <TableCell className={`text-right font-medium ${isVoidedTotal ? 'line-through' : ''}`}>{formatCurrency(inv.total_amount)}</TableCell>
                          <TableCell>
                            {isVoidedTotal ? (
                              <Badge variant="destructive" className="text-[10px] gap-1" title={`Anulada por ${inv.voided_by_credit_note_number ?? 'nota crédito'}`}>
                                Nota Crédito
                              </Badge>
                            ) : isVoidedPartial ? (
                              <div className="flex flex-col gap-0.5">
                                <span style={{ display: 'inline-block', ...(statusStyle[inv.status] || statusStyle.draft) }}>
                                  {s.text}
                                </span>
                                <Badge variant="outline" className="text-[9px] px-1.5 border-destructive/40 text-destructive" title={`NC parcial ${inv.voided_by_credit_note_number ?? ''}: ${formatCurrency(Number(inv.voided_amount ?? 0))}`}>
                                  NC parcial
                                </Badge>
                              </div>
                            ) : (
                              <span style={{ display: 'inline-block', ...(statusStyle[inv.status] || statusStyle.draft) }}>
                                {s.text}
                              </span>
                            )}
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

      {type === 'compra' && (
        <BulkPurchaseUploadModal
          open={bulkUploadOpen}
          onClose={() => setBulkUploadOpen(false)}
          onImported={fetchInvoices}
        />
      )}

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
