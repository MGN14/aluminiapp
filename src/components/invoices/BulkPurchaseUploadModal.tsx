import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { FileArchive, FileText, Loader2, Upload, X, CheckCircle2, AlertTriangle, CopyX, Sparkles } from 'lucide-react';
import { logEvent } from '@/lib/analytics';
import {
  expandFilesToCandidates,
  runBulkImport,
  type BulkImportSummary,
  type ImportStatus,
} from '@/lib/purchaseInvoiceImport';

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

type Step = 'select' | 'working' | 'done';

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

const statusMeta: Record<ImportStatus, { label: string; className: string }> = {
  imported: { label: 'Importada', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  duplicate: { label: 'Duplicada', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  pdf_queued: { label: 'IA en curso', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  error: { label: 'Error', className: 'bg-red-50 text-red-700 border-red-200' },
};

export default function BulkPurchaseUploadModal({ open, onClose, onImported }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('select');
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: '' });
  const [summary, setSummary] = useState<BulkImportSummary | null>(null);

  const reset = useCallback(() => {
    setStep('select');
    setFiles([]);
    setProgress({ done: 0, total: 0, label: '' });
    setSummary(null);
  }, []);

  const handleClose = useCallback(() => {
    if (step === 'working') return; // no cerrar a mitad de importación
    if (summary && (summary.imported > 0 || summary.pdfQueued > 0)) onImported();
    reset();
    onClose();
  }, [step, summary, onImported, reset, onClose]);

  const onDrop = useCallback((accepted: File[]) => {
    if (!accepted.length) return;
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...accepted.filter((f) => !names.has(f.name + f.size))];
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/zip': ['.zip'],
      'application/x-zip-compressed': ['.zip'],
      'text/xml': ['.xml'],
      'application/xml': ['.xml'],
      'application/pdf': ['.pdf'],
    },
    disabled: step !== 'select',
  });

  const handleImport = useCallback(async () => {
    if (!user || files.length === 0) return;
    setStep('working');
    try {
      const candidates = await expandFilesToCandidates(files);
      const result = await runBulkImport(user.id, candidates, (done, total, label) =>
        setProgress({ done, total, label }),
      );
      setSummary(result);
      setStep('done');

      if (result.imported > 0) {
        // Validación DIAN en batch, fire-and-forget (hasta 50 por corrida)
        void supabase.functions.invoke('validate-cufe', { body: { batch: true } }).catch(() => {});
      }
      logEvent('purchase_invoices_bulk_import', {
        user_id: user.id,
        user_email: user.email ?? null,
        props: {
          files: files.length,
          imported: result.imported,
          duplicates: result.duplicates,
          pdf_queued: result.pdfQueued,
          errors: result.errors,
        },
      });
    } catch (e) {
      console.error('Bulk import error:', e);
      toast({
        title: 'La importación falló',
        description: e instanceof Error ? e.message : 'Error inesperado. Intenta de nuevo.',
        variant: 'destructive',
      });
      setStep('select');
    }
  }, [user, files, toast]);

  const totalImportedAmount = summary?.results
    .filter((r) => r.status === 'imported')
    .reduce((s, r) => s + (r.total ?? 0), 0) ?? 0;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby="bulk-purchase-desc">
        <DialogHeader>
          <DialogTitle>
            {step === 'select' && 'Subir facturas de compra (ZIP/XML/PDF)'}
            {step === 'working' && 'Importando facturas...'}
            {step === 'done' && 'Importación terminada'}
          </DialogTitle>
          <DialogDescription id="bulk-purchase-desc">
            {step === 'select' &&
              'Arrastra los ZIP de factura electrónica DIAN (XML + PDF), XMLs sueltos o el ZIP completo de tu carpeta de Drive. Los XML se leen al instante sin IA; los PDF sin XML pasan por extracción con IA.'}
            {step === 'working' && 'Leyendo XMLs, deduplicando por CUFE y creando las facturas.'}
            {step === 'done' && 'Así quedó cada archivo. Las duplicadas (mismo CUFE) no se tocaron.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'select' && (
          <div className="space-y-4">
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
                isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
              }`}
            >
              <input {...getInputProps()} />
              <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="font-medium">Arrastra aquí tus ZIP, XML o PDF</p>
              <p className="text-sm text-muted-foreground mt-1">
                Acepta múltiples archivos y el ZIP completo de la carpeta de Drive
              </p>
            </div>

            {files.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
                {files.map((f) => (
                  <div key={f.name + f.size} className="flex items-center gap-2 px-3 py-2 text-sm">
                    {f.name.toLowerCase().endsWith('.zip')
                      ? <FileArchive className="h-4 w-4 text-muted-foreground shrink-0" />
                      : <FileText className="h-4 w-4 text-muted-foreground shrink-0" />}
                    <span className="truncate flex-1">{f.name}</span>
                    <span className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((x) => x !== f))}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Quitar ${f.name}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between items-center">
              <Button variant="outline" onClick={handleClose}>Cancelar</Button>
              <Button onClick={handleImport} disabled={files.length === 0} className="gap-2">
                <Upload className="h-4 w-4" />
                Importar {files.length > 0 ? `(${files.length} archivo${files.length === 1 ? '' : 's'})` : ''}
              </Button>
            </div>
          </div>
        )}

        {step === 'working' && (
          <div className="flex flex-col items-center justify-center py-12 gap-5">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <div className="w-full max-w-sm space-y-2">
              <Progress
                value={progress.total > 0 ? (progress.done / progress.total) * 100 : 10}
                className="h-2"
              />
              <p className="text-xs text-muted-foreground text-center truncate">
                {progress.total > 0
                  ? `${progress.done} de ${progress.total} · ${progress.label.split('/').pop() ?? ''}`
                  : 'Descomprimiendo y leyendo XMLs...'}
              </p>
            </div>
          </div>
        )}

        {step === 'done' && summary && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border p-3 text-center">
                <CheckCircle2 className="h-4 w-4 mx-auto mb-1 text-emerald-600" />
                <p className="text-xl font-bold">{summary.imported}</p>
                <p className="text-[11px] text-muted-foreground">Importadas</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <CopyX className="h-4 w-4 mx-auto mb-1 text-amber-600" />
                <p className="text-xl font-bold">{summary.duplicates}</p>
                <p className="text-[11px] text-muted-foreground">Duplicadas</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <Sparkles className="h-4 w-4 mx-auto mb-1 text-blue-600" />
                <p className="text-xl font-bold">{summary.pdfQueued}</p>
                <p className="text-[11px] text-muted-foreground">PDF con IA</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <AlertTriangle className="h-4 w-4 mx-auto mb-1 text-red-600" />
                <p className="text-xl font-bold">{summary.errors}</p>
                <p className="text-[11px] text-muted-foreground">Errores</p>
              </div>
            </div>

            {summary.imported > 0 && (
              <p className="text-sm text-muted-foreground">
                Total importado: <strong className="text-foreground">{formatCurrency(totalImportedAmount)}</strong>.
                Las compras quedan confirmadas con saldo pendiente = total; ya cuentan en Cuentas por Pagar y en el pronóstico de caja.
              </p>
            )}

            <div className="max-h-60 overflow-y-auto rounded-md border divide-y">
              {summary.results.map((r, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <Badge variant="outline" className={`shrink-0 text-[10px] ${statusMeta[r.status].className}`}>
                    {statusMeta[r.status].label}
                  </Badge>
                  <span className="truncate flex-1" title={r.label}>
                    {r.supplierName
                      ? `${r.supplierName} · ${r.invoiceNumber ?? ''}`
                      : r.label.split('/').pop()}
                  </span>
                  {r.total != null && (
                    <span className="text-xs text-muted-foreground shrink-0">{formatCurrency(r.total)}</span>
                  )}
                  {r.detail && r.status !== 'imported' && (
                    <span className="text-xs text-muted-foreground truncate max-w-[40%]" title={r.detail}>
                      {r.detail}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <Button onClick={handleClose}>Cerrar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
