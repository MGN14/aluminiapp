import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

interface Props {
  remisionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
  }).format(value);
}

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  pendiente: { label: 'Pendiente', variant: 'secondary' },
  despachado: { label: 'Despachado', variant: 'default' },
  cancelado: { label: 'Cancelado', variant: 'destructive' },
};

export default function RemisionDetailModal({ remisionId, open, onOpenChange }: Props) {
  const { data: remision, isLoading } = useQuery({
    queryKey: ['remision-detail', remisionId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('remisiones') as any)
        .select(`id, date, number, beneficiary, notes, status, remision_items(id, reference, product_name, units, unit_cost, total_cost)`)
        .eq('id', remisionId)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!remisionId,
  });

  const items = (remision as any)?.remision_items || [];
  const totalUnidades = items.reduce((s: number, i: any) => s + Number(i.units), 0);
  const totalValor = items.reduce((s: number, i: any) => s + Number(i.total_cost || 0), 0);
  const status = remision ? STATUS_LABELS[remision.status] || STATUS_LABELS.pendiente : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isLoading ? 'Cargando...' : `Remisión ${(remision as any)?.number}`}
          </DialogTitle>
        </DialogHeader>

        {remision && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Fecha:</span>{' '}
                <strong>{formatDate((remision as any).date)}</strong>
              </div>
              <div>
                <span className="text-muted-foreground">Estado:</span>{' '}
                {status && <Badge variant={status.variant}>{status.label}</Badge>}
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">Beneficiario:</span>{' '}
                <strong>{(remision as any).beneficiary}</strong>
              </div>
              {(remision as any).notes && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Notas:</span>{' '}
                  {(remision as any).notes}
                </div>
              )}
            </div>

            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Referencia</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Unidades</TableHead>
                    <TableHead className="text-right">Costo unit.</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">{item.reference}</TableCell>
                      <TableCell className="text-xs">{item.product_name}</TableCell>
                      <TableCell className="text-right">{Number(item.units).toLocaleString('es-CO')}</TableCell>
                      <TableCell className="text-right">{item.unit_cost > 0 ? formatCurrency(Number(item.unit_cost)) : '—'}</TableCell>
                      <TableCell className="text-right">{item.total_cost > 0 ? formatCurrency(Number(item.total_cost)) : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-between text-sm border-t pt-3">
              <span className="text-muted-foreground">Total unidades: <strong>{totalUnidades.toLocaleString('es-CO')}</strong></span>
              {totalValor > 0 && <span className="text-muted-foreground">Valor total: <strong>{formatCurrency(totalValor)}</strong></span>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
