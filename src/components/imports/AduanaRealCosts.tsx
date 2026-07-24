import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Landmark, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useImportItems } from '@/hooks/useImportItems';
import { DEFAULT_BASIS_BY_TIPO } from '@/lib/landedCost';

/**
 * Captura rápida de la liquidación de aduana REAL (arancel + IVA, en COP).
 *
 * La app estima arancel/IVA con la TRM ponderada de los abonos, pero la DIAN
 * liquida con la TRM de la declaración (la del viernes anterior) — casi nunca
 * coinciden. Cuando el contenedor está en aduana/entregado, acá se digita lo
 * que DE VERDAD se pagó y ese valor manda sobre el estimado en toda la app
 * (es la misma fila de import_costs que lee computeImportBreakdown).
 */
export default function AduanaRealCosts({ importId, disabled }: { importId: string; disabled?: boolean }) {
  const { costs, addCost, updateCost } = useImportItems(importId);
  const arancelRow = costs.find(c => c.tipo === 'arancel') ?? null;
  const ivaRow = costs.find(c => c.tipo === 'iva_importacion') ?? null;

  const [arancel, setArancel] = useState<string>('');
  const [iva, setIva] = useState<string>('');
  // Sync desde la DB al cargar/refrescar (inputs no controlados rompían al
  // guardar desde otro lado, ej. la tabla de costos del Resumen).
  useEffect(() => { setArancel(arancelRow ? String(arancelRow.monto) : ''); }, [arancelRow?.id, arancelRow?.monto]);
  useEffect(() => { setIva(ivaRow ? String(ivaRow.monto) : ''); }, [ivaRow?.id, ivaRow?.monto]);

  const saving = addCost.isPending || updateCost.isPending;
  const hayReal = (arancelRow?.monto ?? 0) > 0 && (ivaRow?.monto ?? 0) > 0;

  const guardar = async () => {
    const va = Number(arancel);
    const vi = Number(iva);
    const ops: Promise<unknown>[] = [];
    if (Number.isFinite(va) && va > 0) {
      ops.push(arancelRow
        ? updateCost.mutateAsync({ id: arancelRow.id, monto: va, moneda: 'COP' })
        : addCost.mutateAsync({ tipo: 'arancel', concepto: 'Liquidación aduana (real)', monto: va, moneda: 'COP', trm: null, base_asignacion: DEFAULT_BASIS_BY_TIPO.arancel, orden: costs.length }));
    }
    if (Number.isFinite(vi) && vi > 0) {
      ops.push(ivaRow
        ? updateCost.mutateAsync({ id: ivaRow.id, monto: vi, moneda: 'COP' })
        : addCost.mutateAsync({ tipo: 'iva_importacion', concepto: 'Liquidación aduana (real)', monto: vi, moneda: 'COP', trm: null, base_asignacion: DEFAULT_BASIS_BY_TIPO.iva_importacion, orden: costs.length + 1 }));
    }
    await Promise.all(ops);
  };

  return (
    <div className={cn(
      'rounded-xl border px-4 py-3 space-y-2',
      hayReal ? 'border-success/30 bg-success/5' : 'border-amber-400/50 bg-amber-50/60 dark:bg-amber-950/15',
    )}>
      <div className="flex items-center gap-2">
        {hayReal
          ? <CheckCircle2 className="h-4 w-4 text-success" />
          : <Landmark className="h-4 w-4 text-amber-600" />}
        <Label className="text-sm font-semibold">
          {hayReal ? 'Liquidación de aduana real cargada' : '¿Cuánto pagaste REALMENTE en aduana?'}
        </Label>
      </div>
      {!hayReal && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          La app estima arancel e IVA con la TRM promediada de tus abonos, pero la DIAN liquida con la
          TRM de la declaración (viernes anterior). Poné acá lo pagado según la declaración de importación
          y ese valor <strong>reemplaza el estimado</strong> en el costeo, los KPIs y la lista.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-[11px] text-muted-foreground">Arancel pagado (COP)</Label>
          <Input
            type="number" step="1" min={0}
            value={arancel}
            onChange={e => setArancel(e.target.value)}
            disabled={disabled}
            placeholder="Ej: 23400000"
            className="h-8 w-40 font-mono text-sm"
          />
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">IVA importación pagado (COP)</Label>
          <Input
            type="number" step="1" min={0}
            value={iva}
            onChange={e => setIva(e.target.value)}
            disabled={disabled}
            placeholder="Ej: 93400000"
            className="h-8 w-40 font-mono text-sm"
          />
        </div>
        <Button
          type="button" size="sm" className="h-8 text-xs gap-1.5"
          onClick={guardar}
          disabled={disabled || saving || (!(Number(arancel) > 0) && !(Number(iva) > 0))}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          Guardar lo pagado
        </Button>
      </div>
      {hayReal && (
        <p className="text-[10px] text-muted-foreground">
          Estos valores mandan sobre el estimado por % en toda la app. Podés corregirlos acá o en "Costos del contenedor".
        </p>
      )}
    </div>
  );
}
