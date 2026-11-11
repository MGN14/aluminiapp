/**
 * Quiénes pueden ser beneficiario de un movimiento clasificado como VENTAS
 * (Conciliación y pendientes del Dashboard):
 *   · evidencia comercial: facturas de venta, remisiones de venta o
 *     cotizaciones (misma regla que derivarRoles);
 *   · marcados a mano en la ficha ("tratarlo como cliente en Ventas",
 *     responsibles.cliente_manual) — la excepción explícita para los Nicolás.
 * Un solo fetch cacheado y compartido entre todas las filas.
 *
 * Devuelve ARRAYS planos (el cache persistido es JSON: nada de Set/Map).
 * PAGINADO: PostgREST corta en 1.000 filas en silencio (H5) y las facturas
 * de venta ya pasan de eso.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { clienteIdsDesdeEvidencia } from '@/lib/beneficiariosVentas';

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
  /** Evidencia ∪ marcados a mano: lo que ofrece el selector en una fila Ventas. */
  clienteIds: string[];
  /** Solo los marcados a mano (para mostrarlo/auditarlo). */
  manuales: string[];
}

export async function fetchClientesConciliacion(): Promise<ClientesConciliacion> {
  const [facturasVenta, remisionesVenta, cotizaciones, manualesRes] = await Promise.all([
    fetchIds((a, b) => db.from('invoices').select('responsible_id').eq('type', 'venta').not('responsible_id', 'is', null).order('id').range(a, b)),
    fetchIds((a, b) => db.from('remisiones').select('responsible_id').neq('remision_type', 'compra').not('responsible_id', 'is', null).order('id').range(a, b)),
    fetchIds((a, b) => db.from('quotations').select('responsible_id').not('responsible_id', 'is', null).order('id').range(a, b)),
    // Tolerante: si la migración de cliente_manual no está aplicada todavía,
    // la columna no existe y esta consulta falla → sin marcados a mano, el
    // resto del selector sigue funcionando.
    db.from('responsibles').select('id').eq('cliente_manual', true).eq('active', true),
  ]);
  const manuales = manualesRes.error
    ? []
    : ((manualesRes.data ?? []) as { id: string }[]).map((r) => r.id).sort();
  const evidencia = clienteIdsDesdeEvidencia({ facturasVenta, remisionesVenta, cotizaciones });
  return { clienteIds: [...new Set([...evidencia, ...manuales])].sort(), manuales };
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
