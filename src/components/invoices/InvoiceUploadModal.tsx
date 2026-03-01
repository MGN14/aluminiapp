import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { ExtractedInvoiceData } from '@/types/invoice';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Upload, FileCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDropzone } from 'react-dropzone';
import InvoiceValidationForm from './InvoiceValidationForm';

interface Props {
  open: boolean;
  onClose: () => void;
  onInvoiceSaved: () => void;
}

export default function InvoiceUploadModal({ open, onClose, onInvoiceSaved }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<'upload' | 'validating' | 'review'>('upload');
  const [extracted, setExtracted] = useState<ExtractedInvoiceData | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setStep('upload');
    setExtracted(null);
    setStoragePath(null);
    setSaving(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const onDrop = async (files: File[]) => {
    if (!files.length || !user) return;
    const file = files[0];
    if (file.type !== 'application/pdf') {
      toast({ title: 'Solo se permiten archivos PDF', variant: 'destructive' });
      return;
    }

    setStep('validating');

    try {
      // 1. Upload PDF to storage
      const path = `${user.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('invoices')
        .upload(path, file);
      if (uploadError) throw uploadError;
      setStoragePath(path);

      // 2. Call AI edge function to extract data
      const formData = new FormData();
      formData.append('file', file);

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-invoice-pdf`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        }
      );

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(errText || 'Error parsing invoice');
      }

      const result: ExtractedInvoiceData = await resp.json();
      setExtracted(result);
      setStep('review');
    } catch (err: any) {
      console.error('Invoice upload error:', err);
      toast({ title: 'Error al procesar factura', description: err.message, variant: 'destructive' });
      setStep('upload');
    }
  };

  const handleSave = async (data: ExtractedInvoiceData) => {
    if (!user) return;
    setSaving(true);
    try {
      // Insert invoice
      const { data: inv, error: invError } = await supabase
        .from('invoices')
        .insert({
          user_id: user.id,
          storage_path: storagePath,
          invoice_number: data.invoice_number,
          prefix: data.prefix,
          number_int: data.number_int,
          type: data.type,
          issue_date: data.issue_date,
          due_date: data.due_date,
          seller_name: data.seller_name,
          seller_nit: data.seller_nit,
          buyer_name: data.buyer_name,
          buyer_nit: data.buyer_nit,
          city: data.city,
          subtotal_base: data.subtotal_base,
          iva_rate: data.iva_rate,
          iva_amount: data.iva_amount,
          total_amount: data.total_amount,
          cufe: data.cufe,
          payment_method: data.payment_method,
        })
        .select('id')
        .single();

      if (invError) throw invError;

      // Insert items
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
      toast({ title: 'Error al guardar factura', description: err.message, variant: 'destructive' });
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
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 'upload' && 'Subir factura PDF'}
            {step === 'validating' && 'Procesando factura...'}
            {step === 'review' && 'Validar datos extraídos'}
          </DialogTitle>
        </DialogHeader>

        {step === 'upload' && (
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
              isDragActive ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50'
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
            <Loader2 className="h-10 w-10 animate-spin text-accent" />
            <p className="text-muted-foreground">Extrayendo datos de la factura con IA...</p>
          </div>
        )}

        {step === 'review' && extracted && (
          <InvoiceValidationForm
            data={extracted}
            onSave={handleSave}
            onCancel={handleClose}
            saving={saving}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
