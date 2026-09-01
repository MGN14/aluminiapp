/**
 * Histórico de contenedores con sus precios y la variación de uno al otro
 * (Nico 2026-08-31: "necesito historial de contenedores con sus respectivos
 * precios. variaciones del uno del otro"). Port del `renderHist` del
 * calculador HTML, pero alimentado por los pedidos reales de la app.
 *
 * Cada fila: SMM · TRM efectiva · flete · mercancía USD · total COP sin IVA ·
 * COP/kg · IVA · Δ% contra el contenedor anterior de la cadena.
 */

import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { History } from 'lucide-react';
import { computeImportBreakdown } from '@/lib/importCosting';
import type { PedidoComparable } from '@/lib/importComparison';
import { cop, numF, pctS, sinIva, fleteUsdDe, type PayRow } from './ModuloContenedor';

interface Props {
  /** Ya ordenados cronológicamente (viejo → nuevo). */
  pedidos: PedidoComparable[];
  payRows: PayRow[];
  trmVal: number;
}

export default function HistorialContenedores({ pedidos, payRows, trmVal }: Props) {
  const filas = useMemo(() => {
    const out = pedidos.map((p) => {
      const abonos = payRows.filter((x) => x.import_id === p.id && Number(x.amount_usd) > 0 && Number(x.trm) > 0);
      const pagadoUsd = abonos.reduce((s, a) => s + Number(a.amount_usd), 0);
      const pagadoCop = abonos.reduce((s, a) => s + Number(a.amount_usd) * Number(a.trm), 0);
      const totalUsd = Number(p.monto_total_usd) || 0;
      const cerrado = p.estado === 'entregado' || p.estado === 'cerrado';
      // Cerrado → su TRM real. Abierto → mixta con la TRM del escenario.
      const trmFila = cerrado
        ? (p.trm != null ? Number(p.trm) : null)
        : (totalUsd > 0 ? (pagadoCop + Math.max(0, totalUsd - pagadoUsd) * trmVal) / totalUsd : trmVal);
      const bd = computeImportBreakdown({
        mercanciaUsd: totalUsd,
        costs: p.costs,
        trm: trmFila,
        arancelPct: Number(p.arancel_pct ?? 5),
        ivaPct: Number(p.iva_pct ?? 19),
        cantidadKg: p.cantidad_ton != null ? Number(p.cantidad_ton) * 1000 : null,
        trmMixta: !cerrado && pagadoUsd > 0 ? { pagadoUsd, pagadoCop } : null,
      });
      const total = sinIva(bd);
      const kg = p.cantidad_ton != null ? Number(p.cantidad_ton) * 1000 : null;
      return {
        id: p.id, label: p.label, cerrado,
        smm: p.precio_smm_cerrado_usd_ton != null ? Number(p.precio_smm_cerrado_usd_ton) : null,
        trm: trmFila,
        flete: fleteUsdDe(p.costs),
        mercanciaUsd: totalUsd || null,
        total, iva: bd.ivaCop,
        copKg: total != null && kg ? total / kg : null,
        delta: null as number | null,
      };
    });
    // Δ% contra el anterior de la cadena.
    for (let i = 1; i < out.length; i++) {
      const prev = out[i - 1].total, cur = out[i].total;
      out[i].delta = prev != null && cur != null && prev !== 0 ? (cur / prev - 1) * 100 : null;
    }
    return out;
  }, [pedidos, payRows, trmVal]);

  if (filas.length === 0) return null;

  return (
    <Card>
      <CardContent className="py-4 px-5 space-y-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <h4 className="text-base font-bold tracking-tight">Histórico de contenedores</h4>
          <Badge variant="secondary" className="text-[11px]">{filas.length} contenedores</Badge>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/60">
              <tr className="text-right">
                <th className="px-3 py-2 font-semibold text-left">Contenedor</th>
                <th className="px-3 py-2 font-semibold">SMM<span className="block text-[10px] font-normal text-muted-foreground">USD/TON</span></th>
                <th className="px-3 py-2 font-semibold">TRM<span className="block text-[10px] font-normal text-muted-foreground">efectiva</span></th>
                <th className="px-3 py-2 font-semibold">Flete<span className="block text-[10px] font-normal text-muted-foreground">USD</span></th>
                <th className="px-3 py-2 font-semibold">Mercancía<span className="block text-[10px] font-normal text-muted-foreground">USD</span></th>
                <th className="px-3 py-2 font-semibold">Total COP<span className="block text-[10px] font-normal text-muted-foreground">sin IVA</span></th>
                <th className="px-3 py-2 font-semibold">COP/kg</th>
                <th className="px-3 py-2 font-semibold">IVA</th>
                <th className="px-3 py-2 font-semibold">Δ% vs<span className="block text-[10px] font-normal text-muted-foreground">anterior</span></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-t border-border/50 text-right hover:bg-muted/30">
                  <td className="px-3 py-2 text-left">
                    <span className="font-bold">{f.label}</span>
                    {!f.cerrado && <Badge variant="outline" className="ml-1.5 text-[10px]">proy.</Badge>}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{numF(f.smm)}</td>
                  <td className="px-3 py-2 tabular-nums">{numF(f.trm)}</td>
                  <td className="px-3 py-2 tabular-nums">{numF(f.flete)}</td>
                  <td className="px-3 py-2 tabular-nums">{numF(f.mercanciaUsd)}</td>
                  <td className="px-3 py-2 tabular-nums font-bold">{cop(f.total)}</td>
                  <td className="px-3 py-2 tabular-nums">{numF(f.copKg)}</td>
                  <td className="px-3 py-2 tabular-nums text-amber-700 dark:text-amber-400">{cop(f.iva)}</td>
                  <td className={cn('px-3 py-2 tabular-nums font-bold',
                    f.delta == null ? 'text-muted-foreground' : f.delta <= 0 ? 'text-success' : 'text-destructive')}>
                    {f.delta == null ? '—' : pctS(f.delta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Total sin IVA (el IVA es descontable: caja, no costo). Los cerrados usan su TRM real; los que están en curso,
          lo pagado a sus TRMs + el saldo a la TRM del escenario — muévela arriba y esta tabla se recalcula.
        </p>
      </CardContent>
    </Card>
  );
}
