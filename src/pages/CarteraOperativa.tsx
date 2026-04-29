import { Navigate, useNavigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Wallet, Info, Coins, TrendingUp, Users, AlertCircle, Landmark, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleContext } from '@/hooks/useModuleContext';
import { useOperativeReceivables } from '@/hooks/useOperativeReceivables';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function CarteraOperativa() {
  const { isGerencial, setMode } = useModuleContext();
  const { data, isLoading, error } = useOperativeReceivables();
  const navigate = useNavigate();

  if (!isGerencial) {
    return <Navigate to="/dashboard" replace />;
  }

  const goToCarteraDian = () => {
    setMode('dian');
    navigate('/reportes/cuentas-por-cobrar');
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Wallet className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Cartera Operativa</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Lo que realmente te deben tus clientes y cómo te están pagando.
            </p>
          </div>
        </div>

        <Card className="border-amber-200 bg-amber-50/40 dark:bg-amber-950/10">
          <CardContent className="p-4 flex gap-3">
            <Info className="h-4 w-4 text-amber-700 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 dark:text-amber-100 leading-relaxed space-y-1.5">
              <p>
                <strong>Cartera Operativa</strong> registra movimientos de tu negocio que no
                necesariamente están vinculados a facturación electrónica DIAN. Es una herramienta
                interna de gestión.
              </p>
              <p>
                Cada usuario es responsable del cumplimiento de sus obligaciones tributarias.
                Te recomendamos consultar con tu contador. AluminIA no asesora en materia fiscal.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Coins className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Saldo pendiente</p>
                <p className="text-xl font-bold text-primary">
                  {isLoading ? '—' : formatCurrency(data?.total_saldo_pendiente ?? 0)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-success" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Recibido</p>
                <p className="text-xl font-bold text-success">
                  {isLoading ? '—' : formatCurrency(data?.total_pagado ?? 0)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">Efectivo + banco asignados</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Clientes con deuda</p>
                <p className="text-xl font-bold">
                  {isLoading ? '—' : data?.clientes_con_deuda ?? 0}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabla */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Cartera por cliente</CardTitle>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="flex items-center gap-2 text-sm text-destructive p-4">
                <AlertCircle className="h-4 w-4" />
                <span>Error al cargar la cartera. Recargá la página.</span>
              </div>
            ) : isLoading ? (
              <p className="text-sm text-muted-foreground p-4">Cargando...</p>
            ) : !data || data.rows.length === 0 ? (
              <div className="text-center py-12 space-y-2">
                <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mx-auto">
                  <Wallet className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Aún no registraste deudas operativas ni asignaste pagos a esta cartera.
                  Próximamente vas a poder hacerlo desde acá y desde conciliación bancaria.
                </p>
              </div>
            ) : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead className="text-right">Deuda registrada</TableHead>
                      <TableHead className="text-right">Pagos en efectivo</TableHead>
                      <TableHead className="text-right">Pagos en banco</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r) => (
                      <TableRow key={r.responsible_id}>
                        <TableCell className="font-medium">{r.responsible_name}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(r.total_deuda)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-success">
                          {r.pagado_efectivo > 0 ? formatCurrency(r.pagado_efectivo) : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-success">
                          {r.pagado_banco > 0 ? formatCurrency(r.pagado_banco) : '—'}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right tabular-nums font-semibold',
                            r.saldo > 0 && 'text-primary',
                            r.saldo < 0 && 'text-success',
                            r.saldo === 0 && 'text-muted-foreground'
                          )}
                        >
                          {formatCurrency(r.saldo)}
                          {r.saldo < 0 && (
                            <span className="block text-[10px] font-normal text-muted-foreground">
                              saldo a favor
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Referencia a cartera fiscal DIAN */}
        <button
          type="button"
          onClick={goToCarteraDian}
          className="w-full text-left group rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 hover:bg-muted/40 hover:border-muted-foreground/50 transition-colors p-4 flex items-center gap-3"
        >
          <div className="w-9 h-9 rounded-lg bg-background flex items-center justify-center flex-shrink-0">
            <Landmark className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">¿Buscás tu cartera fiscal?</p>
            <p className="text-xs text-muted-foreground">
              Las facturas electrónicas pendientes de pago viven en Modo DIAN — Lo que me deben.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
        </button>
      </div>
    </AppLayout>
  );
}
