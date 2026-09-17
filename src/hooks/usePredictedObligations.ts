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
import { planObligationsFromPattern, coveredByManualObligation, type PatternTx } from '@/lib/obligationPlan';

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

/** Patrón conciliado: `egreso|resp:<uuid>|cat:<uuid>` → sus pagos reales. */
const PATTERN_KEY_RE = /^egreso\|resp:([0-9a-f-]{36})\|cat:([0-9a-f-]{36})$/;

async function fetchPatternTxs(patternKey: string): Promise<PatternTx[]> {
  const m = patternKey.match(PATTERN_KEY_RE);
  if (!m) return [];
  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  const { data } = await supabase
    .from('transactions')
    .select('date, amount')
    .eq('type', 'egreso')
    .is('deleted_at', null)
    .eq('responsible_id', m[1])
    .eq('category_id', m[2])
    .gte('date', since.toISOString().slice(0, 10))
    .order('date');
  return ((data ?? []) as Array<{ date: string; amount: number | null }>)
    .map((r) => ({ date: r.date, amount: Math.abs(Number(r.amount ?? 0)) }))
    .filter((r) => r.amount > 0);
}

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
        (supabase as any).from('business_obligations').select('nombre, activa, dia_mes, monto_estimado'),
      ]);

      const raw = Array.isArray(memRes.data?.metric_value) ? memRes.data.metric_value : [];
      const statusByKey = new Map<string, string>(
        ((patRes.data ?? []) as Array<{ pattern_key: string; status: string }>).map((r) => [r.pattern_key, r.status]),
      );
      const manuales = ((oblRes.data ?? []) as Array<{ nombre: string; activa: boolean; dia_mes: number; monto_estimado: number | null }>)
        .filter((o) => o.activa);

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
        // Dedup contra obligaciones manuales: nombre parecido, o misma plata
        // y fecha cercana (MiPlanilla vs "Nómina — Compensar"). La manual es
        // la verdad; el predicho no aporta.
        .filter((p) => !coveredByManualObligation(p, manuales))
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

  /** F3 — "Sí, es fijo": obligación real desde el patrón + patrón confirmed.
   *  Día, monto y meses salen de los pagos REALES (lib/obligationPlan): una
   *  nómina quincenal crea dos filas (15 y 30), una mensual una sola con su
   *  día típico — no el de la proyección. */
  const confirm = useMutation({
    mutationFn: async (p: PredictedObligation) => {
      const txs = await fetchPatternTxs(p.pattern_key);
      const planes = planObligationsFromPattern(p, txs);
      const filas: Array<NewBusinessObligation & { user_id: string }> = planes.map((pl) => ({
        user_id: user!.id,
        nombre: pl.nombre,
        tipo: pl.tipo,
        dia_mes: pl.dia_mes,
        monto_estimado: pl.monto_estimado,
        meses: pl.meses,
        activa: true,
        notas: pl.notas,
      }));
      const { error } = await (supabase as any).from('business_obligations').insert(filas);
      if (error) throw error;
      const { error: patError } = await (supabase as any)
        .from('business_patterns')
        .update({ status: 'confirmed' })
        .eq('pattern_key', p.pattern_key);
      if (patError) throw patError;
      return planes;
    },
    onSuccess: (planes) => {
      invalidate();
      const detalle = planes.map((pl) => `día ${pl.dia_mes}`).join(' y ');
      toast.success(planes.length > 1
        ? `Nómina quincenal: creadas ${planes.length} obligaciones (${detalle}) — editalas en Visita DIAN → Configurar obligaciones`
        : `Obligación fija creada (${detalle}) — editala en Visita DIAN → Configurar obligaciones`);
    },
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
