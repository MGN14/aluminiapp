import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { ExtractedInvoiceData, Invoice } from '@/types/invoice';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Upload, RefreshCw, X, AlertTriangle, Save, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import InvoiceValidationForm from './InvoiceValidationForm';

interface Props {
  open: boolean;
  onClose: () => void;
  onInvoiceSaved: () => void;
  resumeDraft?: Invoice | null;
}

type Step = 'upload' | 'uploading' | 'processing' | 'review' | 'error';

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 90;

function mapExtracted(draft: Invoice, ed: any): ExtractedInvoiceData {
  return {
    invoice_number: draft.invoice_number || ed.invoice_number || '',
    prefix: draft.prefix || ed.prefix || '',
    number_int: draft.number_int ?? ed.number_int ?? null,
    type: (draft.type as 'venta' | 'compra') || ed.type || 'compra',
    issue_date: draft.issue_date || ed.issue_date || '',
    due_date: draft.due_date || ed.due_date || null,
    counterparty_name: draft.counterparty_name || ed.counterparty_name || '',
    counterparty_nit: draft.counterparty_nit || ed.counterparty_nit || '',
    seller_name: draft.seller_name || ed.seller_name || '',
    seller_nit: draft.seller_nit || ed.seller_nit || '',
    buyer_name: draft.buyer_name || ed.buyer_name || '',
    buyer_nit: draft.buyer_nit || ed.buyer_nit || '',
    city: draft.city || ed.city || null,
    subtotal_base: draft.subtotal_base || ed.subtotal_base || 0,
    iva_rate: draft.iva_rate ?? ed.iva_rate ?? 0.19,
    iva_amount: draft.iva_amount || ed.iva_amount || 0,
    total_amount: draft.total_amount || ed.total_amount || 0,
    cufe: draft.cufe || ed.cufe || null,
    payment_method: draft.payment_method || ed.payment_method || null,
    items: ed.items || [],
  };
}

function emptyExtracted(): ExtractedInvoiceData {
  return {
    invoice_number: '', prefix: '', number_int: null, type: 'compra',
    issue_date: '', due_date: '', counterparty_name: '', counterparty_nit: '',
    seller_name: '', seller_nit: '', buyer_name: '', buyer_nit: '',
    city: '', subtotal_base: 0, iva_rate: 0.19, iva_amount: 0,
    total_amount: 0, cufe: '', payment_method: '', items: [],
  };
}

export default function InvoiceUploadModal({ open, onClose, onInvoiceSaved, resumeDraft }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('upload');
  const [extracted, setExtracted] = useState<ExtractedInvoiceData | null>(null);
  const [rawExtracted, setRawExtracted] = useState<any>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [originalFilename, setOriginalFilename] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [pollProgress, setPollProgress] = useState(0);
  const fileRef = useRef<File | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initRef = useRef<string | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Initialize from resumeDraft when modal opens — properly in useEffect
  useEffect(() => {
    if (!open) {
      initRef.current = null;
      return;
    }
    if (resumeDraft && resumeDraft.id !== initRef.current) {
      initRef.current = resumeDraft.id;
      initFromDraft(resumeDraft);
    }
  }, [open, resumeDraft]);

  function initFromDraft(draft: Invoice) {
    setDraftId(draft.id);
    setStoragePath(draft.storage_path);
    setOriginalFilename(draft.original_filename || '');

    if (draft.status === 'ready' && draft.extracted_data) {
      const ed = draft.extracted_data as any;
      setExtracted(mapExtracted(draft, ed));
      setRawExtracted(ed);
      setStep('review');
    } else if (draft.status === 'processing') {
      setStep('processing');
      startPolling(draft.id);
    } else if (draft.status === 'error') {
      setStep('error');
      setErrorMessage(draft.processing_error || 'La extracción anterior falló.');
    } else if (draft.extracted_data) {
      const ed = draft.extracted_data as any;
      setExtracted(mapExtracted(draft, ed));
      setRawExtracted(ed);
      setStep('review');
    } else {
      setStep('upload');
    }
  }

  const reset = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setStep('upload');
    setExtracted(null);
    setRawExtracted(null);
    setDraftId(null);
    setStoragePath(null);
    setOriginalFilename('');
    setSaving(false);
    setErrorMessage('');
    setPollProgress(0);
    fileRef.current = null;
    initRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (draftId) onInvoiceSaved();
    reset();
    onClose();
  }, [draftId, onInvoiceSaved, reset, onClose]);

  // ─── Upload + create draft ───
  const processFile = useCallback(async (file: File) => {
    if (!user) return;
    setErrorMessage('');

    try {
      let path = storagePath;
      let id = draftId;

      if (!path) {
        setStep('uploading');
        const uploadPath = `${user.id}/${Date.now()}_${file.name}`;
        const { error } = await supabase.storage.from('invoices').upload(uploadPath, file);
        if (error) {
          console.error('Storage upload error:', error);
          setStep('error');
          setErrorMessage('No se pudo subir el archivo.');
          return;
        }
        path = uploadPath;
        setStoragePath(path);
      }

      if (!id && path) {
        const { data, error } = await supabase
          .from('invoices')
          .insert({
            user_id: user.id,
            storage_path: path,
            pdf_path: path,
            original_filename: file.name,
            display_name: file.name.replace('.pdf', ''),
            invoice_number: 'Pendiente',
            issue_date: new Date().toISOString().slice(0, 10),
            status: 'uploading',
          } as any)
          .select('id')
          .single();
        if (error) {
          console.error('Draft creation error:', error);
          setStep('error');
          setErrorMessage('No se pudo crear el registro borrador.');
          return;
        }
        id = data.id;
        setDraftId(id);
      }

      setStep('processing');
      setPollProgress(0);
      await triggerProcessing(id!);
      startPolling(id!);
    } catch (err) {
      console.error('Unexpected error:', err);
      setStep('error');
      setErrorMessage('Error inesperado al procesar la factura.');
    }
  }, [user, storagePath, draftId]);

  const triggerProcessing = async (invoiceId: string) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/start-invoice-processing`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ invoice_id: invoiceId }),
        }
      );

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        console.error('Processing trigger failed:', errData);
      }
    } catch (err) {
      console.error('Failed to trigger processing:', err);
    }
  };

  // ─── Polling ───
  const startPolling = useCallback((invoiceId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    let count = 0;

    pollRef.current = setInterval(async () => {
      count++;
      setPollProgress(Math.min((count / MAX_POLLS) * 100, 95));

      if (count >= MAX_POLLS) {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        setStep('error');
        setErrorMessage('El análisis está tardando más de lo esperado. Puedes reintentar o completar manualmente.');
        return;
      }

      try {
        const { data: inv, error } = await supabase
          .from('invoices')
          .select('*')
          .eq('id', invoiceId)
          .single();

        if (error) {
          console.error('Poll fetch error:', error);
          return;
        }

        const invoice = inv as any as Invoice;

        if (invoice.status === 'ready') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setPollProgress(100);

          const ed = invoice.extracted_data as any;
          if (ed) {
            setExtracted(mapExtracted(invoice, ed));
            setRawExtracted(ed);
          } else {
            setExtracted(emptyExtracted());
          }
          setStep('review');
        } else if (invoice.status === 'error') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setStep('error');
          setErrorMessage(invoice.processing_error || 'Error al analizar la factura.');
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }, POLL_INTERVAL_MS);
  }, []);

  const handleRetry = useCallback(async () => {
    if (!draftId) return;
    setErrorMessage('');
    setStep('processing');
    setPollProgress(0);
    await triggerProcessing(draftId);
    startPolling(draftId);
  }, [draftId, startPolling]);

  const handleSaveAsDraft = useCallback(() => {
    toast({ title: 'Factura guardada como borrador' });
    handleClose();
  }, [toast, handleClose]);

  const handleSkipToManual = useCallback(() => {
    setExtracted(emptyExtracted());
    setRawExtracted(null);
    setStep('review');
  }, []);

  const onDrop = useCallback(async (files: File[]) => {
    if (!files.length || !user) return;
    const file = files[0];
    if (file.type !== 'application/pdf') {
      toast({ title: 'Solo se permiten archivos PDF', variant: 'destructive' });
      return;
    }
    fileRef.current = file;
    setOriginalFilename(file.name);
    processFile(file);
  }, [user, processFile, toast]);

  const handleSave = useCallback(async (data: ExtractedInvoiceData & { autoretefuente_rate: number; autoretefuente_amount: number; reteica_rate: number; reteica_amount: number; retefuente_cliente_rate: number; retefuente_cliente_amount: number; status: string; display_name: string }) => {
    if (!user) return;
    setSaving(true);
    try {
      if (draftId) {
        const { error: invError } = await supabase
          .from('invoices')
          .update({
            display_name: data.display_name,
            invoice_number: data.invoice_number,
            prefix: data.prefix,
            number_int: data.number_int,
            type: data.type,
            issue_date: data.issue_date,
            due_date: data.due_date,
            counterparty_name: data.counterparty_name,
            counterparty_nit: data.counterparty_nit,
            seller_name: data.seller_name,
            seller_nit: data.seller_nit,
            buyer_name: data.buyer_name,
            buyer_nit: data.buyer_nit,
            city: data.city,
            subtotal_base: data.subtotal_base,
            iva_rate: data.iva_rate,
            iva_amount: data.iva_amount,
            total_amount: data.total_amount,
            autoretefuente_rate: data.autoretefuente_rate,
            autoretefuente_amount: data.autoretefuente_amount,
            reteica_rate: data.reteica_rate,
            reteica_amount: data.reteica_amount,
            cufe: data.cufe,
            payment_method: data.payment_method,
            status: data.status,
            extracted_data: rawExtracted,
            processing_error: null,
          } as any)
          .eq('id', draftId);
        if (invError) throw invError;

        await supabase.from('invoice_items').delete().eq('invoice_id', draftId);
        if (data.items.length > 0) {
          const items = data.items.map(item => ({
            invoice_id: draftId,
            user_id: user.id,
            item_code: item.item_code || null,
            reference: item.reference || null,
            description: item.description || null,
            quantity: item.quantity ?? 1,
            unit_price: item.unit_price ?? 0,
            line_base: item.line_base ?? 0,
            iva_rate: item.iva_rate ?? 0.19,
            iva_amount: item.iva_amount ?? 0,
            line_total: item.line_total ?? 0,
          }));
          const { error: itemsError } = await supabase.from('invoice_items').insert(items);
          if (itemsError) throw itemsError;
        }
      } else {
        const { data: inv, error: invError } = await supabase
          .from('invoices')
          .insert({
            user_id: user.id,
            storage_path: storagePath,
            pdf_path: storagePath,
            display_name: data.display_name,
            original_filename: originalFilename,
            invoice_number: data.invoice_number,
            prefix: data.prefix,
            number_int: data.number_int,
            type: data.type,
            issue_date: data.issue_date,
            due_date: data.due_date,
            counterparty_name: data.counterparty_name,
            counterparty_nit: data.counterparty_nit,
            seller_name: data.seller_name,
            seller_nit: data.seller_nit,
            buyer_name: data.buyer_name,
            buyer_nit: data.buyer_nit,
            city: data.city,
            subtotal_base: data.subtotal_base,
            iva_rate: data.iva_rate,
            iva_amount: data.iva_amount,
            total_amount: data.total_amount,
            autoretefuente_rate: data.autoretefuente_rate,
            autoretefuente_amount: data.autoretefuente_amount,
            reteica_rate: data.reteica_rate,
            reteica_amount: data.reteica_amount,
            cufe: data.cufe,
            payment_method: data.payment_method,
            status: data.status,
            extracted_data: rawExtracted,
          } as any)
          .select('id')
          .single();
        if (invError) throw invError;

        if (data.items.length > 0) {
          const items = data.items.map(item => ({
            invoice_id: inv.id,
            user_id: user.id,
            item_code: item.item_code || null,
            reference: item.reference || null,
            description: item.description || null,
            quantity: item.quantity ?? 1,
            unit_price: item.unit_price ?? 0,
            line_base: item.line_base ?? 0,
            iva_rate: item.iva_rate ?? 0.19,
            iva_amount: item.iva_amount ?? 0,
            line_total: item.line_total ?? 0,
          }));
          const { error: itemsError } = await supabase.from('invoice_items').insert(items);
          if (itemsError) throw itemsError;
        }
      }

      toast({ title: data.status === 'confirmed' ? 'Factura confirmada exitosamente' : 'Borrador guardado' });
      onInvoiceSaved();
      reset();
      onClose();
    } catch (err: any) {
      console.error('Save invoice error:', err);
      toast({
        title: 'No se pudo guardar la factura',
        description: 'Revisa tu conexión e intenta nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }, [user, draftId, rawExtracted, storagePath, originalFilename, toast, onInvoiceSaved, reset, onClose]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    disabled: step !== 'upload',
  });

  return (
    <Dialog open={open} onOpenChange={() => { /* controlled */ }}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] overflow-y-auto"
        aria-describedby="invoice-upload-desc"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {step === 'upload' && 'Subir factura PDF'}
            {step === 'uploading' && 'Subiendo archivo...'}
            {step === 'processing' && 'Analizando factura...'}
            {step === 'review' && 'Configurar factura'}
            {step === 'error' && 'Conexión con el servidor interrumpida'}
          </DialogTitle>
          <DialogDescription id="invoice-upload-desc">
            {step === 'upload' && 'Sube un PDF de factura electrónica colombiana para extraer sus datos automáticamente.'}
            {step === 'uploading' && 'Estamos subiendo tu archivo de forma segura.'}
            {step === 'processing' && 'Estamos extrayendo los datos de tu factura con IA. Este proceso es seguro — puedes cerrar y volver después.'}
            {step === 'review' && 'Verifica y completa los datos extraídos antes de guardar.'}
            {step === 'error' && 'No te preocupes, tu factura no se perdió. Intenta nuevamente en unos segundos.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
                isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
              }`}
            >
              <input {...getInputProps()} />
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-medium">Arrastra un PDF de factura aquí</p>
              <p className="text-sm text-muted-foreground mt-1">o haz clic para seleccionar</p>
              <p className="text-xs text-muted-foreground mt-3">
                Soporta facturas electrónicas colombianas (Siigo, Alegra, etc.)
              </p>
            </div>
            <div className="flex justify-end mt-4">
              <Button variant="outline" onClick={handleClose}>
                <X className="h-4 w-4 mr-2" /> Cancelar
              </Button>
            </div>
          </div>
        )}

        {step === 'uploading' && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-muted-foreground">Subiendo archivo...</p>
            <p className="text-xs text-muted-foreground">Esto puede tomar unos segundos</p>
          </div>
        )}

        {step === 'processing' && (
          <div className="flex flex-col items-center justify-center py-16 gap-6">
            <div className="relative">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <CheckCircle2 className="h-5 w-5 text-primary absolute -top-1 -right-1" />
            </div>
            <div className="text-center space-y-2 max-w-sm">
              <p className="font-medium text-foreground">Extrayendo datos con IA...</p>
              <p className="text-sm text-muted-foreground">
                Tu PDF está guardado. Puedes cerrar este modal y volver después — la factura aparecerá en tu lista.
              </p>
            </div>
            <div className="w-full max-w-xs space-y-1">
              <Progress value={pollProgress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">
                {pollProgress < 30 ? 'Iniciando análisis...' : pollProgress < 70 ? 'Procesando documento...' : 'Finalizando...'}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleClose}>
              Cerrar y continuar después
            </Button>
          </div>
        )}

        {step === 'error' && (
          <div className="flex flex-col items-center justify-center py-12 gap-6">
            <div className="rounded-full bg-destructive/10 p-4">
              <AlertTriangle className="h-10 w-10 text-destructive" />
            </div>
            <div className="text-center space-y-2 max-w-md">
              <p className="text-muted-foreground">
                No te preocupes, tu factura no se perdió. Intenta nuevamente en unos segundos.
              </p>
              {originalFilename && (
                <p className="text-xs text-muted-foreground">Archivo: {originalFilename}</p>
              )}
            </div>
            <div className="flex gap-3 flex-wrap justify-center">
              <Button variant="outline" onClick={handleClose}>
                <X className="h-4 w-4 mr-2" /> Cancelar
              </Button>
              {draftId && (
                <Button variant="secondary" onClick={handleSaveAsDraft}>
                  <Save className="h-4 w-4 mr-2" /> Guardar como borrador
                </Button>
              )}
              <Button variant="secondary" onClick={handleSkipToManual}>
                Completar manualmente
              </Button>
              {draftId && (
                <Button onClick={handleRetry}>
                  <RefreshCw className="h-4 w-4 mr-2" /> Reintentar
                </Button>
              )}
            </div>
          </div>
        )}

        {step === 'review' && extracted && (
          <InvoiceValidationForm
            data={extracted}
            originalFilename={originalFilename}
            onSave={handleSave}
            onCancel={handleClose}
            saving={saving}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
