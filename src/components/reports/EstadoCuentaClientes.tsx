/**
 * Estado de cuenta de clientes — módulo unificado que reemplaza en el menú a
 * Anticipos + Módulo de Cobranza + Relación de pagos (Nico 2026-09-01).
 *
 * Tres estados por cliente derivados del MISMO motor canónico de cartera
 * (calculateAllClientReceivables vía useCollectionData — el que usan Cobranza,
 * el score IA, los emails y Wompi; acá NO se re-deriva ninguna fórmula, para
 * que jamás haya descuadre entre módulos):
 *   saldo_neto > 0  → Cuentas por cobrar (te deben)
 *   saldo_neto < 0  → Anticipo vivo (le debés factura)
 *   saldo_neto ≈ 0  → Al día
 *
 * Las pantallas viejas NO se borran — quedan como sub-vistas enlazadas desde
 * acá (compartir PDF/WhatsApp/email vive en Relación de pagos; conciliar
 * anticipos iniciales vive en Anticipos; aging + scores IA en Cobranza).
 */
import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import writeXlsxFile from 'write-excel-file';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useModuleContext } from '@/hooks/useModuleContext';
import { useCollectionData, useInvalidateCollection } from '@/hooks/useCollectionData';
import { normalizeName, type ClientReceivable, type InvoiceLine } from '@/lib/clientReceivables';
import { findLikelyDuplicateClients, type DuplicatePair } from '@/lib/duplicateClients';
import { isOperativo } from '@/types/transaction';
import { useToast } from '@/hooks/use-toast';
import { parseLocalDate } from '@/lib/dateUtils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  HandCoins, Wallet, CheckCircle2, ChevronDown, ChevronRight, Search, Download,
  AlertCircle, Loader2, Share2, Truck, Banknote, ExternalLink, ShieldQuestion,
  GitMerge, X,
} from 'lucide-react';
import { ClientDrilldown } from './AccountsReceivableReport';
import VincularPagoModal from './VincularPagoModal';
import AcordarPagoModal from '@/components/expected-payments/AcordarPagoModal';
import PaymentLinkModal from '@/components/collection/PaymentLinkModal';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Math.round(value));
}

/** Mensaje legible de CUALQUIER error — los de Supabase (PostgrestError) son
 *  objetos planos, no instancias de Error: `instanceof Error` los tapaba y el
 *  usuario veía "Error desconocido" en vez de la causa real. */
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const partes = [e.message, e.details, e.hint, e.code ? `(${e.code})` : null].filter(Boolean);
    if (partes.length) return partes.join(' — ');
  }
  return String(err);
}

const currentYear = new Date().getFullYear();
const availableYears = Array.from({ length: 5 }, (_, i) => currentYear - i);

/** Saldos < $1 se consideran al día (residuos por decimales de retención). */
const EPSILON = 1;

type EstadoFilter = 'todos' | 'cxc' | 'anticipos' | 'aldia';

// Corte ESTRICTO (>0 / <0), idéntico al motor y a Cobranza: así la card, el
// conteo, el filtro y el export cuadran al peso con total_saldo_pendiente /
// total_saldo_a_favor. Con epsilon acá, un cliente con saldo $0.60 entraba a
// la card pero no al export.
function estadoDe(c: ClientReceivable): Exclude<EstadoFilter, 'todos'> {
  if (c.saldo_neto > 0) return 'cxc';
  if (c.saldo_neto < 0) return 'anticipos';
  return 'aldia';
}

/** Días de mora de la factura pendiente más vencida. Regla y parseo de fechas
 *  idénticos a agingBuckets.ts (new Date UTC + dias_credito > 0) para que el
 *  chip coincida con los buckets de Cobranza. */
function worstOverdueDays(c: ClientReceivable): number {
  const now = Date.now();
  let worst = 0;
  for (const inv of c.invoices_pendientes) {
    let venc: Date;
    if (inv.due_date) {
      venc = new Date(inv.due_date);
    } else if (inv.dias_credito && inv.dias_credito > 0) {
      venc = new Date(inv.issue_date);
      venc.setDate(venc.getDate() + inv.dias_credito);
    } else {
      venc = new Date(inv.issue_date);
    }
    const days = Math.floor((now - venc.getTime()) / 86_400_000);
    if (days > worst) worst = days;
  }
  return worst;
}

/** Paginación estándar (PostgREST corta en 1000 filas EN SILENCIO — H5). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllRows<T>(build: (from: number, to: number) => any): Promise<T[]> {
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
interface RespCanonData {
  responsibles: Array<{ id: string; name: string }>;
  aliases: Array<{ responsible_id: string; alias: string }>;
}

function useRespCanon() {
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
function buildClientRespIds(client: ClientReceivable, canon: RespCanonData | undefined): string[] {
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

function isUuidClient(clientId: string): boolean {
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
interface DespachoRow {
  responsible_id: string | null;
  beneficiary: string;
  total: number;
}

async function fetchDespachosDelAnio(year: number, includeGerencial: boolean): Promise<DespachoRow[]> {
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
interface PagoCliente {
  id: string;
  date: string;
  description: string;
  amount: number;
  facturas: string;   // "FV-123" o "FV-123 ($2.5M), FV-124 ($1M)" o ''
  origen: 'banco' | 'efectivo';
}

function usePagosCliente(client: ClientReceivable, year: number, isGerencial: boolean, enabled: boolean, clientRespIds: string[]) {
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
interface RemisionCliente {
  id: string;
  number: string;
  date: string;
  status: string;
  total: number;
  facturas: string; // números de factura vinculados, '' = sin facturar
  gerencial: boolean;
}

function useRemisionesCliente(client: ClientReceivable, year: number, isGerencial: boolean, enabled: boolean, clientRespIds: string[]) {
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

// ============================================================================
// Componente principal
// ============================================================================
const DUP_DISMISSED_KEY = 'aluminia.estadoCuenta.dupDismissed.v1';

function loadDismissedPairs(): string[] {
  try {
    const raw = localStorage.getItem(DUP_DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function pairKey(p: DuplicatePair): string {
  return [p.a.client_id, p.b.client_id].sort().join('|');
}

export default function EstadoCuentaClientes() {
  const { user } = useAuth();
  const { isGerencial } = useModuleContext();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [year, setYear] = useState(currentYear);
  const [estado, setEstado] = useState<EstadoFilter>('todos');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showPagadasByClient, setShowPagadasByClient] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  // Unión de posibles duplicados (mismo tercero con dos nombres).
  const [mergePair, setMergePair] = useState<DuplicatePair | null>(null);
  const [merging, setMerging] = useState(false);
  const [dismissedPairs, setDismissedPairs] = useState<string[]>(loadDismissedPairs);

  // Modales de acción por factura — mismos de Cobranza, mismo cableado.
  const [vincularInvoice, setVincularInvoice] = useState<{ id: string; invoice_number: string; counterparty_name: string | null; pending: number; total_amount: number } | null>(null);
  const [paymentLinkInvoice, setPaymentLinkInvoice] = useState<{ id: string; invoice_number: string | null; counterparty_name: string | null; pending: number } | null>(null);
  const [acordarTarget, setAcordarTarget] = useState<{
    invoice?: { id: string; invoice_number: string; pending: number };
    responsible?: { id: string; name: string };
  } | null>(null);

  const queryClient = useQueryClient();
  const { data: cd, isLoading, refetch } = useCollectionData(year);
  const invalidateCollection = useInvalidateCollection();
  const data = cd?.receivables ?? null;
  const onMutated = () => {
    invalidateCollection();
    // Las queries propias del módulo también quedan viejas al vincular un
    // pago: sin esto el Saldo de la fila se actualizaba pero la lista de
    // pagos de abajo seguía mostrando el estado anterior por 5 minutos.
    queryClient.invalidateQueries({ queryKey: ['estado-cuenta-pagos'] });
    queryClient.invalidateQueries({ queryKey: ['estado-cuenta-remisiones'] });
    queryClient.invalidateQueries({ queryKey: ['estado-cuenta-despachos'] });
    refetch();
  };

  // NITs para la tabla y el export formato contador (paginado — H5: los
  // responsables se auto-crean desde facturas y pueden superar 1000).
  const { data: nits } = useQuery<Array<{ id: string; nit: string | null }>>({
    queryKey: ['estado-cuenta-nits', user?.id],
    enabled: !!user,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      try {
        return await fetchAllRows<{ id: string; nit: string | null }>((f, t) =>
          supabase.from('responsibles').select('id, nit' as never).order('id').range(f, t));
      } catch (err) {
        console.warn('No se pudieron cargar los NITs:', err);
        return [];
      }
    },
  });

  // Responsables + aliases para canonicalizar (pagos, efectivo y despachos
  // de responsables legacy caen al cliente canónico, igual que en el motor).
  const { data: respCanon } = useRespCanon();

  // Despachos del año (columna "Despachado") — informativo, NO entra al saldo.
  const { data: despachos } = useQuery<DespachoRow[]>({
    queryKey: ['estado-cuenta-despachos', user?.id, year, isGerencial],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: () => fetchDespachosDelAnio(year, isGerencial),
  });

  const clients = useMemo(() => data?.clients ?? [], [data]);

  const nitById = useMemo(() => {
    const idx: Record<string, string> = {};
    for (const r of nits ?? []) if (r.nit) idx[r.id] = r.nit;
    return idx;
  }, [nits]);

  // responsible_ids que cada cliente canónico absorbe (incluye legacy/alias).
  const respIdsByClient = useMemo(() => {
    const idx: Record<string, string[]> = {};
    for (const c of clients) idx[c.client_id] = buildClientRespIds(c, respCanon);
    return idx;
  }, [clients, respCanon]);

  // Despachado por cliente: cruza por responsible_id CANONICALIZADO (una
  // remisión del responsable legacy suma al cliente canónico, igual que el
  // motor) y, si la remisión vieja no tiene responsable, por nombre
  // normalizado del beneficiario. Lo que no matchea ningún cliente se
  // reporta aparte — no se pierde en silencio.
  const { despachadoByClient, despachadoSinCliente } = useMemo(() => {
    const byId: Record<string, number> = {};
    let sinCliente = 0;
    if (!despachos?.length) return { despachadoByClient: byId, despachadoSinCliente: 0 };
    const respToClient: Record<string, string> = {};
    const clientByNorm: Record<string, string> = {};
    for (const c of clients) {
      clientByNorm[normalizeName(c.client_name)] = c.client_id;
      for (const rid of respIdsByClient[c.client_id] ?? []) {
        if (!respToClient[rid]) respToClient[rid] = c.client_id;
      }
    }
    for (const d of despachos) {
      const target =
        (d.responsible_id && respToClient[d.responsible_id]) ||
        (d.beneficiary && clientByNorm[normalizeName(d.beneficiary)]) ||
        null;
      if (target) byId[target] = (byId[target] ?? 0) + d.total;
      else sinCliente += d.total;
    }
    return { despachadoByClient: byId, despachadoSinCliente: sinCliente };
  }, [despachos, clients, respIdsByClient]);

  const counts = useMemo(() => ({
    cxc: clients.filter((c) => estadoDe(c) === 'cxc').length,
    anticipos: clients.filter((c) => estadoDe(c) === 'anticipos').length,
    aldia: clients.filter((c) => estadoDe(c) === 'aldia').length,
  }), [clients]);

  const filtered = useMemo(() => {
    let list = clients;
    if (estado !== 'todos') list = list.filter((c) => estadoDe(c) === estado);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((c) =>
        c.client_name.toLowerCase().includes(q) ||
        (nitById[c.client_id] ?? '').includes(q));
    }
    const sorted = [...list];
    if (estado === 'anticipos') sorted.sort((a, b) => a.saldo_neto - b.saldo_neto);
    else if (estado === 'aldia') sorted.sort((a, b) => b.facturado_venta - a.facturado_venta);
    else sorted.sort((a, b) => Math.abs(b.saldo_neto) - Math.abs(a.saldo_neto));
    return sorted;
  }, [clients, estado, search, nitById]);

  const sinConciliar = data?.sin_conciliar ?? { count: 0, monto: 0 };

  // Posibles duplicados: mismo tercero con dos nombres (el creado al
  // remisionar "como lo conocemos" vs la razón social que llega al facturar).
  const duplicados = useMemo(
    () => findLikelyDuplicateClients(clients).filter((p) => !dismissedPairs.includes(pairKey(p))),
    [clients, dismissedPairs],
  );

  const dismissPair = (p: DuplicatePair) => {
    const next = [...dismissedPairs, pairKey(p)];
    setDismissedPairs(next);
    try { localStorage.setItem(DUP_DISMISSED_KEY, JSON.stringify(next)); } catch { /* modo privado */ }
  };

  /** Ejecuta la unión real (RPC merge_responsibles: reasigna todo y absorbe
   *  el otro como alias). canonicalId = el nombre que queda. */
  const unirPar = async (pair: DuplicatePair, canonicalId: string) => {
    const legacy = pair.a.client_id === canonicalId ? pair.b : pair.a;
    setMerging(true);
    try {
      const { error } = await (supabase.rpc as any)('merge_responsibles', {
        p_legacy_id: legacy.client_id,
        p_canonical_id: canonicalId,
      });
      if (error) throw error;
      const canonical = pair.a.client_id === canonicalId ? pair.a : pair.b;
      toast({
        title: 'Beneficiarios unidos',
        description: `"${legacy.client_name}" quedó absorbido en "${canonical.client_name}" — facturas, pagos, remisiones y cotizaciones reasignadas.`,
      });
      setMergePair(null);
      queryClient.invalidateQueries({ queryKey: ['estado-cuenta-resp-canon'] });
      queryClient.invalidateQueries({ queryKey: ['estado-cuenta-nits'] });
      onMutated();
    } catch (err) {
      console.error('merge_responsibles falló:', err);
      toast({
        title: 'No se pudo unir',
        description: errMsg(err),
        variant: 'destructive',
      });
    } finally {
      setMerging(false);
    }
  };

  const togglePagadas = (clientId: string) => {
    setShowPagadasByClient((prev) =>
      prev.includes(clientId) ? prev.filter((id) => id !== clientId) : [...prev, clientId]);
  };

  /** Compartir estado de cuenta: Relación de pagos ya tiene PDF + WhatsApp +
   *  email con remisión adjunta — le dejamos el cliente preseleccionado vía
   *  sus filtros persistidos y navegamos allá. */
  const compartirCliente = (c: ClientReceivable) => {
    try {
      const raw = localStorage.getItem('aluminia.paymentsLog.filters.v1');
      const prev = raw ? JSON.parse(raw) : {};
      localStorage.setItem('aluminia.paymentsLog.filters.v1', JSON.stringify({
        ...prev, counterparty: c.client_name.trim(), typeFilter: 'ingreso', year, month: 0,
      }));
    } catch { /* modo privado: igual navegamos, el usuario elige el cliente allá */ }
    navigate('/reportes/relacion-pagos');
  };

  /** Export en el formato del contador: secciones CUENTAS X COBRAR y ANTICIPOS
   *  con NIT, nombre y valor — cuadre directo contra su Excel. */
  const exportContador = async () => {
    setExporting(true);
    try {
      const cxcRows = clients.filter((c) => estadoDe(c) === 'cxc').sort((a, b) => b.saldo_neto - a.saldo_neto);
      const antRows = clients.filter((c) => estadoDe(c) === 'anticipos').sort((a, b) => a.saldo_neto - b.saldo_neto);
      // Totales = Σ de las filas YA redondeadas: si el contador suma la
      // columna en Excel, le cuadra al centavo con la cabecera.
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const totalCxc = r2(cxcRows.reduce((s, c) => s + r2(c.saldo_neto), 0));
      const totalAnt = r2(antRows.reduce((s, c) => s + r2(Math.abs(c.saldo_neto)), 0));

      type XRow = Array<{ value: string | number; fontWeight?: 'bold'; type?: typeof Number }>;
      const cell = (value: string | number, bold = false) =>
        typeof value === 'number'
          ? { value, type: Number, fontWeight: bold ? ('bold' as const) : undefined }
          : { value, fontWeight: bold ? ('bold' as const) : undefined };

      const rows: XRow[] = [
        [cell(''), cell(''), cell('CUENTAS X COBRAR', true), cell(totalCxc, true)],
        ...cxcRows.map((c) => [
          cell('Clientes nacionales'),
          cell(nitById[c.client_id] ?? ''),
          cell(c.client_name),
          cell(Math.round(c.saldo_neto * 100) / 100),
        ]),
        [cell(''), cell(''), cell(''), cell('')],
        [cell(''), cell(''), cell('ANTICIPOS', true), cell(totalAnt, true)],
        ...antRows.map((c) => [
          cell('De clientes'),
          cell(nitById[c.client_id] ?? ''),
          cell(c.client_name),
          cell(Math.round(Math.abs(c.saldo_neto) * 100) / 100),
        ]),
      ];
      await writeXlsxFile(rows as never, {
        fileName: `estado-cuenta-clientes-${year}.xlsx`,
        columns: [{ width: 20 }, { width: 14 }, { width: 42 }, { width: 18 }],
      } as never);
    } finally {
      setExporting(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Header: año + export */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-28 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableYears.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar cliente o NIT..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-8 w-56"
              />
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={exportContador} disabled={exporting || isLoading}>
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Exportar formato contador
          </Button>
        </div>

        {/* 3 estados — cards clickeables que filtran la tabla */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => setEstado(estado === 'cxc' ? 'todos' : 'cxc')}
            className={cn(
              'text-left rounded-xl border p-4 transition-colors',
              estado === 'cxc' ? 'border-destructive bg-destructive/5 ring-1 ring-destructive/30' : 'border-border bg-card hover:bg-muted/30',
            )}
          >
            <div className="flex items-center gap-2 text-xs font-medium text-destructive">
              <HandCoins className="h-3.5 w-3.5" />
              Cuentas por cobrar
            </div>
            <p className="text-xl font-bold mt-1">{formatCurrency(data?.total_saldo_pendiente ?? 0)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{counts.cxc} cliente{counts.cxc === 1 ? '' : 's'} te deben</p>
            <Link
              to="/reportes/cuentas-por-cobrar"
              onClick={(e) => e.stopPropagation()}
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              Cobranza completa (aging + scores IA) <ExternalLink className="h-2.5 w-2.5" />
            </Link>
          </button>

          <button
            type="button"
            onClick={() => setEstado(estado === 'anticipos' ? 'todos' : 'anticipos')}
            className={cn(
              'text-left rounded-xl border p-4 transition-colors',
              estado === 'anticipos' ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-card hover:bg-muted/30',
            )}
          >
            <div className="flex items-center gap-2 text-xs font-medium text-primary">
              <Wallet className="h-3.5 w-3.5" />
              Anticipos vivos
            </div>
            <p className="text-xl font-bold mt-1">{formatCurrency(data?.total_saldo_a_favor ?? 0)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{counts.anticipos} cliente{counts.anticipos === 1 ? '' : 's'} con saldo a favor — les debés factura</p>
            <Link
              to="/reportes/anticipos"
              onClick={(e) => e.stopPropagation()}
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              Conciliar anticipos iniciales <ExternalLink className="h-2.5 w-2.5" />
            </Link>
          </button>

          <button
            type="button"
            onClick={() => setEstado(estado === 'aldia' ? 'todos' : 'aldia')}
            className={cn(
              'text-left rounded-xl border p-4 transition-colors',
              estado === 'aldia' ? 'border-success bg-success/5 ring-1 ring-success/30' : 'border-border bg-card hover:bg-muted/30',
            )}
          >
            <div className="flex items-center gap-2 text-xs font-medium text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Al día
            </div>
            <p className="text-xl font-bold mt-1">{counts.aldia} cliente{counts.aldia === 1 ? '' : 's'}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Saldo en cero — facturado y pagado cuadran</p>
          </button>
        </div>

        {/* KPI de confianza: ingresos sin cliente atribuible */}
        {sinConciliar.count > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
            <ShieldQuestion className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <p className="text-muted-foreground">
              <span className="font-semibold text-foreground">{formatCurrency(sinConciliar.monto)}</span> en {sinConciliar.count} ingreso{sinConciliar.count === 1 ? '' : 's'} del año sin cliente identificable — la cartera puede estar sobrestimada hasta por ese monto.{' '}
              <Link to="/transactions" className="text-primary hover:underline">Conciliar ahora →</Link>
            </p>
          </div>
        )}

        {/* Posibles duplicados: el cliente creado al remisionar vs el que
            crea la facturación — unir con un clic (RPC merge_responsibles). */}
        {duplicados.length > 0 && (
          <div className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 space-y-1.5">
            <p className="text-xs font-semibold flex items-center gap-1.5">
              <GitMerge className="h-3.5 w-3.5 text-warning" />
              Estos parecen el MISMO cliente con dos nombres:
            </p>
            {duplicados.map((p) => {
              const ambosUuid = isUuidClient(p.a.client_id) && isUuidClient(p.b.client_id);
              return (
                <div key={pairKey(p)} className="flex items-center gap-2 text-xs flex-wrap">
                  <span className="font-medium">{p.a.client_name}</span>
                  <span className="text-muted-foreground">↔</span>
                  <span className="font-medium">{p.b.client_name}</span>
                  <span className="text-[10px] text-muted-foreground">({Math.round(p.score * 100)}% parecido)</span>
                  {ambosUuid ? (
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] gap-1" onClick={() => setMergePair(p)}>
                      <GitMerge className="h-3 w-3" />
                      Unir
                    </Button>
                  ) : (
                    <span className="text-[10px] text-muted-foreground italic">
                      uno no tiene tercero creado — asignale el beneficiario a sus facturas en Conciliación y quedan unidos
                    </span>
                  )}
                  <button
                    className="text-muted-foreground hover:text-destructive"
                    title="No son el mismo — no volver a mostrar"
                    onClick={() => dismissPair(p)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Tabla por cliente */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/80">
                    <TableHead className="w-8" />
                    <TableHead className="font-semibold">Cliente</TableHead>
                    <TableHead className="font-semibold text-right">
                      <Tooltip>
                        <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-2">Despachado</TooltipTrigger>
                        <TooltipContent side="top" className="max-w-64 text-xs">
                          Remisiones de venta del año (no canceladas). Informativo: el saldo se calcula contra lo FACTURADO. Si despachado &gt; facturado, hay plata en tránsito sin facturar.
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead className="font-semibold text-right">Facturado</TableHead>
                    <TableHead className="font-semibold text-right">
                      <Tooltip>
                        <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-2">Pagos y desc.</TooltipTrigger>
                        <TooltipContent side="top" className="max-w-64 text-xs">
                          Banco + efectivo + anticipos + retenciones (retefuente, reteICA, autorete). Facturado − esto = Saldo, exacto. El desglose completo está al expandir la fila.
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    <TableHead className="font-semibold text-right">Saldo</TableHead>
                    <TableHead className="font-semibold text-center">Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                        Calculando estado de cuenta...
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12">
                        <div className="flex flex-col items-center gap-2">
                          <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
                          <p className="text-muted-foreground text-sm">
                            {search ? 'Ningún cliente coincide con la búsqueda.' : 'Sin clientes en este estado para ' + year + '.'}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((c) => (
                      <EstadoRow
                        key={c.client_id}
                        client={c}
                        year={year}
                        isGerencial={isGerencial}
                        nit={nitById[c.client_id] ?? null}
                        despachado={despachadoByClient[c.client_id] ?? 0}
                        clientRespIds={respIdsByClient[c.client_id] ?? []}
                        isExpanded={expanded === c.client_id}
                        onToggle={() => setExpanded(expanded === c.client_id ? null : c.client_id)}
                        showPagadas={showPagadasByClient.includes(c.client_id)}
                        onTogglePagadas={() => togglePagadas(c.client_id)}
                        onCompartir={() => compartirCliente(c)}
                        onVincularInvoice={(inv) => setVincularInvoice({
                          id: inv.id,
                          invoice_number: inv.invoice_number,
                          counterparty_name: c.client_name,
                          pending: inv.effective_pending,
                          total_amount: inv.total_amount,
                        })}
                        onAcordarInvoice={(inv) => setAcordarTarget({
                          invoice: { id: inv.id, invoice_number: inv.invoice_number, pending: inv.effective_pending },
                          responsible: isUuidClient(c.client_id) ? { id: c.client_id, name: c.client_name } : undefined,
                        })}
                        onLinkPagoInvoice={(inv) => setPaymentLinkInvoice({
                          id: inv.id,
                          invoice_number: inv.invoice_number,
                          counterparty_name: c.client_name,
                          pending: inv.effective_pending,
                        })}
                        onAcordarCliente={() => setAcordarTarget({
                          responsible: isUuidClient(c.client_id) ? { id: c.client_id, name: c.client_name } : undefined,
                        })}
                      />
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {despachadoSinCliente > 1 && (
          <p className="text-[11px] text-muted-foreground">
            Despachos del año sin cliente identificable: {formatCurrency(despachadoSinCliente)} — remisiones sin tercero asignado.{' '}
            <Link to="/remisiones" className="text-primary hover:underline">Ver remisiones →</Link>
          </p>
        )}

        <VincularPagoModal
          open={!!vincularInvoice}
          onOpenChange={(v) => { if (!v) setVincularInvoice(null); }}
          invoice={vincularInvoice}
          onSuccess={onMutated}
        />
        <AcordarPagoModal
          open={!!acordarTarget}
          onOpenChange={(v) => { if (!v) setAcordarTarget(null); }}
          invoice={acordarTarget?.invoice ?? null}
          responsible={acordarTarget?.responsible ?? null}
          onSuccess={onMutated}
        />
        <PaymentLinkModal
          open={!!paymentLinkInvoice}
          onOpenChange={(v) => { if (!v) setPaymentLinkInvoice(null); }}
          invoice={paymentLinkInvoice}
        />

        {/* Unión de duplicados: elegir cuál nombre queda como principal */}
        <AlertDialog open={!!mergePair} onOpenChange={(o) => { if (!o && !merging) setMergePair(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <GitMerge className="h-4 w-4 text-warning" />
                Unir beneficiarios
              </AlertDialogTitle>
              <AlertDialogDescription>
                Se juntan facturas, pagos, remisiones, cotizaciones y saldos de los dos
                en UNO solo — el otro queda como alias para siempre. Elegí cuál nombre
                sobrevive:
              </AlertDialogDescription>
            </AlertDialogHeader>
            {mergePair && (
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start h-auto py-2 text-left"
                  disabled={merging}
                  onClick={() => unirPar(mergePair, mergePair.a.client_id)}
                >
                  {merging ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-2 text-success" />}
                  Dejar «{mergePair.a.client_name}»
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start h-auto py-2 text-left"
                  disabled={merging}
                  onClick={() => unirPar(mergePair, mergePair.b.client_id)}
                >
                  {merging ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-2 text-success" />}
                  Dejar «{mergePair.b.client_name}»
                </Button>
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={merging}>Cancelar</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}

// ============================================================================
// Fila por cliente + drill-down (facturas vía ClientDrilldown compartido con
// Cobranza + pagos con su factura + remisiones + compartir).
// ============================================================================
interface EstadoRowProps {
  client: ClientReceivable;
  year: number;
  isGerencial: boolean;
  nit: string | null;
  despachado: number;
  /** responsible_ids que el motor colapsa en este cliente (canónico + legacy/alias). */
  clientRespIds: string[];
  isExpanded: boolean;
  onToggle: () => void;
  showPagadas: boolean;
  onTogglePagadas: () => void;
  onCompartir: () => void;
  onVincularInvoice: (inv: InvoiceLine) => void;
  onAcordarInvoice: (inv: InvoiceLine) => void;
  onLinkPagoInvoice: (inv: InvoiceLine) => void;
  onAcordarCliente: () => void;
}

function EstadoRow({ client, year, isGerencial, nit, despachado, clientRespIds, isExpanded, onToggle, showPagadas, onTogglePagadas, onCompartir, onVincularInvoice, onAcordarInvoice, onLinkPagoInvoice, onAcordarCliente }: EstadoRowProps) {
  const est = estadoDe(client);
  const overdue = est === 'cxc' ? worstOverdueDays(client) : 0;
  const facturado = client.facturado_venta + client.cxc_inicial;
  // Incluye retenciones para que Facturado − esta columna = Saldo, EXACTO
  // (el motor las resta del saldo; sin sumarlas acá la resta a mano no daba).
  const cobrado = client.cobrado_banco + client.cobrado_efectivo + client.anticipos_total + client.retenciones_total;
  const sinFacturar = despachado - client.facturado_venta;

  const pagosQ = usePagosCliente(client, year, isGerencial, isExpanded, clientRespIds);
  const remisionesQ = useRemisionesCliente(client, year, isGerencial, isExpanded, clientRespIds);

  return (
    <React.Fragment>
      <TableRow
        className={cn('cursor-pointer hover:bg-muted/50', isExpanded && 'bg-muted/30 border-l-2 border-l-primary')}
        onClick={onToggle}
      >
        <TableCell className="w-8 px-2">
          {isExpanded ? <ChevronDown className="h-4 w-4 text-primary" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </TableCell>
        <TableCell>
          <p className="text-sm font-medium">{client.client_name}</p>
          {nit && <p className="text-[10px] text-muted-foreground font-mono">{nit}</p>}
        </TableCell>
        <TableCell className="text-right text-sm tabular-nums">
          {despachado > 1 ? (
            <div>
              <span>{formatCurrency(despachado)}</span>
              {sinFacturar > EPSILON && (
                <p className="text-[10px] text-warning">sin facturar {formatCurrency(sinFacturar)}</p>
              )}
            </div>
          ) : <span className="text-muted-foreground">—</span>}
        </TableCell>
        <TableCell className="text-right text-sm tabular-nums">
          {formatCurrency(facturado)}
          {client.cxc_inicial > 0 && (
            <p className="text-[10px] text-muted-foreground">incl. inicial {formatCurrency(client.cxc_inicial)}</p>
          )}
        </TableCell>
        <TableCell className="text-right text-sm tabular-nums text-success">
          {formatCurrency(cobrado)}
          {client.retenciones_total > 0 && (
            <p className="text-[10px] text-muted-foreground">incl. ret. {formatCurrency(client.retenciones_total)}</p>
          )}
        </TableCell>
        <TableCell className={cn(
          'text-right text-sm tabular-nums font-bold',
          est === 'cxc' && 'text-destructive',
          est === 'anticipos' && 'text-primary',
          est === 'aldia' && 'text-success',
        )}>
          {formatCurrency(client.saldo_neto)}
        </TableCell>
        <TableCell className="text-center">
          <div className="flex flex-col items-center gap-0.5">
            {est === 'cxc' && (
              <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">Te debe</Badge>
            )}
            {est === 'anticipos' && (
              <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">Anticipo</Badge>
            )}
            {est === 'aldia' && (
              <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/30">Al día</Badge>
            )}
            {overdue > 30 && (
              <span className={cn('text-[9px]', overdue > 90 ? 'text-destructive' : 'text-warning')}>
                vencida {overdue}d
              </span>
            )}
          </div>
        </TableCell>
      </TableRow>

      {isExpanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={7} className="p-0">
            <div className="space-y-0">
              <ClientDrilldown
                client={client}
                showPagadas={showPagadas}
                onTogglePagadas={onTogglePagadas}
                onVincularInvoice={onVincularInvoice}
                onAcordarInvoice={onAcordarInvoice}
                onLinkPagoInvoice={onLinkPagoInvoice}
                onAcordarCliente={onAcordarCliente}
              />

              {/* Pagos del año con su factura conciliada */}
              <div className="bg-muted/10 border-l-2 border-l-primary px-6 pb-4 space-y-2">
                <p className="text-sm font-semibold text-foreground flex items-center gap-2 pt-1">
                  <Banknote className="h-4 w-4 text-success" />
                  Pagos {year} ({pagosQ.data?.length ?? '...'})
                </p>
                {pagosQ.isLoading ? (
                  <p className="text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin inline mr-1" />Buscando pagos...</p>
                ) : !pagosQ.data?.length ? (
                  <p className="text-xs text-muted-foreground italic">Sin pagos registrados en {year}.</p>
                ) : (
                  <div className="space-y-1">
                    {pagosQ.data.slice(0, 30).map((p) => (
                      <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg bg-card border border-border/60 text-xs">
                        <span className="text-muted-foreground shrink-0 w-20">{format(parseLocalDate(p.date), 'dd MMM', { locale: es })}</span>
                        <span className="flex-1 min-w-0 truncate" title={p.description}>{p.description}</span>
                        {p.origen === 'efectivo' && (
                          <Badge variant="outline" className="text-[9px] shrink-0">Efectivo</Badge>
                        )}
                        <span className="shrink-0 text-muted-foreground">
                          {p.facturas
                            ? <span className="text-primary">{p.facturas}</span>
                            : <span className="italic">sin factura puntual</span>}
                        </span>
                        <span className="font-mono font-semibold text-success shrink-0 tabular-nums">{formatCurrency(p.amount)}</span>
                      </div>
                    ))}
                    {pagosQ.data.length > 30 && (
                      <p className="text-[10px] text-muted-foreground italic">+{pagosQ.data.length - 30} pagos más — vélos completos en Relación de pagos.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Remisiones (despachos) del año */}
              <div className="bg-muted/10 border-l-2 border-l-primary px-6 pb-4 space-y-2">
                <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Truck className="h-4 w-4 text-warning" />
                  Remisiones {year} ({remisionesQ.data?.length ?? (clientRespIds.length > 0 ? '...' : 0)})
                </p>
                {clientRespIds.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Cliente sin tercero creado — no hay remisiones asociables.</p>
                ) : remisionesQ.isLoading ? (
                  <p className="text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin inline mr-1" />Buscando remisiones...</p>
                ) : !remisionesQ.data?.length ? (
                  <p className="text-xs text-muted-foreground italic">Sin remisiones de venta en {year}.</p>
                ) : (
                  <div className="space-y-1">
                    {remisionesQ.data.map((r) => (
                      <div key={r.id} className="flex items-center gap-3 p-2 rounded-lg bg-card border border-border/60 text-xs">
                        <span className="font-mono font-medium shrink-0">{r.number}</span>
                        <span className="text-muted-foreground shrink-0">{format(parseLocalDate(r.date), 'dd MMM', { locale: es })}</span>
                        {r.gerencial && <Badge variant="outline" className="text-[9px] shrink-0">G</Badge>}
                        <span className="flex-1" />
                        {r.facturas
                          ? <Badge variant="outline" className="text-[9px] bg-success/10 text-success border-success/30 shrink-0">Facturada · {r.facturas}</Badge>
                          : <Badge variant="outline" className="text-[9px] bg-warning/10 text-warning border-warning/30 shrink-0">Sin facturar</Badge>}
                        <span className="font-mono font-semibold shrink-0 tabular-nums">{formatCurrency(r.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Acciones del cliente */}
              <div className="bg-muted/10 border-l-2 border-l-primary px-6 pb-4 flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2.5 text-xs gap-1.5"
                  onClick={(e) => { e.stopPropagation(); onCompartir(); }}
                >
                  <Share2 className="h-3 w-3" />
                  Compartir estado de cuenta (PDF / WhatsApp / email)
                </Button>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </React.Fragment>
  );
}
