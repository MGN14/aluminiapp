import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  FileDown,
  Loader2,
  CheckCircle2,
  XCircle,
  Send,
  Pencil,
  Copy,
  Trash2,
  ArrowRightCircle,
  Mail,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useDataOwner } from '@/hooks/useDataOwner';
import { supabase } from '@/integrations/supabase/client';
import {
  useQuotationDetail,
  useQuotationMutations,
} from '@/hooks/useQuotations';
import { generateQuotationPdf } from '@/lib/quotationPdf';
import type { QuotationStatus } from '@/types/quotation';
import NewQuoteModal from './NewQuoteModal';
import SendQuoteDialog from './SendQuoteDialog';

const LETTERHEAD_BUCKET = 'letterheads';

interface Props {
  quoteId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

const STATUS_LABELS: Record<
  QuotationStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  draft: { label: 'Borrador', variant: 'outline' },
  sent: { label: 'Enviada', variant: 'secondary' },
  accepted: { label: 'Aceptada', variant: 'default' },
  rejected: { label: 'Rechazada', variant: 'destructive' },
  expired: { label: 'Vencida', variant: 'destructive' },
};

interface CompanyData {
  company_name: string | null;
  company_nit: string | null;
  company_address: string | null;
  company_city: string | null;
  company_phone: string | null;
  letterhead_path: string | null;
  letterhead_top_margin_mm: number;
  letterhead_bottom_margin_mm: number;
  accounting_email: string | null;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  if (!y || !m || !d) return dateStr;
  return `${d}/${m}/${y}`;
}

function fmtNum(n: number, decimals = 2): string {
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

export default function QuoteDetailModal({
  quoteId,
  open,
  onOpenChange,
  onDeleted,
}: Props) {
  const { user } = useAuth();
  // Para colaboradores, los datos de empresa para el PDF están en el
  // profile del owner, no en el suyo.
  const { dataOwnerId } = useDataOwner();
  const { toast } = useToast();
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: detail, isLoading } = useQuotationDetail(quoteId);
  const { remove, setStatus, duplicate } = useQuotationMutations();

  // Empresa + letterhead (best-effort) — leído del profile del owner.
  const { data: company } = useQuery<CompanyData | null>({
    queryKey: ['profile-company-quote', dataOwnerId],
    enabled: !!dataOwnerId && open,
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('profiles')
        .select(
          'company_name, company_nit, company_address, company_city, company_phone, letterhead_path, letterhead_top_margin_mm, letterhead_bottom_margin_mm, accounting_email',
        )
        .eq('user_id', dataOwnerId!)
        .maybeSingle() as unknown as Promise<{
          data: CompanyData | null;
          error: { message: string } | null;
        }>);
      if (error) throw error;
      return data ?? null;
    },
  });

  const handleClose = () => {
    if (generatingPdf) return;
    onOpenChange(false);
  };

  const handleDownloadPdf = async () => {
    if (!detail || !user) return;
    setGeneratingPdf(true);
    try {
      // Letterhead opcional
      let letterheadDataUri: string | undefined;
      let letterheadFormat: 'PNG' | 'JPEG' | undefined;
      if (company?.letterhead_path) {
        try {
          const { data: blob, error: dlErr } = await supabase.storage
            .from(LETTERHEAD_BUCKET)
            .download(company.letterhead_path);
          if (dlErr) throw dlErr;
          letterheadDataUri = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          const ext = company.letterhead_path.split('.').pop()?.toLowerCase();
          letterheadFormat = ext === 'jpg' || ext === 'jpeg' ? 'JPEG' : 'PNG';
        } catch (e) {
          console.error('Letterhead load failed:', e);
        }
      }

      const doc = generateQuotationPdf({
        letterheadDataUri,
        letterheadFormat,
        letterheadTopMarginMm: company?.letterhead_top_margin_mm,
        letterheadBottomMarginMm: company?.letterhead_bottom_margin_mm,
        empresaNombre: company?.company_name || 'Mi empresa',
        empresaNit: company?.company_nit ?? null,
        empresaDireccion: company?.company_address ?? null,
        empresaCiudad: company?.company_city ?? null,
        empresaTelefono: company?.company_phone ?? null,
        empresaEmail: company?.accounting_email ?? null,
        clienteNombre: detail.responsible?.name ?? '—',
        clienteNit: detail.responsible?.nit ?? null,
        clienteDireccion: detail.responsible?.address ?? null,
        clienteEmail: detail.responsible?.email ?? null,
        clienteTelefono: detail.responsible?.phone ?? null,
        quoteNumber: detail.quote_number,
        issueDate: detail.issue_date,
        validUntil: detail.valid_until,
        items: detail.items.map((it) => ({
          description: it.description ?? null,
          system: it.system,
          color: it.color,
          width_m: Number(it.width_m),
          height_m: Number(it.height_m),
          quantity: Number(it.quantity),
          area_m2: Number(it.area_m2),
          price_per_m2: Number(it.price_per_m2),
          line_subtotal: Number(it.line_subtotal),
        })),
        subtotalBase: Number(detail.subtotal_base),
        laborPct: Number(detail.labor_pct),
        laborAmount: Number(detail.labor_amount),
        profitPct: Number(detail.profit_pct),
        profitAmount: Number(detail.profit_amount),
        total: Number(detail.total),
        applyIva: !!detail.apply_iva,
        ivaRate: Number(detail.iva_rate),
        ivaAmount: Number(detail.iva_amount),
        applyRetefuente: !!detail.apply_retefuente,
        retefuenteRate: Number(detail.retefuente_rate),
        retefuenteAmount: Number(detail.retefuente_amount),
        applyReteica: !!detail.apply_reteica,
        reteicaRate: Number(detail.reteica_rate),
        reteicaAmount: Number(detail.reteica_amount),
        totalWithIva: Number(detail.total_with_iva),
        totalNet: Number(detail.total_net),
        notes: detail.notes,
      });

      const filename = `${detail.quote_number}_${(detail.responsible?.name ?? 'cliente')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .toLowerCase()}.pdf`;
      doc.save(filename);
      toast({ title: 'PDF descargado', description: filename });
    } catch (e: any) {
      toast({
        title: 'No se pudo generar el PDF',
        description: e?.message || 'Error desconocido',
        variant: 'destructive',
      });
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleStatusChange = async (newStatus: QuotationStatus) => {
    if (!detail) return;
    try {
      await setStatus.mutateAsync({ id: detail.id, status: newStatus });
      toast({ title: `Cotización ${STATUS_LABELS[newStatus].label.toLowerCase()}` });
    } catch (e: any) {
      toast({
        title: 'No se pudo actualizar',
        description: e?.message,
        variant: 'destructive',
      });
    }
  };

  const handleDuplicate = async () => {
    if (!detail) return;
    try {
      const result = await duplicate.mutateAsync(detail.id);
      toast({
        title: `Cotización duplicada como ${result.quote_number}`,
        description: 'Quedó como borrador.',
      });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Error al duplicar', description: e?.message, variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    if (!detail) return;
    try {
      await remove.mutateAsync(detail.id);
      toast({ title: 'Cotización eliminada' });
      setConfirmDelete(false);
      onDeleted?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: 'No se pudo eliminar',
        description: e?.message,
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : handleClose())}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          {isLoading || !detail ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="font-mono">{detail.quote_number}</span>
                  <Badge variant={STATUS_LABELS[detail.status].variant}>
                    {STATUS_LABELS[detail.status].label}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  Cotización a <strong>{detail.responsible?.name ?? '—'}</strong> ·{' '}
                  Emitida {formatDate(detail.issue_date)} · Vence {formatDate(detail.valid_until)}
                </DialogDescription>
              </DialogHeader>

              {/* Cliente */}
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <div className="text-[10px] uppercase text-muted-foreground mb-1">
                  Cliente
                </div>
                <div className="font-medium">{detail.responsible?.name ?? '—'}</div>
                <div className="text-xs text-muted-foreground space-x-2">
                  {detail.responsible?.nit && <span>NIT {detail.responsible.nit}</span>}
                  {detail.responsible?.email && <span>· {detail.responsible.email}</span>}
                  {detail.responsible?.phone && <span>· {detail.responsible.phone}</span>}
                </div>
                {detail.responsible?.address && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {detail.responsible.address}
                  </div>
                )}
              </div>

              {/* Items */}
              <div className="rounded-md border border-border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">#</TableHead>
                      <TableHead>Producto</TableHead>
                      <TableHead className="text-right">Dim. (m)</TableHead>
                      <TableHead className="text-right">Cant</TableHead>
                      <TableHead className="text-right">m²</TableHead>
                      <TableHead className="text-right">Precio/m²</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.items.map((it, idx) => (
                      <TableRow key={it.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {idx + 1}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium">
                            {it.system} · {it.color}
                          </div>
                          {it.description && (
                            <div className="text-xs text-muted-foreground">
                              {it.description}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {fmtNum(Number(it.width_m), 2)} × {fmtNum(Number(it.height_m), 2)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {it.quantity}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {fmtNum(Number(it.area_m2), 2)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {formatCurrency(Number(it.price_per_m2))}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums font-medium">
                          {formatCurrency(Number(it.line_subtotal))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Totales (con IVA y retenciones) */}
              <div className="ml-auto w-full sm:w-[360px] space-y-1 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal m²</span>
                  <span className="tabular-nums">{formatCurrency(Number(detail.subtotal_base))}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>+ Mano de obra ({fmtNum(Number(detail.labor_pct), 1)}%)</span>
                  <span className="tabular-nums">{formatCurrency(Number(detail.labor_amount))}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>+ Utilidad ({fmtNum(Number(detail.profit_pct), 1)}%)</span>
                  <span className="tabular-nums">{formatCurrency(Number(detail.profit_amount))}</span>
                </div>
                <div className="border-t border-border pt-1 flex justify-between font-medium">
                  <span>Total sin IVA</span>
                  <span className="tabular-nums">{formatCurrency(Number(detail.total))}</span>
                </div>
                {detail.apply_iva && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>+ IVA ({fmtNum(Number(detail.iva_rate) * 100, 0)}%)</span>
                    <span className="tabular-nums">{formatCurrency(Number(detail.iva_amount))}</span>
                  </div>
                )}
                <div className="border-t border-border pt-1 flex justify-between font-semibold text-base">
                  <span>Total con IVA</span>
                  <span className="tabular-nums text-primary">
                    {formatCurrency(Number(detail.total_with_iva))}
                  </span>
                </div>
                {detail.apply_retefuente && Number(detail.retefuente_amount) > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>− Retef. fuente ({fmtNum(Number(detail.retefuente_rate) * 100, 2)}%)</span>
                    <span className="tabular-nums">−{formatCurrency(Number(detail.retefuente_amount))}</span>
                  </div>
                )}
                {detail.apply_reteica && Number(detail.reteica_amount) > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>− Reteica ({fmtNum(Number(detail.reteica_rate) * 100, 2)}%)</span>
                    <span className="tabular-nums">−{formatCurrency(Number(detail.reteica_amount))}</span>
                  </div>
                )}
                {(detail.apply_retefuente || detail.apply_reteica) && (
                  <div className="border-t border-border pt-1 flex justify-between font-medium">
                    <span>Valor neto a recibir</span>
                    <span className="tabular-nums">{formatCurrency(Number(detail.total_net))}</span>
                  </div>
                )}
              </div>

              {detail.notes && (
                <div className="rounded-md border border-border bg-muted/20 p-3">
                  <div className="text-[10px] uppercase text-muted-foreground mb-1">
                    Términos y condiciones
                  </div>
                  <div className="text-xs whitespace-pre-line">{detail.notes}</div>
                </div>
              )}

              <DialogFooter className="flex-wrap gap-2">
                <div className="flex flex-wrap gap-2 mr-auto">
                  {/* Status transitions */}
                  {detail.status === 'draft' && (
                    <>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => setShowSend(true)}
                      >
                        <Mail className="h-3.5 w-3.5 mr-1.5" />
                        Enviar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStatusChange('sent')}
                        disabled={setStatus.isPending}
                        className="text-muted-foreground"
                        title="Marcar como enviada sin enviar email/WhatsApp"
                      >
                        <Send className="h-3.5 w-3.5 mr-1.5" />
                        Marcar enviada
                      </Button>
                    </>
                  )}
                  {detail.status === 'sent' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowSend(true)}
                    >
                      <Mail className="h-3.5 w-3.5 mr-1.5" />
                      Reenviar
                    </Button>
                  )}
                  {(detail.status === 'sent' || detail.status === 'draft') && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStatusChange('accepted')}
                        disabled={setStatus.isPending}
                        className="text-green-700 hover:text-green-800"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                        Aceptada
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStatusChange('rejected')}
                        disabled={setStatus.isPending}
                        className="text-muted-foreground"
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1.5" />
                        Rechazada
                      </Button>
                    </>
                  )}
                  {(detail.status === 'rejected' || detail.status === 'expired') && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleStatusChange('draft')}
                      disabled={setStatus.isPending}
                    >
                      <ArrowRightCircle className="h-3.5 w-3.5 mr-1.5" />
                      Volver a borrador
                    </Button>
                  )}
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(true)}
                  disabled={remove.isPending}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Eliminar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDuplicate}
                  disabled={duplicate.isPending}
                >
                  {duplicate.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Duplicar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowEdit(true)}
                  disabled={detail.status === 'accepted'}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Editar
                </Button>
                <Button onClick={handleDownloadPdf} disabled={generatingPdf}>
                  {generatingPdf ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <FileDown className="h-4 w-4 mr-1.5" />
                  )}
                  Descargar PDF
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edición */}
      {detail && (
        <NewQuoteModal
          open={showEdit}
          onOpenChange={setShowEdit}
          editing={{ quotation: detail, items: detail.items }}
        />
      )}

      {/* Enviar (Email / WhatsApp) */}
      <SendQuoteDialog
        detail={detail}
        open={showSend}
        onOpenChange={setShowSend}
      />

      {/* Confirmación de eliminación */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta cotización?</AlertDialogTitle>
            <AlertDialogDescription>
              {detail?.quote_number} a {detail?.responsible?.name ?? '—'}. Esta acción no se
              puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={remove.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {remove.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
