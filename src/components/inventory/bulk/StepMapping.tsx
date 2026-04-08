import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import type { ColumnMapping, MappedField } from '@/lib/bulkUploadUtils';
import { COLUMN_ALIASES } from '@/lib/bulkUploadUtils';

const FIELD_LABELS: Record<MappedField, string> = {
  referencia: 'Referencia',
  nombre: 'Nombre',
  unidad: 'Unidad',
  stock: 'Stock',
  costo_unitario: 'Costo unitario',
  valor_total: 'Valor total',
  precio_venta: 'Precio venta',
  stock_minimo: 'Stock mínimo',
};

const REQUIRED_FIELDS: MappedField[] = ['referencia', 'nombre', 'stock'];

interface Props {
  mapping: ColumnMapping[];
  sampleRows: unknown[][];
  fileName: string;
  totalRows: number;
  onMappingChange: (idx: number, field: MappedField | null) => void;
  onConfirm: () => void;
  onBack: () => void;
}

export default function StepMapping({ mapping, sampleRows, fileName, totalRows, onMappingChange, onConfirm, onBack }: Props) {
  const mappedFields = mapping.filter(m => m.mappedTo).map(m => m.mappedTo!);
  const missingRequired = REQUIRED_FIELDS.filter(f => !mappedFields.includes(f));
  const allFields = Object.keys(COLUMN_ALIASES) as MappedField[];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{fileName}</p>
          <p className="text-xs text-muted-foreground">{totalRows} filas detectadas</p>
        </div>
        <div className="flex gap-1.5">
          {missingRequired.length === 0 ? (
            <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
              <CheckCircle2 className="h-3 w-3 mr-1" />Mapeo completo
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">
              <AlertCircle className="h-3 w-3 mr-1" />Faltan: {missingRequired.map(f => FIELD_LABELS[f]).join(', ')}
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {mapping.map((col, idx) => (
          <div key={idx} className="flex items-center gap-3 p-2 rounded-lg bg-muted/20 border border-border/30">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono truncate">{col.excelHeader}</p>
              {sampleRows[0] && (
                <p className="text-[10px] text-muted-foreground truncate">
                  Ej: {String(sampleRows[0][col.columnIndex] ?? '—')}
                </p>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground">→</span>
            <Select
              value={col.mappedTo || '__none__'}
              onValueChange={(v) => onMappingChange(idx, v === '__none__' ? null : v as MappedField)}
            >
              <SelectTrigger className="w-40 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Ignorar —</SelectItem>
                {allFields.map(f => (
                  <SelectItem key={f} value={f} disabled={mappedFields.includes(f) && col.mappedTo !== f}>
                    {FIELD_LABELS[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1">Atrás</Button>
        <Button onClick={onConfirm} disabled={missingRequired.length > 0} className="flex-1">
          Continuar
        </Button>
      </div>
    </div>
  );
}
