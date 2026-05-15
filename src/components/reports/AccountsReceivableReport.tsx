import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useModuleContext } from '@/hooks/useModuleContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Receipt, AlertCircle, Info, CheckCircle2, ChevronDown, ChevronRight, Wallet, Link2, ArrowDownCircle, Users, TrendingDown } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import VincularPagoModal from './VincularPagoModal';
import {
  calculateAllClientReceivables,
  type ClientReceivable,
  type InvoiceLine,
} from '@/lib/clientReceivables';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

const currentYear = new Date().getFullYear();
const availableYears = Array.from({ length: 5 }, (_, i) => currentYear - i);

interface VincularInvoiceTarget {
  id: string;
  invoice_number: string;
  counterparty_name: string | null;
  pending: number;
  total_amount: number;
}

export default function AccountsReceivableReport() {
  const { user } = useAuth();
  const { isGerencial } = useModuleContext();
  const [year, setYear] = useState(currentYear);
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
  const [showPagadasByClient, setShowPagadasByClient] = useState<Set<string>>(new Set());
  const [vincularInvoice, setVincularInvoice] = useState<VincularInvoiceTarget | null>(null);
  const [showSaldoAFavor, setShowSaldoAFavor] = useState(false);

  // Cartera por cliente — alineada con la lógica de PaymentsLogReport vía util
  // compartido `calculateAllClientReceivables`. Garantiza que el saldo de un
  // cliente sea idéntico al que muestra Relación de Pagos.
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['accounts-receivable-by-client', user?.id, year],
    queryFn: async () => {
      if (!user) return null;
      return await calculateAllClientReceivables(year);
    },
    enabled: !!user,
  });

  // KPI Gerencial: cobros en efectivo del año (heurística de cartera real).
  const { data: cashIncomeYear } = useQuery({
    queryKey: ['ar-cash-income', user?.id, year, isGerencial],
    queryFn: async () => {
      if (!user || !isGerencial) return 0;
      const { data, error } = await supabase
        .from('cash_movements')
        .select('amount')
        .eq('type', 'ingreso')
        .gte('date', `${year}-01-01`)
        .lte('date', `${year}-12-31`);
      if (error) return 0;
      return (data ?? []).reduce((s, r: { amount: number | null }) => s + Number(r.amount ?? 0), 0);
    },
    enabled: !!user && isGerencial,
  });

  const cobrosEfectivo = cashIncomeYear ?? 0;
  const totalPending = data?.total_saldo_pendiente ?? 0;
  const carteraReal = isGerencial
    ? Math.max(0, totalPending - cobrosEfectivo)
    : totalPending;

  const clientsConDeuda = useMemo(
    () => (data?.clients ?? []).filter(c => c.saldo_neto > 0),
    [data],
  );
  const clientsSaldoAFavor = useMemo(
    () => (data?.clients ?? []).filter(c => c.saldo_neto < 0),
    [data],
  );

  const toggleClient = (id: string) => {
    setExpandedClients(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const togglePagadas = (clientId: string) => {
    setShowPagadasByClient(prev => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Header + año */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">Lo que me deben</CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm">
                    <p className="text-xs leading-snug">
                      Saldo por cliente alineado con Relación de Pagos:
                      facturado + saldo inicial − ingresos del banco del cliente − anticipos.
                      Excluye facturas anuladas con nota crédito.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableYears.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
        </Card>

        {/* KPIs */}
        <div className={isGerencial ? "grid grid-cols-1 md:grid-cols-4 gap-3" : "grid grid-cols-1 md:grid-cols-2 gap-3"}>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {isGerencial ? 'Cartera oficial (DIAN)' : 'Total cartera'}
              </CardTitle>
              <div className="p-2 rounded-lg bg-destructive/10">
                <Receipt className="h-4 w-4 text-destructive" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{formatCurrency(totalPending)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {clientsConDeuda.length} cliente{clientsConDeuda.length !== 1 ? 's' : ''} con saldo • {year}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Saldo a favor</CardTitle>
              <div className="p-2 rounded-lg bg-success/10">
                <ArrowDownCircle className="h-4 w-4 text-success" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-success">{formatCurrency(data?.total_saldo_a_favor ?? 0)}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Anticipos vivos / cobrado de más
              </p>
            </CardContent>
          </Card>

          {isGerencial && (
            <>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Cobrado en efectivo</CardTitle>
                  <div className="p-2 rounded-lg bg-warning/10">
                    <Wallet className="h-4 w-4 text-warning" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-warning">{formatCurrency(cobrosEfectivo)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ingresos en efectivo • {year}
                  </p>
                </CardContent>
              </Card>

              <Card className="border-success/30 bg-success/[0.02]">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Cartera real estimada</CardTitle>
                  <div className="p-2 rounded-lg bg-success/10">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-success">{formatCurrency(carteraReal)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Oficial − cobros en efectivo
                  </p>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Tabla por cliente */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-medium">
                  Saldo por cliente ({clientsConDeuda.length})
                </CardTitle>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/80">
                    <TableHead className="w-8"></TableHead>
                    <TableHead className="font-semibold">Cliente</TableHead>
                    <TableHead className="font-semibold text-right">Facturado</TableHead>
                    <TableHead className="font-semibold text-right">Saldo inicial</TableHead>
                    <TableHead className="font-semibold text-right">Cobrado</TableHead>
                    <TableHead className="font-semibold text-right">Anticipos</TableHead>
                    <TableHead className="font-semibold text-right">Saldo neto</TableHead>
                    <TableHead className="font-semibold text-center"># Facturas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                        Cargando datos...
                      </TableCell>
                    </TableRow>
                  ) : clientsConDeuda.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12">
                        <div className="flex flex-col items-center gap-2">
                          <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
                          <p className="text-muted-foreground">Ningún cliente con saldo pendiente en {year}.</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    clientsConDeuda.map(client => (
                      <ClientRow
                        key={client.client_id}
                        client={client}
                        isExpanded={expandedClients.has(client.client_id)}
                        onToggle={() => toggleClient(client.client_id)}
                        showPagadas={showPagadasByClient.has(client.client_id)}
                        onTogglePagadas={() => togglePagadas(client.client_id)}
                        onVincularInvoice={(inv) => setVincularInvoice({
                          id: inv.id,
                          invoice_number: inv.invoice_number,
                          counterparty_name: client.client_name,
                          pending: inv.pending_invoice,
                          total_amount: inv.total_amount,
                        })}
                      />
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Saldos a favor (anticipos vivos / cobrado de más) */}
        {!isLoading && clientsSaldoAFavor.length > 0 && (
          <Card>
            <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowSaldoAFavor(s => !s)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-success" />
                  <CardTitle className="text-sm font-medium">
                    Clientes con saldo a favor ({clientsSaldoAFavor.length})
                  </CardTitle>
                </div>
                {showSaldoAFavor
                  ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </div>
            </CardHeader>
            {showSaldoAFavor && (
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/80">
                        <TableHead className="font-semibold">Cliente</TableHead>
                        <TableHead className="font-semibold text-right">Facturado</TableHead>
                        <TableHead className="font-semibold text-right">Cobrado</TableHead>
                        <TableHead className="font-semibold text-right">Saldo a favor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clientsSaldoAFavor.map(c => (
                        <TableRow key={c.client_id}>
                          <TableCell className="text-sm font-medium">{c.client_name}</TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(c.facturado_venta + c.cxc_inicial)}</TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(c.cobrado_banco + c.anticipos_total)}</TableCell>
                          <TableCell className="text-right text-sm font-bold text-success">{formatCurrency(Math.abs(c.saldo_neto))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            )}
          </Card>
        )}

        <VincularPagoModal
          open={!!vincularInvoice}
          onOpenChange={(v) => { if (!v) setVincularInvoice(null); }}
          invoice={vincularInvoice}
          onSuccess={() => { refetch(); }}
        />
      </div>
    </TooltipProvider>
  );
}

// ============================================================================
// Sub-component: una fila por cliente + drill-down a sus facturas.
// ============================================================================
interface ClientRowProps {
  client: ClientReceivable;
  isExpanded: boolean;
  onToggle: () => void;
  showPagadas: boolean;
  onTogglePagadas: () => void;
  onVincularInvoice: (inv: InvoiceLine) => void;
}

function ClientRow({ client, isExpanded, onToggle, showPagadas, onTogglePagadas, onVincularInvoice }: ClientRowProps) {
  const facturado = client.facturado_venta;
  const cobrado = client.cobrado_banco;
  const anticipos = client.anticipos_total;
  const cxcInicial = client.cxc_inicial;
  const saldo = client.saldo_neto;
  const nPendientes = client.invoices_pendientes.length;

  return (
    <React.Fragment>
      <TableRow
        className={cn(
          'cursor-pointer hover:bg-muted/50',
          isExpanded && 'bg-muted/30 border-l-2 border-l-primary',
        )}
        onClick={onToggle}
      >
        <TableCell className="w-8 px-2">
          {isExpanded
            ? <ChevronDown className="h-4 w-4 text-primary" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </TableCell>
        <TableCell className="text-sm font-medium">{client.client_name}</TableCell>
        <TableCell className="text-right text-sm">{formatCurrency(facturado)}</TableCell>
        <TableCell className="text-right text-sm text-warning">
          {cxcInicial > 0 ? formatCurrency(cxcInicial) : '—'}
        </TableCell>
        <TableCell className="text-right text-sm text-success">{formatCurrency(cobrado)}</TableCell>
        <TableCell className="text-right text-sm text-success">
          {anticipos > 0 ? `−${formatCurrency(anticipos)}` : '—'}
        </TableCell>
        <TableCell className="text-right text-sm font-bold text-destructive">
          {formatCurrency(saldo)}
        </TableCell>
        <TableCell className="text-center text-xs text-muted-foreground">
          {nPendientes} pend.
        </TableCell>
      </TableRow>

      {isExpanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={8} className="p-0">
            <div className="bg-muted/10 border-l-2 border-l-primary px-6 py-4 space-y-3">
              <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Receipt className="h-4 w-4 text-primary" />
                Facturas pendientes
              </p>

              {client.invoices_pendientes.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  Sin facturas pendientes — el saldo viene del saldo inicial o anticipos.
                </p>
              ) : (
                <div className="space-y-1">
                  {client.invoices_pendientes.map(inv => (
                    <InvoiceLineRow key={inv.id} inv={inv} onVincular={() => onVincularInvoice(inv)} />
                  ))}
                </div>
              )}

              {/* Resumen de cálculo */}
              <div className="space-y-1 pt-2 border-t border-border text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Facturado del año</span>
                  <span className="font-mono">{formatCurrency(facturado)}</span>
                </div>
                {cxcInicial > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">+ Saldo inicial (periodo anterior)</span>
                    <span className="font-mono">{formatCurrency(cxcInicial)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-success">
                  <span>− Cobrado en banco</span>
                  <span className="font-mono">{formatCurrency(cobrado)}</span>
                </div>
                {anticipos > 0 && (
                  <div className="flex items-center justify-between text-success">
                    <span>− Anticipos del cliente</span>
                    <span className="font-mono">{formatCurrency(anticipos)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1.5 border-t border-border text-sm">
                  <span className="font-semibold">Saldo neto</span>
                  <span className={cn("font-mono font-bold", saldo > 0 ? 'text-destructive' : 'text-success')}>
                    {formatCurrency(saldo)}
                  </span>
                </div>
              </div>

              {/* Facturas pagadas — colapsable */}
              {client.invoices_pagadas.length > 0 && (
                <div className="pt-2 border-t border-border">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onTogglePagadas(); }}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPagadas ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    Facturas cubiertas ({client.invoices_pagadas.length})
                  </button>
                  {showPagadas && (
                    <div className="mt-2 space-y-1">
                      {client.invoices_pagadas.map(inv => (
                        <InvoiceLineRow key={inv.id} inv={inv} paid />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </React.Fragment>
  );
}

// ============================================================================
// Sub-component: una línea de factura (pendiente o pagada) dentro del drill-down.
// ============================================================================
interface InvoiceLineRowProps {
  inv: InvoiceLine;
  paid?: boolean;
  onVincular?: () => void;
}

function InvoiceLineRow({ inv, paid = false, onVincular }: InvoiceLineRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-2.5 rounded-lg bg-card border border-border/60 text-xs",
        paid && "opacity-60",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono font-medium">{inv.invoice_number || '(s/n)'}</span>
          <span className="text-muted-foreground">
            {format(parseLocalDate(inv.issue_date), 'dd MMM yyyy', { locale: es })}
          </span>
          {inv.void_type === 'partial' && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 bg-warning/10 text-warning border-warning/30">
              Nota crédito parcial
            </Badge>
          )}
          {!paid && inv.days_since > 30 && (
            <Badge variant="outline" className={cn(
              "text-[9px] px-1 py-0",
              inv.days_since > 90 ? 'bg-destructive/10 text-destructive border-destructive/30'
                : 'bg-warning/10 text-warning border-warning/30',
            )}>
              {inv.days_since}d
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-muted-foreground">
          <span>Total: {formatCurrency(inv.total_amount)}</span>
          {inv.paid_direct > 0 && <span className="text-success">Pagado: {formatCurrency(inv.paid_direct)}</span>}
          {inv.retefuente > 0 && <span className="text-primary">Retefuente: {formatCurrency(inv.retefuente)}</span>}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={cn("font-mono font-bold", paid ? 'text-success' : 'text-destructive')}>
          {paid ? 'Cubierta' : formatCurrency(inv.pending_invoice)}
        </div>
        {!paid && onVincular && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px] mt-0.5 gap-1 text-primary hover:bg-primary/10"
            onClick={(e) => { e.stopPropagation(); onVincular(); }}
          >
            <Link2 className="h-2.5 w-2.5" />
            Vincular pago
          </Button>
        )}
      </div>
    </div>
  );
}
