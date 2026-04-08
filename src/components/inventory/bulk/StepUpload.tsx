import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Download, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  onFileSelected: (file: File) => void;
}

export default function StepUpload({ onFileSelected }: Props) {
  const onDrop = useCallback((files: File[]) => {
    if (files[0]) onFileSelected(files[0]);
  }, [onFileSelected]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    maxFiles: 1,
  });

  const downloadTemplate = () => {
    const csv = `referencia,nombre,unidad,stock,costo_unitario,precio_venta,stock_minimo\nREF-001,Perfil T6 Natural,metro,150,45000,72000,20\nREF-002,Lámina Lisa 1mm,unidad,80,38000,55000,10`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla_inventario.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
          isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/30'
        }`}
      >
        <input {...getInputProps()} />
        <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
        <p className="text-sm font-medium">Arrastra tu archivo Excel o CSV aquí</p>
        <p className="text-xs text-muted-foreground mt-1">Compatible con Siigo, archivos .xlsx, .xls y .csv</p>
      </div>

      <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-2 w-full">
        <Download className="h-3.5 w-3.5" />
        Descargar plantilla CSV
      </Button>

      <div className="text-xs text-muted-foreground space-y-2 bg-muted/30 rounded-xl p-3">
        <p className="font-medium flex items-center gap-1.5">
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Columnas reconocidas automáticamente:
        </p>
        <div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
          <span>Código producto → referencia</span>
          <span>Nombre producto → nombre</span>
          <span>Total en producto → stock</span>
          <span>Valor unitario → costo</span>
        </div>
      </div>
    </div>
  );
}
