import { useQuery } from '@tanstack/react-query';
import { CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import { Boxes } from 'lucide-react';
import { fetchVariantValuation } from '@/lib/variantInventory';
import { DashCard, DashHeader, DashBig, DashItem, DashChip, DashFooter, DashEmpty, DashLoading, Pill, fmtCop, fmtNum } from './cardKit';

const EMERALD_TILE = 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';

/**
 * Card del Dashboard: plata metida en bodega. Valor del inventario por
 * variante a costo landed, calculado DESDE el ledger (inicial + contenedor −
 * remisiones) — el mismo número de Inventario → Variantes, nunca el stock
 * cacheado. Click → /inventario?tab=variantes.
 */
export default function InventoryValueCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['inventory-variants-value'],
    staleTime: 5 * 60_000,
    queryFn: fetchVariantValuation,
  });

  if (isLoading) return <DashLoading lines={3} />;

  const variants = data ?? [];
  const totalValor = variants.reduce((a, v) => a + v.valor, 0);
  const totalUnidades = variants.reduce((a, v) => a + v.stock, 0);
  const topPorValor = variants
    .filter((v) => v.valor > 0)
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 3);

  if (variants.length === 0) {
    return (
      <Link to="/inventario?tab=variantes" className="block group h-full">
        <DashEmpty
          icon={Boxes}
          title="Inventario (costo landed)"
          headline="Sin inventario por variante"
          hint="Subí tu maestra + conteo en Inventario → Variantes para valorizar la bodega."
          cta="Ir a Inventario"
        />
      </Link>
    );
  }

  return (
    <Link to="/inventario?tab=variantes" className="block group h-full">
      <DashCard>
        <CardContent className="p-4 sm:p-5 h-full flex flex-col">
          <DashHeader
            icon={Boxes}
            tileClassName={EMERALD_TILE}
            title="Inventario (costo landed)"
            subtitle={`${fmtNum(totalUnidades)} unidades · ${fmtNum(variants.length)} referencias`}
          >
            <DashBig>{fmtCop(totalValor)}</DashBig>
          </DashHeader>

          {topPorValor.length > 0 && (
            <div className="space-y-2">
              {topPorValor.map((v) => {
                const share = totalValor > 0 ? (v.valor / totalValor) * 100 : 0;
                return (
                  <DashItem
                    key={v.variant_reference}
                    leading={<DashChip className={EMERALD_TILE}>{v.variant_reference}</DashChip>}
                    title={`${fmtNum(v.stock)} unidades`}
                    subtitle={`${share.toLocaleString('es-CO', { maximumFractionDigits: 1 })}% de la bodega`}
                    value={fmtCop(v.valor)}
                    pill={<Pill className="bg-muted text-muted-foreground">Top {topPorValor.indexOf(v) + 1}</Pill>}
                  />
                );
              })}
            </div>
          )}

          <DashFooter note="Top 3 por plata parada">Ver inventario por variante</DashFooter>
        </CardContent>
      </DashCard>
    </Link>
  );
}
