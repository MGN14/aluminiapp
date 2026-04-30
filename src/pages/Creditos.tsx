import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CreditCard, ChevronDown, ChevronUp, DollarSign, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCredits, type CreditWithSummary } from '@/hooks/useCredits';
import NuevoCreditoModal from '@/components/credits/NuevoCreditoModal';
import RegistrarPagoCreditoModal from '@/components/credits/RegistrarPagoCreditoModal';

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
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-success" onClick={() => setPaying(c)} title="Registrar pago">
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

                                <div className="rounded-lg border max-h-72 overflow-y-auto">
                                  <table className="w-full text-xs">
                                    <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                                      <tr>
                                        <th className="text-left p-2">#</th>
                                        <th className="text-left p-2">Fecha</th>
                                        <th className="text-right p-2">Capital</th>
                                        <th className="text-right p-2">Interés</th>
                                        <th className="text-right p-2">Cuota</th>
                                        <th className="text-right p-2">Saldo</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {c.summary.schedule.map((row) => {
                                        const today = new Date().toISOString().slice(0, 10);
                                        const isPast = row.fecha <= today;
                                        return (
                                          <tr key={row.cuotaNumero} className={cn('border-t', isPast && 'bg-success/5')}>
                                            <td className="p-2">{row.cuotaNumero}</td>
                                            <td className="p-2">{formatDate(row.fecha)}</td>
                                            <td className="p-2 text-right tabular-nums">{fmt(row.capitalPagado)}</td>
                                            <td className="p-2 text-right tabular-nums text-amber-700">{fmt(row.interesPagado)}</td>
                                            <td className="p-2 text-right tabular-nums font-semibold">{fmt(row.cuotaTotal)}</td>
                                            <td className="p-2 text-right tabular-nums text-muted-foreground">{fmt(row.saldoRestante)}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>

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

      <RegistrarPagoCreditoModal credit={paying} open={!!paying} onOpenChange={(o) => { if (!o) setPaying(null); }} />
    </AppLayout>
  );
}
