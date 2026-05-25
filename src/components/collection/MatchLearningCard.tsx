// Card: estado del aprendizaje pasivo del auto-matching.
// Solo se muestra si hay >=1 decisión registrada (sino confunde).

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Brain, GraduationCap, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useMatchLearning, getSignalLabel } from '@/hooks/useMatchLearning';

function pctColor(pct: number, total: number): string {
  if (total < 5) return 'text-muted-foreground';
  if (pct >= 85) return 'text-success';
  if (pct >= 65) return 'text-primary';
  if (pct <= 30) return 'text-destructive';
  if (pct <= 50) return 'text-warning';
  return 'text-foreground';
}

function pctIcon(pct: number, total: number) {
  if (total < 5) return <Minus className="h-3 w-3" />;
  if (pct >= 70) return <TrendingUp className="h-3 w-3" />;
  if (pct <= 40) return <TrendingDown className="h-3 w-3" />;
  return <Minus className="h-3 w-3" />;
}

export default function MatchLearningCard() {
  const { data, isLoading } = useMatchLearning();

  if (isLoading || !data || data.total_decisions === 0) {
    // Si nunca decidió, no mostramos card (evita ruido cuando recién empieza)
    return null;
  }

  const progressToActivation = Math.min(100, (data.total_decisions / 20) * 100);

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-primary" />
                Aprendizaje pasivo del matching
                {data.active ? (
                  <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/30">
                    <Brain className="h-3 w-3 mr-1" />
                    Activo
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    Entrenando
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Cada vez que confirmás o rechazás una sugerencia, AluminIA ajusta cómo pesa cada señal para futuras predicciones tuyas.
              </CardDescription>
            </div>
            <div className="text-right text-xs">
              <p className="font-semibold">
                <span className="text-success">{data.total_confirmed}</span>
                {' · '}
                <span className="text-destructive">{data.total_rejected}</span>
              </p>
              <p className="text-[10px] text-muted-foreground">confirmadas · rechazadas</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!data.active && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Necesita {20 - data.total_decisions} decisiones más para activarse</span>
                <span className="font-mono">{data.total_decisions} / 20</span>
              </div>
              <Progress value={progressToActivation} className="h-1.5" />
            </div>
          )}

          {data.by_signal.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground font-medium">
                Confirmación por señal (basado en tu historial)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {data.by_signal.map((s) => {
                  const label = getSignalLabel(s.signal, s.value);
                  const reliable = s.total >= 5;
                  return (
                    <Tooltip key={`${s.signal}_${s.value}`}>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-border bg-card text-xs">
                          <span className="truncate flex-1">{label}</span>
                          <span className={`flex items-center gap-1 font-mono shrink-0 ${pctColor(s.confirm_pct, s.total)}`}>
                            {pctIcon(s.confirm_pct, s.total)}
                            {reliable ? `${s.confirm_pct.toFixed(0)}%` : '—'}
                          </span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        <p>
                          <strong>{s.confirmed}</strong> confirmadas · <strong>{s.rejected}</strong> rechazadas (total {s.total})
                        </p>
                        {!reliable && <p className="text-warning mt-1">Pocas muestras todavía ({s.total}/5 para estadística fiable)</p>}
                        {reliable && data.active && (
                          <p className="mt-1">
                            {s.confirm_pct >= 85 ? '✅ Señal muy confiable → +bonus al score' :
                             s.confirm_pct >= 65 ? '👍 Señal útil → +bonus leve' :
                             s.confirm_pct <= 30 ? '⚠️ Señal poco confiable → -penalty al score' :
                             s.confirm_pct <= 50 ? '🤔 Señal ambigua → -penalty leve' :
                             '➖ Señal neutra'}
                          </p>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          )}

          {data.active && (
            <div className="text-[11px] text-muted-foreground italic">
              💡 Los scores de auto-matching ya están siendo ajustados según tu historial. Cuanto más uses Confirmar/Rechazar, más preciso se vuelve.
            </div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
