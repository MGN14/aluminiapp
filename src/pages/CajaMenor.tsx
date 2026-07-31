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
import { Banknote, Info, Receipt, BadgeCheck, BadgeX, TrendingDown, TrendingUp, Wallet, Trash2, AlertCircle, FileDown, Lock, Unlock, Zap, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useModuleContext } from '@/hooks/useModuleContext';
import { useSubscription } from '@/hooks/useSubscription';
import { useDataOwner } from '@/hooks/useDataOwner';
import { usePettyCashMovements, type PettyCashRow } from '@/hooks/usePettyCashMovements';
import {
  usePettyCashClosings,
  useReopenPettyCashClosing,
  useDiscardPettyCashClosing,
  type PettyCashClosing,
} from '@/hooks/usePettyCashClosings';
import { usePromotePettyCashMovement } from '@/hooks/usePromotePettyCashMovement';
import RegistrarGastoModal from '@/components/caja-menor/RegistrarGastoModal';
import RegistrarIngresoModal from '@/components/caja-menor/RegistrarIngresoModal';
import GenerarCuentaDeCobroModal from '@/components/caja-menor/GenerarCuentaDeCobroModal';
import GenerarComprobanteIngresoModal from '@/components/caja-menor/GenerarComprobanteIngresoModal';
import CerrarCajaModal from '@/components/caja-menor/CerrarCajaModal';
import GuardarCierreEditadoModal from '@/components/caja-menor/GuardarCierreEditadoModal';
import EditarMovimientoModal from '@/components/caja-menor/EditarMovimientoModal';
import { generatePettyCashClosingPdf } from '@/lib/pettyCashClosingPdf';
import { useAuth } from '@/hooks/useAuth';

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
  const { user } = useAuth();
  const { isAdmin } = useSubscription();
  // Solo el dueño de la cuenta (no colaboradores) puede cerrar la caja.
  // El backend también lo valida en close_petty_cash_period, esto solo
  // oculta el botón para evitar confusión.
  const { isCollaborator } = useDataOwner();
  const { data, isLoading, error } = usePettyCashMovements();
  const { data: closings = [] } = usePettyCashClosings();
  const reopenMutation = useReopenPettyCashClosing();
  const discardMutation = useDiscardPettyCashClosing();
  const promoteMutation = usePromotePettyCashMovement();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pdfMovement, setPdfMovement] = useState<PettyCashRow | null>(null);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [editMovimientoRow, setEditMovimientoRow] = useState<PettyCashRow | null>(null);
  const [recloseTarget, setRecloseTarget] = useState<PettyCashClosing | null>(null);
  // Cuando hay un cierre reabierto, el listón general mezcla sus movimientos
  // con todo lo demás. Este filtro los aísla para poder trabajarlos.
  const [soloEnEdicion, setSoloEnEdicion] = useState(false);

  const cierreEnEdicion = closings.find((c) => c.status === 'en_edicion') ?? null;
  /** Un movimiento es editable si está suelto o si su cierre está en edición. */
  const esEditable = (r: PettyCashRow) =>
    !r.closing_id || (cierreEnEdicion !== null && r.closing_id === cierreEnEdicion.id);
  const enEdicion = (r: PettyCashRow) =>
    cierreEnEdicion !== null && r.closing_id === cierreEnEdicion.id;

  if (isGerencial) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleDelete = async (row: PettyCashRow) => {
    if (!esEditable(row)) {
      toast({
        title: 'No se puede eliminar',
        description: 'Este movimiento está incluido en un cierre de caja. Reabrí ese cierre desde "Cierres anteriores" para poder editarlo.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const { error: delErr } = await supabase.from('petty_cash_movements').delete().eq('id', row.id);
      if (delErr) throw delErr;
      await queryClient.invalidateQueries({ queryKey: ['petty-cash-movements'] });
      toast({ title: 'Gasto eliminado' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handlePromote = async (row: PettyCashRow) => {
    if (!isAdmin) return;
    if (row.closing_id) {
      toast({
        title: 'No se puede pasar',
        description: enEdicion(row)
          ? 'Este movimiento pertenece al cierre en edición. Guardá el cierre y después pasalo a Gerencial.'
          : 'Este movimiento está incluido en un cierre. Reabrí el cierre primero.',
        variant: 'destructive',
      });
      return;
    }
    if (row.cash_movement_id) {
      toast({ title: 'Ya está en Gerencial', description: 'Este movimiento ya fue pasado a Movimientos en efectivo.' });
      return;
    }
    const ok = window.confirm(
      `¿Pasar este gasto a Movimientos en efectivo (Modo Gerencial)?\n\nEl gasto seguirá contando para deducibilidad DIAN. También va a aparecer como egreso en el flujo de efectivo del Modo Gerencial.`,
    );
    if (!ok) return;
    try {
      await promoteMutation.mutateAsync(row.id);
      toast({
        title: 'Pasado a Gerencial',
        description: 'El gasto ya está visible en Movimientos en efectivo (Modo Gerencial).',
      });
    } catch (err: any) {
      toast({
        title: 'Error al pasar a Gerencial',
        description: err?.message ?? 'Error desconocido',
        variant: 'destructive',
      });
    }
  };

  const hasOpenMovements = (data?.rows ?? []).some((r) => !r.closing_id);
  const visibleRows = (data?.rows ?? []).filter((r) =>
    soloEnEdicion && cierreEnEdicion ? r.closing_id === cierreEnEdicion.id : true,
  );

  const handleReopen = async (closing: PettyCashClosing) => {
    if (!isAdmin) return;
    if (cierreEnEdicion) {
      toast({
        title: 'Ya hay un cierre en edición',
        description: 'Guardá o descartá ese primero — si no, los períodos se mezclan.',
        variant: 'destructive',
      });
      return;
    }
    const confirm = window.confirm(
      `¿Reabrir el cierre del ${closing.period_start} al ${closing.period_end}?\n\nSus ${closing.movements_count} movimientos vuelven a ser editables PERO siguen agrupados en este cierre — no se mezclan con el resto. Cuando termines, "Guardar y cerrar".`
    );
    if (!confirm) return;
    try {
      await reopenMutation.mutateAsync(closing.id);
      setSoloEnEdicion(true);
      toast({
        title: 'Cierre en edición',
        description: `${closing.movements_count} movimientos editables. Siguen agrupados en este cierre.`,
      });
    } catch (err: any) {
      toast({
        title: 'Error al reabrir',
        description: err?.message ?? 'Error desconocido',
        variant: 'destructive',
      });
    }
  };

  /** Descartar el cierre: suelta los movimientos al listón general y borra el
   *  registro. Es el comportamiento viejo de "Reabrir" — se conserva para el
   *  caso "este cierre estaba mal armado, lo rehago". */
  const handleDiscard = async (closing: PettyCashClosing) => {
    if (!isAdmin) return;
    const confirm = window.confirm(
      `¿Descartar el cierre del ${closing.period_start} al ${closing.period_end}?\n\nSus ${closing.movements_count} movimientos se sueltan al listado general y el cierre se borra. Esto NO se puede deshacer.\n\nSi solo querés corregir algo, usá "Guardar y cerrar" en vez de esto.`
    );
    if (!confirm) return;
    try {
      await discardMutation.mutateAsync(closing.id);
      setSoloEnEdicion(false);
      toast({
        title: 'Cierre descartado',
        description: `${closing.movements_count} movimientos volvieron al listado general.`,
      });
    } catch (err: any) {
      toast({
        title: 'Error al descartar',
        description: err?.message ?? 'Error desconocido',
        variant: 'destructive',
      });
    }
  };

  const handleDownloadClosingPdf = async (closing: PettyCashClosing) => {
    try {
      // Movimientos del cierre
      const movements = (data?.rows ?? []).filter((r) => r.closing_id === closing.id);
      // Datos de la empresa
      const { data: profile } = await supabase
        .from('profiles')
        .select('company_name, company_nit, company_city')
        .eq('user_id', user?.id ?? '')
        .maybeSingle();
      const doc = generatePettyCashClosingPdf(closing, movements, profile ?? {});
      doc.save(`cierre-caja-${closing.period_start}-a-${closing.period_end}.pdf`);
    } catch (err: any) {
      toast({
        title: 'Error al generar PDF',
        description: err?.message ?? 'Error desconocido',
        variant: 'destructive',
      });
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
          <div className="flex items-center gap-2">
            {/* Cerrar caja: solo el administrador/dueño. Los colaboradores
                pueden registrar movimientos pero no cerrar el período. */}
            {!isCollaborator && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCloseModalOpen(true)}
                disabled={!hasOpenMovements}
                title={hasOpenMovements ? 'Cerrar caja del período' : 'No hay movimientos abiertos'}
              >
                <Lock className="h-4 w-4 mr-1.5" />
                Cerrar caja
              </Button>
            )}
            <RegistrarIngresoModal />
            <RegistrarGastoModal />
          </div>
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

        {/* KPIs: ingresos / gastos del mes + saldo total en caja */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-success" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Ingresos del mes</p>
                <p className="text-xl font-bold text-success">
                  {isLoading ? '—' : formatCurrency(data?.total_ingresos_mes ?? 0)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
                <TrendingDown className="h-5 w-5 text-destructive" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Gastos del mes</p>
                <p className="text-xl font-bold text-destructive">
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
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Total en caja hoy</p>
                <p className={`text-xl font-bold ${(data?.saldo_caja ?? 0) >= 0 ? 'text-primary' : 'text-destructive'}`}>
                  {isLoading ? '—' : formatCurrency(data?.saldo_caja ?? 0)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Ingresos − gastos acumulados
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabla */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="space-y-3">
            <CardTitle className="text-base">Movimientos registrados</CardTitle>
            {/* Cierre reabierto: sus movimientos siguen agrupados, pero en el
                listón general quedarían mezclados con el resto. Este banner
                los aísla en un clic. */}
            {cierreEnEdicion && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Unlock className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      Cierre en edición: {format(parseLocalDate(cierreEnEdicion.period_start), 'd MMM', { locale: es })} – {format(parseLocalDate(cierreEnEdicion.period_end), 'd MMM yyyy', { locale: es })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Sus {cierreEnEdicion.movements_count} movimientos son editables pero siguen agrupados en este cierre. Lo que cargues con fecha dentro del período entra al cierre al guardarlo.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant={soloEnEdicion ? 'default' : 'outline'}
                    className="h-7 text-[11px]"
                    onClick={() => setSoloEnEdicion((v) => !v)}
                  >
                    {soloEnEdicion ? 'Viendo solo el cierre' : 'Ver solo los del cierre'}
                  </Button>
                  {isAdmin && (
                    <>
                      <Button
                        size="sm"
                        className="h-7 text-[11px] gap-1"
                        onClick={() => setRecloseTarget(cierreEnEdicion)}
                      >
                        <Lock className="h-3 w-3" />Guardar y cerrar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[11px] text-destructive"
                        onClick={() => handleDiscard(cierreEnEdicion)}
                        disabled={discardMutation.isPending}
                      >
                        Descartar cierre
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}
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
              <>
              {/* Mobile: cards stackeadas */}
              <div className="md:hidden space-y-3">
                {visibleRows.map((r) => (
                  <div key={r.id} className="rounded-xl border border-border bg-card p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-xs text-muted-foreground">
                        {format(parseLocalDate(r.date), 'dd MMM yyyy', { locale: es })}
                      </div>
                      <div className={cn('text-base font-bold tabular-nums whitespace-nowrap', r.category_is_tax_deductible && 'text-success')}>
                        {formatCurrency(r.amount)}
                      </div>
                    </div>
                    <div className="text-sm font-medium inline-flex items-center gap-1.5">
                      {r.responsible_name ?? '—'}
                      {esEditable(r) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground"
                          onClick={() => setEditMovimientoRow(r)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    {(r.concept || r.numero_cuenta_cobro) && (
                      <div className="text-xs text-muted-foreground">
                        {r.concept || '—'}
                        {r.numero_cuenta_cobro && <span className="block">#{r.numero_cuenta_cobro}</span>}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {r.kind === 'cuenta_de_cobro' ? (
                        <Badge variant="outline" className="text-[10px] gap-1"><Receipt className="h-3 w-3" />Cuenta cobro</Badge>
                      ) : r.kind === 'ingreso_efectivo' ? (
                        <Badge variant="outline" className="text-[10px] gap-1 border-success/40 text-success"><Receipt className="h-3 w-3" />Ingreso</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">Efectivo</Badge>
                      )}
                      {r.category_name && (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          {r.category_is_tax_deductible ? <BadgeCheck className="h-3 w-3 text-success" /> : <BadgeX className="h-3 w-3 text-muted-foreground" />}
                          {r.category_name}
                        </Badge>
                      )}
                      {r.cash_movement_id && (
                        <Badge variant="outline" className="gap-1 text-[10px] border-primary/40 text-primary">
                          <Zap className="h-2.5 w-2.5" />En Gerencial
                        </Badge>
                      )}
                      {r.closing_id && (
                        enEdicion(r) ? (
                          <Badge variant="outline" className="gap-1 text-[10px] border-warning/50 text-warning">
                            <Unlock className="h-2.5 w-2.5" />En edición
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-[10px]">
                            <Lock className="h-2.5 w-2.5" />Cerrado
                          </Badge>
                        )
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 pt-1 border-t border-border">
                      <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-primary flex-1" onClick={() => setPdfMovement(r)}>
                        <FileDown className="h-3.5 w-3.5" />PDF
                      </Button>
                      {!r.cash_movement_id && isAdmin && !r.closing_id && (
                        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-primary flex-1" onClick={() => handlePromote(r)} disabled={promoteMutation.isPending}>
                          <Zap className="h-3.5 w-3.5" />A Gerencial
                        </Button>
                      )}
                      {esEditable(r) && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(r)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: tabla tradicional */}
              <div className="hidden md:block overflow-auto">
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
                    {visibleRows.map((r) => (
                      // Franja ámbar a la izquierda = pertenece al cierre en
                      // edición. Sin esto quedan indistinguibles del resto.
                      <TableRow key={r.id} className={enEdicion(r) ? 'bg-warning/5 border-l-2 border-l-warning' : undefined}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {format(parseLocalDate(r.date), 'dd MMM yyyy', { locale: es })}
                          {enEdicion(r) && (
                            <span className="block text-[10px] font-medium text-warning">En edición</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {r.kind === 'cuenta_de_cobro' ? (
                            <Badge variant="outline" className="text-[10px] gap-1">
                              <Receipt className="h-3 w-3" />
                              Cuenta de cobro
                            </Badge>
                          ) : r.kind === 'ingreso_efectivo' ? (
                            <Badge variant="outline" className="text-[10px] gap-1 border-success/40 text-success">
                              <Receipt className="h-3 w-3" />
                              Ingreso
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">Efectivo</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            {r.responsible_name ?? '—'}
                            {esEditable(r) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-primary"
                                onClick={() => setEditMovimientoRow(r)}
                                title="Editar prestador"
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            )}
                          </span>
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
                              title={
                                r.kind === 'cuenta_de_cobro'
                                  ? 'Generar cuenta de cobro'
                                  : r.kind === 'ingreso_efectivo'
                                    ? 'Generar comprobante de pago para el cliente'
                                    : 'Generar comprobante de pago'
                              }
                            >
                              <FileDown className="h-3.5 w-3.5" />
                              PDF
                            </Button>
                            {r.cash_movement_id ? (
                              <Badge
                                variant="outline"
                                className="gap-1 text-[10px] h-6 border-primary/40 text-primary"
                                title="Este gasto también está en Movimientos en efectivo (Modo Gerencial)"
                              >
                                <Zap className="h-2.5 w-2.5" />
                                En Gerencial
                              </Badge>
                            ) : (
                              isAdmin && !r.closing_id && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 gap-1.5 text-primary hover:text-primary"
                                  onClick={() => handlePromote(r)}
                                  disabled={promoteMutation.isPending}
                                  title="Pasar este gasto al Modo Gerencial (Movimientos en efectivo)"
                                >
                                  <Zap className="h-3.5 w-3.5" />
                                  <span className="text-[11px]">A Gerencial</span>
                                </Button>
                              )
                            )}
                            {r.closing_id ? (
                              <Badge variant="outline" className="gap-1 text-[10px] h-6">
                                <Lock className="h-2.5 w-2.5" />
                                Cerrado
                              </Badge>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDelete(r)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Listado de cierres anteriores */}
        {closings.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Lock className="h-4 w-4 text-muted-foreground" />
                Cierres anteriores
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Período</TableHead>
                    <TableHead className="text-right">Movs.</TableHead>
                    <TableHead className="text-right">Computado</TableHead>
                    <TableHead className="text-right">Declarado</TableHead>
                    <TableHead className="text-right">Diferencia</TableHead>
                    <TableHead>Notas</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closings.map((c) => (
                    <TableRow key={c.id} className={c.status === 'en_edicion' ? 'bg-warning/5' : undefined}>
                      <TableCell className="text-xs">
                        {format(parseLocalDate(c.period_start), 'd MMM', { locale: es })} – {format(parseLocalDate(c.period_end), 'd MMM yyyy', { locale: es })}
                        {c.status === 'en_edicion' && (
                          <Badge variant="outline" className="ml-1.5 gap-1 text-[10px] border-warning/50 text-warning">
                            <Unlock className="h-2.5 w-2.5" />En edición
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{c.movements_count}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{formatCurrency(c.computed_balance)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{formatCurrency(c.declared_balance)}</TableCell>
                      <TableCell className={cn(
                        'text-right tabular-nums text-xs font-medium',
                        Math.abs(c.difference) < 1 ? 'text-success' : c.difference > 0 ? 'text-warning' : 'text-destructive',
                      )}>
                        {formatCurrency(c.difference)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate" title={c.notes ?? ''}>
                        {c.notes ?? '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-primary hover:text-primary px-2"
                            onClick={() => handleDownloadClosingPdf(c)}
                            title="Descargar PDF del cierre"
                          >
                            <FileDown className="h-3.5 w-3.5" />
                            <span className="text-[11px]">PDF</span>
                          </Button>
                          {isAdmin && (
                            c.status === 'en_edicion' ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 gap-1 text-primary hover:text-primary px-2"
                                  onClick={() => setRecloseTarget(c)}
                                  title="Recalcular y volver a cerrar este período"
                                >
                                  <Lock className="h-3.5 w-3.5" />
                                  <span className="text-[11px]">Guardar y cerrar</span>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 gap-1 text-destructive hover:text-destructive px-2"
                                  onClick={() => handleDiscard(c)}
                                  disabled={discardMutation.isPending}
                                  title="Borrar el cierre y soltar sus movimientos al listado general"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  <span className="text-[11px]">Descartar</span>
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 text-warning hover:text-warning px-2"
                                onClick={() => handleReopen(c)}
                                disabled={reopenMutation.isPending}
                                title="Reabrir para editar. Los movimientos siguen agrupados en este cierre."
                              >
                                <Unlock className="h-3.5 w-3.5" />
                                <span className="text-[11px]">Reabrir</span>
                              </Button>
                            )
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Router de PDF según kind del movimiento:
            - ingreso_efectivo → Comprobante de ingreso (recibo de caja)
            - cuenta_de_cobro / gasto_efectivo → Cuenta de cobro / Comprobante de pago */}
        {pdfMovement?.kind === 'ingreso_efectivo' ? (
          <GenerarComprobanteIngresoModal
            movement={pdfMovement}
            open={pdfMovement !== null}
            onOpenChange={(o) => !o && setPdfMovement(null)}
          />
        ) : (
          <GenerarCuentaDeCobroModal
            movement={pdfMovement}
            open={pdfMovement !== null}
            onOpenChange={(o) => !o && setPdfMovement(null)}
          />
        )}

        <CerrarCajaModal
          open={closeModalOpen}
          onClose={() => setCloseModalOpen(false)}
          rows={data?.rows ?? []}
        />

        <GuardarCierreEditadoModal
          closing={recloseTarget}
          rows={data?.rows ?? []}
          onClose={() => { setRecloseTarget(null); setSoloEnEdicion(false); }}
        />

        <EditarMovimientoModal
          open={editMovimientoRow !== null}
          onOpenChange={(o) => !o && setEditMovimientoRow(null)}
          movement={editMovimientoRow}
        />
      </div>
    </AppLayout>
  );
}
