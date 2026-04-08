import { CheckCircle2, AlertCircle, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ParsedProduct } from '@/lib/bulkUploadUtils';

interface Props {
  inserted: number;
  errors: number;
  errorProducts: ParsedProduct[];
  onClose: () => void;
}

export default function StepResult({ inserted, errors, errorProducts, onClose }: Props) {
  const downloadErrors = () => {
    if (errorProducts.length === 0) return;
    const header = 'fila,referencia,nombre,error\n';
    const rows = errorProducts.map(p =>
      `${p.rowNumber},"${p.referencia}","${p.nombre}","${p.issues.join('; ')}"`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'errores_importacion.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="text-center space-y-4 py-6">
      <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-400" />
      <div>
        <p className="text-lg font-semibold">{inserted} productos importados</p>
        {errors > 0 && (
          <p className="text-sm text-muted-foreground flex items-center justify-center gap-1 mt-1">
            <AlertCircle className="h-3.5 w-3.5 text-destructive" />
            {errors} no se pudieron importar
          </p>
        )}
      </div>
      {errorProducts.length > 0 && (
        <Button variant="outline" size="sm" onClick={downloadErrors} className="gap-2">
          <Download className="h-3.5 w-3.5" />
          Descargar errores
        </Button>
      )}
      <Button onClick={onClose} className="w-full">Cerrar</Button>
    </div>
  );
}
