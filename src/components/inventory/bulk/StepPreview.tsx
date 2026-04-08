import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { ParsedProduct, ImportMode, DuplicateAction } from '@/lib/bulkUploadUtils';

interface Props {
  products: ParsedProduct[];
  importMode: ImportMode;
  duplicateAction: DuplicateAction;
  hasDuplicates: boolean;
  hasExistingProducts: boolean;
  onImportModeChange: (mode: ImportMode) => void;
  onDuplicateActionChange: (action: DuplicateAction) => void;
  onConfirm: () => void;
  onBack: () => void;
  uploading: boolean;
}

const STATUS_CONFIG = {
  valid: { icon: CheckCircle2, label: 'OK', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  warning: { icon: AlertTriangle, label: 'Advertencia', className: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  error: { icon: XCircle, label: 'Error', className: 'bg-destructive/10 text-destructive border-destructive/30' },
};

export default function StepPreview({
  products, importMode, duplicateAction, hasDuplicates, hasExistingProducts,
  onImportModeChange, onDuplicateActionChange, onConfirm, onBack, uploading,
}: Props) {
  const validCount = products.filter(p => p.status !== 'error').length;
  const errorCount = products.filter(p => p.status === 'error').length;
  const warningCount = products.filter(p => p.status === 'warning').length;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-4 text-xs">
        <span className="text-emerald-400 font-medium">{validCount} válidos</span>
        {warningCount > 0 && <span className="text-amber-400 font-medium">{warningCount} advertencias</span>}
        {errorCount > 0 && <span className="text-destructive font-medium">{errorCount} errores</span>}
        <span className="text-muted-foreground ml-auto">{products.length} productos total</span>
      </div>

      {/* Import mode */}
      <div className="bg-muted/20 rounded-xl p-3 space-y-2">
        <p className="text-xs font-medium">Modo de importación</p>
        <RadioGroup value={importMode} onValueChange={(v) => onImportModeChange(v as ImportMode)} className="flex gap-4">
          <div className="flex items-center gap-1.5">
            <RadioGroupItem value="initial" id="mode-initial" />
            <Label htmlFor="mode-initial" className="text-xs cursor-pointer">Inventario inicial</Label>
          </div>
          {hasExistingProducts && (
            <>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="replace" id="mode-replace" />
                <Label htmlFor="mode-replace" className="text-xs cursor-pointer">Reemplazar</Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="adjust" id="mode-adjust" />
                <Label htmlFor="mode-adjust" className="text-xs cursor-pointer">Ajustar</Label>
              </div>
            </>
          )}
        </RadioGroup>
      </div>

      {/* Duplicate handling */}
      {hasDuplicates && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 space-y-2">
          <p className="text-xs font-medium text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Se encontraron referencias duplicadas
          </p>
          <RadioGroup value={duplicateAction} onValueChange={(v) => onDuplicateActionChange(v as DuplicateAction)} className="flex gap-4">
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="sum" id="dup-sum" />
              <Label htmlFor="dup-sum" className="text-xs cursor-pointer">Sumar cantidades</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="replace" id="dup-replace" />
              <Label htmlFor="dup-replace" className="text-xs cursor-pointer">Usar último</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="skip" id="dup-skip" />
              <Label htmlFor="dup-skip" className="text-xs cursor-pointer">Usar primero</Label>
            </div>
          </RadioGroup>
        </div>
      )}

      {/* Preview table */}
      <div className="max-h-56 overflow-auto rounded-xl border border-border/50">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="w-10">#</TableHead>
              <TableHead>Ref.</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead className="text-right">Costo</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.slice(0, 20).map((p, i) => {
              const cfg = STATUS_CONFIG[p.status];
              const Icon = cfg.icon;
              return (
                <TableRow key={i} className={p.status === 'error' ? 'bg-destructive/5' : p.isDuplicate ? 'bg-amber-500/5' : ''}>
                  <TableCell className="text-[10px] text-muted-foreground">{p.rowNumber}</TableCell>
                  <TableCell className="font-mono text-xs">{p.referencia || '—'}</TableCell>
                  <TableCell className="text-xs max-w-32 truncate">{p.nombre || '—'}</TableCell>
                  <TableCell className="text-right text-xs font-mono">{p.stock.toLocaleString('es-CO')}</TableCell>
                  <TableCell className="text-right text-xs font-mono">
                    {p.costo_unitario > 0 ? `$${p.costo_unitario.toLocaleString('es-CO')}` : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] ${cfg.className} gap-1`}>
                      <Icon className="h-2.5 w-2.5" />
                      {p.issues.length > 0 ? p.issues[0] : cfg.label}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {products.length > 20 && (
          <p className="text-xs text-muted-foreground text-center py-2">+{products.length - 20} más...</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1">Atrás</Button>
        <Button onClick={onConfirm} disabled={uploading || validCount === 0} className="flex-1 gap-2">
          {uploading ? 'Importando...' : `Importar ${validCount} productos`}
        </Button>
      </div>
    </div>
  );
}
