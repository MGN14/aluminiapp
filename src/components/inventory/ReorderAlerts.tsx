import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { PackageX, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react';
import { computeReorder, reorderTotals, type ReorderLevel } from '@/lib/reorder';
import type { InventoryProduct } from '@/hooks/useInventoryData';

const fmt = (v: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Math.round(v));
const fmtNum = (v: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(v);

const LEVEL_BADGE: Record<ReorderLevel, { label: string; cls: string }> = {
  quiebre: { label: 'Sin stock', cls: 'bg-destructive/10 text-destructive border-destructive/30' },
  critico: { label: 'Crítico', cls: 'bg-orange-100 text-orange-700 border-orange-300' },
  bajo: { label: 'En el mínimo', cls: 'bg-amber-100 text-amber-700 border-amber-300' },
};

export default function ReorderAlerts({ products }: { products: InventoryProduct[] }) {
  const [open, setOpen] = useState(true);
  const items = useMemo(() => computeReorder(products.map((p) => ({
    reference: p.reference, name: p.name, unit: p.unit,
    stock_system: p.stock_system, min_stock: p.min_stock, cost_per_unit: p.cost_per_unit,
  }))), [products]);
  const totals = useMemo(() => reorderTotals(items), [items]);

  // Sin alertas: mensaje discreto solo si hay productos con mínimo definido.
  const conMinimo = products.some((p) => (p.min_stock ?? 0) > 0);
  if (items.length === 0) {
    if (!conMinimo) return null; // nadie definió punto de reorden → no molestar
    return (
      <Card className="border-success/30 bg-success/5">
        <CardContent className="py-3 px-4 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
          <p className="text-sm text-foreground">Stock al día: ninguna referencia está por debajo de su mínimo.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn(totals.quiebres > 0 ? 'border-destructive/30' : 'border-amber-300')}>
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <PackageX className={cn('h-4 w-4', totals.quiebres > 0 ? 'text-destructive' : 'text-amber-600')} />
        <span className="text-sm font-semibold">Reponer stock</span>
        <span className="text-xs text-muted-foreground">
          {totals.count} referencia{totals.count === 1 ? '' : 's'}{totals.quiebres > 0 ? ` · ${totals.quiebres} sin stock` : ''}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          Reposición ≈ <span className="font-mono font-medium text-foreground">{fmt(totals.costoTotal)}</span>
          {(() => { const sd = items.filter((i) => i.costoReposicion <= 0).length; return sd > 0 ? <span className="text-amber-600"> (+{sd} sin costo)</span> : null; })()}
        </span>
      </button>
      {open && (
        <CardContent className="p-0 border-t">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60">
                  <TableHead className="text-xs">Referencia</TableHead>
                  <TableHead className="text-xs text-right">Stock</TableHead>
                  <TableHead className="text-xs text-right">Mínimo</TableHead>
                  <TableHead className="text-xs text-right">Pedir</TableHead>
                  <TableHead className="text-xs text-right">Costo reposición</TableHead>
                  <TableHead className="text-xs">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={it.reference}>
                    <TableCell className="text-sm py-2">
                      <span className="font-mono text-xs">{it.reference}</span>
                      <span className="block text-[10px] text-muted-foreground truncate max-w-[200px]">{it.name}</span>
                    </TableCell>
                    <TableCell className="text-sm text-right font-mono py-2">{fmtNum(it.stock)} {it.unit}</TableCell>
                    <TableCell className="text-sm text-right font-mono py-2 text-muted-foreground">{fmtNum(it.min_stock)}</TableCell>
                    <TableCell className="text-sm text-right font-mono py-2 font-semibold text-primary">{fmtNum(it.cantidadSugerida)} {it.unit}</TableCell>
                    <TableCell className="text-sm text-right font-mono py-2">{it.costoReposicion > 0 ? fmt(it.costoReposicion) : <span className="text-muted-foreground text-xs">costo s/d</span>}</TableCell>
                    <TableCell className="py-2">
                      <Badge variant="outline" className={cn('text-[10px]', LEVEL_BADGE[it.nivel].cls)}>{LEVEL_BADGE[it.nivel].label}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-[11px] text-muted-foreground px-4 py-2">
            "Pedir" sugiere reponer hasta el doble del mínimo. Definí el stock mínimo de cada referencia para afinar estas alertas.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
