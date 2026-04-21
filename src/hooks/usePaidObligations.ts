import { useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useFiscalConfig } from '@/hooks/useFiscalConfig';
import { useBusinessObligations } from '@/hooks/useBusinessObligations';
import { toast } from 'sonner';
import type { CalendarEvent } from '@/lib/dianCalendar2026';

/**
 * Clave canónica de pago por evento.
 *  - DIAN (iva/retefuente/renta/ica):  "${tipo}:${YYYY-MM-DD}"
 *  - Negocio:                          "${obligationId}:${YYYY-MM}"
 */
function eventPaidKey(ev: CalendarEvent): string {
  const iso = ev.fecha.toISOString().split('T')[0]; // YYYY-MM-DD
  if (ev.origen === 'negocio') {
    const [y, m] = iso.split('-');
    return `${ev.obligationId}:${y}-${m}`;
  }
  return `${ev.tipo}:${iso}`;
}

function eventMonthKey(ev: CalendarEvent): string {
  const iso = ev.fecha.toISOString().split('T')[0];
  const [y, m] = iso.split('-');
  return `${y}-${m}`;
}

export function usePaidObligations() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { config } = useFiscalConfig();
  const { obligations, toggleMonthComplete } = useBusinessObligations();

  const paidDianSet = useMemo(() => new Set(config?.paid_dian_events ?? []), [config?.paid_dian_events]);

  const isPaid = useCallback((ev: CalendarEvent): boolean => {
    if (ev.origen === 'negocio') {
      const ob = obligations.find(o => o.id === ev.obligationId);
      if (!ob) return false;
      return (ob.completadas || []).includes(eventMonthKey(ev));
    }
    return paidDianSet.has(`${ev.tipo}:${ev.fecha.toISOString().split('T')[0]}`);
  }, [obligations, paidDianSet]);

  const toggleDianPaid = useMutation({
    mutationFn: async ({ key, paid }: { key: string; paid: boolean }) => {
      if (!user?.id) throw new Error('Sin sesión');
      const current = new Set(config?.paid_dian_events ?? []);
      if (paid) current.add(key); else current.delete(key);
      const next = Array.from(current);
      const { error } = await (supabase as any)
        .from('fiscal_config')
        .update({ paid_dian_events: next })
        .eq('user_id', user.id);
      if (error) throw error;
      return next;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal-config'] });
    },
    onError: (err: any) => {
      toast.error(`Error al marcar: ${err.message}`);
    },
  });

  const togglePaid = useCallback(async (ev: CalendarEvent) => {
    const currentlyPaid = isPaid(ev);
    if (ev.origen === 'negocio') {
      if (!ev.obligationId) return;
      await toggleMonthComplete.mutateAsync({
        id: ev.obligationId,
        mes: eventMonthKey(ev),
        completed: !currentlyPaid,
      });
    } else {
      const key = `${ev.tipo}:${ev.fecha.toISOString().split('T')[0]}`;
      await toggleDianPaid.mutateAsync({ key, paid: !currentlyPaid });
    }
  }, [isPaid, toggleMonthComplete, toggleDianPaid]);

  return { isPaid, togglePaid, eventPaidKey };
}
