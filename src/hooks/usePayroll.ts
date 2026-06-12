import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { computePayroll, parseRates, type PayrollRates } from '@/lib/payroll';

export interface PayrollEntry {
  id: string;
  user_id: string;
  year: number;
  month: number;
  salary_total: number;
  transport_allowance: number;
  employees_count: number | null;
  rates: PayrollRates;
  provision_prestaciones: number;
  seguridad_social: number;
  parafiscales: number;
  total_costo_laboral: number;
  notas: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayrollEntryInput {
  year: number;
  month: number;
  salary_total: number;
  transport_allowance: number;
  employees_count: number | null;
  rates: PayrollRates;
  notas?: string | null;
}

/** Marca en `notas` de business_obligations para identificar (y actualizar
 *  en vez de duplicar) las obligaciones que crea el módulo Nómina. */
const AUTO_TAG = '[auto:nomina]';

export function usePayroll() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['payroll-entries', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      // Sin filtro user_id: el RLS (current_data_owner) resuelve visibilidad
      // para owner y colaboradores, igual que business_obligations.
      const { data, error } = await (supabase.from('payroll_entries' as never) as any)
        .select('*')
        .order('year', { ascending: false })
        .order('month', { ascending: false });
      if (error) throw error;
      return ((data || []) as any[]).map((row) => ({
        ...row,
        salary_total: Number(row.salary_total) || 0,
        transport_allowance: Number(row.transport_allowance) || 0,
        provision_prestaciones: Number(row.provision_prestaciones) || 0,
        seguridad_social: Number(row.seguridad_social) || 0,
        parafiscales: Number(row.parafiscales) || 0,
        total_costo_laboral: Number(row.total_costo_laboral) || 0,
        rates: parseRates(row.rates),
      })) as PayrollEntry[];
    },
  });

  const saveEntry = useMutation({
    mutationFn: async (input: PayrollEntryInput) => {
      const b = computePayroll(input.salary_total, input.transport_allowance, input.rates);
      const row = {
        user_id: user!.id, // el trigger BEFORE INSERT lo reescribe al data owner
        year: input.year,
        month: input.month,
        salary_total: input.salary_total,
        transport_allowance: input.transport_allowance,
        employees_count: input.employees_count,
        rates: input.rates,
        provision_prestaciones: b.provisionPrestaciones,
        seguridad_social: b.seguridadSocial,
        parafiscales: b.parafiscales,
        total_costo_laboral: b.totalCostoLaboral,
        notas: input.notas ?? null,
      };
      // El UNIQUE es (user_id, year, month) pero el trigger reescribe user_id,
      // así que resolvemos el upsert a mano: ¿existe fila para ese periodo?
      const { data: existing, error: exErr } = await (supabase.from('payroll_entries' as never) as any)
        .select('id')
        .eq('year', input.year)
        .eq('month', input.month)
        .maybeSingle();
      if (exErr) throw exErr;
      if (existing?.id) {
        const { user_id: _omit, ...updateRow } = row;
        const { error } = await (supabase.from('payroll_entries' as never) as any)
          .update(updateRow)
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from('payroll_entries' as never) as any).insert(row);
        if (error) throw error;
      }
      return b;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-entries'] });
    },
    onError: (err: any) => toast.error(`Error guardando nómina: ${err.message}`),
  });

  const deleteEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('payroll_entries' as never) as any)
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-entries'] });
      toast.success('Registro de nómina eliminado');
    },
    onError: (err: any) => toast.error(`Error: ${err.message}`),
  });

  /**
   * Sincroniza el cronograma: upsertea en business_obligations las
   * obligaciones derivadas de la nómina, que el dashboard muestra en
   * "Próximas obligaciones" y el calendario de Visita DIAN.
   *
   * - Pago de nómina (mensual, devengado + aux transporte)
   * - PILA (mensual, patronal + 8% retenido al empleado)
   * - Prima de servicios (junio y diciembre, ~6 meses de provisión)
   * - Cesantías al fondo (febrero 14, ~12 meses de provisión)
   * - Intereses de cesantías (enero 31, ~12 meses de provisión)
   */
  const syncObligations = useMutation({
    mutationFn: async (latest: {
      salary_total: number;
      transport_allowance: number;
      rates: PayrollRates;
      diaPagoNomina: number;
      diaPagoPila: number;
    }) => {
      const b = computePayroll(latest.salary_total, latest.transport_allowance, latest.rates);
      const ALL_MONTHS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
      // Neto a consignar a empleados = devengado − 8% retenido (4% salud +
      // 4% pensión). Ese 8% se paga por PILA: si la obligación de nómina
      // usara el devengado bruto, el cronograma contaría el 8% dos veces.
      const netoNomina = Math.max(0, latest.salary_total + latest.transport_allowance - Math.round(latest.salary_total * 0.08));
      const targets = [
        {
          nombre: 'Pago de nómina (neto a empleados)',
          tipo: 'nomina',
          dia_mes: latest.diaPagoNomina,
          monto_estimado: netoNomina,
          meses: ALL_MONTHS,
        },
        {
          nombre: 'PILA — Seguridad social y parafiscales',
          tipo: 'pila',
          dia_mes: latest.diaPagoPila,
          monto_estimado: b.pilaEstimado,
          meses: ALL_MONTHS,
        },
        // Prima partida en dos: el vencimiento legal es jun 30 y dic 20.
        // Una sola obligación con dia_mes fijo mentiría en uno de los dos.
        {
          nombre: 'Prima de servicios (1er semestre)',
          tipo: 'nomina',
          dia_mes: 30,
          monto_estimado: b.prima * 6,
          meses: ['6'],
        },
        {
          nombre: 'Prima de servicios (2do semestre)',
          tipo: 'nomina',
          dia_mes: 20,
          monto_estimado: b.prima * 6,
          meses: ['12'],
        },
        {
          nombre: 'Cesantías — consignación al fondo',
          tipo: 'cesantias',
          dia_mes: 14,
          monto_estimado: b.cesantias * 12,
          meses: ['2'],
        },
        {
          nombre: 'Intereses de cesantías',
          tipo: 'cesantias',
          dia_mes: 31,
          monto_estimado: b.interesesCesantias * 12,
          meses: ['1'],
        },
      ];

      // Traer las obligaciones auto-creadas existentes para actualizar en
      // vez de duplicar. Match por nombre exacto + tag en notas.
      const { data: existing, error: exErr } = await (supabase as any)
        .from('business_obligations')
        .select('id, nombre, notas')
        .like('notas', `%${AUTO_TAG}%`);
      if (exErr) throw exErr;
      const byName = new Map(
        ((existing || []) as Array<{ id: string; nombre: string }>).map((o) => [o.nombre, o.id]),
      );

      for (const t of targets) {
        const payload = {
          nombre: t.nombre,
          tipo: t.tipo,
          dia_mes: t.dia_mes,
          monto_estimado: t.monto_estimado,
          meses: t.meses,
          activa: true,
          notas: `${AUTO_TAG} Actualizada desde el módulo Nómina.`,
        };
        const id = byName.get(t.nombre);
        if (id) {
          const { error } = await (supabase as any)
            .from('business_obligations')
            .update(payload)
            .eq('id', id);
          if (error) throw error;
        } else {
          const { error } = await (supabase as any)
            .from('business_obligations')
            .insert({ ...payload, user_id: user!.id });
          if (error) throw error;
        }
      }
      return targets.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['business-obligations'] });
      toast.success('Cronograma actualizado', {
        description: 'Nómina, PILA, prima y cesantías ya aparecen en Próximas obligaciones del Dashboard.',
      });
    },
    onError: (err: any) => toast.error(`Error sincronizando cronograma: ${err.message}`),
  });

  return { entries, isLoading, saveEntry, deleteEntry, syncObligations };
}
