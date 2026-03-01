import { useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { ExtractedInvoiceData, Invoice } from '@/types/invoice';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Upload, RefreshCw, X, AlertTriangle, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import InvoiceValidationForm from './InvoiceValidationForm';

interface Props {
  open: boolean;
  onClose: () => void;
  onInvoiceSaved: () => void;
  /** If provided, resume this draft invoice instead of uploading a new one */
  resumeDraft?: Invoice | null;
}

type Step = 'upload' | 'uploading' | 'validating' | 'review' | 'error';

interface ErrorState {
  phase: 'storage' | 'extraction' | 'save';
  message: string;
}

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1500;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  const [errorState, setErrorState] = useState<ErrorState | null>(null);
  const fileRef = useRef<File | null>(null);

  // Initialize from resumeDraft when modal opens
  const initFromDraft = useCallback((draft: Invoice) => {
    setDraftId(draft.id);
    setStoragePath(draft.storage_path);
    setOriginalFilename(draft.original_filename || '');
    
    if (draft.extracted_data) {
      // Draft already has extracted data — go to review
      const ed = draft.extracted_data as any;
      const mapped: ExtractedInvoiceData = {
        invoice_number: draft.invoice_number || ed.invoice_number || '',
        prefix: draft.prefix || ed.prefix || '',
        number_int: draft.number_int ?? ed.number_int ?? null,
        type: draft.type as 'venta' | 'compra',
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
      setExtracted(mapped);
      setRawExtracted(ed);
      setStep('review');
    } else {
      // No extracted data — let user re-upload or show manual
      setExtracted(null);
      setRawExtracted(null);
      setStep(draft.status === 'error' ? 'error' : 'upload');
      setErrorState(draft.status === 'error' ? { phase: 'extraction', message: 'La extracción anterior falló.' } : null);
    }
  }, []);

  // When modal opens with a resumeDraft, initialize
  const prevOpenRef = useRef(false);
  if (open && !prevOpenRef.current) {
    if (resumeDraft) {
      initFromDraft(resumeDraft);
    }
  }
  prevOpenRef.current = open;

  const reset = () => {
    setStep('upload');
    setExtracted(null);
    setRawExtracted(null);
    setDraftId(null);
    setStoragePath(null);
    setOriginalFilename('');
    setSaving(false);
    setErrorState(null);
    fileRef.current = null;
  };

  const handleClose = () => {
    // If we have a draft, refresh the list so it appears
    if (draftId) {
      onInvoiceSaved();
    }
    reset();
    onClose();
  };

  const uploadToStorage = async (file: File): Promise<string> => {
    const path = `${user!.id}/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from('invoices').upload(path, file);
    if (error) throw error;
    return path;
  };

  const createDraftInvoice = async (path: string, filename: string): Promise<string> => {
    const { data, error } = await supabase
      .from('invoices')
      .insert({
        user_id: user!.id,
        storage_path: path,
        pdf_path: path,
        original_filename: filename,
        display_name: filename.replace('.pdf', ''),
        invoice_number: 'Pendiente',
        issue_date: new Date().toISOString().slice(0, 10),
        status: 'draft',
      } as any)
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  };

  const updateDraftWithExtraction = async (invoiceId: string, result: any) => {
    const updateData: any = {
      extracted_data: result,
      invoice_number: result.invoice_number || 'Pendiente',
      prefix: result.prefix || null,
      number_int: result.number_int ?? null,
      type: result.type || 'compra',
      issue_date: result.issue_date || new Date().toISOString().slice(0, 10),
      due_date: result.due_date || null,
      counterparty_name: result.counterparty_name || '',
      counterparty_nit: result.counterparty_nit || '',
      seller_name: result.seller_name || '',
      seller_nit: result.seller_nit || '',
      buyer_name: result.buyer_name || '',
      buyer_nit: result.buyer_nit || '',
      city: result.city || null,
      subtotal_base: result.subtotal_base || 0,
      iva_rate: result.iva_rate ?? 0.19,
      iva_amount: result.iva_amount || 0,
      total_amount: result.total_amount || 0,
      cufe: result.cufe || null,
      payment_method: result.payment_method || null,
      status: 'draft',
    };
    const { error } = await supabase
      .from('invoices')
      .update(updateData)
      .eq('id', invoiceId);
    if (error) throw error;
  };

  const callExtraction = async (file: File): Promise<any> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const formData = new FormData();
    formData.append('file', file);

    const resp = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-invoice-pdf`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(errText || `HTTP ${resp.status}`);
    }
    return resp.json();
  };

  const processFile = useCallback(async (file: File) => {
    if (!user) return;
    setErrorState(null);

    try {
      // Phase 1: Upload to storage + create draft
      let path = storagePath;
      let id = draftId;

      if (!path) {
        setStep('uploading');
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            path = await uploadToStorage(file);
            setStoragePath(path);
            break;
          } catch (err) {
            console.error(`Storage upload attempt ${attempt}/${MAX_RETRIES}:`, err);
            if (attempt === MAX_RETRIES) {
              setStep('error');
              setErrorState({ phase: 'storage', message: 'No se pudo subir el archivo.' });
              return;
            }
            await sleep(BACKOFF_BASE_MS * attempt);
          }
        }
      }

      if (!id && path) {
        try {
          id = await createDraftInvoice(path, file.name);
          setDraftId(id);
        } catch (err) {
          console.error('Failed to create draft invoice:', err);
          setStep('error');
          setErrorState({ phase: 'storage', message: 'No se pudo crear el registro borrador.' });
          return;
        }
      }

      // Phase 2: AI extraction (with retries)
      setStep('validating');
      let result: any = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          result = await callExtraction(file);
          break;
        } catch (err) {
          console.error(`Extraction attempt ${attempt}/${MAX_RETRIES}:`, err);
          if (attempt === MAX_RETRIES) {
            // Mark draft as error
            if (id) {
              try { await supabase.from('invoices').update({ status: 'error' } as any).eq('id', id); } catch {}
            }
            setStep('error');
            setErrorState({ phase: 'extraction', message: 'No se pudieron extraer los datos del PDF.' });
            return;
          }
          await sleep(BACKOFF_BASE_MS * attempt);
        }
      }

      // Phase 3: Save extracted data to draft
      if (id && result) {
        try {
          await updateDraftWithExtraction(id, result);
        } catch (err) {
          console.error('Failed to update draft with extraction:', err);
          // Non-critical — we still have the data in memory
        }
      }

      setRawExtracted(result);
      const mapped: ExtractedInvoiceData = {
        ...result,
        counterparty_name: result.counterparty_name || (result.type === 'venta' ? result.buyer_name : result.seller_name) || '',
        counterparty_nit: result.counterparty_nit || (result.type === 'venta' ? result.buyer_nit : result.seller_nit) || '',
        items: result.items || [],
      };
      setExtracted(mapped);
      setStep('review');
    } catch (err) {
      console.error('Unexpected invoice processing error:', err);
      setStep('error');
      setErrorState({ phase: 'extraction', message: 'Error inesperado al procesar la factura.' });
    }
  }, [user, storagePath, draftId]);

  const handleRetry = () => {
    if (!fileRef.current) return;
    processFile(fileRef.current);
  };

  const handleSaveAsDraft = () => {
    // Draft already exists in DB — just close
    toast({ title: 'Factura guardada como borrador' });
    handleClose();
  };

  const handleSkipToManual = () => {
    setExtracted({
      invoice_number: '',
      prefix: '',
      number_int: null,
      type: 'compra',
      issue_date: '',
      due_date: '',
      counterparty_name: '',
      counterparty_nit: '',
      seller_name: '',
      seller_nit: '',
      buyer_name: '',
      buyer_nit: '',
      city: '',
      subtotal_base: 0,
      iva_rate: 0.19,
      iva_amount: 0,
      total_amount: 0,
      cufe: '',
      payment_method: '',
      items: [],
    });
    setRawExtracted(null);
    setStep('review');
  };

  const onDrop = async (files: File[]) => {
    if (!files.length || !user) return;
    const file = files[0];
    if (file.type !== 'application/pdf') {
      toast({ title: 'Solo se permiten archivos PDF', variant: 'destructive' });
      return;
    }
    fileRef.current = file;
    setOriginalFilename(file.name);
    processFile(file);
  };

  const handleSave = async (data: ExtractedInvoiceData & { autoretefuente_rate: number; autoretefuente_amount: number; reteica_rate: number; reteica_amount: number; status: string; display_name: string }) => {
    if (!user) return;
    setSaving(true);
    try {
      if (draftId) {
        // UPDATE existing draft
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
          } as any)
          .eq('id', draftId);
        if (invError) throw invError;

        // Delete existing items then re-insert
        await supabase.from('invoice_items').delete().eq('invoice_id', draftId);
        
        if (data.items.length > 0) {
          const items = data.items.map(item => ({
            invoice_id: draftId,
            user_id: user.id,
            item_code: item.item_code,
            reference: item.reference,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            line_base: item.line_base,
            iva_rate: item.iva_rate,
            iva_amount: item.iva_amount,
            line_total: item.line_total,
          }));
          const { error: itemsError } = await supabase.from('invoice_items').insert(items);
          if (itemsError) throw itemsError;
        }
      } else {
        // Fallback: INSERT (shouldn't happen in new flow but safe)
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
            item_code: item.item_code,
            reference: item.reference,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            line_base: item.line_base,
            iva_rate: item.iva_rate,
            iva_amount: item.iva_amount,
            line_total: item.line_total,
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
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    disabled: step !== 'upload',
  });

  return (
    <Dialog open={open} onOpenChange={() => { /* controlled — no auto-close */ }}>
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
            {step === 'validating' && 'Analizando factura...'}
            {step === 'review' && 'Configurar factura'}
            {step === 'error' && 'Conexión con el servidor interrumpida'}
          </DialogTitle>
          <DialogDescription id="invoice-upload-desc">
            {step === 'upload' && 'Sube un PDF de factura electrónica colombiana para extraer sus datos automáticamente.'}
            {step === 'uploading' && 'Estamos subiendo tu archivo de forma segura.'}
            {step === 'validating' && 'Estamos extrayendo los datos de tu factura con IA.'}
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

        {step === 'validating' && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-muted-foreground">Extrayendo datos de la factura con IA...</p>
            <p className="text-xs text-muted-foreground">Esto puede tomar unos segundos</p>
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
                <p className="text-xs text-muted-foreground">
                  Archivo: {originalFilename}
                </p>
              )}
            </div>
            <div className="flex gap-3 flex-wrap justify-center">
              <Button variant="outline" onClick={handleClose}>
                <X className="h-4 w-4 mr-2" />
                Cancelar
              </Button>
              {draftId && (
                <Button variant="secondary" onClick={handleSaveAsDraft}>
                  <Save className="h-4 w-4 mr-2" />
                  Guardar como borrador
                </Button>
              )}
              {errorState?.phase === 'extraction' && (
                <Button variant="secondary" onClick={handleSkipToManual}>
                  Completar manualmente
                </Button>
              )}
              {fileRef.current && (
                <Button onClick={handleRetry}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reintentar
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
