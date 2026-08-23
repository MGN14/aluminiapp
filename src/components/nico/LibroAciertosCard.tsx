// Libro de aciertos — el track record de las predicciones de la app.
//
// Tres fuentes:
//   · prediction_log (gasto_recurrente / score_cobranza): lo escribe y
//     resuelve el cron diario de update-business-memory. La zona gris del
//     score (40-59, hit NULL) no puntúa — el modelo no se comprometió.
//   · ETA de importaciones: retro directo de imports (estimada vs real),
//     sin log — ambas fechas ya viven en la tabla.
//
// Sin historial suficiente (n < 5) se muestra "juntando datos" en vez de un
// porcentaje que no significa nada.

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Target, TrendingUp, Ship, HelpCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const MIN_N = 5;

interface KindStats { n: number; hits: number; misses: number; gris: number }

function useLibroAciertos() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['libro-aciertos', user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [logRes, impRes] = await Promise.all([
        (supabase as any).from('prediction_log').select('kind, hit').not('resolved_at', 'is', null),
        (supabase as any).from('imports').select('fecha_estimada_llegada, fecha_arribo_real')
          .not('fecha_estimada_llegada', 'is', null).not('fecha_arribo_real', 'is', null),
      ]);

      const byKind = new Map<string, KindStats>();
      for (const r of ((logRes.data ?? []) as Array<{ kind: string; hit: boolean | null }>)) {
        const s = byKind.get(r.kind) ?? { n: 0, hits: 0, misses: 0, gris: 0 };
        s.n += 1;
        if (r.hit === true) s.hits += 1;
        else if (r.hit === false) s.misses += 1;
        else s.gris += 1;
        byKind.set(r.kind, s);
      }

      const desvios = ((impRes.data ?? []) as Array<{ fecha_estimada_llegada: string; fecha_arribo_real: string }>)
        .map((r) => Math.round(
          (new Date(r.fecha_arribo_real + 'T00:00:00Z').getTime() - new Date(r.fecha_estimada_llegada + 'T00:00:00Z').getTime()) / 86_400_000,
        ))
        .filter((d) => Math.abs(d) < 120);
      const etaN = desvios.length;
      const etaMedia = etaN > 0 ? desvios.reduce((a, b) => a + b, 0) / etaN : 0;
      const etaAbs = etaN > 0 ? desvios.reduce((a, b) => a + Math.abs(b), 0) / etaN : 0;

      return { byKind, eta: { n: etaN, media: Math.round(etaMedia), abs: Math.round(etaAbs) } };
    },
  });
}

function pctOf(s: KindStats | undefined): { pct: number; decididos: number } | null {
  if (!s) return null;
  const decididos = s.hits + s.misses;
  if (decididos < MIN_N) return null;
  return { pct: Math.round((s.hits / decididos) * 100), decididos };
}

function Row({ icon: Icon, label, value, detail, tone }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; detail: string; tone?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm">{label}</p>
        <p className="text-[11px] text-muted-foreground">{detail}</p>
      </div>
      <span className={cn('text-lg font-semibold tabular-nums shrink-0', tone ?? 'text-foreground')}>{value}</span>
    </div>
  );
}

export default function LibroAciertosCard() {
  const { data } = useLibroAciertos();
  if (!data) return null;

  const gasto = pctOf(data.byKind.get('gasto_recurrente'));
  const score = pctOf(data.byKind.get('score_cobranza'));
  const scoreStats = data.byKind.get('score_cobranza');

  const tone = (p: number) => (p >= 70 ? 'text-success' : p >= 50 ? 'text-warning' : 'text-destructive');

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Target className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Libro de aciertos</h3>
        <span title="Cada predicción de la app queda registrada y se confronta con lo que pasó de verdad. Esto no es marketing: es el historial auditable.">
          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-2">
        Qué tan bien viene prediciendo la app — medido contra la realidad, no contra sí misma.
      </p>
      <div className="divide-y divide-border">
        <Row
          icon={TrendingUp}
          label="Gastos recurrentes predichos"
          detail={gasto ? `${gasto.decididos} predicciones confrontadas` : 'Juntando historial — se llena solo con el cron diario'}
          value={gasto ? `${gasto.pct}%` : '—'}
          tone={gasto ? tone(gasto.pct) : undefined}
        />
        <Row
          icon={Target}
          label="Score de cobranza"
          detail={score
            ? `${score.decididos} scores confrontados a 30 días${scoreStats && scoreStats.gris > 0 ? ` · ${scoreStats.gris} en zona gris (no puntúan)` : ''}`
            : 'Juntando historial — cada score se confronta a los 30 días'}
          value={score ? `${score.pct}%` : '—'}
          tone={score ? tone(score.pct) : undefined}
        />
        <Row
          icon={Ship}
          label="ETA de importaciones"
          detail={data.eta.n >= 3
            ? `${data.eta.n} llegadas medidas · sesgo ${data.eta.media > 0 ? `+${data.eta.media}d tarde` : data.eta.media < 0 ? `${data.eta.media}d antes` : 'neutro'}`
            : 'Se mide solo con cada contenedor entregado'}
          value={data.eta.n >= 3 ? `±${data.eta.abs}d` : '—'}
          tone={data.eta.n >= 3 ? (data.eta.abs <= 7 ? 'text-success' : data.eta.abs <= 15 ? 'text-warning' : 'text-destructive') : undefined}
        />
      </div>
      {gasto === null && score === null && data.eta.n < 3 && (
        <Badge variant="outline" className="text-[10px] mt-2">El libro se escribe solo — volvé en unas semanas</Badge>
      )}
    </div>
  );
}
