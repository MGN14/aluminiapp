import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Banknote, Info, Receipt, BadgeCheck, BadgeX, TrendingDown, Trash2, AlertCircle, FileDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useModuleContext } from '@/hooks/useModuleContext';
import { usePettyCashMovements, type PettyCashRow } from '@/hooks/usePettyCashMovements';
import RegistrarGastoModal from '@/components/caja-menor/RegistrarGastoModal';
import GenerarCuentaDeCobroModal from '@/components/caja-menor/GenerarCuentaDeCobroModal';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function CajaMenor() {
  const { isGerencial } = useModuleContext();
  const { data, isLoading, error } = usePettyCashMovements();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pdfMovement, setPdfMovement] = useState<PettyCashRow | null>(null);

  if (isGerencial) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleDelete = async (id: string) => {
    try {
      const { error: delErr } = await supabase.from('petty_cash_movements').delete().eq('id', id);
      if (delErr) throw delErr;
      await queryClient.invalidateQueries({ queryKey: ['petty-cash-movements'] });
      toast({ title: 'Gasto eliminado' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Banknote className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Caja Menor</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Egresos en efectivo del Modo DIAN. Gastos sin documento y cuentas de cobro de proveedores.
              </p>
            </div>
          </div>
          <RegistrarGastoModal />
        </div>

        <Card className="border-blue-200 bg-blue-50/40 dark:bg-blue-950/10">
          <CardContent className="p-4 flex gap-3">
            <Info className="h-4 w-4 text-blue-700 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-blue-900 dark:text-blue-100 leading-relaxed">
              La deducibilidad fiscal se calcula automáticamente según la categoría del gasto.
              Editá las categorías deducibles en Ajustes → Categorías. Cada caso fiscal es distinto —
              consultá con tu contador. AluminIA no asesora en materia fiscal.
            </div>
          </CardContent>
        </Card>

        {/* KPIs del mes en curso */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
                <TrendingDown className="h-5 w-5 text-destructive" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Gastos del mes</p>
                <p className="text-xl font-bold">
                  {isLoading ? '—' : formatCurrency(data?.total_mes_actual ?? 0)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {data?.count_mes_actual ?? 0} movimiento{data?.count_mes_actual === 1 ? '' : 's'}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
                <BadgeCheck className="h-5 w-5 text-success" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Deducible DIAN</p>
                <p className="text-xl font-bold text-success">
                  {isLoading ? '—' : formatCurrency(data?.total_deducible_mes_actual ?? 0)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                <BadgeX className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">No deducible</p>
                <p className="text-xl font-bold">
                  {isLoading ? '—' : formatCurrency(data?.total_no_deducible_mes_actual ?? 0)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabla */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Movimientos registrados</CardTitle>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="flex items-center gap-2 text-sm text-destructive p-4">
                <AlertCircle className="h-4 w-4" />
                <span>Error al cargar. Recargá la página.</span>
              </div>
            ) : isLoading ? (
              <p className="text-sm text-muted-foreground p-4">Cargando...</p>
            ) : !data || data.rows.length === 0 ? (
              <div className="text-center py-12 space-y-2">
                <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mx-auto">
                  <Banknote className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Aún no registraste gastos. Click en "Registrar gasto" arriba para empezar.
                </p>
              </div>
            ) : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Proveedor</TableHead>
                      <TableHead>Concepto</TableHead>
                      <TableHead>Categoría</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {format(parseLocalDate(r.date), 'dd MMM yyyy', { locale: es })}
                        </TableCell>
                        <TableCell>
                          {r.kind === 'cuenta_de_cobro' ? (
                            <Badge variant="outline" className="text-[10px] gap-1">
                              <Receipt className="h-3 w-3" />
                              Cuenta de cobro
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">Efectivo</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {r.responsible_name ?? '—'}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm" title={r.concept ?? ''}>
                          {r.concept || '—'}
                          {r.numero_cuenta_cobro && (
                            <span className="block text-[11px] text-muted-foreground">
                              #{r.numero_cuenta_cobro}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.category_name ? (
                            <div className="flex items-center gap-1.5">
                              <span>{r.category_name}</span>
                              {r.category_is_tax_deductible ? (
                                <BadgeCheck className="h-3 w-3 text-success" />
                              ) : (
                                <BadgeX className="h-3 w-3 text-muted-foreground" />
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right tabular-nums font-medium',
                            r.category_is_tax_deductible ? 'text-success' : ''
                          )}
                        >
                          {formatCurrency(r.amount)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1.5 text-primary hover:text-primary"
                              onClick={() => setPdfMovement(r)}
                              title={r.kind === 'cuenta_de_cobro' ? 'Generar cuenta de cobro' : 'Generar comprobante de pago'}
                            >
                              <FileDown className="h-3.5 w-3.5" />
                              PDF
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => handleDelete(r.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <GenerarCuentaDeCobroModal
          movement={pdfMovement}
          open={pdfMovement !== null}
          onOpenChange={(o) => !o && setPdfMovement(null)}
        />
      </div>
    </AppLayout>
  );
}
