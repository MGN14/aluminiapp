/**
 * "Impacto en tu lista de precios" — la conclusión del tablero.
 *
 * Todo lo demás dice cuánto CUESTA el contenedor. Esto dice si con ese costo
 * seguís ganando plata a los precios que ya tenés publicados: margen mayorista
 * ponderado, utilidad que deja el contenedor completo a lista actual, cuánto
 * habría que ajustar la lista, y las referencias que ya se venden con el
 * margen comido o directamente a pérdida.
 *
 * Era la última tarjeta del calculador HTML de Nico — la única que quedó sin
 * portar. Los datos ya existían: inventory_products.sale_price se traía en
 * ImportCostingSection y nunca se leía.
 */

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, TrendingDown, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { refFamilyKey } from '@/lib/refFamily';
import { computePriceImpact, MARGEN_OBJETIVO, MARGEN_RIESGO, type RefPrecio } from '@/lib/priceImpact';
import { useListaPrecios, listaPreciosIndex } from '@/hooks/useListaPrecios';
import type { LandedItemResult } from '@/lib/landedCost';
import { cop, numF, pctS } from './ModuloContenedor';

const pct1 = (n: number | null | undefined) =>
  n == null ? '—' : `${(n * 100).toFixed(1).replace('.', ',')}%`;

interface Props {
  label: string;
  items: LandedItemResult[];
  /** Para el aviso del piso de costeo. */
  smmActual: number | null;
  smmPiso: number | null;
}

export default function ImpactoListaPrecios({ label, items, smmActual, smmPiso }: Props) {
  const [ivaIncluido, setIvaIncluido] = useState(() => {
    try { return localStorage.getItem('aluminia_lista_iva_incluido') !== '0'; } catch { return true; }
  });
  const [verRefs, setVerRefs] = useState(false);

  const { data: precios } = useListaPrecios();

  const impacto = useMemo(() => {
    const idx = listaPreciosIndex(precios);
    const refs: RefPrecio[] = items.map((it) => {
      const fam = refFamilyKey(it.reference);
      const p = idx.get(fam);
      return {
        familia: fam, reference: it.reference, descripcion: it.descripcion,
        cantidad: it.cantidad, landedUnit: it.landed_unit_cop,
        precioLista: p && p.sale > 0 ? p.sale : null,
      };
    });
    return computePriceImpact(refs, { ivaIncluido });
  }, [items, precios, ivaIncluido]);

  const toggleIva = () => {
    setIvaIncluido((v) => {
      const nv = !v;
      try { localStorage.setItem('aluminia_lista_iva_incluido', nv ? '1' : '0'); } catch { /* modo privado */ }
      return nv;
    });
  };

  if (impacto.conPrecio === 0) {
    return (
      <Card>
        <CardContent className="py-4 px-5">
          <div className="flex items-center gap-2 mb-1.5">
            <Tag className="h-4 w-4 text-primary" />
            <h4 className="text-base font-bold tracking-tight">Impacto en tu lista de precios</h4>
          </div>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            Ninguna de las {items.length} referencias del packing tiene precio de venta cargado en el maestro
            de inventario. Cargá <code className="text-xs">sale_price</code> en Inventario y acá vas a ver el
            margen que deja cada una con el costo nuevo.
          </p>
        </CardContent>
      </Card>
    );
  }

  const margen = impacto.margenPonderado;
  const tono = margen == null ? '' : margen >= MARGEN_OBJETIVO ? 'text-success'
    : margen >= MARGEN_RIESGO ? 'text-amber-600 dark:text-amber-400' : 'text-destructive';

  return (
    <Card>
      <CardContent className="py-4 px-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-primary" />
            <h4 className="text-base font-bold tracking-tight">Impacto en tu lista de precios · {label}</h4>
          </div>
          <button type="button" onClick={toggleIva}
            className="text-[11px] text-muted-foreground hover:text-foreground border border-border rounded-full px-2.5 py-1 transition-colors"
            title="Cambia si el precio de lista del maestro está cargado con IVA o sin IVA — define el margen">
            Lista {ivaIncluido ? 'CON' : 'SIN'} IVA · cambiar
          </button>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-border p-3.5">
            <p className="text-[11px] text-muted-foreground">Margen mayorista a lista actual</p>
            <p className={cn('text-[32px] leading-none font-extrabold tabular-nums mt-1', tono)}>{pct1(margen)}</p>
            <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
              objetivo {pct1(MARGEN_OBJETIVO)} (lista armada a costo × 1,18)
            </p>
          </div>
          <div className="rounded-xl border border-border p-3.5">
            <p className="text-[11px] text-muted-foreground">Utilidad que deja el contenedor</p>
            <p className={cn('text-[32px] leading-none font-extrabold tabular-nums mt-1',
              (impacto.utilidadTotal ?? 0) >= 0 ? 'text-success' : 'text-destructive')}>
              {cop(impacto.utilidadTotal)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
              a los precios de hoy, sobre las {impacto.conPrecio} refs con precio cargado
            </p>
          </div>
          <div className="rounded-xl border border-border p-3.5">
            <p className="text-[11px] text-muted-foreground">Ajuste de lista para el objetivo</p>
            <p className={cn('text-[32px] leading-none font-extrabold tabular-nums mt-1',
              impacto.ajusteNecesarioPct == null ? 'text-success' : 'text-destructive')}>
              {impacto.ajusteNecesarioPct == null ? 'ninguno' : `+${impacto.ajusteNecesarioPct.toFixed(1).replace('.', ',')}%`}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
              {impacto.ajusteNecesarioPct == null
                ? 'la lista aguanta este costo — no la bajes'
                : 'lo que habría que subir para volver al margen'}
            </p>
          </div>
        </div>

        {/* Piso de costeo: la misma decisión, vista desde la perilla del SMM */}
        {smmPiso != null && smmActual != null && (
          <div className={cn('rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed',
            smmActual >= smmPiso
              ? 'border-success/30 bg-success/5'
              : 'border-amber-400/50 bg-amber-50/70 dark:bg-amber-950/20')}>
            <b>Piso de costeo {numF(smmPiso)} USD/ton</b> —{' '}
            {smmActual >= smmPiso
              ? `estás costeando a ${numF(smmActual)}, por encima del piso. La lista está protegida contra la próxima reposición.`
              : `estás costeando a ${numF(smmActual)}, por DEBAJO del piso. Preciando así te quedás sin margen cuando llegue el contenedor siguiente a precio de reposición.`}
          </div>
        )}

        {(impacto.enPerdida.length > 0 || impacto.enRiesgo.length > 0) && (
          <div className="flex items-center gap-2 flex-wrap text-[13px]">
            <TrendingDown className="h-4 w-4 text-destructive" />
            {impacto.enPerdida.length > 0 && (
              <Badge variant="outline" className="border-destructive/40 text-destructive text-[11px]">
                {impacto.enPerdida.length} referencia(s) a PÉRDIDA
              </Badge>
            )}
            {impacto.enRiesgo.length > 0 && (
              <Badge variant="outline" className="border-amber-400/50 text-amber-700 dark:text-amber-400 text-[11px]">
                {impacto.enRiesgo.length} con margen bajo {pct1(MARGEN_RIESGO)}
              </Badge>
            )}
            <span className="text-muted-foreground text-[11px]">— ordenadas primero en la tabla</span>
          </div>
        )}

        <button type="button" onClick={() => setVerRefs((v) => !v)}
          className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors">
          <ChevronDown className={cn('h-4 w-4 transition-transform', verRefs && 'rotate-180')} />
          Margen referencia por referencia ({impacto.conPrecio} con precio
          {impacto.sinPrecio > 0 ? `, ${impacto.sinPrecio} sin cargar` : ''})
        </button>

        {verRefs && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/60">
                <tr className="text-left">
                  <th className="px-3 py-2 font-semibold">Ref</th>
                  <th className="px-3 py-2 font-semibold">Descripción</th>
                  <th className="px-3 py-2 font-semibold text-right">Costo nuevo</th>
                  <th className="px-3 py-2 font-semibold text-right">Precio lista{ivaIncluido ? ' (s/IVA)' : ''}</th>
                  <th className="px-3 py-2 font-semibold text-right">Margen</th>
                  <th className="px-3 py-2 font-semibold text-right">Subir a</th>
                </tr>
              </thead>
              <tbody>
                {[...impacto.refs]
                  .filter((r) => r.margen != null)
                  .sort((a, b) => (a.margen ?? 1) - (b.margen ?? 1))
                  .slice(0, 150)
                  .map((r) => (
                    <tr key={r.reference} className={cn('border-t border-border/50 hover:bg-muted/30',
                      r.margen != null && r.margen < 0 && 'bg-destructive/5')}>
                      <td className="px-3 py-1.5 font-mono font-medium">{r.reference}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{r.descripcion ?? '—'}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{cop(r.landedUnit)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{cop(r.precioSinIva)}</td>
                      <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums font-bold',
                        r.margen == null ? '' : r.margen < 0 ? 'text-destructive'
                          : r.margen < MARGEN_RIESGO ? 'text-amber-600 dark:text-amber-400'
                            : r.margen >= MARGEN_OBJETIVO ? 'text-success' : '')}>
                        {pct1(r.margen)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                        {r.ajustePct == null ? '—' : `${cop(r.precioNecesario)} (${pctS(r.ajustePct)})`}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Margen mayorista = (precio sin IVA − costo landed) / precio sin IVA. El costo landed usa la TRM del
          escenario, así que esta tarjeta se mueve con las perillas de arriba. El precio de lista sale del maestro
          de inventario (Siigo), cruzado por familia de color.
        </p>
      </CardContent>
    </Card>
  );
}
