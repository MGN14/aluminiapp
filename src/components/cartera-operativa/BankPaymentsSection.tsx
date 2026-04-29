import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Link2, Link2Off, Inbox, Landmark } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  useUnassignedBankPayments,
  useAssignedOperativePayments,
  type BankPayment,
} from '@/hooks/useUnassignedBankPayments';
import AsignarPagoBancarioModal from './AsignarPagoBancarioModal';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function BankPaymentsSection() {
  const { data: unassigned = [], isLoading: loadingUnassigned } = useUnassignedBankPayments();
  const { data: assigned = [], isLoading: loadingAssigned } = useAssignedOperativePayments();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedPayment, setSelectedPayment] = useState<BankPayment | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [unassigning, setUnassigning] = useState<string | null>(null);

  const openAssign = (p: BankPayment) => {
    setSelectedPayment(p);
    setModalOpen(true);
  };

  const handleUnassign = async (id: string) => {
    setUnassigning(id);
    try {
      const { error } = await supabase
        .from('transactions')
        .update({
          operative_receivable_assigned: false,
          operative_responsible_id: null,
        } as never)
        .eq('id', id);
      if (error) throw error;

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['unassigned-bank-payments'] }),
        queryClient.invalidateQueries({ queryKey: ['assigned-operative-payments'] }),
        queryClient.invalidateQueries({ queryKey: ['operative-receivables'] }),
      ]);
      toast({ title: 'Asignación quitada' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setUnassigning(null);
    }
  };

  return (
    <>
      {/* Sin asignar */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Inbox className="h-4 w-4 text-muted-foreground" />
                Pagos bancarios sin asignar
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Ingresos de los últimos 90 días sin factura DIAN. Asignalos a un cliente para
                descontarlos de Cartera Operativa.
              </p>
            </div>
            {unassigned.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {unassigned.length} pago{unassigned.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loadingUnassigned ? (
            <p className="text-sm text-muted-foreground p-4">Cargando...</p>
          ) : unassigned.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">
                No hay pagos bancarios pendientes de asignar.
              </p>
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right w-[140px]">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unassigned.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {format(parseLocalDate(p.date), 'dd MMM', { locale: es })}
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-sm" title={p.description}>
                        {p.description || '—'}
                        {p.operative_responsible_name && (
                          <span className="block text-[11px] text-muted-foreground">
                            Beneficiario sugerido: {p.operative_responsible_name}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium text-success">
                        {formatCurrency(p.credit)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openAssign(p)}>
                          <Link2 className="h-3.5 w-3.5" />
                          Asignar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Asignados */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Landmark className="h-4 w-4 text-muted-foreground" />
            Pagos asignados a Cartera Operativa
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Estos pagos descuentan de la deuda operativa de su beneficiario. Siguen pendientes de
            factura en Modo DIAN.
          </p>
        </CardHeader>
        <CardContent>
          {loadingAssigned ? (
            <p className="text-sm text-muted-foreground p-4">Cargando...</p>
          ) : assigned.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">Aún no asignaste ningún pago bancario.</p>
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Beneficiario</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right w-[140px]">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assigned.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {format(parseLocalDate(p.date), 'dd MMM', { locale: es })}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {p.operative_responsible_name ?? '—'}
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate text-sm text-muted-foreground" title={p.description}>
                        {p.description || '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatCurrency(p.credit)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1.5 text-muted-foreground hover:text-destructive"
                          onClick={() => handleUnassign(p.id)}
                          disabled={unassigning === p.id}
                        >
                          <Link2Off className="h-3.5 w-3.5" />
                          {unassigning === p.id ? 'Quitando...' : 'Quitar'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AsignarPagoBancarioModal
        payment={selectedPayment}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </>
  );
}
