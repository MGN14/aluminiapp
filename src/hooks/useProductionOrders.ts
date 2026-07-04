import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

const sb = supabase as any;

export interface ProductionOrderLine {
  reference: string;
  descripcion: string;
  qty: number;      // total para TODAS las unidades de la orden
  unidad: string;
  costo_unit: number;
  costo_linea: number;
}

export interface ProductionOrder {
  id: string;
  template_id: string | null;
  template_name: string;
  ancho_m: number;
  alto_m: number;
  cantidad: number;
  estado: 'planificada' | 'en_proceso' | 'terminada' | 'cancelada';
  despiece: ProductionOrderLine[];
  costo_materiales: number;
  costo_mano_obra: number;
  costo_total: number;
  producto_ref: string;
  consumo_aplicado: boolean;
  produccion_aplicada: boolean;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  notas: string | null;
  created_at: string;
}

export function useProductionOrders() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const query = useQuery<ProductionOrder[]>({
    queryKey: ['production-orders', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await sb
        .from('production_orders')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as any[]).map(r => ({
        ...r,
        despiece: Array.isArray(r.despiece) ? r.despiece : [],
      })) as ProductionOrder[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['production-orders', user?.id] });
    // El consumo/terminación mueve stock → refrescar vistas de inventario
    qc.invalidateQueries({ queryKey: ['inventory'] });
  };

  const createOrder = useMutation({
    mutationFn: async (input: Omit<ProductionOrder, 'id' | 'estado' | 'consumo_aplicado' | 'produccion_aplicada' | 'fecha_inicio' | 'fecha_fin' | 'created_at' | 'costo_total'>) => {
      const { error } = await sb.from('production_orders').insert({ ...input, user_id: user!.id });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast({ title: 'Orden de producción creada' }); },
    onError: (e: Error) => toast({ title: 'Error al crear la orden', description: e.message, variant: 'destructive' }),
  });

  // consumir | terminar | cancelar — atómico en DB (RPC)
  const applyAction = useMutation({
    mutationFn: async ({ orderId, action }: { orderId: string; action: 'consumir' | 'terminar' | 'cancelar' }) => {
      const { data, error } = await sb.rpc('apply_production_order', {
        p_order_id: orderId,
        p_action: action,
      });
      if (error) throw error;
      return data as { ok: boolean; refs_no_encontradas?: string[]; costo_unitario?: number };
    },
    onSuccess: (data, vars) => {
      invalidate();
      if (vars.action === 'consumir') {
        const faltantes = data?.refs_no_encontradas ?? [];
        toast({
          title: 'Materiales descontados del inventario',
          description: faltantes.length
            ? `OJO: ${faltantes.length} referencia(s) no existen en inventario y no se descontaron: ${faltantes.slice(0, 5).join(', ')}`
            : 'Orden en proceso.',
          ...(faltantes.length ? { variant: 'destructive' as const } : {}),
        });
      } else if (vars.action === 'terminar') {
        toast({
          title: 'Producción terminada',
          description: `Producto terminado sumado al inventario con costo unitario $${Math.round(data?.costo_unitario ?? 0).toLocaleString('es-CO')}.`,
        });
      } else {
        toast({ title: 'Orden cancelada', description: 'Si había consumido materiales, volvieron al inventario.' });
      }
    },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return {
    orders: query.data ?? [],
    isLoading: query.isLoading,
    createOrder,
    applyAction,
  };
}
