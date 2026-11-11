/**
 * Quiénes pueden ser beneficiario de un movimiento clasificado como VENTAS
 * (Conciliación y pendientes del Dashboard):
 *   · clienteIds     — evidencia comercial: facturas de venta, remisiones de
 *                      venta o cotizaciones (misma regla que derivarRoles).
 *   · usadosEnVentas — terceros que ya fueron beneficiario de un movimiento
 *                      en una categoría de ventas (así entra Nicolás).
 * Un solo fetch cacheado y compartido entre todas las filas.
 *
 * Devuelve un ARRAY plano (el cache persistido es JSON: nada de Set/Map).
 * PAGINADO: PostgREST corta en 1.000 filas en silencio (H5) y las facturas
 * de venta ya pasan de eso.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { clienteIdsDesdeEvidencia, esCategoriaVentas, idsUnicos } from '@/lib/beneficiariosVentas';

type RowId = { responsible_id: string | null };
const db = supabase as never as { from: (t: string) => any };
const PAGE = 1000;

async function fetchIds(build: (from: number, to: number) => any): Promise<RowId[]> {
  const out: RowId[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as RowId[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

export interface ClientesConciliacion {
  clienteIds: string[];
  usadosEnVentas: string[];
}

export async function fetchClientesConciliacion(): Promise<ClientesConciliacion> {
  const { data: cats, error: catsErr } = await db.from('categories').select('id, name');
  if (catsErr) throw catsErr;
  const ventasIds = ((cats ?? []) as { id: string; name: string }[]).filter((c) => esCategoriaVentas(c.name)).map((c) => c.id);

  const [facturasVenta, remisionesVenta, cotizaciones, txVentas] = await Promise.all([
    fetchIds((a, b) => db.from('invoices').select('responsible_id').eq('type', 'venta').not('responsible_id', 'is', null).order('id').range(a, b)),
    fetchIds((a, b) => db.from('remisiones').select('responsible_id').neq('remision_type', 'compra').not('responsible_id', 'is', null).order('id').range(a, b)),
    fetchIds((a, b) => db.from('quotations').select('responsible_id').not('responsible_id', 'is', null).order('id').range(a, b)),
    ventasIds.length
      ? fetchIds((a, b) => db.from('transactions').select('responsible_id').in('category_id', ventasIds).not('responsible_id', 'is', null).is('deleted_at', null).order('id').range(a, b))
      : Promise.resolve([] as RowId[]),
  ]);
  return {
    clienteIds: clienteIdsDesdeEvidencia({ facturasVenta, remisionesVenta, cotizaciones }),
    usadosEnVentas: idsUnicos(txVentas),
  };
}

export function useClientesConciliacion(enabled = true) {
  return useQuery({
    queryKey: ['conciliacion', 'clientes-ventas'],
    queryFn: fetchClientesConciliacion,
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}
