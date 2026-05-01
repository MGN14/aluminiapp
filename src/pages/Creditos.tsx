import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, ChevronDown, ChevronUp, DollarSign, Trash2, Loader2, AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCredits, type CreditWithSummary } from '@/hooks/useCredits';
import NuevoCreditoModal from '@/components/credits/NuevoCreditoModal';
import RegistrarPagoCreditoModal, { type PrefillCuota } from '@/components/credits/RegistrarPagoCreditoModal';
import ConciliacionMatchesPanel from '@/components/credits/ConciliacionMatchesPanel';

function fmt(n: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n);
}

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export default function Creditos() {
  const { data, isLoading, error } = useCredits();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [paying, setPaying] = useState<CreditWithSummary | null>(null);
  const [prefillCuota, setPrefillCuota] = useState<PrefillCuota | null>(null);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar "${name}" y todos sus pagos? No se puede deshacer.`)) return;
    try {
      const { error } = await supabase.from('credits' as never).delete().eq('id', id);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['credits'] });
      toast({ title: 'Crédito eliminado' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const credits = data ?? [];
  const activos = credits.filter((c) => c.credit.status === 'active');
  const totalDeudaActiva = activos.reduce((s, c) => s + c.summary.currentBalance, 0);
  const proximasCuotas = activos
    .map((c) => c.summary.nextCuota)
    .filter((c): c is NonNullable<typeof c> => !!c);
  const proximoMontoTotal = proximasCuotas.reduce((s, c) => s + c.cuotaTotal, 0);
  const totalIntPagados = credits.reduce((s, c) => s + c.summary.totalInterestPaid, 0);

  return (
    <AppLayout>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <CreditCard className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Créditos</h1>
              <p className="text-muted-foreground text-xs mt-0.5">
                {activos.length} activo{activos.length === 1 ? '' : 's'} · {credits.length - activos.length} cerrado{credits.length - activos.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <NuevoCreditoModal />
        </div>

        {/* KPI bar compacto */}
        {activos.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Card className="border-0 shadow-sm">
              <CardContent className="py-3 px-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Deuda total</p>
                <p className="text-lg font-bold mt-0.5">{fmt(totalDeudaActiva)}</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="py-3 px-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Próximo pago consolidado</p>
                <p className="text-lg font-bold mt-0.5">{fmt(proximoMontoTotal)}</p>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-sm">
              <CardContent className="py-3 px-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Intereses pagados</p>
                <p className="text-lg font-bold mt-0.5 text-amber-700">{fmt(totalIntPagados)}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Lista créditos */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-8 flex items-center justify-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando...
              </div>
            ) : error ? (
              <div className="py-8 flex items-center justify-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                Error al cargar créditos.
              </div>
            ) : credits.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <CreditCard className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                <p className="text-sm text-muted-foreground">No tenés créditos registrados.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead></TableHead>
                    <TableHead>Crédito</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead className="text-right">Próxima cuota</TableHead>
                    <TableHead className="text-right">% Pagado</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {credits.map((c) => {
                    const isExpanded = expanded === c.credit.id;
                    return (
                      <>
                        <TableRow key={c.credit.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setExpanded(isExpanded ? null : c.credit.id)}>
                          <TableCell className="w-8 p-2">
                            {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium text-sm">{c.credit.name}</p>
                              {c.credit.bank_name && <p className="text-[11px] text-muted-foreground">{c.credit.bank_name} · {Number(c.credit.interest_rate_monthly).toFixed(2)}%/mes · {c.credit.term_months}m</p>}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{fmt(c.summary.currentBalance)}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {c.summary.nextCuota
                              ? <>
                                <p>{fmt(c.summary.nextCuota.cuotaTotal)}</p>
                                <p className="text-[10px] text-muted-foreground">{formatDate(c.summary.nextCuota.fecha)}</p>
                              </>
                              : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                                <div className="h-full bg-primary" style={{ width: `${Math.min(100, c.summary.percentPaid)}%` }} />
                              </div>
                              {c.summary.percentPaid.toFixed(0)}%
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={c.credit.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">
                              {c.credit.status === 'active' ? 'Activo' : c.credit.status === 'paid' ? 'Pagado' : 'Cancelado'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              {c.credit.status === 'active' && (
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-success" onClick={() => { setPrefillCuota(null); setPaying(c); }} title="Registrar pago">
                                  <DollarSign className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(c.credit.id, c.credit.name)} title="Eliminar">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow className="bg-muted/10 hover:bg-muted/10">
                            <TableCell colSpan={7} className="p-4">
                              <div className="space-y-3">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                  <div>
                                    <p className="text-muted-foreground">Monto inicial</p>
                                    <p className="font-semibold">{fmt(Number(c.credit.principal))}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground">Capital pagado</p>
                                    <p className="font-semibold">{fmt(c.summary.totalPrincipalPaid)}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground">Intereses pagados</p>
                                    <p className="font-semibold">{fmt(c.summary.totalInterestPaid)}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground">Total pagado</p>
                                    <p className="font-semibold">{fmt(c.summary.totalPaid)}</p>
                                  </div>
                                </div>

                                {/* Costo total del crédito y costos adicionales */}
                                <div className="grid grid-cols-3 gap-3 text-xs p-2 rounded-lg bg-amber-50/40 dark:bg-amber-950/10 border border-amber-200">
                                  <div>
                                    <p className="text-muted-foreground">Intereses teóricos totales</p>
                                    <p className="font-semibold text-amber-700">{fmt(c.summary.totalInterestScheduled)}</p>
                                  </div>
                                  {c.summary.additionalCostsAmount > 0 && (
                                    <div>
                                      <p className="text-muted-foreground">Costos adicionales</p>
                                      <p className="font-semibold text-amber-700">{fmt(c.summary.additionalCostsAmount)}</p>
                                      {c.credit.additional_costs_label && (
                                        <p className="text-[10px] text-muted-foreground">{c.credit.additional_costs_label}</p>
                                      )}
                                    </div>
                                  )}
                                  <div>
                                    <p className="text-muted-foreground">Costo total del crédito</p>
                                    <p className="font-bold">{fmt(c.summary.totalCreditCost)}</p>
                                    <p className="text-[10px] text-muted-foreground">
                                      Sobre principal: +{((c.summary.totalCreditCost / Number(c.credit.principal) - 1) * 100).toFixed(1)}%
                                    </p>
                                  </div>
                                </div>

                                <div className="rounded-lg border max-h-72 overflow-y-auto">
                                  <table className="w-full text-xs">
                                    <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                                      <tr>
                                        <th className="text-left p-2">#</th>
                                        <th className="text-left p-2">Fecha</th>
                                        <th className="text-left p-2">Estado</th>
                                        <th className="text-right p-2">Capital</th>
                                        <th className="text-right p-2">Interés</th>
                                        <th className="text-right p-2">Cuota</th>
                                        <th className="text-right p-2">Saldo real</th>
                                        <th className="p-2"></th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {c.summary.scheduleWithStatus.map((row) => {
                                        const isSaldado = row.estado === 'saldado';
                                        const isPagada = row.estado === 'pagada';
                                        const isParcial = row.estado === 'parcial';
                                        const isPendiente = row.estado === 'pendiente';
                                        const capitalShow = isPendiente ? row.capitalEfectivo : row.capitalPagado;
                                        const interesShow = isPendiente ? row.interesEfectivo : row.interesPagado;
                                        const cuotaShow = isPendiente ? capitalShow + interesShow : row.cuotaTotal;
                                        return (
                                          <tr
                                            key={row.cuotaNumero}
                                            className={cn(
                                              'border-t',
                                              isPagada && 'bg-success/5',
                                              isParcial && 'bg-amber-50/40 dark:bg-amber-950/10',
                                              isSaldado && 'opacity-50',
                                            )}
                                          >
                                            <td className="p-2">{row.cuotaNumero}</td>
                                            <td className="p-2">{formatDate(row.fecha)}</td>
                                            <td className="p-2">
                                              {isPagada && (
                                                <span className="inline-flex items-center gap-1 text-success font-medium">
                                                  <CheckCircle2 className="h-3 w-3" />
                                                  Pagada
                                                </span>
                                              )}
                                              {isParcial && (
                                                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
                                                  <AlertTriangle className="h-3 w-3" />
                                                  Parcial
                                                </span>
                                              )}
                                              {isPendiente && (
                                                <span className="text-muted-foreground">
                                                  Pendiente
                                                  {row.recalculada && (
                                                    <span className="ml-1 text-[9px] text-primary" title="Recalculada por abono extra">★</span>
                                                  )}
                                                </span>
                                              )}
                                              {isSaldado && (
                                                <span className="text-muted-foreground italic">Saldado</span>
                                              )}
                                            </td>
                                            <td className={cn('p-2 text-right tabular-nums', isSaldado && 'line-through')}>
                                              {isSaldado ? '—' : fmt(capitalShow)}
                                            </td>
                                            <td className={cn('p-2 text-right tabular-nums text-amber-700', isSaldado && 'line-through')}>
                                              {isSaldado ? '—' : fmt(interesShow)}
                                            </td>
                                            <td className={cn('p-2 text-right tabular-nums font-semibold', isSaldado && 'line-through')}>
                                              {isSaldado ? '—' : fmt(cuotaShow)}
                                            </td>
                                            <td className={cn('p-2 text-right tabular-nums', row.recalculada && !isSaldado ? 'text-primary font-medium' : 'text-muted-foreground')}>
                                              {fmt(row.saldoRealRestante)}
                                            </td>
                                            <td className="p-2 text-right">
                                              {isPendiente && c.credit.status === 'active' && (
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  className="h-6 w-6 text-success"
                                                  title="Pagar esta cuota"
                                                  onClick={() => {
                                                    setPrefillCuota({
                                                      fecha: row.fecha,
                                                      cuotaTotal: cuotaShow,
                                                      capitalEfectivo: capitalShow,
                                                      interesEfectivo: interesShow,
                                                      cuotaNumero: row.cuotaNumero,
                                                    });
                                                    setPaying(c);
                                                  }}
                                                >
                                                  <DollarSign className="h-3 w-3" />
                                                </Button>
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>

                                {c.summary.scheduleWithStatus.some((r) => r.recalculada || r.estado === 'saldado') && (
                                  <p className="text-[10px] text-muted-foreground italic">
                                    ★ Cuota recalculada por abono extra (modalidad: reducir plazo). Las cuotas finales pueden quedar saldadas si el saldo llega a cero antes.
                                  </p>
                                )}

                                {c.credit.status === 'active' && <ConciliacionMatchesPanel credit={c} />}

                                {c.payments.length > 0 && (
                                  <div className="space-y-1">
                                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Pagos registrados ({c.payments.length})</p>
                                    <div className="space-y-1">
                                      {c.payments.slice().sort((a, b) => b.payment_date.localeCompare(a.payment_date)).slice(0, 5).map((p) => (
                                        <div key={p.id} className="flex items-center justify-between text-xs p-1.5 rounded border bg-background">
                                          <span>{formatDate(p.payment_date)}{p.is_extra && <Badge variant="outline" className="ml-2 text-[9px]">Extra</Badge>}</span>
                                          <div className="flex gap-3 text-right tabular-nums">
                                            <span className="text-muted-foreground">Cap: {fmt(Number(p.principal_paid))}</span>
                                            <span className="text-muted-foreground">Int: {fmt(Number(p.interest_paid))}</span>
                                            <span className="font-semibold w-24">{fmt(Number(p.amount_paid))}</span>
                                          </div>
                                        </div>
                                      ))}
                                      {c.payments.length > 5 && (
                                        <p className="text-[10px] text-muted-foreground italic">+{c.payments.length - 5} pagos más</p>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <RegistrarPagoCreditoModal
        credit={paying}
        open={!!paying}
        prefillCuota={prefillCuota}
        onOpenChange={(o) => {
          if (!o) {
            setPaying(null);
            setPrefillCuota(null);
          }
        }}
      />
    </AppLayout>
  );
}
