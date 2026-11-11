/**
 * Estado de cuenta de clientes — DATOS (movidos tal cual desde
 * EstadoCuentaClientes.tsx en la renovación de 2026-11-11; sin cambios de
 * lógica). La cartera sale del motor canónico (useCollectionData); acá solo
 * viven los complementos que la pantalla trae aparte: canonicalización de
 * responsables, despachos del año y, al abrir un cliente, sus pagos y
 * remisiones.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { normalizeName, type ClientReceivable } from '@/lib/clientReceivables';
import { isOperativo } from '@/types/transaction';
import { formatCurrency } from './modelo';

/** Paginación estándar (PostgREST corta en 1000 filas EN SILENCIO — H5). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchAllRows<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// ============================================================================
// Canonicalización de responsables — mismo criterio del motor: un cliente
// canónico absorbe a los responsables legacy cuyo nombre o alias normaliza
// igual (responsible_aliases, ambas direcciones). Sin esto, un pago o una
// remisión registrada bajo "Aluminios JH" (alias de "Aluminios del Eje") suma
// en el saldo del motor pero no aparecía en el drill-down ni en Despachado.
// ============================================================================
export interface RespCanonData {
  responsibles: Array<{ id: string; name: string }>;
  aliases: Array<{ responsible_id: string; alias: string }>;
}

export function useRespCanon() {
  const { user } = useAuth();
  return useQuery<RespCanonData>({
    queryKey: ['estado-cuenta-resp-canon', user?.id],
    enabled: !!user,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const [responsibles, aliases] = await Promise.all([
        fetchAllRows<{ id: string; name: string }>((f, t) =>
          supabase.from('responsibles').select('id, name').order('id').range(f, t)),
        fetchAllRows<{ responsible_id: string; alias: string }>((f, t) =>
          (supabase.from('responsible_aliases' as never) as any).select('responsible_id, alias').order('responsible_id').range(f, t))
          .catch(() => [] as Array<{ responsible_id: string; alias: string }>),
      ]);
      return { responsibles, aliases };
    },
  });
}

/** Todos los responsible_id que el motor colapsa en este cliente canónico. */
export function buildClientRespIds(client: ClientReceivable, canon: RespCanonData | undefined): string[] {
  const ids = new Set<string>();
  if (isUuidClient(client.client_id)) ids.add(client.client_id);
  if (!canon) return Array.from(ids);
  const target = new Set<string>([normalizeName(client.client_name)]);
  // Aliases DEL cliente: sus nombres legacy también lo identifican.
  for (const a of canon.aliases) {
    if (ids.has(a.responsible_id)) target.add(normalizeName(a.alias));
  }
  for (const r of canon.responsibles) {
    if (target.has(normalizeName(r.name))) ids.add(r.id);
  }
  for (const a of canon.aliases) {
    if (target.has(normalizeName(a.alias))) ids.add(a.responsible_id);
  }
  return Array.from(ids).sort();
}

export function isUuidClient(clientId: string): boolean {
  return !clientId.startsWith('__');
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ============================================================================
// Despachos (remisiones de venta) del año — para la columna "Despachado".
// Total por remisión = total_manual ?? Σ remision_items.total_cost (fórmula
// canónica de Remisiones.tsx). Se excluyen compras y canceladas; el módulo
// Gerencial solo entra si el usuario está en Gerencial (no filtrar info de
// ese mundo a colaboradores).
// ============================================================================
export interface DespachoRow {
  responsible_id: string | null;
  beneficiary: string;
  total: number;
}

export async function fetchDespachosDelAnio(year: number, includeGerencial: boolean): Promise<DespachoRow[]> {
  const PAGE = 1000;
  const out: DespachoRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = (supabase as any)
      .from('remisiones')
      .select('id, responsible_id, beneficiary, total_manual, remision_type, status, module_origin, remision_items(total_cost)')
      .gte('date', `${year}-01-01`)
      .lte('date', `${year}-12-31`)
      .eq('remision_type', 'venta')
      .neq('status', 'cancelado')
      .order('id')
      .range(from, from + PAGE - 1);
    if (!includeGerencial) q = q.eq('module_origin', 'dian');
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      responsible_id: string | null; beneficiary: string | null; total_manual: number | null;
      remision_items: Array<{ total_cost: number | null }> | null;
    }>;
    for (const r of rows) {
      const itemsTotal = (r.remision_items ?? []).reduce((s, it) => s + Number(it.total_cost ?? 0), 0);
      out.push({
        responsible_id: r.responsible_id,
        beneficiary: r.beneficiary ?? '',
        // Truthy a propósito (así lo hace Remisiones.tsx): total_manual = 0
        // guardado explícito cae a la suma de items, no a $0.
        total: r.total_manual ? Number(r.total_manual) : itemsTotal,
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

// ============================================================================
// Pagos del cliente (lazy, al expandir): transacciones bancarias del año
// atribuibles al cliente por los MISMOS tres caminos del motor (responsible_id
// → invoice_id → invoice_transaction_matches) + efectivo (solo Gerencial).
// Cada pago muestra la factura en la que quedó conciliado.
// ============================================================================
export interface PagoCliente {
  id: string;
  date: string;
  description: string;
  amount: number;
  facturas: string;   // "FV-123" o "FV-123 ($2.5M), FV-124 ($1M)" o ''
  origen: 'banco' | 'efectivo';
}

export function usePagosCliente(client: ClientReceivable, year: number, isGerencial: boolean, enabled: boolean, clientRespIds: string[]) {
  const { user } = useAuth();
  return useQuery<PagoCliente[]>({
    queryKey: ['estado-cuenta-pagos', user?.id, client.client_id, year, isGerencial, clientRespIds.join('|')],
    enabled: enabled && !!user,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const from = `${year}-01-01`;
      const to = `${year}-12-31`;
      const lines = [...client.invoices_pendientes, ...client.invoices_pagadas];
      const invIds = lines.map((l) => l.id);
      const invIdSet: Record<string, true> = {};
      const numberById: Record<string, string> = {};
      for (const l of lines) {
        invIdSet[l.id] = true;
        numberById[l.id] = l.invoice_number || '(s/n)';
      }
      const respSet: Record<string, true> = {};
      for (const id of clientRespIds) respSet[id] = true;
      const norm = normalizeName(client.client_name);

      interface TxRow { id: string; date: string; description: string | null; amount: number; invoice_id: string | null; responsible_id: string | null; movement_nature: string | null }
      const txById: Record<string, TxRow> = {};
      const collect = (rows: unknown[] | null) => {
        for (const r of (rows ?? []) as TxRow[]) txById[r.id] = r;
      };
      const TX_SELECT = 'id, date, description, amount, invoice_id, responsible_id, movement_nature';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const baseFilters = (q: any) => q
        .eq('type', 'ingreso')
        .is('deleted_at', null)
        .gte('date', from)
        .lte('date', to);

      // Candidatos por los CUATRO caminos del motor (unión), y después un
      // filtro EXCLUYENTE con la misma prioridad (responsible → invoice →
      // matches → saldo inicial) para no mostrar pagos que el motor atribuyó
      // a OTRO cliente ni perder los del saldo inicial migrado.

      // Camino 1: responsible_id (canónico + legacy/aliases)
      for (const ids of chunk(clientRespIds, 100)) {
        const { data, error } = await baseFilters(
          supabase.from('transactions').select(TX_SELECT).in('responsible_id', ids),
        );
        if (error) throw error;
        collect(data);
      }

      // Camino 2: invoice_id directo a una factura del cliente
      for (const ids of chunk(invIds, 150)) {
        const { data, error } = await baseFilters(
          supabase.from('transactions').select(TX_SELECT).in('invoice_id', ids),
        );
        if (error) throw error;
        collect(data);
      }

      // Camino 3: invoice_transaction_matches (repartos N:M)
      const matchRows: Array<{ transaction_id: string; invoice_id: string; matched_amount: number }> = [];
      for (const ids of chunk(invIds, 150)) {
        const { data, error } = await supabase
          .from('invoice_transaction_matches')
          .select('transaction_id, invoice_id, matched_amount')
          .in('invoice_id', ids);
        if (error) throw error;
        matchRows.push(...((data ?? []) as typeof matchRows));
      }
      const matchedTxIds: Record<string, true> = {};
      for (const m of matchRows) matchedTxIds[m.transaction_id] = true;

      // Camino 4: initial_balance_matches — ingresos conciliados contra el
      // saldo inicial del cliente (sin responsible ni factura en la tx).
      const ibmTxIds: Record<string, true> = {};
      {
        const { data: details, error: dErr } = await supabase
          .from('initial_state_details')
          .select('id, responsible_id, responsible_name, invoice_id, field_type');
        if (!dErr) {
          const detailIds = ((details ?? []) as Array<{ id: string; responsible_id: string | null; responsible_name: string | null; invoice_id: string | null; field_type: string }>)
            .filter((d) =>
              (d.field_type === 'cuentas_por_cobrar' || d.field_type === 'anticipos_de_clientes') && (
                (d.responsible_id && respSet[d.responsible_id]) ||
                (d.responsible_name && normalizeName(d.responsible_name) === norm) ||
                (d.invoice_id && invIdSet[d.invoice_id])
              ))
            .map((d) => d.id);
          for (const ids of chunk(detailIds, 150)) {
            const { data: ibm, error: iErr } = await (supabase.from('initial_balance_matches' as never) as any)
              .select('transaction_id')
              .in('initial_state_detail_id', ids);
            if (iErr) continue;
            for (const r of (ibm ?? []) as Array<{ transaction_id: string }>) ibmTxIds[r.transaction_id] = true;
          }
        }
      }

      // Traer las txs de matches / saldo inicial que faltan en el pool
      const missingTxIds = [...matchRows.map((m) => m.transaction_id), ...Object.keys(ibmTxIds)]
        .filter((id) => !txById[id]);
      for (const ids of chunk(Array.from(new Set(missingTxIds)), 150)) {
        const { data, error } = await baseFilters(
          supabase.from('transactions').select(TX_SELECT).in('id', ids),
        );
        if (error) throw error;
        collect(data);
      }

      // Filtro excluyente — la MISMA prioridad con la que el motor atribuye
      // cada tx a UN solo cliente (clientReceivables.ts).
      const perteneceAlCliente = (t: TxRow): boolean => {
        if (t.responsible_id) return !!respSet[t.responsible_id];
        if (t.invoice_id) return !!invIdSet[t.invoice_id];
        if (matchedTxIds[t.id]) return true;
        return !!ibmTxIds[t.id];
      };

      const pagos: PagoCliente[] = Object.values(txById)
        .filter((t) => isOperativo(t.movement_nature as never))
        .filter(perteneceAlCliente)
        .map((t) => {
          const partes: string[] = [];
          if (t.invoice_id && numberById[t.invoice_id]) partes.push(numberById[t.invoice_id]);
          for (const m of matchRows) {
            if (m.transaction_id !== t.id) continue;
            const num = numberById[m.invoice_id] ?? '(s/n)';
            if (t.invoice_id === m.invoice_id) continue;
            partes.push(`${num} (${formatCurrency(Number(m.matched_amount))})`);
          }
          if (partes.length === 0 && ibmTxIds[t.id]) partes.push('saldo inicial');
          return {
            id: t.id,
            date: t.date,
            description: t.description ?? '',
            amount: Math.abs(Number(t.amount)),
            facturas: partes.join(', '),
            origen: 'banco' as const,
          };
        });

      // Efectivo del cliente — solo visible en Gerencial (misma regla que
      // Relación de pagos: el saldo lo incluye siempre, las FILAS solo acá).
      // También por responsables legacy/alias, igual que el motor.
      if (isGerencial && clientRespIds.length > 0) {
        for (const ids of chunk(clientRespIds, 100)) {
          const { data, error } = await supabase
            .from('cash_movements')
            .select('id, date, amount, notes')
            .eq('type', 'ingreso')
            .in('responsible_id', ids)
            .gte('date', from)
            .lte('date', to);
          if (error) throw error;
          for (const m of (data ?? []) as Array<{ id: string; date: string; amount: number; notes: string | null }>) {
            pagos.push({
              id: `cash-${m.id}`,
              date: m.date,
              description: (m.notes ?? 'Pago en efectivo').replace(/\[.*?\]/g, '').trim() || 'Pago en efectivo',
              amount: Math.abs(Number(m.amount)),
              facturas: '',
              origen: 'efectivo',
            });
          }
        }
      }

      pagos.sort((a, b) => b.date.localeCompare(a.date));
      return pagos;
    },
  });
}

// ============================================================================
// Remisiones del cliente (lazy, al expandir): despachos del año con su estado
// de facturación (facturada = tiene filas en remision_invoices).
// ============================================================================
export interface RemisionCliente {
  id: string;
  number: string;
  date: string;
  status: string;
  total: number;
  facturas: string; // números de factura vinculados, '' = sin facturar
  gerencial: boolean;
}

export function useRemisionesCliente(client: ClientReceivable, year: number, isGerencial: boolean, enabled: boolean, clientRespIds: string[]) {
  const { user } = useAuth();
  return useQuery<RemisionCliente[]>({
    queryKey: ['estado-cuenta-remisiones', user?.id, client.client_id, year, isGerencial, clientRespIds.join('|')],
    enabled: enabled && !!user && clientRespIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // .in con el set canónico: remisiones registradas bajo el responsable
      // legacy/alias también son de este cliente (consistente con la columna
      // Despachado y con el motor).
      let q = (supabase as any)
        .from('remisiones')
        .select('id, number, date, status, total_manual, module_origin, remision_type, remision_items(total_cost), remision_invoices(invoice_id, invoices(invoice_number))')
        .in('responsible_id', clientRespIds)
        .eq('remision_type', 'venta')
        .neq('status', 'cancelado')
        .gte('date', `${year}-01-01`)
        .lte('date', `${year}-12-31`)
        .order('date', { ascending: false });
      if (!isGerencial) q = q.eq('module_origin', 'dian');
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as Array<{
        id: string; number: string; date: string; status: string; total_manual: number | null; module_origin: string;
        remision_items: Array<{ total_cost: number | null }> | null;
        remision_invoices: Array<{ invoice_id: string; invoices: { invoice_number: string | null } | null }> | null;
      }>).map((r) => ({
        id: r.id,
        number: r.number,
        date: r.date,
        status: r.status,
        total: r.total_manual ? Number(r.total_manual) : (r.remision_items ?? []).reduce((s, it) => s + Number(it.total_cost ?? 0), 0),
        facturas: (r.remision_invoices ?? []).map((ri) => ri.invoices?.invoice_number ?? '(s/n)').join(', '),
        gerencial: r.module_origin === 'gerencial',
      }));
    },
  });
}
