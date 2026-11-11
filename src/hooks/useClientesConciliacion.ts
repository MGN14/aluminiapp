/**
 * Quiénes pueden ser beneficiario de un movimiento clasificado como VENTAS
 * (Conciliación y pendientes del Dashboard):
 *   · evidencia comercial: facturas de venta, remisiones de venta o
 *     cotizaciones (misma regla que derivarRoles);
 *   · rol fijado a mano en Terceros (responsibles.roles_manual): con Cliente
 *     entra aunque no tenga evidencia (los Nicolás); sin Cliente SALE aunque
 *     la tenga. La marca heredada cliente_manual sigue contando para quien
 *     no tenga roles_manual.
 * Un solo fetch cacheado y compartido entre todas las filas.
 *
 * Devuelve ARRAYS planos (el cache persistido es JSON: nada de Set/Map).
 * PAGINADO: PostgREST corta en 1.000 filas en silencio (H5) y las facturas
 * de venta ya pasan de eso.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { aplicarRolesManuales, clienteIdsDesdeEvidencia, type RolManualRow } from '@/lib/beneficiariosVentas';

type RowId = { responsible_id: string | null };
const db = supabase as never as { from: (t: string) => any };
const PAGE = 1000;

async function fetchIds(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<RowId[]> {
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
  /** Lo que ofrece el selector en una fila Ventas: evidencia + rol Cliente a
   *  mano − los que tienen rol a mano sin Cliente. */
  clienteIds: string[];
  /** Los que entran por rol fijado a mano (para mostrarlo/auditarlo). */
  manuales: string[];
}

/**
 * Terceros con algo fijado a mano. Tolerante a migraciones sin aplicar: sin
 * roles_manual (20261111130000) cae a la marca heredada; sin ninguna de las
 * dos columnas, lista vacía y el selector sigue funcionando con la evidencia.
 */
async function fetchRolesManuales(): Promise<RolManualRow[]> {
  const conRoles = await db.from('responsibles')
    .select('id, roles_manual, cliente_manual')
    .eq('active', true)
    .or('roles_manual.not.is.null,cliente_manual.eq.true');
  if (!conRoles.error) return (conRoles.data ?? []) as RolManualRow[];
  const heredada = await db.from('responsibles').select('id, cliente_manual').eq('cliente_manual', true).eq('active', true);
  return heredada.error ? [] : ((heredada.data ?? []) as RolManualRow[]);
}

export async function fetchClientesConciliacion(): Promise<ClientesConciliacion> {
  const [facturasVenta, remisionesVenta, cotizaciones, filasManuales] = await Promise.all([
    fetchIds((a, b) => db.from('invoices').select('responsible_id').eq('type', 'venta').not('responsible_id', 'is', null).order('id').range(a, b)),
    fetchIds((a, b) => db.from('remisiones').select('responsible_id').neq('remision_type', 'compra').not('responsible_id', 'is', null).order('id').range(a, b)),
    fetchIds((a, b) => db.from('quotations').select('responsible_id').not('responsible_id', 'is', null).order('id').range(a, b)),
    fetchRolesManuales(),
  ]);
  const evidencia = clienteIdsDesdeEvidencia({ facturasVenta, remisionesVenta, cotizaciones });
  const { clienteIds, manuales } = aplicarRolesManuales(evidencia, filasManuales);
  return { clienteIds, manuales };
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
