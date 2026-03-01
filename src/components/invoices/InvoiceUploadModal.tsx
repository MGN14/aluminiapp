import { useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { ExtractedInvoiceData } from '@/types/invoice';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Upload, RefreshCw, X, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import InvoiceValidationForm from './InvoiceValidationForm';

interface Props {
  open: boolean;
  onClose: () => void;
  onInvoiceSaved: () => void;
}

type Step = 'upload' | 'validating' | 'review' | 'error';

interface ErrorState {
  phase: 'storage' | 'extraction' | 'save';
  canRetry: boolean;
}

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1500;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default function InvoiceUploadModal({ open, onClose, onInvoiceSaved }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('upload');
  const [extracted, setExtracted] = useState<ExtractedInvoiceData | null>(null);
  const [rawExtracted, setRawExtracted] = useState<any>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [originalFilename, setOriginalFilename] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [errorState, setErrorState] = useState<ErrorState | null>(null);
  const fileRef = useRef<File | null>(null);

  const reset = () => {
    setStep('upload');
    setExtracted(null);
    setRawExtracted(null);
    setStoragePath(null);
    setOriginalFilename('');
    setSaving(false);
    setErrorState(null);
    fileRef.current = null;
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const uploadToStorage = async (file: File): Promise<string> => {
    const path = `${user!.id}/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from('invoices').upload(path, file);
    if (error) throw error;
    return path;
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

    setStep('validating');
    setErrorState(null);

    try {
      // Phase 1: Upload to storage (with retries)
      let path = storagePath;
      if (!path) {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            path = await uploadToStorage(file);
            setStoragePath(path);
            break;
          } catch (err) {
            console.error(`Storage upload attempt ${attempt}/${MAX_RETRIES}:`, err);
            if (attempt === MAX_RETRIES) {
              setStep('error');
              setErrorState({ phase: 'storage', canRetry: true });
              return;
            }
            await sleep(BACKOFF_BASE_MS * attempt);
          }
        }
      }

      // Phase 2: AI extraction (with retries)
      let result: any = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          result = await callExtraction(file);
          break;
        } catch (err) {
          console.error(`Extraction attempt ${attempt}/${MAX_RETRIES}:`, err);
          if (attempt === MAX_RETRIES) {
            // Extraction failed — allow manual completion
            setStep('error');
            setErrorState({ phase: 'extraction', canRetry: true });
            return;
          }
          await sleep(BACKOFF_BASE_MS * attempt);
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
      setErrorState({ phase: 'extraction', canRetry: true });
    }
  }, [user, storagePath]);

  const handleRetry = () => {
    if (!fileRef.current) return;
    processFile(fileRef.current);
  };

  const handleSkipToManual = () => {
    // Let user fill everything manually
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

      toast({ title: 'Factura guardada exitosamente' });
      onInvoiceSaved();
      handleClose();
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
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" aria-describedby="invoice-upload-desc">
        <DialogHeader>
          <DialogTitle>
            {step === 'upload' && 'Subir factura PDF'}
            {step === 'validating' && 'Procesando factura...'}
            {step === 'review' && 'Configurar factura'}
            {step === 'error' && 'Conexión con el servidor interrumpida'}
          </DialogTitle>
          <DialogDescription id="invoice-upload-desc">
            {step === 'upload' && 'Sube un PDF de factura electrónica colombiana para extraer sus datos automáticamente.'}
            {step === 'validating' && 'Estamos extrayendo los datos de tu factura con IA.'}
            {step === 'review' && 'Verifica y completa los datos extraídos antes de guardar.'}
            {step === 'error' && 'No te preocupes, tu factura no se perdió. Intenta nuevamente en unos segundos.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
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
            <div className="flex gap-3">
              <Button variant="outline" onClick={handleClose}>
                <X className="h-4 w-4 mr-2" />
                Cancelar
              </Button>
              {errorState?.phase === 'extraction' && (
                <Button variant="secondary" onClick={handleSkipToManual}>
                  Completar manualmente
                </Button>
              )}
              <Button onClick={handleRetry}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Reintentar
              </Button>
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
