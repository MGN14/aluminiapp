import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import type { EmployeeRow, EmployeeEventRow, LawParams } from '@/lib/payrollEmployee';

const sb = supabase as any;

export function usePayrollEmployees() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const employeesQuery = useQuery<EmployeeRow[]>({
    queryKey: ['payroll-employees', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await sb
        .from('payroll_employees')
        .select('*')
        .order('activo', { ascending: false })
        .order('nombre');
      if (error) throw error;
      return (data ?? []) as EmployeeRow[];
    },
  });

  const eventsQuery = useQuery<EmployeeEventRow[]>({
    queryKey: ['payroll-employee-events', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await sb
        .from('payroll_employee_events')
        .select('*')
        .order('fecha', { ascending: false });
      if (error) throw error;
      return (data ?? []) as EmployeeEventRow[];
    },
  });

  // Parámetros de ley del año (SMMLV + auxilio) — viven en profiles, editables.
  const paramsQuery = useQuery<LawParams>({
    queryKey: ['payroll-law-params', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await sb
        .from('profiles')
        .select('smmlv_actual, aux_transporte_actual')
        .eq('user_id', user!.id)
        .maybeSingle();
      return {
        smmlv: Number(data?.smmlv_actual ?? 1623500),
        auxTransporte: Number(data?.aux_transporte_actual ?? 200000),
      };
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['payroll-employees', user?.id] });
    qc.invalidateQueries({ queryKey: ['payroll-employee-events', user?.id] });
  };

  const saveEmployee = useMutation({
    mutationFn: async (emp: Partial<EmployeeRow> & { id?: string }) => {
      const { id, ...fields } = emp;
      if (id) {
        const { error } = await sb.from('payroll_employees').update(fields).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await sb.from('payroll_employees').insert({ ...fields, user_id: user!.id });
        if (error) throw error;
      }
    },
    onSuccess: () => { invalidate(); toast({ title: 'Empleado guardado' }); },
    onError: (e: Error) => toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' }),
  });

  const addEvent = useMutation({
    mutationFn: async (ev: Omit<EmployeeEventRow, 'id'>) => {
      const { error } = await sb.from('payroll_employee_events').insert({ ...ev, user_id: user!.id });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast({ title: 'Novedad registrada' }); },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const removeEvent = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from('payroll_employee_events').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const saveParams = useMutation({
    mutationFn: async (p: LawParams) => {
      const { error } = await sb
        .from('profiles')
        .update({ smmlv_actual: p.smmlv, aux_transporte_actual: p.auxTransporte })
        .eq('user_id', user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-law-params', user?.id] });
      toast({ title: 'Parámetros de ley actualizados' });
    },
  });

  return {
    employees: employeesQuery.data ?? [],
    events: eventsQuery.data ?? [],
    params: paramsQuery.data ?? { smmlv: 1623500, auxTransporte: 200000 },
    isLoading: employeesQuery.isLoading || eventsQuery.isLoading,
    saveEmployee,
    addEvent,
    removeEvent,
    saveParams,
  };
}
