import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Trash2, Upload, PackageOpen, Calculator, Info } from 'lucide-react';
import { useImportItems } from '@/hooks/useImportItems';
import PackingListImport from './PackingListImport';

const fmtCop = (n: number | null | undefined) =>
  n === null || n === undefined ? '—'
    : new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
const fmtUsd = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const fmtNum = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: d });

/** Costo unitario actual del inventario por referencia (read-only, para comparar). */
function useInventoryCosts() {
  const { user } = useAuth();
  return useQuery<Map<string, { cost: number; sale: number }>>({
    queryKey: ['inventory-costs-map', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_products')
        .select('reference, cost_per_unit, sale_price')
        .eq('user_id', user!.id);
      if (error) throw error;
      const m = new Map<string, { cost: number; sale: number }>();
      for (const r of (data ?? []) as Array<{ reference: string; cost_per_unit: number; sale_price: number }>) {
        if (r.reference) m.set(r.reference.trim().toLowerCase(), { cost: Number(r.cost_per_unit) || 0, sale: Number(r.sale_price) || 0 });
      }
      return m;
    },
  });
}

export default function ImportCostingSection({ importId, montoTotalUsd }: { importId: string; montoTotalUsd?: number | null }) {
  const [trmOverride, setTrmOverride] = useState<number | ''>('');
  const {
    items, landed, trmPonderada, trmEfectiva,
    addItems, updateItem, removeItem,
  } = useImportItems(importId, trmOverride === '' ? null : Number(trmOverride));
  const { data: invCosts } = useInventoryCosts();
  const [showImport, setShowImport] = useState(false);

  const landedById = useMemo(() => {
    const m = new Map(landed.items.map((r) => [r.id, r]));
    return m;
  }, [landed]);

  const noTrm = trmEfectiva === null || trmEfectiva <= 0;

  // Conciliación: ¿la suma de FOB del packing list cuadra con el monto total
  // del pedido tecleado en la cabecera? Si difieren, el costeo puede estar
  // inflado/desinflado respecto al desembolso real.
  const fobPacking = landed.totals.fob_total_usd;
  const fobMismatchPct = montoTotalUsd && montoTotalUsd > 0 && fobPacking > 0
    ? ((fobPacking - montoTotalUsd) / montoTotalUsd) * 100
    : null;
  const showMismatch = fobMismatchPct !== null && Math.abs(fobMismatchPct) > 1;

  return (
    <div className="space-y-5 rounded-lg border border-border p-4 bg-muted/10">
      <div className="flex items-center gap-2">
        <PackageOpen className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Costeo referencia a referencia (landed cost)</h3>
      </div>

      {/* ── TRM ── */}
      <div className="flex flex-wrap items-end gap-3 text-xs">
        <div>
          <Label className="text-[11px] text-muted-foreground">TRM ponderada de abonos</Label>
          <p className="font-mono font-semibold text-sm">
            {trmPonderada ? `$${trmPonderada.toLocaleString('es-CO', { maximumFractionDigits: 2 })}` : 'Sin abonos aún'}
          </p>
        </div>
        <div className="w-40">
          <Label className="text-[11px] text-muted-foreground">TRM para simular (opcional)</Label>
          <Input
            type="number" step="0.01" min={0}
            value={trmOverride}
            onChange={(e) => setTrmOverride(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder={trmPonderada ? String(trmPonderada) : 'Ej: 4100'}
            className="h-8 font-mono"
          />
        </div>
        {noTrm && (
          <p className="text-[11px] text-amber-600 flex items-center gap-1 max-w-xs">
            <Info className="h-3.5 w-3.5 shrink-0" />
            Registrá abonos (con TRM) o poné una TRM de simulación para ver el costo en COP.
          </p>
        )}
      </div>

      {/* ── Packing list ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold text-muted-foreground">Packing list ({items.length})</Label>
          <div className="flex gap-1.5">
            <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowImport(true)}>
              <Upload className="h-3.5 w-3.5" /> Importar CSV/Excel
            </Button>
            <Button
              type="button" size="sm" variant="outline" className="h-7 text-xs gap-1"
              onClick={() => addItems.mutate([{ reference: '', descripcion: null, cantidad: 0, unidad: 'kg', peso_kg: null, fob_total_usd: 0, orden: items.length, notas: null }])}
            >
              <Plus className="h-3.5 w-3.5" /> Fila
            </Button>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center border rounded-lg border-dashed">
            Sin referencias. Importá el packing list o agregá filas a mano.
          </p>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60">
                  <TableHead className="text-[11px]">Referencia</TableHead>
                  <TableHead className="text-[11px]">Descripción</TableHead>
                  <TableHead className="text-[11px] text-right">Cantidad</TableHead>
                  <TableHead className="text-[11px]">Unidad</TableHead>
                  <TableHead className="text-[11px] text-right">Peso kg</TableHead>
                  <TableHead className="text-[11px] text-right">FOB USD</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="p-1">
                      <Input defaultValue={it.reference} className="h-7 text-xs font-mono w-28"
                        onBlur={(e) => e.target.value !== it.reference && updateItem.mutate({ id: it.id, reference: e.target.value })} />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input defaultValue={it.descripcion ?? ''} className="h-7 text-xs w-36"
                        onBlur={(e) => e.target.value !== (it.descripcion ?? '') && updateItem.mutate({ id: it.id, descripcion: e.target.value || null })} />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input type="number" step="0.001" defaultValue={it.cantidad} className="h-7 text-xs font-mono w-20 text-right"
                        onBlur={(e) => { if (e.target.value === '') return; const v = Number(e.target.value) || 0; if (v !== it.cantidad) updateItem.mutate({ id: it.id, cantidad: v }); }} />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input defaultValue={it.unidad} className="h-7 text-xs w-14"
                        onBlur={(e) => e.target.value !== it.unidad && updateItem.mutate({ id: it.id, unidad: e.target.value || 'kg' })} />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input type="number" step="0.001" defaultValue={it.peso_kg ?? ''} className="h-7 text-xs font-mono w-20 text-right"
                        onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== it.peso_kg) updateItem.mutate({ id: it.id, peso_kg: v }); }} />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input type="number" step="0.01" defaultValue={it.fob_total_usd} className="h-7 text-xs font-mono w-24 text-right"
                        onBlur={(e) => Number(e.target.value) !== it.fob_total_usd && updateItem.mutate({ id: it.id, fob_total_usd: Number(e.target.value) || 0 })} />
                    </TableCell>
                    <TableCell className="p-1">
                      <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => removeItem.mutate(it.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Los costos del contenedor (flete, seguro, aduana…) se cargan en el
          RESUMEN (ImportCostsTable) — acá solo se consumen para el landed. */}

      {/* Conciliación FOB packing list vs total del pedido */}
      {showMismatch && (
        <p className="text-[11px] text-amber-600 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2 flex items-start gap-1.5">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          El FOB del packing list ({fmtUsd(fobPacking)}) difiere {fobMismatchPct! > 0 ? '+' : ''}{fobMismatchPct!.toFixed(1)}% del monto total del pedido ({fmtUsd(montoTotalUsd)}). Revisá si falta una referencia o un FOB está mal antes de confiar en el costeo.
        </p>
      )}

      {/* ── Resultado landed cost ── */}
      {items.length > 0 && noTrm && (
        <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-4 text-center">
          <p className="text-xs text-amber-700">
            Para ver el costo nacionalizado en COP, registrá abonos (con TRM) o poné una TRM de simulación arriba.
          </p>
        </div>
      )}
      {items.length > 0 && !noTrm && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            <Label className="text-xs font-semibold">Costo nacionalizado por referencia</Label>
          </div>

          {/* Composición FOB vs costos */}
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-muted-foreground">Composición:</span>
            <span className="text-foreground font-medium">FOB {landed.totals.pct_fob}%</span>
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden max-w-[260px]">
              <div className="h-full bg-primary" style={{ width: `${landed.totals.pct_fob}%` }} />
            </div>
            <span className="text-foreground font-medium">Importación {landed.totals.pct_costos}%</span>
          </div>

          <div className="overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60">
                  <TableHead className="text-[11px]">Referencia</TableHead>
                  <TableHead className="text-[11px] text-right">FOB COP</TableHead>
                  <TableHead className="text-[11px] text-right">+ Importación</TableHead>
                  <TableHead className="text-[11px] text-right">Landed total</TableHead>
                  <TableHead className="text-[11px] text-right">Costo unit.</TableHead>
                  <TableHead className="text-[11px] text-right">Por kg</TableHead>
                  <TableHead className="text-[11px] text-right">Inv. actual</TableHead>
                  <TableHead className="text-[11px] text-right" title="Compara el costo unitario landed contra el cost_per_unit cargado en inventario. Asume la misma unidad de medida.">Δ vs inv.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => {
                  const r = landedById.get(it.id);
                  if (!r) return null;
                  const inv = invCosts?.get(it.reference.trim().toLowerCase());
                  const delta = inv && inv.cost > 0 ? ((r.landed_unit_cop - inv.cost) / inv.cost) * 100 : null;
                  return (
                    <TableRow key={it.id}>
                      <TableCell className="text-xs font-mono">{it.reference || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-xs font-mono text-right">{fmtCop(r.fob_total_cop)}</TableCell>
                      <TableCell className="text-xs font-mono text-right text-muted-foreground">{fmtCop(r.costos_asignados_cop)}</TableCell>
                      <TableCell className="text-xs font-mono text-right font-semibold">{fmtCop(r.landed_total_cop)}</TableCell>
                      <TableCell className="text-xs font-mono text-right font-semibold text-primary">{fmtCop(r.landed_unit_cop)}</TableCell>
                      <TableCell className="text-xs font-mono text-right">{r.landed_por_kg_cop ? fmtCop(r.landed_por_kg_cop) : '—'}</TableCell>
                      <TableCell className="text-xs font-mono text-right text-muted-foreground">{inv ? fmtCop(inv.cost) : '—'}</TableCell>
                      <TableCell className={`text-xs font-mono text-right font-medium ${delta === null ? 'text-muted-foreground' : delta > 0 ? 'text-destructive' : 'text-success'}`}>
                        {delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-muted/30 font-semibold">
                  <TableCell className="text-xs">Total · {fmtUsd(landed.totals.fob_total_usd)} FOB · {fmtNum(landed.totals.peso_total_kg)} kg</TableCell>
                  <TableCell className="text-xs font-mono text-right">{fmtCop(landed.totals.fob_total_cop)}</TableCell>
                  <TableCell className="text-xs font-mono text-right">{fmtCop(landed.totals.costos_total_cop)}</TableCell>
                  <TableCell className="text-xs font-mono text-right">{fmtCop(landed.totals.landed_total_cop)}</TableCell>
                  <TableCell colSpan={4} />
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 shrink-0" />
            Solo análisis: este costo no modifica tu inventario. La columna "Δ vs inv." compara contra el costo que ya tenés cargado.
          </p>
        </div>
      )}

      <PackingListImport open={showImport} onOpenChange={setShowImport} onConfirm={(rows) => addItems.mutate(rows)} />
    </div>
  );
}
