/**
 * CORRECTOR DE REFERENCIAS MAL DIGITADAS EN REMISIONES.
 *
 * Pedido de Nico (2026-08-05): "esas 21 unidades son errores de digitación,
 * ¿cómo configuramos para que la app pueda corregirlos con el usuario?".
 *
 * Cada línea de remisión cuya referencia no cruza con ninguna variante son
 * unidades que salieron de bodega y NO descuentan de nada. Acá se corrigen:
 * se elige la referencia buena (con sugerencia por familia), se reescribe la
 * línea de la remisión y se recuadra al toque, así el stock queda al día.
 *
 * Alternativa por línea: descartarla, para basura de digitación ("B", "1")
 * que no corresponde a ningún producto.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, Trash2, Wrench, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { usePermissions } from '@/hooks/usePermissions';
import { type LineaSinCruce } from '@/lib/refsSinCruce';
import { backfillVariantRemisionesDesdeDB, syncVariantStockToLedger } from '@/lib/variantInventory';
import { cn } from '@/lib/utils';

const db = supabase as never as { from: (t: string) => any };
const fmt = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);

interface Props {
  lineas: LineaSinCruce[];
  /** Referencias válidas para el selector. */
  referencias: { variant_reference: string; name: string | null }[];
  onAplicado?: () => void;
}

export default function RemisionRefFixer({ lineas, referencias, onAplicado }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isAdmin } = usePermissions();
  const [abierto, setAbierto] = useState(false);
  // Referencia elegida por línea (arranca con la sugerencia por familia).
  const [elegida, setElegida] = useState<Record<string, string>>({});

  const totalUnds = useMemo(() => lineas.reduce((s, l) => s + l.units, 0), [lineas]);
  const key = (l: LineaSinCruce) => `${l.remision}|${l.reference}`;

  const corregir = useMutation({
    mutationFn: async ({ linea, destino }: { linea: LineaSinCruce; destino: string | null }) => {
      // Todas las líneas de remisión con esa referencia mal escrita: el mismo
      // typo suele repetirse en varias remisiones.
      const { data, error } = await db
        .from('remision_items')
        .select('id, reference')
        .eq('reference', linea.reference);
      if (error) throw error;
      const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
      if (!ids.length) throw new Error('No encontré esas líneas (¿ya se corrigieron?).');

      if (destino) {
        const { error: upErr } = await db
          .from('remision_items')
          .update({ reference: destino })
          .in('id', ids);
        if (upErr) throw upErr;
      } else {
        const { error: delErr } = await db.from('remision_items').delete().in('id', ids);
        if (delErr) throw delErr;
      }

      // El ledger se re-espeja y el stock se recalcula con la fórmula.
      await backfillVariantRemisionesDesdeDB();
      await syncVariantStockToLedger();
      return { lineas: ids.length, destino };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['remisiones-sin-cruce'] });
      qc.invalidateQueries({ queryKey: ['inventory-variants'] });
      qc.invalidateQueries({ queryKey: ['inventory-variant-movs'] });
      qc.invalidateQueries({ queryKey: ['inventory-count-lines'] });
      qc.invalidateQueries({ queryKey: ['imports'] });
      onAplicado?.();
      toast({
        title: r.destino ? `Corregido → ${r.destino}` : 'Línea(s) descartada(s)',
        description: `${r.lineas} línea(s) de remisión actualizadas. El stock ya quedó recalculado.`,
        duration: 8000,
      });
    },
    onError: (e) => toast({ title: 'No se pudo corregir', description: (e as Error).message, variant: 'destructive' }),
  });

  if (!lineas.length) return null;

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/[0.05] px-4 py-3 text-xs space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="font-semibold text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" />
            {lineas.length} línea(s) de remisión no cruzan con ninguna referencia — {fmt(totalUnds)} unidades que NO están descontando
          </p>
          <p className="text-muted-foreground mt-0.5">
            La referencia despachada no existe en el inventario. Si es un error de digitación, corregilo acá:
            la app reescribe la línea de la remisión y recalcula el stock al toque.
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs shrink-0"
          onClick={() => setAbierto((v) => !v)}>
          {abierto ? <><X className="h-3.5 w-3.5 mr-1" /> Cerrar</> : <><Wrench className="h-3.5 w-3.5 mr-1" /> Corregir referencias</>}
        </Button>
      </div>

      {!abierto && (
        <p className="text-muted-foreground">
          Ejemplos: {lineas.slice(0, 5).map((l) => l.reference).join(', ')}{lineas.length > 5 ? '…' : ''}
        </p>
      )}

      {abierto && (
        <div className="overflow-x-auto rounded border border-border bg-background">
          <table className="w-full text-[11px]">
            <thead className="bg-muted/60">
              <tr className="text-left">
                <th className="px-2 py-1.5 font-semibold">Remisión</th>
                <th className="px-2 py-1.5 font-semibold">Fecha</th>
                <th className="px-2 py-1.5 font-semibold">Mal escrita</th>
                <th className="px-2 py-1.5 font-semibold text-right">Unds</th>
                <th className="px-2 py-1.5 font-semibold">Referencia correcta</th>
                <th className="px-2 py-1.5 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l) => {
                const k = key(l);
                const val = elegida[k] ?? l.sugerencia ?? '';
                const enCurso = corregir.isPending && corregir.variables?.linea && key(corregir.variables.linea) === k;
                return (
                  <tr key={k} className="border-t border-border/60">
                    <td className="px-2 py-1.5 font-medium">{l.remision}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{l.fecha}</td>
                    <td className="px-2 py-1.5 font-mono text-destructive">{l.reference}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmt(l.units)}</td>
                    <td className="px-2 py-1.5">
                      <select
                        value={val}
                        disabled={!isAdmin || corregir.isPending}
                        onChange={(e) => setElegida((p) => ({ ...p, [k]: e.target.value }))}
                        className={cn('w-full max-w-64 rounded border border-input bg-background px-1.5 py-1 font-mono',
                          !val && 'text-muted-foreground')}
                      >
                        <option value="">— elegir referencia —</option>
                        {referencias.map((r) => (
                          <option key={r.variant_reference} value={r.variant_reference}>
                            {r.variant_reference}{r.name ? ` · ${r.name}` : ''}
                          </option>
                        ))}
                      </select>
                      {l.sugerencia && val === l.sugerencia && (
                        <span className="text-[10px] text-muted-foreground ml-1">sugerida</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] mr-1"
                        disabled={!isAdmin || !val || corregir.isPending}
                        onClick={() => {
                          if (!window.confirm(
                            `Cambiar «${l.reference}» por «${val}» en TODAS las líneas de remisión con esa referencia.\n\n` +
                            'La remisión queda corregida y el stock se recalcula. ¿Continuar?',
                          )) return;
                          corregir.mutate({ linea: l, destino: val });
                        }}>
                        {enCurso ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Check className="h-3 w-3 mr-1" /> Corregir</>}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-muted-foreground"
                        disabled={!isAdmin || corregir.isPending}
                        title="La línea no corresponde a ningún producto: se elimina de la remisión."
                        onClick={() => {
                          if (!window.confirm(
                            `Eliminar las líneas con referencia «${l.reference}» (${fmt(l.units)} und) de sus remisiones.\n\n` +
                            'Usalo solo si es basura de digitación. ¿Continuar?',
                          )) return;
                          corregir.mutate({ linea: l, destino: null });
                        }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!isAdmin && (
            <p className="px-2 py-1.5 text-[10px] text-muted-foreground">
              Solo el administrador puede corregir referencias de remisiones.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
