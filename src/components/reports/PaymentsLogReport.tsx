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
  Banknote, Wallet, Mail, MessageCircle, Loader2, User, Receipt,
} from 'lucide-react';

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

interface PaymentRow {
  id: string;
  date: string;
  description: string;
  type: 'ingreso' | 'egreso';
  amount: number;
  source: 'banco' | 'efectivo';
  category: string | null;
  responsible: string | null;
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

  const startDate = month === 0 ? `${year}-01-01` : `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = (() => {
    if (month === 0) return `${year}-12-31`;
    const last = new Date(year, month, 0);
    return `${year}-${String(month).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  })();

  // Lista de beneficiarios (responsibles) únicos del año.
  // Los sacamos desde `responsibles` que tienen al menos una transacción
  // asociada — son los que aparecen como "beneficiario" en conciliación
  // bancaria. Antes los sacábamos desde invoices.counterparty_name pero
  // eso dejaba afuera a clientes que solo tienen movimientos bancarios
  // (sin factura emitida) y mostraba pagos cruzados mal.
  const { data: counterpartyOptions } = useQuery({
    queryKey: ['payments-log-counterparties-v2', user?.id, year],
    queryFn: async (): Promise<CounterpartyOption[]> => {
      if (!user) return [];
      // 1. Traer todos los responsibles del usuario
      const { data: resps } = await supabase
        .from('responsibles')
        .select('id, name')
        .eq('user_id', user.id);
      const respMap = new Map<string, string>();
      (resps ?? []).forEach((r: any) => respMap.set(r.id, r.name));
      // 2. Quedarnos solo con los que tienen transacciones en el año
      const { data: txs } = await supabase
        .from('transactions')
        .select('responsible_id')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .not('responsible_id', 'is', null)
        .gte('date', `${year}-01-01`)
        .lte('date', `${year}-12-31`);
      const usedIds = new Set<string>();
      (txs ?? []).forEach((t: any) => {
        if (t.responsible_id) usedIds.add(t.responsible_id);
      });
      const names = new Set<string>();
      usedIds.forEach((id) => {
        const name = respMap.get(id);
        if (name) names.add(name);
      });
      return Array.from(names)
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
    queryKey: ['payments-log-counterparty-summary-v2', user?.id, counterparty, year],
    queryFn: async () => {
      if (!user || counterparty === 'all') return null;

      // 1. Sumar movimientos bancarios del responsible
      const { data: resp } = await supabase
        .from('responsibles')
        .select('id')
        .eq('user_id', user.id)
        .eq('name', counterparty)
        .maybeSingle();
      let movIngresos = 0;
      let movEgresos = 0;
      let movCount = 0;
      if (resp?.id) {
        const { data: txs } = await supabase
          .from('transactions')
          .select('amount, type')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .eq('responsible_id', resp.id)
          .gte('date', `${year}-01-01`)
          .lte('date', `${year}-12-31`);
        (txs ?? []).forEach((t: any) => {
          const amt = Math.abs(Number(t.amount ?? 0));
          if (t.type === 'ingreso') movIngresos += amt;
          else if (t.type === 'egreso') movEgresos += amt;
          movCount++;
        });
      }

      // 2. Buscar facturas con counterparty_name parecido al nombre del
      // responsable (case-insensitive, allow partial match para tolerar
      // diferencias menores como "S.A.S" vs sin sufijo).
      const { data: invs } = await supabase
        .from('invoices')
        .select('id, type, total_amount, counterparty_name')
        .eq('user_id', user.id)
        .ilike('counterparty_name', `%${counterparty.split(' ').slice(0, 2).join(' ')}%`)
        .gte('issue_date', `${year}-01-01`)
        .lte('issue_date', `${year}-12-31`);
      const facturado = (invs ?? []).reduce((s: number, i: any) => s + Number(i.total_amount ?? 0), 0);
      const invIds = (invs ?? []).map((i: any) => i.id);

      // 3. Pagos vinculados a esas facturas (transactions + matches)
      let cobrado = 0;
      if (invIds.length > 0) {
        const { data: txs } = await supabase
          .from('transactions')
          .select('amount')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .in('invoice_id', invIds);
        cobrado += (txs ?? []).reduce((s: number, t: any) => s + Math.abs(Number(t.amount ?? 0)), 0);
        const { data: matches } = await supabase
          .from('invoice_transaction_matches')
          .select('matched_amount')
          .eq('user_id', user.id)
          .in('invoice_id', invIds);
        cobrado += (matches ?? []).reduce((s: number, m: any) => s + Math.abs(Number(m.matched_amount ?? 0)), 0);
      }

      return {
        facturado,
        cobrado,
        pendiente: Math.max(0, facturado - cobrado),
        invoiceCount: (invs ?? []).length,
        movIngresos,
        movEgresos,
        movCount,
        hasInvoices: invIds.length > 0,
      };
    },
    enabled: !!user && counterparty !== 'all',
  });

  // Movimientos del periodo
  const { data, isLoading } = useQuery({
    queryKey: ['payments-log', user?.id, year, month, typeFilter, counterparty, isGerencial],
    queryFn: async (): Promise<PaymentRow[]> => {
      if (!user) return [];

      // Banco: transactions con join a categories/responsibles/invoices
      const txQuery = supabase
        .from('transactions')
        .select(`
          id, date, description, type, amount, category_id, responsible_id, invoice_id,
          categories ( name ),
          responsibles ( name ),
          invoices ( invoice_number, counterparty_name )
        `)
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .in('type', ['ingreso', 'egreso'])
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false });
      const txResult = await txQuery;
      if (txResult.error) throw txResult.error;

      const bankRows: PaymentRow[] = (txResult.data ?? []).map((r: any) => ({
        id: `bank-${r.id}`,
        date: r.date,
        description: r.description ?? 'Sin descripción',
        type: r.type as 'ingreso' | 'egreso',
        amount: Math.abs(Number(r.amount ?? 0)),
        source: 'banco',
        category: r.categories?.name ?? null,
        responsible: r.responsibles?.name ?? null,
        invoice_ref: r.invoices?.invoice_number ?? null,
        counterparty: r.responsibles?.name ?? null, // = beneficiario en conciliación
      }));

      // Efectivo solo en Gerencial. cash_movements no tiene responsible,
      // así que en filtro por beneficiario NO se incluyen.
      let cashRows: PaymentRow[] = [];
      if (isGerencial && counterparty === 'all') {
        const cashRes = await supabase
          .from('cash_movements')
          .select('id, date, type, amount, category, notes')
          .eq('user_id', user.id)
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date', { ascending: false });
        if (!cashRes.error && cashRes.data) {
          cashRows = (cashRes.data as any[]).map((r) => ({
            id: `cash-${r.id}`,
            date: r.date,
            description: r.notes ?? 'Movimiento en efectivo',
            type: r.type as 'ingreso' | 'egreso',
            amount: Math.abs(Number(r.amount ?? 0)),
            source: 'efectivo',
            category: r.category ?? null,
            responsible: null,
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

  const periodoLabel = month === 0 ? `${year}` : `${MONTH_LABELS[month]} ${year}`;
  const fileSlug = counterparty !== 'all'
    ? `aluminia_estado_cuenta_${slugify(counterparty)}_${month === 0 ? year : `${year}-${String(month).padStart(2, '0')}`}.xlsx`
    : `aluminia_relacion_pagos_${month === 0 ? year : `${year}-${String(month).padStart(2, '0')}`}.xlsx`;

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

  // WhatsApp share — abre wa.me sin número (el usuario elige contacto).
  // En paralelo descargamos el Excel local para que lo adjunte manualmente.
  const handleWhatsAppShare = async () => {
    if (rows.length === 0) {
      toast.error('No hay pagos para compartir.');
      return;
    }
    try {
      // Mensaje pre-armado
      let msg = '';
      if (counterparty !== 'all' && counterpartySummary) {
        const lines = [
          `*Estado de cuenta — ${periodoLabel}*`,
          ``,
          `📋 Cliente: ${counterparty}`,
        ];
        if (counterpartySummary.hasInvoices) {
          lines.push(
            `💰 Total facturado: ${formatCurrency(counterpartySummary.facturado)}`,
            `✅ Cobrado sobre facturas: ${formatCurrency(counterpartySummary.cobrado)}`,
            `⏳ Saldo pendiente: *${formatCurrency(counterpartySummary.pendiente)}*`,
          );
        }
        lines.push(
          ``,
          `📊 Movimientos bancarios del periodo:`,
          `  ↗️ Te pagaron: ${formatCurrency(counterpartySummary.movIngresos)}`,
          `  ↘️ Le pagaste: ${formatCurrency(counterpartySummary.movEgresos)}`,
          ``,
          `Te paso el detalle completo en el Excel adjunto.`,
        );
        msg = lines.join('\n');
      } else {
        msg = [
          `*Relación de pagos — ${periodoLabel}*`,
          ``,
          `↗️ Ingresos: ${formatCurrency(totals.ingresos)}`,
          `↘️ Egresos: ${formatCurrency(totals.egresos)}`,
          `📊 Neto: ${formatCurrency(totals.ingresos - totals.egresos)}`,
          ``,
          `Detalle en el Excel adjunto.`,
        ].join('\n');
      }
      // Descargar Excel en paralelo
      const data = buildWorkbook();
      await writeXlsxFile(data as any, { fileName: fileSlug, columns: xlsxColumns } as any);
      // Abrir WhatsApp sin número — el usuario elige contacto
      const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
      window.open(url, '_blank');
      toast.info('WhatsApp abierto. El Excel se descargó — arrastralo al chat.');
    } catch (e) {
      console.error(e);
      toast.error('No pudimos abrir WhatsApp. Intentá descargar el Excel y enviarlo manual.');
    }
  };

  const showCounterpartyKpis = counterparty !== 'all' && counterpartySummary;

  return (
    <div className="space-y-4">
      {/* Filtros + acciones */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-[100px] h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="w-[160px] h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTH_LABELS.map((label, i) => (
                    <SelectItem key={i} value={String(i)}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as FilterType)}>
                <SelectTrigger className="w-[140px] h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Ingresos y egresos</SelectItem>
                  <SelectItem value="ingreso">Solo ingresos</SelectItem>
                  <SelectItem value="egreso">Solo egresos</SelectItem>
                </SelectContent>
              </Select>
              <Select value={counterparty} onValueChange={setCounterparty}>
                <SelectTrigger className="w-[200px] h-9 text-sm">
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
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline" size="sm"
                onClick={handleExport}
                disabled={isLoading || rows.length === 0}
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                Excel
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={handleWhatsAppShare}
                disabled={isLoading || rows.length === 0}
                className="gap-2 border-green-600/30 text-green-700 hover:bg-green-50 hover:text-green-700"
              >
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </Button>
              <Button
                size="sm"
                onClick={() => setEmailModalOpen(true)}
                disabled={isLoading || rows.length === 0}
                className="gap-2"
              >
                <Mail className="h-4 w-4" />
                Enviar por correo
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs — vista por cliente vs vista general */}
      {showCounterpartyKpis ? (
        <>
          {/* Cards de movimientos bancarios — siempre disponibles para cualquier
              beneficiario, salgan en facturas o no */}
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

          {/* Cards de facturación SOLO si hay facturas matcheadas — sino el
              cliente solo está en banco (típico de proveedores informales o
              clientes sin factura formal). */}
          {counterpartySummary!.hasInvoices && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card className="border-primary/20 bg-primary/[0.02]">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Facturado</CardTitle>
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Receipt className="h-4 w-4 text-primary" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(counterpartySummary!.facturado)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {counterpartySummary!.invoiceCount} factura{counterpartySummary!.invoiceCount !== 1 ? 's' : ''} • {periodoLabel}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Cobrado sobre facturas</CardTitle>
                  <div className="p-2 rounded-lg bg-success/10">
                    <TrendingUp className="h-4 w-4 text-success" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-success">{formatCurrency(counterpartySummary!.cobrado)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Pagos vinculados a sus facturas
                  </p>
                </CardContent>
              </Card>
              <Card className="border-destructive/20 bg-destructive/[0.02]">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Saldo pendiente</CardTitle>
                  <div className="p-2 rounded-lg bg-destructive/10">
                    <ArrowUpDown className="h-4 w-4 text-destructive" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-destructive">{formatCurrency(counterpartySummary!.pendiente)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Facturado − cobrado
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Ingresos del periodo</CardTitle>
              <div className="p-2 rounded-lg bg-success/10">
                <TrendingUp className="h-4 w-4 text-success" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-success">{formatCurrency(totals.ingresos)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {rows.filter((r) => r.type === 'ingreso').length} movimientos
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Egresos del periodo</CardTitle>
              <div className="p-2 rounded-lg bg-destructive/10">
                <TrendingDown className="h-4 w-4 text-destructive" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{formatCurrency(totals.egresos)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {rows.filter((r) => r.type === 'egreso').length} movimientos
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Neto del periodo</CardTitle>
              <div className="p-2 rounded-lg bg-primary/10">
                <ArrowUpDown className="h-4 w-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${(totals.ingresos - totals.egresos) >= 0 ? 'text-success' : 'text-destructive'}`}>
                {(totals.ingresos - totals.egresos) >= 0 ? '+' : ''}{formatCurrency(totals.ingresos - totals.egresos)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Ingresos − egresos</p>
            </CardContent>
          </Card>
        </div>
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
                        {r.invoice_ref ? `#${r.invoice_ref}` : '—'}
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
      />
    </div>
  );
}

// ---------- EmailModal ----------

interface EmailModalProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rows: PaymentRow[];
  counterparty: string | null;
  counterpartySummary: {
    facturado: number; cobrado: number; pendiente: number; invoiceCount: number;
    movIngresos: number; movEgresos: number; movCount: number; hasInvoices: boolean;
  } | null;
  periodoLabel: string;
  fileSlug: string;
  buildWorkbook: () => any[];
  xlsxColumns: any;
  totalsGeneral: { ingresos: number; egresos: number };
}

function EmailModal({
  open, onOpenChange, rows, counterparty, counterpartySummary,
  periodoLabel, fileSlug, buildWorkbook, xlsxColumns, totalsGeneral,
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
