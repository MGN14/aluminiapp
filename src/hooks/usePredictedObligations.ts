// F2+F3 del plan de aprendizaje continuo (auditoría 2026-08-23):
// gastos recurrentes PREDICHOS desde la conciliación, como recordatorios.
//
// Lee business_memory.predictions (que genera update-business-memory desde
// los patrones conciliados) y las convierte en recordatorios estimados para
// el Dashboard. Umbrales de DISPLAY más duros que los del motor (ocurrencias
// ≥4, confianza ≥0.5, solo egresos, máx 3): tres pagos no son un patrón fijo
// para mostrárselo al dueño — para Nico y cfo-insights el umbral bajo queda.
//
// F3: "es fijo" crea la business_obligation real desde el patrón (un clic
// reemplaza el formulario) y marca el patrón confirmed; "ignoralo" lo marca
// dismissed. El status vive en business_patterns por pattern_key y sobrevive
// el regenerado (F1). Nunca se presenta un predicho como vencimiento DIAN:
// origen 'predicho', badge "estimado" — una cosa es ley, la otra estadística.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import type { NewBusinessObligation } from '@/hooks/useBusinessObligations';

export interface PredictedObligation {
  pattern_key: string;
  description: string;
  estimated_amount: number;
  estimated_date: string; // YYYY-MM-DD
  days_until: number;
  confidence: number;
  occurrences: number;
  frequency_days: number;
  source: string; // 'conciliado' | 'texto' | 'factura'
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const DISPLAY_MIN_OCCURRENCES = 4;
const DISPLAY_MIN_CONFIDENCE = 0.5;
const MAX_DISPLAY = 3;

export function usePredictedObligations() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['predicted-obligations', user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<PredictedObligation[]> => {
      const [memRes, patRes, oblRes] = await Promise.all([
        (supabase as any).from('business_memory').select('metric_value').eq('metric_key', 'predictions').maybeSingle(),
        (supabase as any).from('business_patterns').select('pattern_key, status').not('pattern_key', 'is', null),
        (supabase as any).from('business_obligations').select('nombre, activa'),
      ]);

      const raw = Array.isArray(memRes.data?.metric_value) ? memRes.data.metric_value : [];
      const statusByKey = new Map<string, string>(
        ((patRes.data ?? []) as Array<{ pattern_key: string; status: string }>).map((r) => [r.pattern_key, r.status]),
      );
      const obligationNames = ((oblRes.data ?? []) as Array<{ nombre: string; activa: boolean }>)
        .filter((o) => o.activa)
        .map((o) => norm(o.nombre));

      return (raw as PredictedObligation[])
        // Solo EGRESOS: los ingresos recurrentes son territorio de cobranza
        // (expected_payments), no de este card.
        .filter((p: any) => p.type === 'egreso_recurrente' || p.type === 'compra_recurrente_proveedor')
        // El jsonb de predictions se regenera con el cron; entre corridas, el
        // status fresco de business_patterns manda (confirmar/descartar acá
        // debe sacarlo de la lista al instante).
        .filter((p) => {
          const st = p.pattern_key ? statusByKey.get(p.pattern_key) : undefined;
          return st !== 'dismissed' && st !== 'confirmed' && st !== 'archived';
        })
        // Dedup contra obligaciones manuales: si ya existe una con nombre
        // parecido, el predicho no aporta (la manual es la verdad).
        .filter((p) => {
          const d = norm(p.description);
          return !obligationNames.some((n) => n && (d.includes(n) || n.includes(d)));
        })
        .filter((p) => (p.occurrences ?? 0) >= DISPLAY_MIN_OCCURRENCES
          && (p.confidence ?? 0) >= DISPLAY_MIN_CONFIDENCE
          && p.days_until >= 0
          && !!p.pattern_key)
        .sort((a, b) => a.days_until - b.days_until)
        .slice(0, MAX_DISPLAY);
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['predicted-obligations'] });
    qc.invalidateQueries({ queryKey: ['business-obligations'] });
    qc.invalidateQueries({ queryKey: ['business-patterns'] });
  };

  /** F3 — "Sí, es fijo": obligación real desde el patrón + patrón confirmed. */
  const confirm = useMutation({
    mutationFn: async (p: PredictedObligation) => {
      const dia = Number(p.estimated_date.slice(8, 10)) || 1;
      // Frecuencia ~mensual (25-35d) → todos los meses; si no, arranca con el
      // mes de la próxima fecha y el usuario ajusta en Configurar obligaciones.
      const mensual = p.frequency_days >= 25 && p.frequency_days <= 35;
      const meses = mensual
        ? ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']
        : [String(Number(p.estimated_date.slice(5, 7)))];
      const nueva: NewBusinessObligation & { user_id: string } = {
        user_id: user!.id,
        nombre: p.description.substring(0, 120),
        tipo: 'otro',
        dia_mes: Math.min(dia, 28),
        monto_estimado: p.estimated_amount,
        meses,
        activa: true,
        notas: `Creada desde patrón detectado (${p.occurrences} pagos, cada ~${p.frequency_days}d).`,
      } as never;
      const { error } = await (supabase as any).from('business_obligations').insert(nueva);
      if (error) throw error;
      const { error: patError } = await (supabase as any)
        .from('business_patterns')
        .update({ status: 'confirmed' })
        .eq('pattern_key', p.pattern_key);
      if (patError) throw patError;
    },
    onSuccess: () => { invalidate(); toast.success('Obligación fija creada — editala en Visita DIAN → Configurar obligaciones'); },
    onError: (e) => toast.error(`No se pudo crear: ${(e as Error).message}`),
  });

  /** F3 — "Ignoralo": no vuelve a proponerse (sobrevive el regenerado). */
  const dismiss = useMutation({
    mutationFn: async (p: PredictedObligation) => {
      const { error } = await (supabase as any)
        .from('business_patterns')
        .update({ status: 'dismissed' })
        .eq('pattern_key', p.pattern_key);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success('Listo, no te lo vuelvo a sugerir'); },
    onError: (e) => toast.error(`Error: ${(e as Error).message}`),
  });

  return { predicted: query.data ?? [], isLoading: query.isLoading, confirm, dismiss };
}
