import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, FileText, Loader2, CheckCircle, AlertCircle, Lock } from 'lucide-react';
import UpgradeLimitModal from '@/components/subscription/UpgradeLimitModal';

interface PDFUploaderProps {
  onUploadComplete: (statementId: string, filePath: string) => void;
}

export default function PDFUploader({ onUploadComplete }: PDFUploaderProps) {
  const { user } = useAuth();
  const { checkUploadLimit, plan, pdfUploadsTotal, getPlanLimits } = useSubscription();
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [limitMessage, setLimitMessage] = useState('');

  const { trialExpired, isTrialing } = useSubscription();
  const limits = getPlanLimits();
  const isAtLimit = trialExpired || (isTrialing && limits.pdfLimit !== -1 && pdfUploadsTotal >= limits.pdfLimit);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file || !user) return;

    if (file.type !== 'application/pdf') {
      setErrorMessage('Solo se permiten archivos PDF');
      setUploadStatus('error');
      return;
    }

    // Check bank account limit before uploading
    const bankAccountLimit = limits.bankAccounts;
    if (bankAccountLimit > 0) {
      const { data: existingAccounts } = await supabase
        .from('bank_statements')
        .select('account_number')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .not('account_number', 'is', null);

      const distinctAccounts = new Set(
        (existingAccounts || []).map(s => s.account_number).filter(Boolean)
      );
      // We can't check the new file's account number before processing,
      // but we enforce after config. This is a soft pre-check.
      if (distinctAccounts.size >= bankAccountLimit) {
        // Only warn - the real enforcement happens in StatementConfigModal
        // For now, let it through since we don't know the account number yet
      }
    }

    // Check upload limits BEFORE uploading
    const limitCheck = await checkUploadLimit();
    if (!limitCheck.canUpload) {
      setLimitMessage(limitCheck.message);
      setShowUpgradeModal(true);
      return;
    }

    setUploading(true);
    setUploadStatus('idle');
    setErrorMessage('');

    try {
      // Upload to storage
      const filePath = `${user.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('bank-statements')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Create database record
      const { data: statement, error: dbError } = await supabase
        .from('bank_statements')
        .insert({
          user_id: user.id,
          file_name: file.name,
          file_path: filePath,
          bank_name: 'Bancolombia'
        })
        .select()
        .single();

      if (dbError) throw dbError;

      // Increment PDF upload counter via RPC
      await supabase.rpc('increment_pdf_upload', { p_user_id: user.id });

      setUploadStatus('success');
      onUploadComplete(statement.id, filePath);
    } catch (error: any) {
      console.error('Upload error:', error);
      setErrorMessage(error.message || 'Error al subir el archivo');
      setUploadStatus('error');
    } finally {
      setUploading(false);
    }
  }, [user, onUploadComplete, checkUploadLimit]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    disabled: uploading || isAtLimit
  });

  const handleUpgradeClick = () => {
    setLimitMessage(
      trialExpired
        ? 'Tu prueba gratuita terminó. Activa tu plan para seguir subiendo extractos.'
        : 'Alcanzaste el límite de extractos en tu prueba gratuita. Activa tu plan para subir más.'
    );
    setShowUpgradeModal(true);
  };

  // Show upgrade CTA if at limit
  if (isAtLimit) {
    return (
      <>
        <Card className="border-2 border-dashed border-warning/50 bg-warning/5">
          <CardContent className="p-8">
            <div className="text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center">
                  <Lock className="h-8 w-8 text-warning" />
                </div>
                <div>
                  <p className="font-medium text-foreground">
                    {trialExpired ? 'Prueba expirada' : 'Límite alcanzado'}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {trialExpired
                      ? 'Tu prueba gratuita terminó. Activa un plan para continuar.'
                      : `Alcanzaste el límite de ${limits.pdfLimit} extractos en tu prueba gratuita`}
                  </p>
                </div>
                <Button onClick={handleUpgradeClick} className="mt-2">
                  Activar Plan
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        <UpgradeLimitModal
          open={showUpgradeModal}
          onOpenChange={setShowUpgradeModal}
          message={limitMessage}
        />
      </>
    );
  }

  return (
    <>
      <Card className="border-2 border-dashed border-border hover:border-accent transition-colors">
        <CardContent className="p-8">
          <div
            {...getRootProps()}
            className={`cursor-pointer text-center ${isDragActive ? 'opacity-75' : ''}`}
          >
            <input {...getInputProps()} />
            
            <div className="flex flex-col items-center gap-4">
              {uploading ? (
                <>
                  <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 text-accent animate-spin" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Subiendo archivo...</p>
                    <p className="text-sm text-muted-foreground">Por favor espera</p>
                  </div>
                </>
              ) : uploadStatus === 'success' ? (
                <>
                  <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
                    <CheckCircle className="h-8 w-8 text-success" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">¡Archivo subido!</p>
                    <p className="text-sm text-muted-foreground">Procesando extracto...</p>
                  </div>
                </>
              ) : uploadStatus === 'error' ? (
                <>
                  <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
                    <AlertCircle className="h-8 w-8 text-destructive" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Error al subir</p>
                    <p className="text-sm text-destructive">{errorMessage}</p>
                  </div>
                  <Button variant="outline" size="sm">
                    Intentar de nuevo
                  </Button>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
                    {isDragActive ? (
                      <FileText className="h-8 w-8 text-accent" />
                    ) : (
                      <Upload className="h-8 w-8 text-accent" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      {isDragActive ? 'Suelta el archivo aquí' : 'Arrastra tu extracto PDF'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      o haz clic para seleccionar · compatible con múltiples bancos
                    </p>
                  </div>
                  {isTrialing && (
                    <p className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
                      Empresarial Gratuito: {pdfUploadsTotal} extracto{pdfUploadsTotal === 1 ? '' : 's'} subido{pdfUploadsTotal === 1 ? '' : 's'}
                    </p>
                  )}
                  <Button variant="outline" size="sm" className="mt-2">
                    Seleccionar archivo
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      <UpgradeLimitModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        message={limitMessage}
      />
    </>
  );
}
