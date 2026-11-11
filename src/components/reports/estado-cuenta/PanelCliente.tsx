/**
 * Detalle de un cliente al abrir su fila: cómo se llega al saldo, y en
 * pestañas sus facturas pendientes, las cubiertas, los pagos y las remisiones.
 * Mismos datos y mismas acciones que antes (vincular pago, acordar cobro, link
 * de Wompi, compartir): solo cambia la presentación.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  CalendarClock, ExternalLink, Link2, Loader2, Receipt, Share2, Truck, Banknote, CheckCheck, CreditCard,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { calcDaysOverdue } from '@/lib/agingBuckets';
import { parseLocalDate } from '@/lib/dateUtils';
import type { InvoiceLine } from '@/lib/clientReceivables';
import { cn } from '@/lib/utils';
import { usePagosCliente, useRemisionesCliente, isUuidClient } from './datos';
import { formatCurrency, type FilaEstado } from './modelo';
import { ESTADO_UI, MoraPill } from './piezas';

const dia = (iso: string | null | undefined) => (iso ? format(parseLocalDate(iso.slice(0, 10)), 'd MMM yy', { locale: es }) : '—');

/** Fecha de vencimiento que usa el aging (due_date, o emisión + días de crédito, o la emisión). */
function vencimiento(inv: InvoiceLine): string {
  if (inv.due_date) return inv.due_date;
  if (inv.dias_credito && inv.dias_credito > 0) {
    const d = parseLocalDate(inv.issue_date);
    d.setDate(d.getDate() + inv.dias_credito);
    return format(d, 'yyyy-MM-dd');
  }
  return inv.issue_date;
}

interface Props {
  fila: FilaEstado;
  year: number;
  isGerencial: boolean;
  clientRespIds: string[];
  onCompartir: () => void;
  onVincularInvoice: (inv: InvoiceLine) => void;
  onAcordarInvoice: (inv: InvoiceLine) => void;
  onLinkPagoInvoice: (inv: InvoiceLine) => void;
  onAcordarCliente: () => void;
}

export default function PanelCliente({
  fila, year, isGerencial, clientRespIds, onCompartir, onVincularInvoice, onAcordarInvoice, onLinkPagoInvoice, onAcordarCliente,
}: Props) {
  const c = fila.client;
  const pagosQ = usePagosCliente(c, year, isGerencial, true, clientRespIds);
  const remisionesQ = useRemisionesCliente(c, year, isGerencial, true, clientRespIds);
  const [tab, setTab] = useState<string>(c.invoices_pendientes.length ? 'pendientes' : 'pagos');
  const hoy = new Date();

  const pasos: { label: string; valor: number; signo: '+' | '−' }[] = [
    { label: 'Facturado', valor: c.facturado_venta, signo: '+' },
    ...(c.cxc_inicial > 0 ? [{ label: 'Saldo inicial', valor: c.cxc_inicial, signo: '+' as const }] : []),
    { label: 'Banco', valor: c.cobrado_banco, signo: '−' },
    ...(c.cobrado_efectivo > 0 ? [{ label: 'Efectivo', valor: c.cobrado_efectivo, signo: '−' as const }] : []),
    ...(c.anticipos_total > 0 ? [{ label: 'Anticipos', valor: c.anticipos_total, signo: '−' as const }] : []),
    ...(c.retenciones_total > 0 ? [{ label: 'Retenciones', valor: c.retenciones_total, signo: '−' as const }] : []),
  ];

  const totalPagos = (pagosQ.data ?? []).reduce((s, p) => s + p.amount, 0);
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="px-3 sm:px-5 py-4 bg-muted/40 dark:bg-muted/20 border-t border-border" onClick={stop}>
      <div className="rounded-xl border border-border bg-card shadow-sm">
        {/* Cómo se llega al saldo + acciones */}
        <div className="flex items-start justify-between gap-4 flex-wrap p-4 border-b border-border">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Cómo se llega al saldo de {year}</p>
            <div className="flex items-center gap-1.5 flex-wrap text-sm">
              {pasos.map((p, i) => (
                <span key={p.label} className="inline-flex items-center gap-1.5">
                  {i > 0 && <span className="text-muted-foreground">{p.signo}</span>}
                  <span className="inline-flex flex-col rounded-lg bg-muted/70 px-2.5 py-1">
                    <span className="text-xs text-muted-foreground leading-tight">{p.label}</span>
                    <span className="font-medium tabular-nums leading-tight">{formatCurrency(p.valor)}</span>
                  </span>
                </span>
              ))}
              <span className="text-muted-foreground">=</span>
              <span className="inline-flex flex-col rounded-lg border border-border px-2.5 py-1">
                <span className="text-xs text-muted-foreground leading-tight">Saldo</span>
                <span className={cn('font-semibold tabular-nums leading-tight', ESTADO_UI[fila.estado].texto)}>{formatCurrency(c.saldo_neto)}</span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onAcordarCliente}>
              <CalendarClock className="h-3.5 w-3.5" /> Acordar cobro
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onCompartir}>
              <Share2 className="h-3.5 w-3.5" /> Compartir estado de cuenta
            </Button>
            {isUuidClient(c.client_id) && (
              <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" asChild>
                <Link to={`/terceros/${c.client_id}`} target="_blank" rel="noreferrer">
                  Ficha <ExternalLink className="h-3 w-3" />
                </Link>
              </Button>
            )}
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="p-4 pt-3">
          <TabsList className="h-auto min-h-9 flex-wrap justify-start gap-0.5">
            <TabsTrigger value="pendientes" className="text-xs gap-1.5">
              <Receipt className="h-3.5 w-3.5" /> Pendientes ({c.invoices_pendientes.length})
            </TabsTrigger>
            <TabsTrigger value="cubiertas" className="text-xs gap-1.5">
              <CheckCheck className="h-3.5 w-3.5" /> Cubiertas ({c.invoices_pagadas.length})
            </TabsTrigger>
            <TabsTrigger value="pagos" className="text-xs gap-1.5">
              <Banknote className="h-3.5 w-3.5" /> Pagos ({pagosQ.data?.length ?? '…'})
            </TabsTrigger>
            <TabsTrigger value="remisiones" className="text-xs gap-1.5">
              <Truck className="h-3.5 w-3.5" /> Remisiones ({clientRespIds.length ? (remisionesQ.data?.length ?? '…') : 0})
            </TabsTrigger>
          </TabsList>

          {/* ── Facturas pendientes ── */}
          <TabsContent value="pendientes" className="mt-3">
            {c.invoices_pendientes.length === 0 ? (
              <Vacio texto="Sin facturas pendientes: el saldo viene del saldo inicial o de anticipos." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border">
                      <th className="py-2 pr-3 font-medium">Factura</th>
                      <th className="py-2 pr-3 font-medium">Emitida</th>
                      <th className="py-2 pr-3 font-medium">Vence</th>
                      <th className="py-2 pr-3 font-medium">Mora</th>
                      <th className="py-2 pr-3 font-medium text-right">Total</th>
                      <th className="py-2 pr-3 font-medium text-right">Abonado</th>
                      <th className="py-2 pr-3 font-medium text-right">Retenciones</th>
                      <th className="py-2 pr-3 font-medium text-right">Saldo</th>
                      <th className="py-2 font-medium text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.invoices_pendientes.map((inv) => (
                      <tr key={inv.id} className="border-b border-border last:border-0 align-top">
                        <td className="py-2 pr-3 font-mono text-xs font-medium whitespace-nowrap">
                          {inv.invoice_number || '(s/n)'}
                          {inv.void_type === 'partial' && <span className="block font-sans text-xs text-amber-700 dark:text-amber-400">nota crédito parcial</span>}
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">{dia(inv.issue_date)}</td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">{dia(vencimiento(inv))}</td>
                        <td className="py-2 pr-3"><MoraPill dias={calcDaysOverdue(inv, hoy)} /></td>
                        <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{formatCurrency(inv.total_amount)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap text-muted-foreground">{inv.paid_direct > 0 ? formatCurrency(inv.paid_direct) : '—'}</td>
                        <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap text-muted-foreground" title={inv.retenciones_total > 0 ? `Retefuente ${formatCurrency(inv.retefuente)} · ReteICA ${formatCurrency(inv.reteica)} · Autorete ${formatCurrency(inv.autoretefuente)}` : undefined}>
                          {inv.retenciones_total > 0 ? formatCurrency(inv.retenciones_total) : '—'}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap font-semibold text-red-600 dark:text-red-400">{formatCurrency(inv.effective_pending)}</td>
                        <td className="py-2 text-right">
                          <span className="inline-flex gap-0.5 justify-end">
                            <AccionMini onClick={() => onVincularInvoice(inv)} icon={Link2} label="Vincular pago" />
                            <AccionMini onClick={() => onAcordarInvoice(inv)} icon={CalendarClock} label="Acordar" />
                            <AccionMini onClick={() => onLinkPagoInvoice(inv)} icon={CreditCard} label="Link de pago Wompi" />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          {/* ── Facturas cubiertas ── */}
          <TabsContent value="cubiertas" className="mt-3">
            {c.invoices_pagadas.length === 0 ? (
              <Vacio texto={`Ninguna factura de ${year} quedó cubierta todavía.`} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border">
                      <th className="py-2 pr-3 font-medium">Factura</th>
                      <th className="py-2 pr-3 font-medium">Emitida</th>
                      <th className="py-2 pr-3 font-medium text-right">Total</th>
                      <th className="py-2 pr-3 font-medium text-right">Abonado directo</th>
                      <th className="py-2 font-medium text-right">Retenciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.invoices_pagadas.map((inv) => (
                      <tr key={inv.id} className="border-b border-border last:border-0">
                        <td className="py-2 pr-3 font-mono text-xs font-medium">{inv.invoice_number || '(s/n)'}</td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">{dia(inv.issue_date)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(inv.total_amount)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{inv.paid_direct > 0 ? formatCurrency(inv.paid_direct) : '—'}</td>
                        <td className="py-2 text-right tabular-nums text-muted-foreground">{inv.retenciones_total > 0 ? formatCurrency(inv.retenciones_total) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          {/* ── Pagos ── */}
          <TabsContent value="pagos" className="mt-3">
            {pagosQ.isLoading ? (
              <Cargando texto="Buscando pagos…" />
            ) : !pagosQ.data?.length ? (
              <Vacio texto={`Sin pagos registrados en ${year}.`} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border">
                      <th className="py-2 pr-3 font-medium">Fecha</th>
                      <th className="py-2 pr-3 font-medium">Descripción</th>
                      <th className="py-2 pr-3 font-medium">Aplicado a</th>
                      <th className="py-2 font-medium text-right">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagosQ.data.map((p) => (
                      <tr key={p.id} className="border-b border-border last:border-0">
                        <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">{dia(p.date)}</td>
                        <td className="py-2 pr-3 text-xs max-w-[320px]">
                          <span className="line-clamp-1" title={p.description}>{p.description}</span>
                          {p.origen === 'efectivo' && <span className="text-xs text-muted-foreground">efectivo</span>}
                        </td>
                        <td className="py-2 pr-3 text-xs">{p.facturas || <span className="text-muted-foreground">sin factura puntual</span>}</td>
                        <td className="py-2 text-right tabular-nums font-medium whitespace-nowrap">{formatCurrency(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="text-xs">
                      <td colSpan={3} className="pt-2 text-muted-foreground">{pagosQ.data.length} pago{pagosQ.data.length === 1 ? '' : 's'} en {year}</td>
                      <td className="pt-2 text-right tabular-nums font-semibold">{formatCurrency(totalPagos)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </TabsContent>

          {/* ── Remisiones ── */}
          <TabsContent value="remisiones" className="mt-3">
            {clientRespIds.length === 0 ? (
              <Vacio texto="Cliente sin tercero creado: no hay remisiones asociables." />
            ) : remisionesQ.isLoading ? (
              <Cargando texto="Buscando remisiones…" />
            ) : !remisionesQ.data?.length ? (
              <Vacio texto={`Sin remisiones de venta en ${year}.`} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border">
                      <th className="py-2 pr-3 font-medium">Remisión</th>
                      <th className="py-2 pr-3 font-medium">Fecha</th>
                      <th className="py-2 pr-3 font-medium">Facturación</th>
                      <th className="py-2 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {remisionesQ.data.map((r) => (
                      <tr key={r.id} className="border-b border-border last:border-0">
                        <td className="py-2 pr-3 font-mono text-xs font-medium">{r.number}{r.gerencial && <span className="ml-1.5 font-sans text-muted-foreground">G</span>}</td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">{dia(r.date)}</td>
                        <td className="py-2 pr-3 text-xs">
                          {r.facturas
                            ? <span className="text-emerald-700 dark:text-emerald-400">Facturada · {r.facturas}</span>
                            : <span className="text-amber-700 dark:text-amber-400 font-medium">Sin facturar</span>}
                        </td>
                        <td className="py-2 text-right tabular-nums font-medium">{formatCurrency(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function AccionMini({ onClick, icon: Icon, label }: { onClick: () => void; icon: typeof Link2; label: string }) {
  return (
    // En pantallas medianas solo el ícono (con nombre accesible y title) para
    // que las tres acciones quepan en una línea; desde xl, ícono + texto.
    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1"
      aria-label={label} title={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <Icon className="h-3.5 w-3.5" /> <span className="hidden xl:inline">{label}</span>
    </Button>
  );
}

function Vacio({ texto }: { texto: string }) {
  return <p className="text-sm text-muted-foreground py-6 text-center">{texto}</p>;
}

function Cargando({ texto }: { texto: string }) {
  return <p className="text-sm text-muted-foreground py-6 text-center"><Loader2 className="h-4 w-4 animate-spin inline mr-1.5" />{texto}</p>;
}
