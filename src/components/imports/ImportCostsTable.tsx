import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { useImportItems } from '@/hooks/useImportItems';
import {
  COST_TIPO_LABEL, BASIS_LABEL, DEFAULT_BASIS_BY_TIPO,
  type ImportCostTipo, type AllocationBasis,
} from '@/lib/landedCost';

/**
 * Módulo de costos del contenedor: flete, seguro, arancel, IVA, agencia…
 * Vive en el RESUMEN del modal (decisión de Nico: los costos se cargan donde
 * se ve el costeo, no en la pestaña de landed cost). El landed cost por
 * referencia (pestaña Costeo) consume estos mismos costos vía useImportItems.
 */
export default function ImportCostsTable({ importId, disabled }: { importId: string; disabled?: boolean }) {
  const { costs, landed, addCost, updateCost, removeCost } = useImportItems(importId);
  const fallbackSet = useMemo(() => new Set(landed.fallbackCostIds), [landed.fallbackCostIds]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold text-muted-foreground">
          Costos del contenedor ({costs.length})
        </Label>
        {!disabled && (
          <Button
            type="button" size="sm" variant="outline" className="h-7 text-xs gap-1"
            onClick={() => addCost.mutate({ tipo: 'flete', concepto: null, monto: 0, moneda: 'USD', trm: null, base_asignacion: DEFAULT_BASIS_BY_TIPO.flete, orden: costs.length })}
          >
            <Plus className="h-3.5 w-3.5" /> Agregar costo
          </Button>
        )}
      </div>

      {costs.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2.5 text-center border rounded-lg border-dashed">
          Sin costos cargados. Agregá flete, seguro, aduana… acá y el costeo se actualiza solo.
        </p>
      ) : (
        <div className="overflow-x-auto border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60">
                <TableHead className="text-[11px]">Tipo</TableHead>
                <TableHead className="text-[11px] text-right">Monto</TableHead>
                <TableHead className="text-[11px]">Moneda</TableHead>
                <TableHead className="text-[11px]">Prorrateo</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {costs.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="p-1">
                    <Select
                      value={c.tipo}
                      disabled={disabled}
                      onValueChange={(v) => updateCost.mutate({ id: c.id, tipo: v as ImportCostTipo, base_asignacion: DEFAULT_BASIS_BY_TIPO[v as ImportCostTipo] })}
                    >
                      <SelectTrigger className="h-7 text-xs w-44"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(COST_TIPO_LABEL) as ImportCostTipo[]).map((t) => (
                          <SelectItem key={t} value={t} className="text-xs">{COST_TIPO_LABEL[t]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="p-1">
                    <Input type="number" step="0.01" defaultValue={c.monto} disabled={disabled} className="h-7 text-xs font-mono w-28 text-right"
                      onBlur={(e) => Number(e.target.value) !== c.monto && updateCost.mutate({ id: c.id, monto: Number(e.target.value) || 0 })} />
                  </TableCell>
                  <TableCell className="p-1">
                    <Select value={c.moneda} disabled={disabled} onValueChange={(v) => updateCost.mutate({ id: c.id, moneda: v as 'USD' | 'COP' })}>
                      <SelectTrigger className="h-7 text-xs w-20"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD" className="text-xs">USD</SelectItem>
                        <SelectItem value="COP" className="text-xs">COP</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="p-1">
                    <div className="flex items-center gap-1">
                      <Select value={c.base_asignacion} disabled={disabled} onValueChange={(v) => updateCost.mutate({ id: c.id, base_asignacion: v as AllocationBasis })}>
                        <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(BASIS_LABEL) as AllocationBasis[]).map((b) => (
                            <SelectItem key={b} value={b} className="text-xs">{BASIS_LABEL[b]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {fallbackSet.has(c.id) && (
                        <span title="Ninguna referencia tiene esa base (ej: sin peso). Se prorrateó con otra base para no perder el costo." className="text-[9px] text-amber-600 font-medium whitespace-nowrap">⚠ auto</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="p-1">
                    {!disabled && (
                      <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => removeCost.mutate(c.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
