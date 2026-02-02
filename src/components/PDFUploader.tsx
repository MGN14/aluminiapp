import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, FileText, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface PDFUploaderProps {
  onUploadComplete: (statementId: string, filePath: string) => void;
}

export default function PDFUploader({ onUploadComplete }: PDFUploaderProps) {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file || !user) return;

    if (file.type !== 'application/pdf') {
      setErrorMessage('Solo se permiten archivos PDF');
      setUploadStatus('error');
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

      setUploadStatus('success');
      onUploadComplete(statement.id, filePath);
    } catch (error: any) {
      console.error('Upload error:', error);
      setErrorMessage(error.message || 'Error al subir el archivo');
      setUploadStatus('error');
    } finally {
      setUploading(false);
    }
  }, [user, onUploadComplete]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    disabled: uploading
  });

  return (
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
                    o haz clic para seleccionar (solo Bancolombia por ahora)
                  </p>
                </div>
                <Button variant="outline" size="sm" className="mt-2">
                  Seleccionar archivo
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
