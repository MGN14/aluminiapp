import { useState } from 'react';
import { Package, ArrowUpDown, Plus, Minus, Eye, Bot } from 'lucide-react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ProductWithMetrics, InventoryStatus } from '@/hooks/useInventoryData';

const statusConfig: Record<InventoryStatus, { label: string; className: string }> = {
  critico: { label: 'Crítico', className: 'bg-destructive/10 text-destructive border-destructive/30' },
  alerta: { label: 'Alerta', className: 'bg-warning/10 text-warning border-warning/30' },
  sano: { label: 'Sano', className: 'bg-success/10 text-success border-success/30' },
  exceso: { label: 'Exceso', className: 'bg-violet-500/10 text-violet-500 border-violet-500/30' },
};

interface Props {
  products: ProductWithMetrics[];
  onAdjust: (product: ProductWithMetrics) => void;
  onAddMovement: (product: ProductWithMetrics, type: 'entrada' | 'salida') => void;
}

export default function InventoryTable({ products, onAdjust, onAddMovement }: Props) {
  const [sortKey, setSortKey] = useState<'reference' | 'stock_system' | 'days_of_inventory' | 'status'>('status');
  const [sortAsc, setSortAsc] = useState(true);

  const sorted = [...products].sort((a, b) => {
    const statusOrder: Record<InventoryStatus, number> = { critico: 0, alerta: 1, sano: 2, exceso: 3 };
    let cmp = 0;
    if (sortKey === 'status') cmp = statusOrder[a.status] - statusOrder[b.status];
    else if (sortKey === 'reference') cmp = a.reference.localeCompare(b.reference);
    else cmp = (a[sortKey] as number) - (b[sortKey] as number);
    return sortAsc ? cmp : -cmp;
  });

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const askNicoAboutProduct = (product: ProductWithMetrics) => {
    const diffText = product.difference === 0 
      ? 'está alineado con el conteo físico'
      : product.difference > 0 
        ? `tiene ${product.difference} unidades faltantes respecto al físico`
        : `tiene ${Math.abs(product.difference)} unidades de exceso físico`;
    
    const query = `Analiza el producto ${product.reference} (${product.name}). Stock sistema: ${product.stock_system}, Stock físico: ${product.stock_physical ?? 'no contado'}. El inventario ${diffText}. ¿Qué puede estar causando esta diferencia y qué debería hacer?`;
    
    window.dispatchEvent(new CustomEvent('nico-prefill', { 
      detail: { query, pageContext: { page: 'inventory' } }
    }));
  };

  if (!products.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 rounded-2xl border border-border/50 bg-muted/10">
        <Package className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Agrega tu primer producto para comenzar</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-card/60 backdrop-blur-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent border-b border-border/50">
            <TableHead className="cursor-pointer" onClick={() => toggleSort('reference')}>
              <span className="flex items-center gap-1">Referencia <ArrowUpDown className="h-3 w-3" /></span>
            </TableHead>
            <TableHead>Producto</TableHead>
            <TableHead className="text-right cursor-pointer" onClick={() => toggleSort('stock_system')}>
              <span className="flex items-center justify-end gap-1">Uds. Sistema <ArrowUpDown className="h-3 w-3" /></span>
            </TableHead>
            <TableHead className="text-right">Uds. Físicas</TableHead>
            <TableHead className="text-right">Diferencia</TableHead>
            <TableHead className="text-right cursor-pointer" onClick={() => toggleSort('days_of_inventory')}>
              <span className="flex items-center justify-end gap-1">Días Inv. <ArrowUpDown className="h-3 w-3" /></span>
            </TableHead>
            <TableHead className="text-right">Rotación</TableHead>
            <TableHead className="cursor-pointer" onClick={() => toggleSort('status')}>
              <span className="flex items-center gap-1">Estado <ArrowUpDown className="h-3 w-3" /></span>
            </TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map(p => {
            const sc = statusConfig[p.status];
            const hasPhysical = p.stock_physical !== null;
            const diff = p.difference;
            const absDiff = Math.abs(diff);

            // Difference visual states
            let diffColor = 'text-muted-foreground';
            let diffLabel = '';
            if (hasPhysical) {
              if (diff === 0) {
                diffColor = 'text-emerald-400';
                diffLabel = 'Alineado';
              } else if (diff > 0) {
                // System > Physical: missing units
                diffColor = absDiff > 10 ? 'text-destructive' : 'text-amber-400';
                diffLabel = absDiff > 10 ? 'Faltante crítico' : 'Faltante leve';
              } else {
                // Physical > System: excess physical
                diffColor = 'text-violet-400';
                diffLabel = 'Exceso físico';
              }
            }

            return (
              <TableRow key={p.id} className="border-b border-border/30 hover:bg-muted/30">
                <TableCell className="font-mono text-sm font-medium">{p.reference}</TableCell>
                <TableCell className="text-sm">{p.name}</TableCell>
                <TableCell className="text-right font-mono text-sm">{p.stock_system}</TableCell>
                <TableCell className="text-right font-mono text-sm text-muted-foreground">{p.stock_physical ?? '—'}</TableCell>
                <TableCell className="text-right">
                  {hasPhysical ? (
                    <span className={`font-mono text-sm font-medium ${diffColor}`} title={diffLabel}>
                      {diff > 0 ? `+${diff}` : diff === 0 ? '0 ✓' : diff}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{p.days_of_inventory >= 999 ? '∞' : `${p.days_of_inventory}d`}</TableCell>
                <TableCell className="text-right font-mono text-sm">{p.rotation}x</TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-[10px] font-semibold uppercase tracking-wider ${sc.className}`}>
                    {sc.label}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onAddMovement(p, 'entrada')} title="Entrada">
                      <Plus className="h-3.5 w-3.5 text-success" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onAddMovement(p, 'salida')} title="Salida">
                      <Minus className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onAdjust(p)} title="Ajustar">
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10" 
                      onClick={() => askNicoAboutProduct(p)} 
                      title="Preguntar a Nico"
                    >
                      <Bot className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
