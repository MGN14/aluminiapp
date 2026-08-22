// Ciclo comercial — "Generar remisión" desde una cotización aceptada.
//
// Calcula el despiece (plantilla exacta > BOM por m² > descriptiva) y lo deja
// en un preview EDITABLE: el teórico casi nunca es lo que sale de bodega.
// Al confirmar usa el mismo write path que NewRemisionModal: insert remisión
// (con quotation_id → trazabilidad), items, applyRemisionInventory.

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, PackageCheck, Trash2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import type { QuotationDetail } from '@/hooks/useQuotations';
import { computeQuoteDespiece, type QuoteDespieceLine } from '@/lib/quoteToRemision';
import { applyRemisionInventory, fetchProductsByRefs, type ProductLite } from '@/lib/remisionInventory';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: QuotationDetail;
  onCreated?: () => void;
}

const fmtCOP = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);

const SOURCE_LABEL: Record<QuoteDespieceLine['source'], string> = {
  plantilla: 'plantilla',
  bom_m2: 'BOM m²',
  sin_despiece: 'sin despiece',
};

export default function GenerateRemisionModal({ open, onOpenChange, detail, onCreated }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lines, setLines] = useState<QuoteDespieceLine[]>([]);
  const [productMap, setProductMap] = useState<Map<string, ProductLite>>(new Map());
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await computeQuoteDespiece(detail.items);
        const map = await fetchProductsByRefs(user?.id ?? '', result.lines.map((l) => l.reference));
        if (cancelled) return;
        // Costo vacío → cost_per_unit del maestro (mismo criterio que el Excel).
        setLines(result.lines.map((l) => {
          if (l.unit_cost > 0) return l;
          const prod = map.get(l.reference.trim().toLowerCase());
          return prod && prod.cost_per_unit > 0 ? { ...l, unit_cost: Number(prod.cost_per_unit) } : l;
        }));
        setProductMap(map);
        setNotes(`Generada desde cotización ${detail.quote_number}`);
      } catch (e) {
        toast({ title: 'Error al calcular el despiece', description: (e as Error).message, variant: 'destructive' });
        onOpenChange(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, detail.id]);

  const setLine = (idx: number, patch: Partial<QuoteDespieceLine>) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const validLines = useMemo(() => lines.filter((l) => l.units > 0 && (l.reference.trim() || l.product_name.trim())), [lines]);
  const total = useMemo(() => validLines.reduce((s, l) => s + l.units * l.unit_cost, 0), [validLines]);
  const sinMatch = useMemo(
    () => validLines.filter((l) => l.reference.trim() && !productMap.has(l.reference.trim().toLowerCase())),
    [validLines, productMap],
  );

  const handleCreate = async () => {
    if (!user?.id || validLines.length === 0) return;
    setSaving(true);
    try {
      const { data: remision, error: remError } = await (supabase.from('remisiones') as any)
        .insert({
          user_id: user.id,
          date,
          beneficiary: detail.responsible?.name ?? '',
          responsible_id: detail.responsible?.id ?? null,
          notes,
          status: 'pendiente',
          module_origin: 'dian',
          remision_type: 'venta',
          quotation_id: detail.id,
        })
        .select('id, number')
        .single();
      if (remError) throw remError;

      const itemsToInsert = validLines.map((l) => ({
        remision_id: remision.id,
        reference: l.reference.trim(),
        product_name: l.product_name,
        units: l.units,
        unit_cost: l.unit_cost,
        total_cost: Number(l.units) * Number(l.unit_cost),
      }));
      const { error: itemsError } = await supabase.from('remision_items').insert(itemsToInsert);
      if (itemsError) throw itemsError;

      const result = await applyRemisionInventory({
        userId: user.id,
        remisionId: remision.id,
        remisionType: 'venta',
        movementDate: date,
        items: validLines,
        productMap,
      });

      let description = `${validLines.length} referencias desde la cotización ${detail.quote_number}.`;
      if (result.applied > 0 || result.variantesAplicadas > 0) description += ' Stock descontado.';
      if (result.unmatched.length > 0) description += ` ⚠️ ${result.unmatched.length} ítems sin match (no afectaron stock).`;

      toast({ title: `Remisión ${remision.number ?? ''} creada`, description });
      await queryClient.invalidateQueries({ queryKey: ['remisiones'] });
      await queryClient.invalidateQueries({ queryKey: ['quote-cycle'] });
      onCreated?.();
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Error al crear la remisión', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const stockOf = (l: QuoteDespieceLine): string => {
    const p = productMap.get(l.reference.trim().toLowerCase());
    if (!p) return '—';
    return String(p.stock_physical ?? p.stock_system ?? 0);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-primary" />
            Generar remisión — {detail.quote_number}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            Calculando despiece…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3 text-sm">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Cliente</label>
                <div className="font-medium">{detail.responsible?.name ?? '—'}</div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Fecha despacho</label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 w-40" />
              </div>
              <div className="flex-1 min-w-[220px]">
                <label className="text-xs text-muted-foreground block mb-1">Notas</label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-8" />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Despiece teórico de la cotización — revisá y ajustá a lo que realmente sale de bodega antes de crear.
            </p>

            <div className="overflow-x-auto border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/60">
                    <TableHead className="text-xs">Referencia</TableHead>
                    <TableHead className="text-xs">Producto</TableHead>
                    <TableHead className="text-xs text-right">Unidades</TableHead>
                    <TableHead className="text-xs text-right">Costo unit.</TableHead>
                    <TableHead className="text-xs text-right">Stock</TableHead>
                    <TableHead className="text-xs">Origen</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l, i) => (
                    <TableRow key={i} className={l.source === 'sin_despiece' ? 'bg-amber-500/5' : undefined}>
                      <TableCell className="py-1">
                        <Input value={l.reference} onChange={(e) => setLine(i, { reference: e.target.value })} className="h-7 w-28 font-mono text-xs" placeholder="(sin ref)" />
                      </TableCell>
                      <TableCell className="py-1">
                        <Input value={l.product_name} onChange={(e) => setLine(i, { product_name: e.target.value })} className="h-7 min-w-[180px] text-xs" />
                      </TableCell>
                      <TableCell className="py-1 text-right">
                        <Input type="number" inputMode="decimal" value={String(l.units)} onChange={(e) => setLine(i, { units: Number(e.target.value) || 0 })} className="h-7 w-20 text-right font-mono text-xs ml-auto" />
                      </TableCell>
                      <TableCell className="py-1 text-right">
                        <Input type="number" inputMode="decimal" value={String(l.unit_cost)} onChange={(e) => setLine(i, { unit_cost: Number(e.target.value) || 0 })} className="h-7 w-24 text-right font-mono text-xs ml-auto" />
                      </TableCell>
                      <TableCell className="py-1 text-right font-mono text-xs text-muted-foreground">{stockOf(l)}</TableCell>
                      <TableCell className="py-1">
                        <Badge variant={l.source === 'sin_despiece' ? 'destructive' : 'outline'} className="text-[9px]">{SOURCE_LABEL[l.source]}</Badge>
                      </TableCell>
                      <TableCell className="py-1">
                        <button type="button" onClick={() => removeLine(i)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {sinMatch.length > 0 && (
              <p className="text-xs text-amber-600 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {sinMatch.length} referencia(s) sin match en el maestro: se guardan en la remisión pero no descuentan stock.
              </p>
            )}

            <div className="text-right text-sm font-medium">
              Total costo: <span className="font-mono">{fmtCOP(total)}</span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleCreate} disabled={loading || saving || validLines.length === 0} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
            {saving ? 'Creando…' : `Crear remisión (${validLines.length} ítems)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
