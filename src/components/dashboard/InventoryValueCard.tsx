import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import { Boxes, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

// inventory_variants aún no está en supabase/types.ts — mismo cast que usan
// el hook y la lib del inventario por variante.
const db = supabase as never as { from: (t: string) => any };

interface VariantRow {
  variant_reference: string;
  name: string | null;
  stock: number;
  avg_cost: number;
}

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
const fmtNum = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);

/**
 * Card del Dashboard: plata metida en bodega. Valor del inventario por
 * variante a costo landed (stock × costo promedio del contenedor) — el mismo
 * total que muestra Inventario → Variantes. Click → /inventario?tab=variantes.
 */
export default function InventoryValueCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['inventory-variants-value'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: rows, error } = await db
        .from('inventory_variants')
        .select('variant_reference, name, stock, avg_cost')
        .eq('active', true);
      if (error) throw error;
      return (rows ?? []) as VariantRow[];
    },
  });

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardContent className="p-4 flex items-center justify-center h-full">
          <p className="text-xs text-muted-foreground">Cargando...</p>
        </CardContent>
      </Card>
    );
  }

  const variants = data ?? [];
  const totalValor = variants.reduce((a, v) => a + Number(v.stock ?? 0) * Number(v.avg_cost ?? 0), 0);
  const totalUnidades = variants.reduce((a, v) => a + Number(v.stock ?? 0), 0);
  const topPorValor = variants
    .map((v) => ({ ...v, valor: Number(v.stock ?? 0) * Number(v.avg_cost ?? 0) }))
    .filter((v) => v.valor > 0)
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 3);

  if (variants.length === 0) {
    return (
      <Link to="/inventario?tab=variantes" className="block group">
        <Card className="overflow-hidden border border-border hover:border-primary/20 transition-colors cursor-pointer h-full">
          <CardContent className="p-4 h-full flex flex-col justify-center">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center shrink-0">
                <Boxes className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground">Inventario (costo landed)</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">Sin inventario por variante</p>
                <p className="text-[11px] text-muted-foreground leading-snug mt-1">
                  Subí tu maestra + conteo en Inventario → Variantes para valorizar la bodega.
                </p>
                <div className="flex items-center gap-1 text-[11px] text-primary/70 group-hover:text-primary font-medium transition-colors pt-2">
                  Ir a Inventario <ArrowRight className="h-3 w-3" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }

  return (
    <Link to="/inventario?tab=variantes" className="block group">
      <Card className="overflow-hidden h-full hover:border-primary/30 transition-colors">
        <CardContent className="p-4 h-full flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Boxes className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">Inventario (costo landed)</p>
              <p className="text-xl font-bold text-foreground mt-0.5 tabular-nums">{fmtCOP(totalValor)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {fmtNum(totalUnidades)} unidades · {fmtNum(variants.length)} referencias
              </p>
            </div>
          </div>

          {topPorValor.length > 0 && (
            <ul className="space-y-1.5">
              {topPorValor.map((v) => (
                <li key={v.variant_reference} className="flex items-center gap-2 p-2 rounded-md bg-muted/30 text-xs">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{v.variant_reference}</span>
                    {v.name && <span className="text-muted-foreground text-[10px] ml-1.5 truncate">{v.name}</span>}
                    <div className="text-muted-foreground text-[10px]">{fmtNum(v.stock)} und</div>
                  </div>
                  <span className="font-mono font-semibold tabular-nums whitespace-nowrap">{fmtCOP(v.valor)}</span>
                </li>
              ))}
            </ul>
          )}

          <span className="flex items-center justify-end gap-1 text-[11px] text-primary group-hover:underline mt-auto">
            Ver inventario por variante <ArrowRight className="h-3 w-3" />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}
