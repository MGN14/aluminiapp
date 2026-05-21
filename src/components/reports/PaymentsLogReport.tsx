// Reporte: Relación de pagos / Estado de cuenta.
//
// Caso de uso real (post-meeting con cliente):
//   "Si Aluminios JH me pregunta cómo están las cuentas, quiero tener
//    listo el saldo Y el historial para enviarle por WhatsApp o correo."
//
// Por eso el reporte se centra en filtrar POR CLIENTE/PROVEEDOR. Cuando hay
// uno seleccionado:
//   - Cards arriba muestran su estado de cuenta (facturado / cobrado / saldo).
//   - Tabla solo movimientos de ese cliente (banco + efectivo si Gerencial).
//   - Botones "Enviar por correo" y "Enviar por WhatsApp" listos.
//
// Sin filtro: vista general como historial de todo.
//
// Fuentes de datos:
//   - transactions (extractos bancarios) — siempre.
//   - cash_movements — solo en módulo Gerencial.
//   - invoices — para calcular saldo pendiente del cliente.
//
// Compartir:
//   - Email vía Resend (edge function send-payments-report-email).
//   - WhatsApp via wa.me — abre el WA del usuario sin número precargado
//     para que él elija el contacto. El Excel se descarga en paralelo
//     y el usuario lo arrastra al chat manualmente.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import writeXlsxFile from 'write-excel-file';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useModuleContext } from '@/hooks/useModuleContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  Download, Share2, Filter, TrendingUp, TrendingDown, ArrowUpDown,
  Banknote, Wallet, Mail, MessageCircle, Loader2, User, Receipt, Link2,
} from 'lucide-react';
import VincularFacturaTxModal from './VincularFacturaTxModal';
import { useQueryClient } from '@tanstack/react-query';
import { generatePaymentsLogPdf, type PaymentsLogPdfData, type PaymentsLogPdfRow, type RemisionPdfBlock } from '@/lib/paymentsLogPdf';
import type jsPDF from 'jspdf';

const currentYear = new Date().getFullYear();
const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - i);

const MONTH_LABELS = [
  'Todos los meses',
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function formatCurrency(v: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Math.round(v));
}

function formatDateLong(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

// Normalización fuerte para comparar nombres entre tablas (responsibles vs
// initial_state_details vs invoices). Quita tildes, sufijos legales (S.A.S,
// LTDA, S.A.), puntuación, lowercase y trim. Tolera variaciones humanas.
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+s\.?a\.?s\.?\s*$/i, '')
    .replace(/\s+ltda\.?\s*$/i, '')
    .replace(/\s+s\.?a\.?\s*$/i, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface PaymentRow {
  id: string;
  /** UUID de la factura actualmente vinculada (si está). Necesitamos el ID
   *  además del invoice_ref (número) para poder cambiar/desvincular sin que
   *  el modal tenga que resolver el número → id. */
  invoice_id: string | null;
  // Para transactions de banco, este campo contiene el id "bank-<uuid>".
  // Para vincular a factura necesitamos el uuid limpio:
  rawTxId: string | null;
  date: string;
  description: string;
  type: 'ingreso' | 'egreso';
  amount: number;
  source: 'banco' | 'efectivo';
  category: string | null;
  responsible: string | null;
  responsible_id: string | null;
  invoice_ref: string | null;
  counterparty: string | null;
}

interface CounterpartyOption {
  name: string;
  slug: string;
}

type FilterType = 'todos' | 'ingreso' | 'egreso';

export default function PaymentsLogReport() {
  const { user } = useAuth();
  const { isGerencial } = useModuleContext();
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState<number>(0);
  const [typeFilter, setTypeFilter] = useState<FilterType>('todos');
  const [counterparty, setCounterparty] = useState<string>('all'); // 'all' | <name>
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  // Remisión opcional a adjuntar al PDF/WhatsApp/email. La primera vez que se
  // envía la rel. de pagos a un cliente se quiere incluir la remisión para
  // que confirme el pedido; después solo el saldo. No se persiste en DB.
  const [selectedRemisionId, setSelectedRemisionId] = useState<string | null>(null);
  // Resetear remisión al cambiar de cliente o período: la remisión es del
  // cliente actual, si cambia ya no aplica.
  const handleCounterpartyChange = (v: string) => {
    setCounterparty(v);
    setSelectedRemisionId(null);
  };
  // Vincular factura a movimiento desde acá: track de qué fila estamos vinculando
  const [linkingTx, setLinkingTx] = useState<PaymentRow | null>(null);
  const queryClient = useQueryClient();

  const startDate = month === 0 ? `${year}-01-01` : `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = (() => {
    if (month === 0) return `${year}-12-31`;
    const last = new Date(year, month, 0);
    return `${year}-${String(month).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  })();

  // Lista de clientes/proveedores únicos del año — fuentes:
  //   A) transactions con responsible_id + categoría comercial (venta/compra)
  //   B) invoices con responsible_id (cualquier factura del año)
  //   C) invoices SIN responsible_id pero con counterparty_name que matchea
  //      un alias de Conciliación Bancaria (resuelto al canonical name)
  //
  // Antes solo se usaba (A), por eso si un cliente tenía facturas pero
  // ningún pago bancario asignado a su responsible_id, no aparecía en la
  // lista — caso real reportado: "Aluminios del Eje" tiene facturas pero
  // no aparece, mientras que "Aluminios Jh" (legacy con tx vinculada) sí.
  const { data: counterpartyOptions } = useQuery({
    queryKey: ['payments-log-counterparties-v5', user?.id, year],
    queryFn: async (): Promise<CounterpartyOption[]> => {
      if (!user) return [];

      // 1. Traer todos los responsibles + sus aliases (Beneficiarios de
      //    Conciliación Bancaria como fuente de verdad).
      const [respRes, aliasRes, allCatsRes] = await Promise.all([
        supabase
          .from('responsibles')
          .select('id, name'),
        supabase
          .from('responsible_aliases' as never)
          .select('responsible_id, alias'),
        supabase
          .from('categories')
          .select('id, name, report_group'),
      ]);

      const respMap = new Map<string, string>();
      ((respRes.data as Array<{ id: string; name: string }>) ?? []).forEach(r => respMap.set(r.id, r.name));

      // Alias normalizado → name canónico (incluye el name del responsible
      // como su propio alias).
      const aliasToCanonical = new Map<string, string>();
      respMap.forEach((name) => aliasToCanonical.set(normalizeName(name), name));
      ((aliasRes as { data: Array<{ responsible_id: string; alias: string }> | null }).data ?? []).forEach(a => {
        const canonical = respMap.get(a.responsible_id);
        if (canonical) aliasToCanonical.set(normalizeName(a.alias), canonical);
      });

      // 2. Identificar categorías comerciales (venta + compra) usando
      //    report_group SEMÁNTICO + sinónimos en el nombre.
      const validCatIds = new Set<string>();
      ((allCatsRes.data as Array<{ id: string; name: string; report_group: string }> | null) ?? []).forEach(c => {
        const name = (c.name ?? '').toLowerCase();
        const group = (c.report_group ?? '').toLowerCase();
        const isIncome = group === 'ingresos' || /venta|cliente/.test(name);
        const isCost = group === 'costos_operacionales'
          || /compra|proveedor/.test(name);
        if (isIncome || isCost) validCatIds.add(c.id);
      });

      const usedNames = new Set<string>();

      // 3A. Transacciones bancarias con responsible_id + categoría comercial.
      if (validCatIds.size > 0) {
        const { data: txs } = await supabase
          .from('transactions')
          .select('responsible_id, category_id')
          .is('deleted_at', null)
          .not('responsible_id', 'is', null)
          .in('category_id', Array.from(validCatIds))
          .gte('date', `${year}-01-01`)
          .lte('date', `${year}-12-31`);
        ((txs as Array<{ responsible_id: string | null }> | null) ?? []).forEach(t => {
          if (!t.responsible_id) return;
          const name = respMap.get(t.responsible_id);
          if (name) usedNames.add(name);
        });
      }

      // 3B. Facturas del año (cualquier tipo: venta/compra).
      const { data: invs } = await supabase
        .from('invoices')
        .select('responsible_id, counterparty_name')
        .gte('issue_date', `${year}-01-01`)
        .lte('issue_date', `${year}-12-31`);
      ((invs as Array<{ responsible_id: string | null; counterparty_name: string | null }> | null) ?? []).forEach(inv => {
        // Caso 1: factura con responsible_id directo
        if (inv.responsible_id) {
          const name = respMap.get(inv.responsible_id);
          if (name) {
            usedNames.add(name);
            return;
          }
        }
        // Caso 2: sin responsible_id, intentar matchear counterparty_name
        // contra los aliases. Si matchea → usar el canonical name.
        // Si no matchea → usar el counterparty_name crudo (cliente sin
        // beneficiario aún creado en Conciliación Bancaria).
        const raw = (inv.counterparty_name ?? '').trim();
        if (!raw) return;
        const canonical = aliasToCanonical.get(normalizeName(raw));
        usedNames.add(canonical ?? raw);
      });

      return Array.from(usedNames)
        .sort((a, b) => a.localeCompare(b, 'es'))
        .map(n => ({ name: n, slug: slugify(n) }));
    },
    enabled: !!user,
  });

  // Resumen del beneficiario seleccionado:
  // - Total cobrado (ingresos bancarios donde responsible = X)
  // - Total pagado (egresos bancarios donde responsible = X)
  // - Si hay facturas con counterparty_name que matchea el nombre del
  //   responsable (case-insensitive), también calcular facturado/pendiente.
  // El "beneficiario" del banco y el "counterparty_name" de la factura suelen
  // ser el mismo nombre — pero a veces difieren (ej: la factura dice "PROVIDENCE
  // GROUP S.A.S" y el banco "PROVIDENCE GROUP"). Hacemos match flexible.
  const { data: counterpartySummary } = useQuery({
    queryKey: ['payments-log-counterparty-summary-v6', user?.id, counterparty, year],
    queryFn: async () => {
      if (!user || counterparty === 'all') return null;

      // 0. Resolver respId del responsible canónico (si existe)
      const { data: resp } = await supabase
        .from('responsibles')
        .select('id')
        .ilike('name', counterparty.trim())
        .maybeSingle();
      const respId: string | null = resp?.id ?? null;

      // 1. Buscar TODAS las facturas del cliente.
      //   a) responsible_id = respId (vínculo exacto)
      //   b) sin responsible_id pero counterparty_name matchea (legacy)
      //   c) responsible_id apunta a un responsible cuyo alias = canonical
      //      (cubre casos donde el responsible_id de la factura es legacy)
      // Para (c) cargamos los aliases del responsible canónico y buscamos
      // facturas con cualquiera de esos responsibles.
      let aliasRespIds: string[] = [];
      if (respId) {
        const aliasRes = await supabase
          .from('responsible_aliases' as never)
          .select('alias')
          .eq('responsible_id', respId);
        const aliasRows = (aliasRes.data as unknown as Array<{ alias: string }> | null) ?? [];
        const aliasNames = new Set<string>(aliasRows.map(a => normalizeName(a.alias)));
        aliasNames.add(normalizeName(counterparty));
        // Buscar responsibles cuyo nombre normalizado coincida con algún alias
        // (cubre legacy responsibles que ya no existen pero que tenían nombres
        // similares — ej: si "Aluminios Jh" fue absorbido como alias de del Eje)
        const { data: allResps } = await supabase
          .from('responsibles')
          .select('id, name');
        ((allResps as Array<{ id: string; name: string }> | null) ?? []).forEach(r => {
          if (aliasNames.has(normalizeName(r.name))) aliasRespIds.push(r.id);
        });
      }
      const allRespIdsForClient = Array.from(new Set([
        ...(respId ? [respId] : []),
        ...aliasRespIds,
      ]));

      const invsCollected = new Map<string, any>();
      // (a)+(c) facturas con responsible_id en la lista del cliente
      if (allRespIdsForClient.length > 0) {
        const { data: linkedInvs } = await supabase
          .from('invoices')
          .select('id, type, total_amount, counterparty_name, responsible_id, subtotal_base, retefuente_cliente_amount, retefuente_cliente_rate, reteica_amount, autoretefuente_amount, retefuente_amount' as never)
          .in('responsible_id', allRespIdsForClient)
          // Excluir facturas anuladas totalmente por nota crédito.
          .or('void_type.is.null,void_type.eq.partial')
          .gte('issue_date', `${year}-01-01`)
          .lte('issue_date', `${year}-12-31`);
        (linkedInvs ?? []).forEach((i: any) => invsCollected.set(i.id, i));
      }
      // (b) Fallback ilike (facturas SIN responsible_id que matcheen por nombre)
      const { data: fallbackInvs } = await supabase
        .from('invoices')
        .select('id, type, total_amount, counterparty_name, responsible_id')
        .is('responsible_id', null)
        .ilike('counterparty_name', `%${counterparty.split(' ').slice(0, 2).join(' ')}%`)
        // Excluir facturas anuladas totalmente por nota crédito.
        .or('void_type.is.null,void_type.eq.partial')
        .gte('issue_date', `${year}-01-01`)
        .lte('issue_date', `${year}-12-31`);
      (fallbackInvs ?? []).forEach((i: any) => {
        if (!invsCollected.has(i.id)) invsCollected.set(i.id, i);
      });

      const invs = Array.from(invsCollected.values());
      const invsVenta = invs.filter((i: any) => i.type === 'venta');
      const invsCompra = invs.filter((i: any) => i.type === 'compra');
      const facturadoVenta = invsVenta.reduce((s: number, i: any) => s + Number(i.total_amount ?? 0), 0);
      const facturadoCompra = invsCompra.reduce((s: number, i: any) => s + Number(i.total_amount ?? 0), 0);
      const facturado = facturadoVenta + facturadoCompra;
      const invIds = invs.map((i: any) => i.id);

      // Retenciones del lado venta: el cliente retuvo plata y la pagó a DIAN/
      // municipio en vez de pagártela al banco. Por lo tanto se descuentan del
      // saldo (no son deuda viva). reteica + autoretefuente: auto-detect por
      // amount > 0 (cliente no agente retenedor → quedan en 0). retefuente
      // mantiene comportamiento legacy (default 2.5% si rate=null) para no
      // inflar facturas viejas.
      const retencionesVenta = invsVenta.reduce((s: number, i: any) => {
        const savedRete = Number(i.retefuente_cliente_amount ?? 0);
        const rawRate = i.retefuente_cliente_rate;
        const hasRate = rawRate !== null && rawRate !== undefined;
        const effRate = hasRate ? Number(rawRate) : 0.025;
        const retefuente = savedRete > 0
          ? savedRete
          : Math.round(Number(i.subtotal_base ?? 0) * effRate);
        const reteica = Math.abs(Number(i.reteica_amount ?? 0));
        const autoretefuente = Math.abs(Number(i.autoretefuente_amount ?? 0));
        return s + retefuente + reteica + autoretefuente;
      }, 0);

      // Retenciones del lado compra: lo que NOSOTROS le retuvimos al proveedor
      // y pagamos a DIAN/municipio en su nombre. No se las pagamos al
      // proveedor, así que reducen el "saldo por pagar". Sin esto, el saldo
      // de compra quedaba inflado (decía "le debo X" cuando ya pagué la parte
      // descontada al estado).
      const retencionesCompra = invsCompra.reduce((s: number, i: any) => {
        const retefuente = Math.abs(Number(i.retefuente_amount ?? 0));
        const reteica = Math.abs(Number(i.reteica_amount ?? 0));
        const autoretefuente = Math.abs(Number(i.autoretefuente_amount ?? 0));
        return s + retefuente + reteica + autoretefuente;
      }, 0);

      // 2. Encontrar TODAS las txs del cliente — vía 3 caminos:
      //   (a) responsible_id IN (allRespIdsForClient)
      //   (b) invoice_id IN (invIds) — vínculo directo
      //   (c) invoice_transaction_matches.invoice_id IN (invIds) — match manual
      //
      // Esto cubre el caso reportado: tx con responsible_id legacy ("Jh") pero
      // conciliada con factura del cliente real ("del Eje"). Antes solo
      // buscábamos por (a) y los pagos no aparecían.
      const txIdsForClient = new Set<string>();
      if (allRespIdsForClient.length > 0) {
        const { data: byResp } = await supabase
          .from('transactions')
          .select('id')
          .is('deleted_at', null)
          .in('responsible_id', allRespIdsForClient)
          .gte('date', `${year}-01-01`)
          .lte('date', `${year}-12-31`);
        (byResp ?? []).forEach((t: { id: string }) => txIdsForClient.add(t.id));
      }
      if (invIds.length > 0) {
        const [byInvoiceId, byMatches] = await Promise.all([
          supabase
            .from('transactions')
            .select('id')
            .is('deleted_at', null)
            .in('invoice_id', invIds),
          supabase
            .from('invoice_transaction_matches')
            .select('transaction_id')
            .in('invoice_id', invIds),
        ]);
        (byInvoiceId.data ?? []).forEach((t: { id: string }) => txIdsForClient.add(t.id));
        (byMatches.data ?? []).forEach((m: { transaction_id: string }) => txIdsForClient.add(m.transaction_id));
      }

      // Traer todas esas txs (filtradas por año) y sumar
      let movIngresos = 0;
      let movEgresos = 0;
      let movCount = 0;
      if (txIdsForClient.size > 0) {
        const { data: clientTxs } = await supabase
          .from('transactions')
          .select('amount, type, date')
          .is('deleted_at', null)
          .in('id', Array.from(txIdsForClient))
          .gte('date', `${year}-01-01`)
          .lte('date', `${year}-12-31`);
        (clientTxs ?? []).forEach((t: any) => {
          const amt = Math.abs(Number(t.amount ?? 0));
          if (t.type === 'ingreso') movIngresos += amt;
          else if (t.type === 'egreso') movEgresos += amt;
          movCount++;
        });
      }

      // 3. cobrado vinculado por factura (subset de movIngresos, sirve para mostrar
      //    "Cobrado vía conciliación con factura" si lo necesitamos en otro lado)
      let cobrado = 0;
      if (invIds.length > 0) {
        const { data: txs } = await supabase
          .from('transactions')
          .select('amount')
          .is('deleted_at', null)
          .in('invoice_id', invIds);
        cobrado += (txs ?? []).reduce((s: number, t: any) => s + Math.abs(Number(t.amount ?? 0)), 0);
        const { data: matches } = await supabase
          .from('invoice_transaction_matches')
          .select('matched_amount')
          .in('invoice_id', invIds);
        cobrado += (matches ?? []).reduce((s: number, m: any) => s + Math.abs(Number(m.matched_amount ?? 0)), 0);
      }

      // 4. Saldos iniciales del cliente/proveedor.
      // BUG anterior: la app NO restaba anticipos iniciales del saldo
      // pendiente. Si Aluminios JH tenía $113M anticipado y le facturamos
      // $167M, el saldo real es $54M (no $167M).
      //
      // Buscamos initial_state_details del responsible:
      //   - Por responsible_id (vínculo exacto) si existe
      //   - O por responsible_name (texto), tolerante a variaciones
      // Match laxo de filas a un cliente:
      //   1. responsible_id exacto (si la línea está vinculada por FK)
      //   2. responsible_name normalizado (sin tildes ni sufijos legales)
      //      con match exacto, contains o includes-al-revés
      // Esto cubre: "Aluminios Jh" ↔ "ALUMINIOS JH", "Aluminios Jh SAS",
      // "Aluminios JH Ltda", "Aluminios Jh.", etc.
      const targetNorm = normalizeName(counterparty);
      const matchByRespIdOrName = (rows: any[]): any[] => {
        return rows.filter((r) => {
          if (respId && r.responsible_id === respId) return true;
          const raw = (r.responsible_name ?? '').trim();
          if (!raw) return false;
          const n = normalizeName(raw);
          if (!n) return false;
          return n === targetNorm || n.includes(targetNorm) || targetNorm.includes(n);
        });
      };

      const { data: allInitialDetails } = await supabase
        .from('initial_state_details')
        .select('field_type, amount, invoice_id, responsible_id, responsible_name');

      const all = (allInitialDetails ?? []) as any[];

      // Para CLIENTES (lado venta):
      //   - cuentas_por_cobrar: lo que ya nos debían al inicio → SUMA al facturado
      //   - anticipos_de_clientes:
      //       sin invoice_id  → unlinked (saldo a favor general)
      //       con invoice_id de factura del cliente → linked (descuento de factura puntual)
      //     AMBOS deben restarse del saldo total — son plata que el cliente
      //     ya nos pagó, sea atribuida o no a factura específica.
      const cxcInicialRows = matchByRespIdOrName(all.filter(r => r.field_type === 'cuentas_por_cobrar'));
      const anticiposClienteAllRows = all.filter(r => r.field_type === 'anticipos_de_clientes');
      const anticiposClienteUnlinkedRows = matchByRespIdOrName(
        anticiposClienteAllRows.filter(r => !r.invoice_id),
      );
      // Anticipos LINKED: los que tienen invoice_id y la factura es del cliente.
      const invIdSet = new Set(invIds);
      const anticiposClienteLinkedRows = anticiposClienteAllRows.filter(
        r => r.invoice_id && invIdSet.has(r.invoice_id),
      );
      const cxcInicial = cxcInicialRows.reduce((s, r) => s + Math.abs(Number(r.amount ?? 0)), 0);
      const anticiposClienteUnlinked = anticiposClienteUnlinkedRows.reduce(
        (s, r) => s + Math.abs(Number(r.amount ?? 0)), 0);
      const anticiposClienteLinked = anticiposClienteLinkedRows.reduce(
        (s, r) => s + Math.abs(Number(r.amount ?? 0)), 0);
      const anticiposClienteTotal = anticiposClienteUnlinked + anticiposClienteLinked;

      // Para PROVEEDORES (lado compra):
      //   - cuentas_por_pagar: lo que ya les debíamos al inicio → SUMA al facturado compra
      //   - anticipos_a_proveedores: les pagamos antes → RESTA del pendiente
      //     (incluye linked + unlinked, mismo razonamiento que arriba)
      const cxpInicialRows = matchByRespIdOrName(all.filter(r => r.field_type === 'cuentas_por_pagar'));
      const anticiposProvAllRows = all.filter(r => r.field_type === 'anticipos_a_proveedores');
      const anticiposProvUnlinkedRows = matchByRespIdOrName(
        anticiposProvAllRows.filter(r => !r.invoice_id),
      );
      const anticiposProvLinkedRows = anticiposProvAllRows.filter(
        r => r.invoice_id && invIdSet.has(r.invoice_id),
      );
      const cxpInicial = cxpInicialRows.reduce((s, r) => s + Math.abs(Number(r.amount ?? 0)), 0);
      const anticiposProvUnlinked = anticiposProvUnlinkedRows.reduce(
        (s, r) => s + Math.abs(Number(r.amount ?? 0)), 0);
      const anticiposProvLinked = anticiposProvLinkedRows.reduce(
        (s, r) => s + Math.abs(Number(r.amount ?? 0)), 0);
      const anticiposProvTotal = anticiposProvUnlinked + anticiposProvLinked;

      // Saldo real — modelo nuevo:
      //   Total a cobrar venta = facturadoVenta + cxcInicial
      //   Total recibido       = TODOS los pagos del banco (movIngresos) +
      //                          anticipos previos del saldo inicial
      //   Saldo neto venta     = total a cobrar − total recibido
      //
      // Cambio importante (bug reportado por Nico): antes contábamos solo
      // los pagos vinculados a una factura específica (`cobrado`). Si los
      // pagos del banco no estaban vinculados, no se descontaban del saldo
      // y mostrábamos "te debe X" cuando en realidad ya estaba todo cobrado
      // o incluso recibido por encima.
      //
      // Permitimos saldo negativo: significa que recibiste más plata de lo
      // que facturaste — les tenés que emitir facturas (anticipos vivos).
      const totalACobrar = facturadoVenta + cxcInicial;
      const totalRecibidoVenta = movIngresos + anticiposClienteTotal;
      // Retenciones (retefuente + reteica + autoretefuente) descuentan del
      // saldo: son plata que el cliente retuvo y pagó al estado, no a vos.
      const saldoNetoVenta = totalACobrar - totalRecibidoVenta - retencionesVenta;
      // Para retrocompatibilidad mantenemos "pendienteVenta" pero ahora
      // representa el saldo neto (puede ser negativo).
      const pendienteVenta = saldoNetoVenta;
      const excesoCobradoVenta = saldoNetoVenta < 0 ? Math.abs(saldoNetoVenta) : 0;

      const totalAPagar = facturadoCompra + cxpInicial;
      // En el lado compra: el "total entregado" son los egresos al proveedor
      // por banco + los anticipos a proveedores del saldo inicial (linked + unlinked).
      const totalEntregadoCompra = movEgresos + anticiposProvTotal;
      // Restamos también las retenciones de compra — son plata que pagamos a
      // DIAN/municipio en lugar de al proveedor, así que reducen el saldo a
      // pagar (mismo razonamiento que retencionesVenta del lado cliente).
      const saldoNetoCompra = totalAPagar - totalEntregadoCompra - retencionesCompra;
      const pendienteCompra = saldoNetoCompra;
      // Si pagaste más de lo facturado, son anticipos a ellos (les pagaste de más)
      const excesoEntregadoCompra = saldoNetoCompra < 0 ? Math.abs(saldoNetoCompra) : 0;

      // Pendiente "general" = el que aplique según haya facturas venta o compra
      const pendiente = facturadoVenta > 0 ? pendienteVenta : pendienteCompra;

      return {
        facturado,
        facturadoVenta,
        facturadoCompra,
        cobrado,
        pendiente,
        pendienteVenta,
        pendienteCompra,
        excesoCobradoVenta,
        excesoEntregadoCompra,
        cxcInicial,
        cxpInicial,
        anticiposClienteUnlinked,
        anticiposClienteLinked,
        anticiposClienteTotal,
        retencionesVenta,
        retencionesCompra,
        anticiposProvUnlinked,
        anticiposProvLinked,
        anticiposProvTotal,
        invoiceCount: (invs ?? []).length,
        invoiceCountVenta: invsVenta.length,
        invoiceCountCompra: invsCompra.length,
        movIngresos,
        movEgresos,
        movCount,
        hasInvoices: invIds.length > 0 || cxcInicial > 0 || cxpInicial > 0,
      };
    },
    enabled: !!user && counterparty !== 'all',
  });

  // Movimientos del periodo — solo de categorías comerciales (ventas/compras).
  // Excluye gastos operativos, impuestos, nómina, etc.
  // Detección por report_group + sinónimos en el nombre (mismo criterio que
  // en el dropdown de counterparties). Ej: "Proveedores" matchea via
  // report_group='costos_operacionales' aunque el nombre no diga "compra".
  //
  // CLIENTE REAL: si la tx está vinculada a una factura (invoice_id), el
  // cliente real es el de la FACTURA (resuelto via responsibles + aliases),
  // NO el responsible_id de la transacción. Esto cubre el caso donde una
  // tx vieja tiene responsible_id legacy ("Aluminios Jh") pero la factura
  // conciliada apunta al cliente correcto ("Aluminios del Eje").
  const { data, isLoading } = useQuery({
    queryKey: ['payments-log-v4', user?.id, year, month, typeFilter, counterparty, isGerencial],
    queryFn: async (): Promise<PaymentRow[]> => {
      if (!user) return [];

      const { data: allCats } = await supabase
        .from('categories')
        .select('id, name, report_group');

      const validCatIds = new Set<string>();
      (allCats ?? []).forEach((c: any) => {
        const name = (c.name ?? '').toLowerCase();
        const group = (c.report_group ?? '').toLowerCase();
        const isIncome = group === 'ingresos' || /venta|cliente/.test(name);
        const isCost = group === 'costos_operacionales' || /compra|proveedor/.test(name);
        if (isIncome || isCost) validCatIds.add(c.id);
      });

      // Banco: TODAS las transactions del periodo. Sin filtro SQL por
      // responsible_id — lo aplicamos en JS después de resolver el cliente
      // real de cada tx (incluyendo las que vienen vinculadas a factura).
      const txResult = await supabase
        .from('transactions')
        .select('id, date, description, type, amount, category_id, responsible_id, invoice_id')
        .is('deleted_at', null)
        .in('type', ['ingreso', 'egreso'])
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false });
      if (txResult.error) throw txResult.error;

      const txs = (txResult.data ?? []) as Array<{
        id: string;
        date: string;
        description: string | null;
        type: string;
        amount: number | null;
        category_id: string | null;
        responsible_id: string | null;
        invoice_id: string | null;
      }>;

      // Lookups en paralelo: responsibles, aliases, invoices vinculadas
      // (con counterparty + responsible_id de la factura), e invoice_transaction_matches
      // que también vincula tx ↔ factura sin tocar invoice_id.
      const linkedInvoiceIds = new Set<string>();
      txs.forEach(t => { if (t.invoice_id) linkedInvoiceIds.add(t.invoice_id); });
      const txIds = txs.map(t => t.id);

      const [allRespsRes, aliasesRes, matchesRes] = await Promise.all([
        supabase.from('responsibles').select('id, name'),
        supabase
          .from('responsible_aliases' as never)
          .select('responsible_id, alias'),
        txIds.length > 0
          ? supabase
              .from('invoice_transaction_matches')
              .select('invoice_id, transaction_id')
              .in('transaction_id', txIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (allRespsRes.error) throw allRespsRes.error;
      // aliasesRes y matchesRes pueden fallar silenciosamente si la tabla
      // no existe en el entorno actual — defensivo, no rompemos.

      // Recolectar IDs de invoices: las directas (invoice_id) + las indirectas (matches)
      ((matchesRes as { data: Array<{ invoice_id: string; transaction_id: string }> | null }).data ?? []).forEach(m => {
        if (m.invoice_id) linkedInvoiceIds.add(m.invoice_id);
      });

      const linkedInvsRes = linkedInvoiceIds.size > 0
        ? await supabase
            .from('invoices')
            .select('id, invoice_number, counterparty_name, responsible_id')
            .in('id', Array.from(linkedInvoiceIds))
        : { data: [], error: null };
      if (linkedInvsRes.error) throw linkedInvsRes.error;

      const catNameById = new Map<string, string>();
      for (const c of (allCats ?? []) as Array<{ id: string; name: string }>) {
        catNameById.set(c.id, c.name);
      }
      const respNameById = new Map<string, string>();
      for (const r of (allRespsRes.data ?? []) as Array<{ id: string; name: string }>) {
        respNameById.set(r.id, r.name);
      }

      // Alias normalizado → name canónico (incluye el name del responsible
      // como su propio alias).
      const aliasToCanonical = new Map<string, string>();
      respNameById.forEach((name) => aliasToCanonical.set(normalizeName(name), name));
      ((aliasesRes as { data: Array<{ responsible_id: string; alias: string }> | null }).data ?? []).forEach(a => {
        const canonical = respNameById.get(a.responsible_id);
        if (canonical) aliasToCanonical.set(normalizeName(a.alias), canonical);
      });

      // Resolver counterparty de una factura (responsible_id directo o via alias del counterparty_name)
      const linkedInvoices = (linkedInvsRes.data ?? []) as Array<{
        id: string; invoice_number: string; counterparty_name: string | null; responsible_id: string | null;
      }>;
      const invoiceNumById = new Map<string, string>();
      const invoiceCounterpartyById = new Map<string, string>();
      for (const inv of linkedInvoices) {
        invoiceNumById.set(inv.id, inv.invoice_number);
        let resolved: string | null = null;
        if (inv.responsible_id) {
          resolved = respNameById.get(inv.responsible_id) ?? null;
        }
        if (!resolved && inv.counterparty_name) {
          const canonical = aliasToCanonical.get(normalizeName(inv.counterparty_name));
          resolved = canonical ?? inv.counterparty_name.trim();
        }
        if (resolved) invoiceCounterpartyById.set(inv.id, resolved);
      }

      // Mapeo tx_id → invoice_id (vía matches), para fallback cuando la tx
      // no tiene invoice_id directo pero sí está conciliada via matches.
      const invoiceIdByTxId = new Map<string, string>();
      ((matchesRes as { data: Array<{ invoice_id: string; transaction_id: string }> | null }).data ?? []).forEach(m => {
        if (m.transaction_id && m.invoice_id) invoiceIdByTxId.set(m.transaction_id, m.invoice_id);
      });

      // Filtro de categorías comerciales (venta/compra) — aplicado en JS para
      // que las txs vinculadas a factura pasen aunque su category sea NULL.
      const txPasesCommercialFilter = (catId: string | null, hasInvoiceLink: boolean): boolean => {
        if (hasInvoiceLink) return true; // si está vinculada a factura, es comercial por definición
        if (!catId) return false;
        return validCatIds.has(catId);
      };

      const bankRows: PaymentRow[] = txs.flatMap((r) => {
        const linkedInvoiceId = r.invoice_id ?? invoiceIdByTxId.get(r.id) ?? null;
        const hasInvoiceLink = !!linkedInvoiceId;
        if (!txPasesCommercialFilter(r.category_id, hasInvoiceLink)) return [];

        const respName = r.responsible_id ? respNameById.get(r.responsible_id) ?? null : null;
        // CLIENTE REAL: prioridad invoice → responsible_id de tx
        const resolvedCounterparty = linkedInvoiceId
          ? (invoiceCounterpartyById.get(linkedInvoiceId) ?? respName)
          : respName;
        return [{
          id: `bank-${r.id}`,
          invoice_id: linkedInvoiceId,
          rawTxId: r.id,
          date: r.date,
          description: r.description ?? 'Sin descripción',
          type: r.type as 'ingreso' | 'egreso',
          amount: Math.abs(Number(r.amount ?? 0)),
          source: 'banco' as const,
          category: r.category_id ? catNameById.get(r.category_id) ?? null : null,
          responsible: resolvedCounterparty,
          responsible_id: r.responsible_id ?? null,
          invoice_ref: linkedInvoiceId ? invoiceNumById.get(linkedInvoiceId) ?? null : null,
          counterparty: resolvedCounterparty,
        }];
      });

      // Efectivo solo en Gerencial — y solo si la categoría del cash_movement
      // es "ventas" o "compra" (se filtra en JS porque cash_movements.category
      // es texto libre, no FK). Excluye nómina, gastos operativos, etc.
      let cashRows: PaymentRow[] = [];
      if (isGerencial && counterparty === 'all') {
        const cashRes = await supabase
          .from('cash_movements')
          .select('id, date, type, amount, category, notes')
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date', { ascending: false });
        if (!cashRes.error && cashRes.data) {
          cashRows = (cashRes.data as any[])
            .filter((r) => {
              const cat = (r.category ?? '').toLowerCase();
              // Mismo criterio amplio que para transactions:
              // venta/cliente (ingresos) o compra/proveedor (costos).
              return /venta|cliente|compra|proveedor/.test(cat);
            })
            .map((r) => ({
              id: `cash-${r.id}`,
              invoice_id: null,
              rawTxId: null,
              date: r.date,
              description: r.notes ?? 'Movimiento en efectivo',
              type: r.type as 'ingreso' | 'egreso',
              amount: Math.abs(Number(r.amount ?? 0)),
              source: 'efectivo',
              category: r.category ?? null,
              responsible: null,
              responsible_id: null,
              invoice_ref: null,
              counterparty: null,
            }));
        }
      }

      let all = [...bankRows, ...cashRows];
      if (typeFilter !== 'todos') all = all.filter((r) => r.type === typeFilter);
      // Filtro por beneficiario = transactions cuyo responsible.name matchea
      if (counterparty !== 'all') all = all.filter((r) => r.responsible === counterparty);
      return all.sort((a, b) => b.date.localeCompare(a.date));
    },
    enabled: !!user,
  });

  const rows = data ?? [];

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        if (r.type === 'ingreso') acc.ingresos += r.amount;
        else acc.egresos += r.amount;
        return acc;
      },
      { ingresos: 0, egresos: 0 },
    );
  }, [rows]);

  // Totales facturados del periodo (ventas y compras) — para los KPIs de
  // vista general. Permite comparar "lo que cobré/pagué en banco" vs "lo
  // que está facturado en DIAN".
  const { data: invoiceTotals } = useQuery({
    queryKey: ['payments-log-invoice-totals', user?.id, year, month],
    queryFn: async () => {
      if (!user) return { ventas: 0, compras: 0, ventasCount: 0, comprasCount: 0 };
      const { data: invs } = await supabase
        .from('invoices')
        .select('type, total_amount, status')
        .eq('status', 'confirmed')
        // Excluir facturas anuladas totalmente por nota crédito.
        .or('void_type.is.null,void_type.eq.partial')
        .gte('issue_date', startDate)
        .lte('issue_date', endDate);
      let ventas = 0, compras = 0, ventasCount = 0, comprasCount = 0;
      (invs ?? []).forEach((i: any) => {
        const t = Number(i.total_amount ?? 0);
        if (i.type === 'venta') { ventas += t; ventasCount++; }
        else if (i.type === 'compra') { compras += t; comprasCount++; }
      });
      return { ventas, compras, ventasCount, comprasCount };
    },
    enabled: !!user,
  });

  // Remisiones del cliente seleccionado — para que el dueño pueda elegir cuál
  // adjuntar al PDF/email/WhatsApp ("la primera vez se confirma con remisión,
  // después solo el saldo"). NO filtramos por año/mes: el cliente puede
  // querer adjuntar una remisión vieja al estado de cuenta del mes actual.
  const { data: clientRemisiones } = useQuery({
    queryKey: ['payments-log-client-remisiones-v2', user?.id, counterparty],
    queryFn: async (): Promise<Array<{ id: string; number: string; date: string; total_manual: number | null; itemsTotal: number }>> => {
      if (!user || counterparty === 'all') return [];

      // Resolver respId + alias del cliente (mismo criterio que counterpartySummary).
      const { data: resp } = await supabase
        .from('responsibles')
        .select('id')
        .ilike('name', counterparty.trim())
        .maybeSingle();
      const respId = resp?.id ?? null;

      let aliasRespIds: string[] = [];
      if (respId) {
        const aliasRes = await supabase
          .from('responsible_aliases' as never)
          .select('alias')
          .eq('responsible_id', respId);
        const aliasRows = (aliasRes.data as unknown as Array<{ alias: string }> | null) ?? [];
        const aliasNames = new Set(aliasRows.map(a => normalizeName(a.alias)));
        aliasNames.add(normalizeName(counterparty));
        const { data: allResps } = await supabase
          .from('responsibles')
          .select('id, name');
        ((allResps as Array<{ id: string; name: string }> | null) ?? []).forEach(r => {
          if (aliasNames.has(normalizeName(r.name))) aliasRespIds.push(r.id);
        });
      }
      const allRespIds = Array.from(new Set([
        ...(respId ? [respId] : []),
        ...aliasRespIds,
      ]));

      if (allRespIds.length === 0) return [];

      const { data: rems } = await (supabase
        .from('remisiones') as any)
        .select('id, number, date, total_manual, remision_items(total_cost)')
        .in('responsible_id', allRespIds)
        .order('date', { ascending: false });

      return ((rems ?? []) as Array<{
        id: string; number: string; date: string; total_manual: number | null;
        remision_items: Array<{ total_cost: number | null }> | null;
      }>).map(r => ({
        id: r.id,
        number: r.number,
        date: r.date,
        total_manual: r.total_manual,
        itemsTotal: (r.remision_items ?? []).reduce((s, it) => s + Number(it.total_cost ?? 0), 0),
      }));
    },
    enabled: !!user && counterparty !== 'all',
  });

  // Subconjunto de remisiones del cliente que caen en el período seleccionado.
  // Sirve para el KPI "Total remisiones (período)" — útil para validar que la
  // suma de remisiones coincide con lo facturado en DIAN para ese cliente.
  const remisionesPeriodo = useMemo(() => {
    const list = (clientRemisiones ?? []).filter(r => r.date >= startDate && r.date <= endDate);
    const total = list.reduce(
      (s, r) => s + (r.total_manual != null && r.total_manual > 0 ? r.total_manual : r.itemsTotal),
      0,
    );
    return { count: list.length, total };
  }, [clientRemisiones, startDate, endDate]);

  const periodoLabel = month === 0 ? `${year}` : `${MONTH_LABELS[month]} ${year}`;
  const fileSlug = counterparty !== 'all'
    ? `aluminiapp_estado_cuenta_${slugify(counterparty)}_${month === 0 ? year : `${year}-${String(month).padStart(2, '0')}`}.xlsx`
    : `aluminiapp_relacion_pagos_${month === 0 ? year : `${year}-${String(month).padStart(2, '0')}`}.xlsx`;

  const buildWorkbook = () => {
    const header = [
      { value: 'Fecha', fontWeight: 'bold' },
      { value: 'Tipo', fontWeight: 'bold' },
      { value: 'Origen', fontWeight: 'bold' },
      { value: 'Descripción', fontWeight: 'bold' },
      { value: 'Cliente/Proveedor', fontWeight: 'bold' },
      { value: 'Categoría', fontWeight: 'bold' },
      { value: 'Factura', fontWeight: 'bold' },
      { value: 'Monto (COP)', fontWeight: 'bold', align: 'right' },
    ];
    const dataRows = rows.map((r) => [
      { value: r.date, type: String },
      { value: r.type === 'ingreso' ? 'Ingreso' : 'Egreso', type: String },
      { value: r.source === 'banco' ? 'Banco' : 'Efectivo', type: String },
      { value: r.description, type: String },
      { value: r.counterparty ?? '—', type: String },
      { value: r.category ?? '—', type: String },
      { value: r.invoice_ref ?? '—', type: String },
      {
        value: r.type === 'egreso' ? -r.amount : r.amount,
        type: Number, format: '#,##0', align: 'right',
      },
    ]);
    return [header, ...dataRows];
  };

  const xlsxColumns = [
    { width: 12 }, { width: 10 }, { width: 10 }, { width: 38 },
    { width: 24 }, { width: 18 }, { width: 14 }, { width: 16 },
  ];

  const handleExport = async () => {
    if (rows.length === 0) {
      toast.error('No hay pagos en el periodo seleccionado.');
      return;
    }
    try {
      const data = buildWorkbook();
      await writeXlsxFile(data as any, { fileName: fileSlug, columns: xlsxColumns } as any);
      toast.success(`Exportado: ${rows.length} movimientos`);
    } catch (e) {
      console.error(e);
      toast.error('No pudimos exportar. Intentá de nuevo.');
    }
  };

  // Construir data y generar PDF de Relación de Pagos.
  // Carga datos de empresa + letterhead del profile en cada llamada.
  const buildAndDownloadPdf = async (): Promise<jsPDF | null> => {
    if (!user) return null;
    if (rows.length === 0) {
      toast.error('No hay pagos en el periodo seleccionado.');
      return null;
    }

    const { data: profileData } = await supabase
      .from('profiles')
      .select('company_name, company_nit, company_city')
      .eq('user_id', user.id)
      .maybeSingle();

    // Relación de pagos NO usa letterhead — Nico prefiere hoja en blanco
    // para este reporte. La hoja membretada solo aplica a cuentas de cobro
    // y comprobantes de pago en Caja Menor.

    const pdfRows: PaymentsLogPdfRow[] = rows.map((r) => ({
      date: r.date,
      type: r.type,
      source: r.source,
      description: r.description ?? '',
      responsible: r.responsible ?? r.counterparty ?? null,
      invoice_ref: r.invoice_ref ?? null,
      amount: r.amount,
    }));

    // Si el dueño eligió una remisión para adjuntar, la traemos con items.
    // Carga lazy: solo se hace cuando hay PDF a generar (no en cada render).
    let remision: RemisionPdfBlock | undefined;
    if (selectedRemisionId) {
      const { data: remData } = await (supabase
        .from('remisiones') as any)
        .select('number, date, beneficiary, notes, total_manual, remision_items(reference, product_name, units, unit_cost, total_cost)')
        .eq('id', selectedRemisionId)
        .maybeSingle();
      if (remData) {
        const items = ((remData.remision_items ?? []) as Array<{
          reference: string | null; product_name: string | null;
          units: number | string; unit_cost: number | string; total_cost: number | string;
        }>).map((it) => ({
          reference: it.reference ?? '',
          product_name: it.product_name ?? '',
          units: Number(it.units) || 0,
          unit_cost: Number(it.unit_cost) || 0,
          total_cost: Number(it.total_cost) || 0,
        }));
        remision = {
          number: remData.number,
          date: remData.date,
          beneficiary: remData.beneficiary ?? null,
          notes: remData.notes ?? null,
          totalManual: remData.total_manual ?? null,
          items,
        };
      }
    }

    const pdfData: PaymentsLogPdfData = {
      empresaNombre: (profileData as { company_name?: string | null })?.company_name || 'Mi empresa',
      empresaNit: (profileData as { company_nit?: string | null })?.company_nit ?? undefined,
      empresaCiudad: (profileData as { company_city?: string | null })?.company_city ?? undefined,
      periodoLabel,
      counterparty: counterparty !== 'all' ? counterparty : null,
      tePagaron: counterparty !== 'all' && counterpartySummary
        ? counterpartySummary.movIngresos
        : totals.ingresos,
      lePagaste: counterparty !== 'all' && counterpartySummary
        ? counterpartySummary.movEgresos
        : totals.egresos,
      movimientosCount: rows.length,
      saldoPorCobrar: counterparty !== 'all' && counterpartySummary && counterpartySummary.hasInvoices
        ? {
            facturado: counterpartySummary.facturado,
            saldoInicial: counterpartySummary.anticiposClienteTotal,
            pagosIdentificados: counterpartySummary.movIngresos,
            retenciones: counterpartySummary.retencionesVenta,
            saldoPendiente: counterpartySummary.pendienteVenta,
          }
        : undefined,
      rows: pdfRows,
      remision,
    };

    return generatePaymentsLogPdf(pdfData);
  };

  const handlePdfDownload = async () => {
    try {
      const pdf = await buildAndDownloadPdf();
      if (!pdf) return;
      pdf.save(`${fileSlug}.pdf`);
      toast.success(`PDF generado: ${rows.length} movimientos`);
    } catch (e: any) {
      console.error(e);
      toast.error('No pudimos generar el PDF. Intentá de nuevo.');
    }
  };

  // WhatsApp share — abre wa.me sin número (el usuario elige contacto).
  // En paralelo descarga el Excel local para que lo arrastre al chat manualmente.
  // Mensaje limpio sin emojis pesados.
  const handleWhatsAppShare = async () => {
    if (rows.length === 0) {
      toast.error('No hay pagos para compartir.');
      return;
    }
    try {
      let msg = '';
      if (counterparty !== 'all' && counterpartySummary) {
        const lines = [
          `Hola ${counterparty},`,
          ``,
          `Aquí está nuestro estado de cuenta a ${periodoLabel}:`,
          ``,
        ];
        if (counterpartySummary.hasInvoices) {
          lines.push(`Facturado: ${formatCurrency(counterpartySummary.facturado)}`);
          lines.push(`Pagos identificados: ${formatCurrency(counterpartySummary.movIngresos)}`);
          if (counterpartySummary.anticiposClienteTotal > 0) {
            lines.push(`Anticipos del cliente: ${formatCurrency(counterpartySummary.anticiposClienteTotal)}`);
          }
          const saldo = counterpartySummary.pendienteVenta;
          if (saldo > 0) {
            lines.push(``, `Saldo pendiente por cobrar: ${formatCurrency(saldo)}`);
          } else if (saldo < 0) {
            lines.push(``, `A favor del cliente (pendiente facturar): ${formatCurrency(Math.abs(saldo))}`);
          } else {
            lines.push(``, `Cuentas al día.`);
          }
        }
        lines.push(``, `Adjunto el detalle en Excel.`);
        msg = lines.join('\n');
      } else {
        msg = [
          `Relación de pagos — ${periodoLabel}`,
          ``,
          `Ingresos: ${formatCurrency(totals.ingresos)}`,
          `Egresos: ${formatCurrency(totals.egresos)}`,
          `Neto: ${formatCurrency(totals.ingresos - totals.egresos)}`,
          ``,
          `Detalle en el Excel adjunto.`,
        ].join('\n');
      }
      // Generar PDF en paralelo
      const pdf = await buildAndDownloadPdf();
      if (!pdf) return;

      // Si el browser soporta Web Share API con archivos, compartir directo
      const pdfBlob = pdf.output('blob');
      const pdfFile = new File([pdfBlob], `${fileSlug}.pdf`, { type: 'application/pdf' });

      const navAny = navigator as Navigator & { canShare?: (data: ShareData) => boolean; share?: (data: ShareData) => Promise<void> };
      if (navAny.canShare && navAny.canShare({ files: [pdfFile] }) && navAny.share) {
        try {
          await navAny.share({ files: [pdfFile], text: msg, title: 'Relación de pagos' });
          return;
        } catch (e: any) {
          if (e?.name === 'AbortError') return;
          // Si la share API falla, caemos al fallback de descargar + wa.me
        }
      }

      // Fallback: descargar PDF + abrir wa.me
      pdf.save(`${fileSlug}.pdf`);
      const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
      window.open(url, '_blank');
      toast.info('PDF descargado. WhatsApp abierto — arrastrá el PDF al chat.');
    } catch (e) {
      console.error(e);
      toast.error('No pudimos abrir WhatsApp. Intentá descargar el PDF y enviarlo manual.');
    }
  };

  const showCounterpartyKpis = counterparty !== 'all' && counterpartySummary;

  return (
    <div className="space-y-4">
      {/* Filtros + acciones */}
      <Card>
        <CardContent className="py-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-[90px] h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-[150px] h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTH_LABELS.map((label, i) => (
                  <SelectItem key={i} value={String(i)}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as FilterType)}>
              <SelectTrigger className="w-[150px] h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Ingresos y egresos</SelectItem>
                <SelectItem value="ingreso">Solo ingresos</SelectItem>
                <SelectItem value="egreso">Solo egresos</SelectItem>
              </SelectContent>
            </Select>
            <Select value={counterparty} onValueChange={handleCounterpartyChange}>
              <SelectTrigger className="w-[200px] h-8 text-sm">
                <User className="h-3.5 w-3.5 mr-1 shrink-0" />
                <SelectValue placeholder="Todos los clientes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los clientes</SelectItem>
                {(counterpartyOptions ?? []).map((c) => (
                  <SelectItem key={c.slug} value={c.name}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Selector remisión (opcional). Solo cuando hay cliente seleccionado
                y existen remisiones para él. La remisión se renderiza en páginas
                extra del PDF al final — útil la primera vez que se envía rel.
                de pagos a un cliente para que confirme el pedido. */}
            {counterparty !== 'all' && (clientRemisiones?.length ?? 0) > 0 && (
              <Select
                value={selectedRemisionId ?? 'none'}
                onValueChange={(v) => setSelectedRemisionId(v === 'none' ? null : v)}
              >
                <SelectTrigger
                  className={`w-[230px] h-8 text-sm ${selectedRemisionId ? 'border-primary/40 bg-primary/5' : ''}`}
                  title="Adjuntar remisión al PDF/email/WhatsApp"
                >
                  <Receipt className="h-3.5 w-3.5 mr-1 shrink-0" />
                  <SelectValue placeholder="Sin remisión adjunta" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin remisión adjunta</SelectItem>
                  {(clientRemisiones ?? []).map((r) => {
                    const total = r.total_manual != null && r.total_manual > 0 ? r.total_manual : r.itemsTotal;
                    const label = total > 0
                      ? `${r.number} · ${r.date} · ${formatCurrency(total)}`
                      : `${r.number} · ${r.date}`;
                    return <SelectItem key={r.id} value={r.id}>{label}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            )}

            {/* Acciones inline a la derecha en pantallas grandes; abajo en mobile */}
            <div className="flex flex-wrap items-center gap-1.5 ml-auto">
              <Button
                variant="outline" size="sm"
                onClick={handlePdfDownload}
                disabled={isLoading || rows.length === 0}
                className="h-8 gap-1.5"
              >
                <Download className="h-3.5 w-3.5" />
                PDF
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={handleExport}
                disabled={isLoading || rows.length === 0}
                className="h-8 gap-1.5"
              >
                <Download className="h-3.5 w-3.5" />
                Excel
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={handleWhatsAppShare}
                disabled={isLoading || rows.length === 0}
                className="h-8 gap-1.5 border-green-600/30 text-green-700 hover:bg-green-50 hover:text-green-700"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                WhatsApp
              </Button>
              <Button
                size="sm"
                onClick={() => setEmailModalOpen(true)}
                disabled={isLoading || rows.length === 0}
                className="h-8 gap-1.5"
              >
                <Mail className="h-3.5 w-3.5" />
                Enviar por correo
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs por beneficiario — adaptados al filtro de tipo.
            Caso "Solo ingresos": cliente nos paga → mostramos su perspectiva
              de ventas (te pagaron / total facturado venta / movimientos).
            Caso "Solo egresos": proveedor al que pagamos → su perspectiva
              de compras (le pagaste / total facturado compra / movimientos).
            Caso "Todos": ambos, con cards balanceadas. */}
      {showCounterpartyKpis ? (
        <>
          {typeFilter === 'ingreso' ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Te pagaron (banco)</CardTitle>
                  <div className="p-2 rounded-lg bg-success/10">
                    <TrendingUp className="h-4 w-4 text-success" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-success">{formatCurrency(counterpartySummary!.movIngresos)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ingresos bancarios de {counterparty}
                  </p>
                </CardContent>
              </Card>
              <Card className="border-primary/20 bg-primary/[0.02]">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total facturado a {counterparty}</CardTitle>
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Receipt className="h-4 w-4 text-primary" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(counterpartySummary!.facturadoVenta)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {counterpartySummary!.invoiceCountVenta} factura{counterpartySummary!.invoiceCountVenta !== 1 ? 's' : ''} de venta • {periodoLabel}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Movimientos del periodo</CardTitle>
                  <div className="p-2 rounded-lg bg-primary/10">
                    <ArrowUpDown className="h-4 w-4 text-primary" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{counterpartySummary!.movCount}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Total de transacciones bancarias
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : typeFilter === 'egreso' ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Le pagaste (banco)</CardTitle>
                  <div className="p-2 rounded-lg bg-destructive/10">
                    <TrendingDown className="h-4 w-4 text-destructive" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-destructive">{formatCurrency(counterpartySummary!.movEgresos)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Egresos bancarios a {counterparty}
                  </p>
                </CardContent>
              </Card>
              <Card className="border-primary/20 bg-primary/[0.02]">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total facturado por {counterparty}</CardTitle>
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Receipt className="h-4 w-4 text-primary" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(counterpartySummary!.facturadoCompra)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {counterpartySummary!.invoiceCountCompra} factura{counterpartySummary!.invoiceCountCompra !== 1 ? 's' : ''} de compra • {periodoLabel}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Movimientos del periodo</CardTitle>
                  <div className="p-2 rounded-lg bg-primary/10">
                    <ArrowUpDown className="h-4 w-4 text-primary" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{counterpartySummary!.movCount}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Total de transacciones bancarias
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : (
            // typeFilter === 'todos': muestra los 3 tradicionales (banco completo)
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Te pagaron (banco)</CardTitle>
                  <div className="p-2 rounded-lg bg-success/10">
                    <TrendingUp className="h-4 w-4 text-success" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-success">{formatCurrency(counterpartySummary!.movIngresos)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ingresos bancarios de {counterparty}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Le pagaste (banco)</CardTitle>
                  <div className="p-2 rounded-lg bg-destructive/10">
                    <TrendingDown className="h-4 w-4 text-destructive" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-destructive">{formatCurrency(counterpartySummary!.movEgresos)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Egresos bancarios a {counterparty}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Movimientos del periodo</CardTitle>
                  <div className="p-2 rounded-lg bg-primary/10">
                    <ArrowUpDown className="h-4 w-4 text-primary" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{counterpartySummary!.movCount}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Total de transacciones bancarias
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Saldo neto del cliente.
              Puede ser positivo (te deben pagar), 0 (al día) o negativo
              (te recibieron más de lo facturado → tenés que emitirles facturas).
              Cambia título, color y mensaje según el signo.
              Mostramos el card si el cliente tiene CUALQUIER actividad (facturas,
              movimientos bancarios, remisiones del período o saldos iniciales).
              Antes solo se mostraba si había facturas — clientes con remisiones
              pero sin DIAN aún se quedaban sin saldo. */}
          {(
            counterpartySummary!.hasInvoices ||
            (counterpartySummary?.movCount ?? 0) > 0 ||
            remisionesPeriodo.count > 0
          ) && (() => {
            const isVenta = typeFilter !== 'egreso';
            const saldo = isVenta ? counterpartySummary!.pendienteVenta : counterpartySummary!.pendienteCompra;
            // Saldo > 0 → te deben pagar (lado venta) o tenés que pagar (lado compra)
            // Saldo < 0 → exceso recibido/entregado, hay que emitir/recibir factura
            // Saldo = 0 → cuentas al día
            let titulo: string;
            let mensaje: string;
            let color: 'destructive' | 'warning' | 'success';
            if (Math.abs(saldo) < 1) {
              titulo = 'Cuentas al día';
              mensaje = 'No hay saldos pendientes en ninguna dirección.';
              color = 'success';
            } else if (saldo > 0) {
              titulo = isVenta ? 'Te deben (saldo por cobrar)' : 'Le debés (saldo por pagar)';
              mensaje = isVenta
                ? `${counterparty} todavía no terminó de pagarte el total facturado.`
                : `Todavía no terminaste de pagarle a ${counterparty} el total facturado.`;
              color = 'destructive';
            } else {
              titulo = isVenta
                ? 'Pendiente de facturarles'
                : 'Anticipos pagados pendientes de factura';
              mensaje = isVenta
                ? `${counterparty} te pagó más de lo que facturaste — tenés que emitirles facturas por la diferencia.`
                : `Le pagaste a ${counterparty} más de lo facturado — falta que ellos te emitan facturas.`;
              color = 'warning';
            }

            const colorClasses = {
              destructive: { card: 'border-destructive/20 bg-destructive/[0.02]', value: 'text-destructive' },
              warning: { card: 'border-amber-500/30 bg-amber-500/[0.04]', value: 'text-amber-600' },
              success: { card: 'border-success/20 bg-success/[0.04]', value: 'text-success' },
            }[color];

            const recibido = isVenta ? counterpartySummary!.movIngresos : counterpartySummary!.movEgresos;
            const facturadoLado = isVenta ? counterpartySummary!.facturadoVenta : counterpartySummary!.facturadoCompra;
            const inicialLado = isVenta ? counterpartySummary!.cxcInicial : counterpartySummary!.cxpInicial;
            const anticiposLado = isVenta ? counterpartySummary!.anticiposClienteTotal : counterpartySummary!.anticiposProvTotal;
            const recibidoLabel = isVenta ? 'Pagos identificados (banco)' : 'Pagos hechos (banco)';
            const anticiposLabel = isVenta ? 'Anticipos del cliente' : 'Anticipos a proveedor';

            return (
              <Card className={colorClasses.card}>
                <CardContent className="py-4 px-5 space-y-3">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                      {titulo}
                    </p>
                    <p className={`text-3xl font-bold tabular-nums mt-1 ${colorClasses.value}`}>
                      {formatCurrency(Math.abs(saldo))}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1.5 max-w-2xl">
                      {mensaje}
                    </p>
                  </div>

                  {/* Desglose del cálculo — incluye AHORA todos los pagos del banco */}
                  <div className="text-xs text-muted-foreground bg-background rounded-md p-3 border">
                    <p className="font-semibold text-foreground mb-1.5 text-[11px] uppercase tracking-wider">Cómo se calcula</p>
                    <ul className="space-y-1 tabular-nums">
                      <li className="flex justify-between">
                        <span>Facturado en {periodoLabel}</span>
                        <span className="font-medium">{formatCurrency(facturadoLado)}</span>
                      </li>
                      {inicialLado > 0 && (
                        <li className="flex justify-between">
                          <span>+ {isVenta ? 'Saldo inicial por cobrar' : 'Saldo inicial por pagar'}</span>
                          <span className="font-medium">{formatCurrency(inicialLado)}</span>
                        </li>
                      )}
                      {recibido > 0 && (
                        <li className="flex justify-between text-success">
                          <span>− {recibidoLabel}</span>
                          <span className="font-medium">{formatCurrency(recibido)}</span>
                        </li>
                      )}
                      {anticiposLado > 0 && (
                        <li className="flex justify-between text-success">
                          <span>− {anticiposLabel}</span>
                          <span className="font-medium">{formatCurrency(anticiposLado)}</span>
                        </li>
                      )}
                      {/* Línea de retenciones: SIEMPRE visible cuando hay
                          facturado del lado correspondiente, aunque sea 0.
                          Antes se ocultaba si retenciones=0 y Nico no veía que
                          el cálculo las consideraba ("no veo las retenciones
                          restadas"). Mostrarla aunque sea 0 hace transparente
                          la fórmula. */}
                      {isVenta && facturadoLado > 0 && (
                        <li className={`flex justify-between ${counterpartySummary!.retencionesVenta > 0 ? 'text-success' : ''}`}>
                          <span>− Retenciones (rete­fuente + reteica + autorete­fuente)</span>
                          <span className="font-medium">{formatCurrency(counterpartySummary!.retencionesVenta)}</span>
                        </li>
                      )}
                      {!isVenta && facturadoLado > 0 && (
                        <li className={`flex justify-between ${counterpartySummary!.retencionesCompra > 0 ? 'text-success' : ''}`}>
                          <span>− Retenciones aplicadas al proveedor (rete­fuente + reteica + autorete­fuente)</span>
                          <span className="font-medium">{formatCurrency(counterpartySummary!.retencionesCompra)}</span>
                        </li>
                      )}
                      <li className={`flex justify-between border-t pt-1.5 mt-1 font-semibold ${colorClasses.value}`}>
                        <span>
                          = {saldo > 0 ? 'Saldo pendiente' : saldo < 0 ? 'Saldo a favor del cliente' : 'Saldo cero'}
                        </span>
                        <span>
                          {saldo < 0 ? '−' : ''}{formatCurrency(Math.abs(saldo))}
                        </span>
                      </li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* Card de remisiones del cliente en el período. Muestra suma + cantidad.
              Solo aparece si el cliente tiene al menos una remisión en el período. */}
          {remisionesPeriodo.count > 0 && (
            <Card className="border-primary/20 bg-primary/[0.02]">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total remisiones a {counterparty} — {periodoLabel}
                </CardTitle>
                <div className="p-2 rounded-lg bg-primary/10">
                  <Receipt className="h-4 w-4 text-primary" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums">{formatCurrency(remisionesPeriodo.total)}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {remisionesPeriodo.count} remisi{remisionesPeriodo.count === 1 ? 'ón' : 'ones'} despachada{remisionesPeriodo.count === 1 ? '' : 's'}
                  {counterpartySummary?.facturadoVenta && counterpartySummary.facturadoVenta > 0
                    ? ` · ${Math.round((remisionesPeriodo.total / counterpartySummary.facturadoVenta) * 100)}% del facturado`
                    : ''}
                </p>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        // Vista general (sin cliente seleccionado).
        // Muestra DOS bloques de cards: ingresos (banco vs facturado venta)
        // y egresos (banco vs facturado compra). Permite comparar de un vistazo
        // si lo cobrado en banco coincide con lo facturado.
        <>
          {/* INGRESOS */}
          {(typeFilter === 'todos' || typeFilter === 'ingreso') && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-success" />
                Ingresos
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Total cobrado (banco)</CardTitle>
                    <div className="p-2 rounded-lg bg-success/10">
                      <TrendingUp className="h-4 w-4 text-success" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-success">{formatCurrency(totals.ingresos)}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {rows.filter((r) => r.type === 'ingreso').length} ingresos en {periodoLabel}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-primary/20 bg-primary/[0.02]">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Total facturado (venta)</CardTitle>
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Receipt className="h-4 w-4 text-primary" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(invoiceTotals?.ventas ?? 0)}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {invoiceTotals?.ventasCount ?? 0} factura{(invoiceTotals?.ventasCount ?? 0) !== 1 ? 's' : ''} confirmada{(invoiceTotals?.ventasCount ?? 0) !== 1 ? 's' : ''}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Brecha ingresos</CardTitle>
                    <div className="p-2 rounded-lg bg-amber-500/10">
                      <ArrowUpDown className="h-4 w-4 text-amber-600" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className={`text-2xl font-bold tabular-nums ${
                      (invoiceTotals?.ventas ?? 0) - totals.ingresos > 0 ? 'text-amber-600' : 'text-success'
                    }`}>
                      {formatCurrency(Math.max(0, (invoiceTotals?.ventas ?? 0) - totals.ingresos))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Facturado − cobrado (pendiente o no conciliado)
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* EGRESOS */}
          {(typeFilter === 'todos' || typeFilter === 'egreso') && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-2">
                <TrendingDown className="h-3.5 w-3.5 text-destructive" />
                Egresos
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Total pagado (banco)</CardTitle>
                    <div className="p-2 rounded-lg bg-destructive/10">
                      <TrendingDown className="h-4 w-4 text-destructive" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-destructive">{formatCurrency(totals.egresos)}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {rows.filter((r) => r.type === 'egreso').length} egresos en {periodoLabel}
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-primary/20 bg-primary/[0.02]">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Total facturado (compra)</CardTitle>
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Receipt className="h-4 w-4 text-primary" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{formatCurrency(invoiceTotals?.compras ?? 0)}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {invoiceTotals?.comprasCount ?? 0} factura{(invoiceTotals?.comprasCount ?? 0) !== 1 ? 's' : ''} confirmada{(invoiceTotals?.comprasCount ?? 0) !== 1 ? 's' : ''}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Brecha egresos</CardTitle>
                    <div className="p-2 rounded-lg bg-amber-500/10">
                      <ArrowUpDown className="h-4 w-4 text-amber-600" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className={`text-2xl font-bold tabular-nums ${
                      (invoiceTotals?.compras ?? 0) - totals.egresos > 0 ? 'text-amber-600' : 'text-success'
                    }`}>
                      {formatCurrency(Math.max(0, (invoiceTotals?.compras ?? 0) - totals.egresos))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Facturado − pagado (pendiente o no conciliado)
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </>
      )}

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/80">
                  <TableHead className="font-semibold">Fecha</TableHead>
                  <TableHead className="font-semibold">Tipo</TableHead>
                  <TableHead className="font-semibold">Origen</TableHead>
                  <TableHead className="font-semibold">Descripción</TableHead>
                  {counterparty === 'all' && (
                    <TableHead className="font-semibold">Cliente</TableHead>
                  )}
                  <TableHead className="font-semibold">Factura</TableHead>
                  <TableHead className="font-semibold text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={counterparty === 'all' ? 7 : 6} className="text-center py-12 text-muted-foreground">
                      Cargando movimientos...
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={counterparty === 'all' ? 7 : 6} className="text-center py-12 text-muted-foreground">
                      No hay pagos en el periodo seleccionado.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatDateLong(r.date)}</TableCell>
                      <TableCell>
                        {r.type === 'ingreso' ? (
                          <Badge variant="outline" className="bg-success/10 text-success border-success/30">Ingreso</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">Egreso</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          {r.source === 'banco' ? <Banknote className="h-3 w-3" /> : <Wallet className="h-3 w-3" />}
                          {r.source === 'banco' ? 'Banco' : 'Efectivo'}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-sm" title={r.description}>{r.description}</TableCell>
                      {counterparty === 'all' && (
                        <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
                          {r.counterparty ?? '—'}
                        </TableCell>
                      )}
                      <TableCell className="text-xs text-muted-foreground">
                        {r.invoice_ref && r.source === 'banco' && r.rawTxId ? (
                          // Click sobre el chip vinculado → abre el modal en modo
                          // edición (preseleccionada + botón "Desvincular").
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[11px] font-medium text-foreground hover:bg-primary/10 gap-1"
                            onClick={() => setLinkingTx(r)}
                            title="Cambiar o desvincular la factura"
                          >
                            <Link2 className="h-3 w-3" />#{r.invoice_ref}
                          </Button>
                        ) : r.invoice_ref ? (
                          <span className="inline-flex items-center gap-1 font-medium text-foreground">
                            <Link2 className="h-3 w-3" />#{r.invoice_ref}
                          </span>
                        ) : r.source === 'banco' && r.rawTxId ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[11px] text-primary hover:text-primary hover:bg-primary/10 gap-1"
                            onClick={() => setLinkingTx(r)}
                          >
                            <Link2 className="h-3 w-3" />
                            Vincular
                          </Button>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium tabular-nums ${
                          r.type === 'ingreso' ? 'text-success' : 'text-destructive'
                        }`}
                      >
                        {r.type === 'ingreso' ? '+' : '−'}{formatCurrency(r.amount)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Modal vincular tx ↔ factura */}
      <VincularFacturaTxModal
        open={linkingTx !== null}
        onOpenChange={(o) => !o && setLinkingTx(null)}
        tx={linkingTx ? {
          id: linkingTx.rawTxId!,
          date: linkingTx.date,
          description: linkingTx.description,
          amount: linkingTx.amount,
          type: linkingTx.type,
          counterparty: linkingTx.counterparty,
          responsibleId: linkingTx.responsible_id,
        } : null}
        currentInvoiceId={linkingTx?.invoice_id ?? null}
        onSuccess={() => {
          // Invalidar queries del reporte para refrescar la fila y el saldo.
          // Las keys versionadas (v4 / v6) cambian cuando se hace bump del
          // schema; mantener acá las MISMAS strings que en useQuery — si no,
          // la fila vinculada no aparece sin refresh manual.
          queryClient.invalidateQueries({ queryKey: ['payments-log-v4'] });
          queryClient.invalidateQueries({ queryKey: ['payments-log-counterparty-summary-v6'] });
          queryClient.invalidateQueries({ queryKey: ['payments-log-invoice-totals'] });
        }}
      />

      {/* Modal email */}
      <EmailModal
        open={emailModalOpen}
        onOpenChange={setEmailModalOpen}
        rows={rows}
        counterparty={counterparty === 'all' ? null : counterparty}
        counterpartySummary={counterpartySummary ?? null}
        periodoLabel={periodoLabel}
        fileSlug={fileSlug}
        buildWorkbook={buildWorkbook}
        xlsxColumns={xlsxColumns}
        totalsGeneral={totals}
        buildPdf={buildAndDownloadPdf}
        attachRemision={!!selectedRemisionId}
      />
    </div>
  );
}

// ---------- EmailModal ----------

interface CounterpartySummary {
  facturado: number;
  facturadoVenta: number;
  facturadoCompra: number;
  cobrado: number;
  // pendiente* puede ser negativo: significa que se recibió más de lo
  // facturado (anticipos vivos pendientes de ser facturados).
  pendiente: number;
  pendienteVenta: number;
  pendienteCompra: number;
  excesoCobradoVenta: number;
  excesoEntregadoCompra: number;
  cxcInicial: number;
  cxpInicial: number;
  anticiposClienteUnlinked: number;
  anticiposClienteLinked: number;
  anticiposClienteTotal: number;
  anticiposProvUnlinked: number;
  anticiposProvLinked: number;
  anticiposProvTotal: number;
  invoiceCount: number;
  invoiceCountVenta: number;
  invoiceCountCompra: number;
  movIngresos: number;
  movEgresos: number;
  movCount: number;
  hasInvoices: boolean;
}

interface EmailModalProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rows: PaymentRow[];
  counterparty: string | null;
  counterpartySummary: CounterpartySummary | null;
  periodoLabel: string;
  fileSlug: string;
  buildWorkbook: () => any[];
  xlsxColumns: any;
  totalsGeneral: { ingresos: number; egresos: number };
  /** Genera el PDF (incluye remisión si fue elegida en el reporte). */
  buildPdf: () => Promise<jsPDF | null>;
  /** True si el reporte tiene una remisión seleccionada — en ese caso, además
   *  del Excel, adjuntamos el PDF (que incluye relación de pagos + remisión). */
  attachRemision: boolean;
}

function EmailModal({
  open, onOpenChange, rows, counterparty, counterpartySummary,
  periodoLabel, fileSlug, buildWorkbook, xlsxColumns, totalsGeneral,
  buildPdf, attachRemision,
}: EmailModalProps) {
  const [toEmail, setToEmail] = useState('');
  const [toName, setToName] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  // Pre-llenar nombre cuando se abre con cliente seleccionado
  const opened = useMemo(() => open, [open]);
  useMemo(() => {
    if (opened && counterparty) setToName(counterparty);
  }, [opened, counterparty]);

  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const handleSend = async () => {
    if (!isValidEmail(toEmail)) {
      toast.error('Ingresá un correo válido.');
      return;
    }
    if (rows.length === 0) {
      toast.error('No hay movimientos para enviar.');
      return;
    }
    setSending(true);
    try {
      // Generar Excel como blob → base64 (chunks para evitar stack overflow)
      const blob = await (writeXlsxFile as unknown as (d: unknown, o: unknown) => Promise<Blob>)(
        buildWorkbook(), { columns: xlsxColumns },
      );
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
      }
      const base64 = btoa(binary);

      const summary = counterpartySummary
        ? {
            facturado: counterpartySummary.facturado,
            cobrado: counterpartySummary.cobrado,
            pendiente: counterpartySummary.pendiente,
            periodo: periodoLabel,
            count: rows.length,
          }
        : {
            facturado: totalsGeneral.ingresos, // sin counterparty mostramos ingresos como "facturado"
            cobrado: 0,
            pendiente: 0,
            periodo: periodoLabel,
            count: rows.length,
          };

      // Si el reporte tiene una remisión seleccionada, generamos también el PDF
      // (que ya incluye páginas extra de remisión) y lo mandamos como segundo
      // attachment. Así el cliente recibe ambos: Excel (detalle de movs) + PDF
      // (estado de cuenta presentable + remisión).
      let pdfBase64: string | null = null;
      let pdfFileName: string | null = null;
      if (attachRemision) {
        try {
          const pdf = await buildPdf();
          if (pdf) {
            const dataUri = pdf.output('datauristring');
            // datauristring viene como "data:application/pdf;filename=...;base64,XXX"
            const b64Match = dataUri.match(/base64,(.+)$/);
            if (b64Match) {
              pdfBase64 = b64Match[1];
              pdfFileName = fileSlug.replace(/\.xlsx$/i, '.pdf');
            }
          }
        } catch (e) {
          console.error('Generación de PDF para email falló:', e);
          // Seguimos enviando solo el Excel — no rompemos el flujo principal.
        }
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-payments-report-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            to_email: toEmail.trim(),
            to_name: toName.trim() || null,
            message: message.trim() || null,
            file_base64: base64,
            file_name: fileSlug,
            summary: counterpartySummary ? summary : null,
            pdf_base64: pdfBase64,
            pdf_file_name: pdfFileName,
          }),
        },
      );
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok || payload?.error) {
        throw new Error(payload?.error || `Error ${resp.status}`);
      }
      toast.success(`Correo enviado a ${toEmail}`);
      onOpenChange(false);
      setToEmail(''); setToName(''); setMessage('');
    } catch (err: any) {
      console.error('send payments email error:', err);
      toast.error(err?.message || 'No pudimos enviar el correo. Probá de nuevo.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar relación de pagos por correo</DialogTitle>
          <DialogDescription>
            {counterparty
              ? `Estado de cuenta de ${counterparty} — ${periodoLabel}. ${rows.length} movimiento${rows.length !== 1 ? 's' : ''}.`
              : `Relación de pagos — ${periodoLabel}. ${rows.length} movimiento${rows.length !== 1 ? 's' : ''}.`}
            {attachRemision && (
              <span className="block mt-1 text-primary">
                Se adjuntará también el PDF con la remisión seleccionada.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="to-email" className="text-xs">Correo del destinatario</Label>
            <Input
              id="to-email" type="email" placeholder="cliente@empresa.com"
              value={toEmail} onChange={(e) => setToEmail(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="to-name" className="text-xs">Nombre (opcional)</Label>
            <Input
              id="to-name" type="text" placeholder="Aluminios JH"
              value={toName} onChange={(e) => setToName(e.target.value)}
              className="mt-1"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Aparecerá en el saludo del correo: "Hola {toName || '<nombre>'} 👋"
            </p>
          </div>
          <div>
            <Label htmlFor="msg" className="text-xs">Mensaje adicional (opcional)</Label>
            <Textarea
              id="msg" placeholder="Cualquier comentario que quieras agregar al correo..."
              value={message} onChange={(e) => setMessage(e.target.value)}
              rows={3} className="mt-1 text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={handleSend} disabled={sending || !isValidEmail(toEmail)} className="gap-2">
            {sending ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</> : <><Mail className="h-4 w-4" /> Enviar</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
