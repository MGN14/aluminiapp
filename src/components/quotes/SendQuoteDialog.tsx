import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Loader2, Mail, MessageCircle, FileDown, ExternalLink, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { generateQuotationPdf } from '@/lib/quotationPdf';
import { jsPdfToBlobAndBase64, uploadQuotationPdf } from '@/lib/quotationPdfStorage';
import { useQuotationMutations } from '@/hooks/useQuotations';
import type { QuotationDetail } from '@/hooks/useQuotations';

const LETTERHEAD_BUCKET = 'letterheads';

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

interface Props {
  detail: QuotationDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  return `${d}/${m}/${y}`;
}

/** Limpia un teléfono dejando solo dígitos para wa.me. */
function cleanPhoneForWhatsApp(raw: string): string {
  return raw.replace(/[^\d]/g, '');
}

function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export default function SendQuoteDialog({ detail, open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { markSent } = useQuotationMutations();
  const [tab, setTab] = useState<'email' | 'whatsapp'>('email');
  const [busy, setBusy] = useState(false);

  // Email tab state
  const [toEmail, setToEmail] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [ccSelf, setCcSelf] = useState(true);

  // WhatsApp tab state
  const [waPhone, setWaPhone] = useState('');
  const [waMessage, setWaMessage] = useState('');

  // Empresa
  const { data: company } = useQuery<CompanyData | null>({
    queryKey: ['profile-company-quote-send', user?.id],
    enabled: !!user?.id && open,
    queryFn: async () => {
      const { data } = await (supabase
        .from('profiles')
        .select(
          'company_name, company_nit, company_address, company_city, company_phone, letterhead_path, letterhead_top_margin_mm, letterhead_bottom_margin_mm, accounting_email',
        )
        .eq('user_id', user!.id)
        .maybeSingle() as unknown as Promise<{ data: CompanyData | null }>);
      return data ?? null;
    },
  });

  // Prefill cuando abre o cambia el detail
  useEffect(() => {
    if (!open || !detail) return;
    setToEmail(detail.responsible?.email ?? '');
    setWaPhone(detail.responsible?.phone ?? '');

    const companyName = company?.company_name ?? '';
    const dueText = detail.valid_until ? ` Es válida hasta el ${fmtDate(detail.valid_until)}.` : '';
    const headlineTotal = detail.apply_iva
      ? Number(detail.total_with_iva)
      : Number(detail.total);
    const baseMsg = `Hola${detail.responsible?.name ? ` ${detail.responsible.name.split(' ')[0]}` : ''},

Te comparto la cotización ${detail.quote_number} por ${fmtMoney(headlineTotal)}${detail.apply_iva ? ' (IVA incluido)' : ''}.${dueText}

Cualquier ajuste o duda, me decís.

${companyName || ''}`.trim();
    setEmailMessage(baseMsg);
    setWaMessage(baseMsg);
    setBusy(false);
  }, [open, detail, company]);

  if (!detail) return null;

  // Genera PDF + lo sube al storage. Devuelve { blob, base64, storagePath }.
  // Cachea para no regenerarlo cada vez que cambias de tab.
  const buildPdf = async () => {
    let letterheadDataUri: string | undefined;
    let letterheadFormat: 'PNG' | 'JPEG' | undefined;
    if (company?.letterhead_path) {
      try {
        const { data: blob } = await supabase.storage
          .from(LETTERHEAD_BUCKET)
          .download(company.letterhead_path);
        if (blob) {
          letterheadDataUri = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          const ext = company.letterhead_path.split('.').pop()?.toLowerCase();
          letterheadFormat = ext === 'jpg' || ext === 'jpeg' ? 'JPEG' : 'PNG';
        }
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

    const { blob, base64 } = await jsPdfToBlobAndBase64(doc);
    const filename = `${detail.quote_number}_${(detail.responsible?.name ?? 'cliente')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .toLowerCase()}.pdf`;
    return { blob, base64, filename };
  };

  // ================== EMAIL ==================
  const handleSendEmail = async () => {
    const email = toEmail.trim();
    if (!isValidEmail(email)) {
      toast({ title: 'Correo inválido', variant: 'destructive' });
      return;
    }
    if (!user) return;
    setBusy(true);
    try {
      const { blob, base64, filename } = await buildPdf();

      // Upload PDF al storage (best effort) ANTES de mandar el email.
      const storagePath = await uploadQuotationPdf({
        userId: user.id,
        quotationId: detail.id,
        pdfBlob: blob,
      });

      // Llamar edge function vía fetch directo para poder leer el body de error.
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-quotation-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            quote_id: detail.id,
            to_email: email,
            message: emailMessage,
            file_base64: base64,
            file_name: filename,
            cc_self: ccSelf,
          }),
        },
      );
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || payload?.error) {
        throw new Error(payload?.error || `Error ${resp.status}`);
      }

      // Marca como enviada
      await markSent.mutateAsync({
        id: detail.id,
        channel: 'email',
        recipient: email,
        pdfStoragePath: storagePath,
      });

      toast({
        title: '✓ Cotización enviada',
        description: `Email a ${email}${ccSelf && company?.accounting_email ? ` (con copia a ${company.accounting_email})` : ''}`,
      });
      onOpenChange(false);
    } catch (err: any) {
      console.error('Send quote email error:', err);
      toast({
        title: 'No se pudo enviar',
        description: err?.message || 'Revisá conexión o que el cliente tenga email cargado.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  // ================== WHATSAPP ==================
  const handleSendWhatsApp = async () => {
    const phoneClean = cleanPhoneForWhatsApp(waPhone);
    if (phoneClean.length < 7) {
      toast({
        title: 'Teléfono inválido',
        description: 'Ingresá un número con código de país (ej: 573001234567).',
        variant: 'destructive',
      });
      return;
    }
    if (!user) return;
    setBusy(true);
    try {
      const { blob, base64, filename } = await buildPdf();

      // 1) Upload al storage (histórico)
      const storagePath = await uploadQuotationPdf({
        userId: user.id,
        quotationId: detail.id,
        pdfBlob: blob,
      });

      // 2) Descargar el PDF localmente (para que el user lo arrastre al chat de WhatsApp)
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      // 3) Abrir wa.me con texto pre-armado
      const waUrl = `https://wa.me/${phoneClean}?text=${encodeURIComponent(waMessage)}`;
      window.open(waUrl, '_blank', 'noopener,noreferrer');

      // 4) Marcar como enviada
      await markSent.mutateAsync({
        id: detail.id,
        channel: 'whatsapp',
        recipient: phoneClean,
        pdfStoragePath: storagePath,
      });

      // base64 no se usa en el flujo WhatsApp, pero lo dejamos calculado por consistencia.
      void base64;

      toast({
        title: '✓ WhatsApp abierto',
        description: 'Adjuntá el PDF descargado al chat antes de enviar.',
      });
      onOpenChange(false);
    } catch (err: any) {
      console.error('Send quote whatsapp error:', err);
      toast({
        title: 'No se pudo preparar el envío',
        description: err?.message,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? null : onOpenChange(o))}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Enviar cotización {detail.quote_number}</DialogTitle>
          <DialogDescription>
            {detail.responsible?.name ?? '—'} ·{' '}
            {fmtMoney(
              detail.apply_iva ? Number(detail.total_with_iva) : Number(detail.total),
            )}
            {detail.apply_iva ? ' (IVA incl.)' : ''}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'email' | 'whatsapp')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="email">
              <Mail className="h-3.5 w-3.5 mr-1.5" />
              Email
            </TabsTrigger>
            <TabsTrigger value="whatsapp">
              <MessageCircle className="h-3.5 w-3.5 mr-1.5" />
              WhatsApp
            </TabsTrigger>
          </TabsList>

          {/* ================== EMAIL ================== */}
          <TabsContent value="email" className="space-y-3 pt-3">
            {!detail.responsible?.email && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-2.5 flex gap-2 text-xs">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 text-amber-700 dark:text-amber-400 flex-shrink-0" />
                <span className="text-amber-900 dark:text-amber-100">
                  El cliente no tiene email cargado. Ingresalo abajo o agregalo en Beneficiarios.
                </span>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Para</Label>
              <Input
                type="email"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                placeholder="cliente@empresa.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Mensaje</Label>
              <Textarea
                rows={6}
                value={emailMessage}
                onChange={(e) => setEmailMessage(e.target.value)}
              />
            </div>
            {company?.accounting_email && (
              <div className="flex items-center justify-between rounded-md border border-border p-2.5">
                <div className="text-xs">
                  <div className="font-medium">Copiarme</div>
                  <div className="text-muted-foreground">{company.accounting_email}</div>
                </div>
                <Switch checked={ccSelf} onCheckedChange={setCcSelf} />
              </div>
            )}
          </TabsContent>

          {/* ================== WHATSAPP ================== */}
          <TabsContent value="whatsapp" className="space-y-3 pt-3">
            {!detail.responsible?.phone && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-2.5 flex gap-2 text-xs">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 text-amber-700 dark:text-amber-400 flex-shrink-0" />
                <span className="text-amber-900 dark:text-amber-100">
                  El cliente no tiene teléfono cargado. Ingresalo abajo o agregalo en Beneficiarios.
                </span>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Teléfono (con código país)</Label>
              <Input
                type="tel"
                value={waPhone}
                onChange={(e) => setWaPhone(e.target.value)}
                placeholder="573001234567"
              />
              <p className="text-[10px] text-muted-foreground">
                Solo números, sin espacios ni símbolos. Ej: <strong>573001234567</strong> (Colombia
                + número).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Mensaje pre-armado</Label>
              <Textarea
                rows={5}
                value={waMessage}
                onChange={(e) => setWaMessage(e.target.value)}
              />
            </div>
            <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 p-2.5 text-xs space-y-1.5">
              <div className="flex items-center gap-2 font-medium text-blue-900 dark:text-blue-100">
                <FileDown className="h-3.5 w-3.5" />
                Cómo funciona
              </div>
              <ol className="text-blue-900 dark:text-blue-100 space-y-0.5 pl-4 list-decimal">
                <li>Te bajamos el PDF al equipo</li>
                <li>Te abrimos WhatsApp Web/app con el mensaje listo</li>
                <li>Arrastrás el PDF al chat y enviás</li>
              </ol>
              <p className="text-[10px] text-blue-700 dark:text-blue-300 pt-1">
                WhatsApp no permite adjuntar archivos vía link automático — esto es lo más cercano
                a "un click" sin pagar API de WhatsApp Business.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          {tab === 'email' ? (
            <Button onClick={handleSendEmail} disabled={busy || !toEmail.trim()}>
              {busy ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Mail className="h-4 w-4 mr-1.5" />
              )}
              Enviar email
            </Button>
          ) : (
            <Button onClick={handleSendWhatsApp} disabled={busy || !waPhone.trim()}>
              {busy ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <ExternalLink className="h-4 w-4 mr-1.5" />
              )}
              Abrir WhatsApp + descargar PDF
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
