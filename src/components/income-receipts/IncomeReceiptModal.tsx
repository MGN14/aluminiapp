import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Trash2, Loader2, Download, FileText, Sparkles } from 'lucide-react';
import { useIncomeReceipts, type IncomeReceiptRow } from '@/hooks/useIncomeReceipts';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { generateComprobanteIngresoPdf, type ComprobanteIngresoData } from '@/lib/comprobanteIngresoPdf';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

const LETTERHEAD_BUCKET = 'letterheads';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: IncomeReceiptRow | null;
}

const todayIso = () => new Date().toISOString().split('T')[0];

interface ProfileLite {
  company_name: string | null;
  company_nit: string | null;
  company_address: string | null;
  company_city: string | null;
  letterhead_path: string | null;
  letterhead_top_margin_mm: number | null;
  letterhead_bottom_margin_mm: number | null;
}

export default function IncomeReceiptModal({ open, onOpenChange, editing }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { create, update, remove } = useIncomeReceipts();
  const isEdit = !!editing;

  const [fecha, setFecha] = useState(todayIso());
  const [payerName, setPayerName] = useState('');
  const [payerDocType, setPayerDocType] = useState<'CC' | 'CE' | 'NIT' | 'PA' | ''>('CC');
  const [payerDoc, setPayerDoc] = useState('');
  const [payerCity, setPayerCity] = useState('');
  const [payerPhone, setPayerPhone] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [concept, setConcept] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Transferencia');
  const [referenceDoc, setReferenceDoc] = useState('');
  const [notes, setNotes] = useState('');
  const [useLetterhead, setUseLetterhead] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const [profile, setProfile] = useState<ProfileLite | null>(null);

  // Load profile (company info + letterhead)
  useEffect(() => {
    if (!open || !user) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('company_name, company_nit, company_address, company_city, letterhead_path, letterhead_top_margin_mm, letterhead_bottom_margin_mm')
        .eq('user_id', user.id)
        .maybeSingle();
      setProfile(data as ProfileLite);
      // Si el profile no tiene letterhead, forzamos useLetterhead=false
      if (!data?.letterhead_path) setUseLetterhead(false);
    })();
  }, [open, user?.id]);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setFecha(editing.fecha);
      setPayerName(editing.payer_name);
      setPayerDocType(editing.payer_document_type ?? 'CC');
      setPayerDoc(editing.payer_document ?? '');
      setPayerCity(editing.payer_city ?? '');
      setPayerPhone(editing.payer_phone ?? '');
      setAmount(editing.amount);
      setConcept(editing.concept);
      setPaymentMethod(editing.payment_method ?? 'Transferencia');
      setReferenceDoc(editing.reference_doc ?? '');
      setNotes(editing.notes ?? '');
      setUseLetterhead(editing.use_letterhead);
    } else {
      setFecha(todayIso());
      setPayerName('');
      setPayerDocType('CC');
      setPayerDoc('');
      setPayerCity('');
      setPayerPhone('');
      setAmount('');
      setConcept('');
      setPaymentMethod('Transferencia');
      setReferenceDoc('');
      setNotes('');
      // useLetterhead se setea desde profile.letterhead_path
    }
    setErrMsg(null);
  }, [open, editing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrMsg(null);
    if (!payerName.trim()) { setErrMsg('Tenés que poner el nombre del pagador'); return; }
    if (!concept.trim()) { setErrMsg('Falta el concepto del pago'); return; }
    if (amount === '' || +amount <= 0) { setErrMsg('El monto debe ser mayor que 0'); return; }

    const payload = {
      fecha,
      payer_name: payerName.trim(),
      payer_document: payerDoc.trim() || null,
      payer_document_type: (payerDocType || null) as 'CC' | 'CE' | 'NIT' | 'PA' | null,
      payer_city: payerCity.trim() || null,
      payer_phone: payerPhone.trim() || null,
      amount: +amount,
      concept: concept.trim(),
      payment_method: paymentMethod.trim() || null,
      reference_doc: referenceDoc.trim() || null,
      notes: notes.trim() || null,
      use_letterhead: useLetterhead,
    };

    try {
      if (isEdit && editing) {
        await update.mutateAsync({ id: editing.id, ...payload });
      } else {
        await create.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Error al guardar');
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    const ok = window.confirm(`¿Eliminar el comprobante "${editing.numero_consecutivo ?? '—'}"? No se puede deshacer.`);
    if (!ok) return;
    await remove.mutateAsync(editing.id);
    onOpenChange(false);
  };

  const handleDownloadPdf = async () => {
    setGeneratingPdf(true);
    setErrMsg(null);
    try {
      // 1) Si no hay editing (creando nuevo), guardamos primero para obtener consecutivo
      let target: IncomeReceiptRow | null = editing ?? null;
      if (!target) {
        if (!payerName.trim() || !concept.trim() || amount === '' || +amount <= 0) {
          setErrMsg('Completá pagador, concepto y monto antes de generar el PDF');
          setGeneratingPdf(false);
          return;
        }
        target = await create.mutateAsync({
          fecha,
          payer_name: payerName.trim(),
          payer_document: payerDoc.trim() || null,
          payer_document_type: (payerDocType || null) as 'CC' | 'CE' | 'NIT' | 'PA' | null,
          payer_city: payerCity.trim() || null,
          payer_phone: payerPhone.trim() || null,
          amount: +amount,
          concept: concept.trim(),
          payment_method: paymentMethod.trim() || null,
          reference_doc: referenceDoc.trim() || null,
          notes: notes.trim() || null,
          use_letterhead: useLetterhead,
        });
      }

      if (!target) throw new Error('No se pudo crear el comprobante');

      // 2) Cargar letterhead si el toggle está activo
      let letterheadDataUri: string | undefined;
      let letterheadFormat: 'PNG' | 'JPEG' | undefined;
      if (useLetterhead && profile?.letterhead_path) {
        try {
          const { data: blob, error: dlErr } = await supabase.storage
            .from(LETTERHEAD_BUCKET)
            .download(profile.letterhead_path);
          if (dlErr) throw dlErr;
          letterheadDataUri = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          const ext = profile.letterhead_path.split('.').pop()?.toLowerCase();
          letterheadFormat = ext === 'jpg' || ext === 'jpeg' ? 'JPEG' : 'PNG';
        } catch (e) {
          console.error('Error cargando letterhead:', e);
          toast({
            title: 'No se pudo cargar la hoja membretada',
            description: 'Se generará el PDF sin membrete.',
            variant: 'destructive',
          });
        }
      }

      // 3) Generar PDF
      const fechaFormatted = format(parseISO(target.fecha), "d 'de' MMMM 'de' yyyy", { locale: es });
      const data: ComprobanteIngresoData = {
        useLetterhead: useLetterhead && !!letterheadDataUri,
        letterheadDataUri,
        letterheadFormat,
        letterheadTopMarginMm: profile?.letterhead_top_margin_mm ?? undefined,
        letterheadBottomMarginMm: profile?.letterhead_bottom_margin_mm ?? undefined,
        empresaNombre: profile?.company_name ?? undefined,
        empresaNit: profile?.company_nit ?? undefined,
        empresaDireccion: profile?.company_address ?? undefined,
        empresaCiudad: profile?.company_city ?? undefined,
        pagadorNombre: target.payer_name,
        pagadorTipoDocumento: (target.payer_document_type ?? undefined) as ComprobanteIngresoData['pagadorTipoDocumento'],
        pagadorDocumento: target.payer_document ?? undefined,
        pagadorCiudad: target.payer_city ?? undefined,
        pagadorTelefono: target.payer_phone ?? undefined,
        numeroConsecutivo: target.numero_consecutivo ?? '—',
        fecha: fechaFormatted,
        ciudadEmision: profile?.company_city || target.payer_city || 'Bogotá D.C.',
        monto: Number(target.amount),
        concepto: target.concept,
        metodoPago: target.payment_method ?? undefined,
        referenciaDoc: target.reference_doc ?? undefined,
        notas: target.notes ?? undefined,
      };

      const pdf = generateComprobanteIngresoPdf(data);
      const safePayer = target.payer_name.replace(/\s+/g, '-').toLowerCase();
      const filename = `comprobante-ingreso-${target.numero_consecutivo ?? 'sin-num'}-${safePayer}.pdf`;
      pdf.save(filename);

      toast({ title: 'PDF generado', description: filename });

      // Cerramos modal si era un nuevo (ya guardado)
      if (!editing) onOpenChange(false);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Error generando PDF');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const saving = create.isPending || update.isPending;
  const hasLetterheadConfigured = !!profile?.letterhead_path;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-success" />
            {isEdit ? `Editar comprobante ${editing?.numero_consecutivo ?? ''}` : 'Nuevo comprobante de ingreso'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Recibo de caja que le entregás al cliente como constancia del pago recibido.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Fecha + método pago + referencia */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm">Fecha *</Label>
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} max={todayIso()} required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Método de pago</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Efectivo">Efectivo</SelectItem>
                  <SelectItem value="Transferencia">Transferencia</SelectItem>
                  <SelectItem value="Cheque">Cheque</SelectItem>
                  <SelectItem value="Tarjeta">Tarjeta</SelectItem>
                  <SelectItem value="Wompi">Wompi (link)</SelectItem>
                  <SelectItem value="Otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Referencia / Factura</Label>
              <Input value={referenceDoc} onChange={(e) => setReferenceDoc(e.target.value)} placeholder="Ej: FV-001" />
            </div>
          </div>

          {/* Pagador */}
          <div className="space-y-2 p-3 rounded-lg border border-border bg-muted/20">
            <Label className="text-sm font-semibold">Pagador (cliente)</Label>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Nombre completo *</Label>
                <Input
                  required
                  value={payerName}
                  onChange={(e) => setPayerName(e.target.value)}
                  placeholder="Ej: Comercial El Sol S.A.S."
                  autoFocus={!isEdit}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tipo doc.</Label>
                <Select value={payerDocType} onValueChange={(v) => setPayerDocType(v as typeof payerDocType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CC">Cédula</SelectItem>
                    <SelectItem value="NIT">NIT</SelectItem>
                    <SelectItem value="CE">Cédula Extranjería</SelectItem>
                    <SelectItem value="PA">Pasaporte</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Número documento</Label>
                <Input value={payerDoc} onChange={(e) => setPayerDoc(e.target.value)} placeholder="900.123.456-7" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Ciudad</Label>
                <Input value={payerCity} onChange={(e) => setPayerCity(e.target.value)} placeholder="Bogotá" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Teléfono</Label>
                <Input value={payerPhone} onChange={(e) => setPayerPhone(e.target.value)} placeholder="3001234567" />
              </div>
            </div>
          </div>

          {/* Monto + concepto */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm">Monto recibido (COP) *</Label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value === '' ? '' : +e.target.value)}
                placeholder="0"
                className="font-mono"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Concepto *</Label>
              <Input
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                placeholder="Ej: Abono factura FV-001"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Notas (opcional, no se imprimen)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Detalles internos del pago, conciliación, etc."
              rows={2}
            />
          </div>

          {/* Toggle letterhead */}
          <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-muted/20">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Generar con formato de empresa (membrete)
              </Label>
              <p className="text-xs text-muted-foreground">
                {hasLetterheadConfigured
                  ? 'Tu hoja membretada va de fondo. Activa para PDF formal con tu marca; desactiva para formato limpio.'
                  : 'No tenés membrete cargado. Configurá uno en Ajustes → Hoja membretada para activar esta opción.'}
              </p>
            </div>
            <Switch
              checked={useLetterhead}
              onCheckedChange={setUseLetterhead}
              disabled={!hasLetterheadConfigured}
            />
          </div>

          {errMsg && <p className="text-xs text-destructive">{errMsg}</p>}

          <div className="flex items-center gap-2 flex-wrap">
            {isEdit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDelete}
                disabled={remove.isPending}
                className="text-destructive border-destructive/30 hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Eliminar
              </Button>
            )}
            <div className="flex-1" />
            <Button type="submit" variant="outline" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {isEdit ? 'Guardar cambios' : 'Solo guardar'}
            </Button>
            <Button type="button" onClick={handleDownloadPdf} disabled={generatingPdf || saving}>
              {generatingPdf ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Download className="h-4 w-4 mr-1" />
              )}
              {isEdit ? 'Generar PDF' : 'Guardar + PDF'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
