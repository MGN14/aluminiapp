import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import AppLayout from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Package, Eye, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import NewRemisionModal from '@/components/remisiones/NewRemisionModal';
import RemisionDetailModal from '@/components/remisiones/RemisionDetailModal';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
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

export default function Remisiones() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data: remisiones = [], isLoading } = useQuery({
    queryKey: ['remisiones', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('remisiones')
        .select(`
          id, date, number, beneficiary, notes, status, created_at,
          total_manual,
          remision_items(id, reference, product_name, units, unit_cost, total_cost)
        `)
        .eq('user_id', user.id)
        .order('date', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar esta remisión?')) return;
    const { error } = await supabase.from('remisiones').delete().eq('id', id);
    if (error) {
      toast({ title: 'Error al eliminar', variant: 'destructive' });
    } else {
      toast({ title: 'Remisión eliminada' });
      queryClient.invalidateQueries({ queryKey: ['remisiones'] });
    }
  };

  const totalRemisiones = remisiones.length;
  const totalUnidades = remisiones.reduce((s, r) => s + (r.remision_items?.reduce((si: number, i: any) => si + Number(i.units), 0) || 0), 0);
  const totalValor = remisiones.reduce((s, r: any) => {
    const itemsValor = r.remision_items?.reduce((si: number, i: any) => si + Number(i.total_cost || 0), 0) || 0;
    return s + (r.total_manual ? Number(r.total_manual) : itemsValor);
  }, 0);

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Remisiones</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Registra los despachos y compras reales del negocio
            </p>
          </div>
          <Button onClick={() => setNewOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Nueva Remisión
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total Remisiones</p>
              <p className="text-2xl font-bold">{totalRemisiones}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total Unidades</p>
              <p className="text-2xl font-bold">{totalUnidades.toLocaleString('es-CO')}</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Valor Total</p>
              <p className="text-2xl font-bold">{formatCurrency(totalValor)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Tabla */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Historial de Remisiones</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="text-center py-12 text-muted-foreground">Cargando...</div>
            ) : remisiones.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                <Package className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-muted-foreground">No hay remisiones registradas aún.</p>
                <Button variant="outline" onClick={() => setNewOpen(true)} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Crear primera remisión
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead># Remisión</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Beneficiario</TableHead>
                    <TableHead className="text-right">Referencias</TableHead>
                    <TableHead className="text-right">Unidades</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {remisiones.map((r: any) => {
                    const items = r.remision_items || [];
                    const unidades = items.reduce((s: number, i: any) => s + Number(i.units), 0);
                    const itemsValor = items.reduce((s: number, i: any) => s + Number(i.total_cost || 0), 0);
                    const valor = (r as any).total_manual ? Number((r as any).total_manual) : itemsValor;
                    const status = STATUS_LABELS[r.status] || STATUS_LABELS.pendiente;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.number}</TableCell>
                        <TableCell>{formatDate(r.date)}</TableCell>
                        <TableCell>{r.beneficiary}</TableCell>
                        <TableCell className="text-right">{items.length}</TableCell>
                        <TableCell className="text-right">{unidades.toLocaleString('es-CO')}</TableCell>
                        <TableCell className="text-right">{formatCurrency(valor)}</TableCell>
                        <TableCell>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => setDetailId(r.id)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <NewRemisionModal
        open={newOpen}
        onOpenChange={setNewOpen}
        onComplete={() => queryClient.invalidateQueries({ queryKey: ['remisiones'] })}
      />

      {detailId && (
        <RemisionDetailModal
          remisionId={detailId}
          open={!!detailId}
          onOpenChange={(o) => { if (!o) setDetailId(null); }}
        />
      )}
    </AppLayout>
  );
}
