import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { ArrowRight, AlertTriangle, Zap, ShieldCheck, Info, Upload, Brain, Repeat, Sparkles } from 'lucide-react';
import { PeriodSelection } from './UnifiedPeriodFilter';
import { supabase } from '@/integrations/supabase/client';
import nicoAvatar from '@/assets/nico-avatar.png';

interface Insight {
  key: string;
  title: string;
  text: string;
  impact: number;
  trend?: 'up' | 'down' | null;
  insightType?: 'anomaly' | 'pattern' | 'prediction' | 'learning' | null;
}

type InsightColor = 'red' | 'orange' | 'blue' | 'green' | 'gray' | 'purple';

function getInsightColor(insight: Insight): InsightColor {
  // New adaptive types first
  if (insight.insightType === 'pattern') return 'green';
  if (insight.insightType === 'prediction') return 'purple';
  if (insight.insightType === 'learning') return 'purple';
  if (insight.insightType === 'anomaly') return 'red';
  
  if (insight.key === 'conciliacion' && insight.trend === 'up') return 'green';
  if (insight.key === 'conciliacion' && insight.trend === 'down') return 'red';
  if (insight.key === 'flujo' && insight.trend === 'down') return 'red';
  if (insight.key === 'cxc') return 'red';
  if (insight.key === 'concentracion' && insight.impact >= 8) return 'red';
  if (insight.key === 'concentracion') return 'orange';
  if (insight.key === 'outlier') return 'orange';
  if (insight.key === 'anticipos') return 'orange';
  if (insight.key === 'flujo' && insight.trend === 'up') return 'green';
  if (insight.key === 'impuestos') return 'blue';
  return 'gray';
}

const COLOR_STYLES: Record<InsightColor, { border: string; bg: string; iconColor: string; badge: string }> = {
  red: { border: 'border-l-destructive', bg: 'bg-destructive/5', iconColor: 'text-destructive', badge: 'bg-destructive/10 text-destructive' },
  orange: { border: 'border-l-warning', bg: 'bg-warning/5', iconColor: 'text-warning', badge: 'bg-warning/10 text-warning' },
  blue: { border: 'border-l-primary', bg: 'bg-primary/5', iconColor: 'text-primary', badge: 'bg-primary/10 text-primary' },
  green: { border: 'border-l-success', bg: 'bg-success/5', iconColor: 'text-success', badge: 'bg-success/10 text-success' },
  purple: { border: 'border-l-[hsl(var(--accent))]', bg: 'bg-accent/5', iconColor: 'text-accent-foreground', badge: 'bg-accent/10 text-accent-foreground' },
  gray: { border: 'border-l-muted-foreground', bg: 'bg-muted/30', iconColor: 'text-muted-foreground', badge: 'bg-muted text-muted-foreground' },
};

const BADGE_LABELS: Record<InsightColor, string> = {
  red: 'Alerta', orange: 'Riesgo', blue: 'Oportunidad', green: 'Positivo', purple: 'Nico IA', gray: 'Info',
};

function getIcon(color: InsightColor, insightType?: string | null) {
  if (insightType === 'pattern') return Repeat;
  if (insightType === 'prediction') return Sparkles;
  if (insightType === 'learning') return Brain;
  switch (color) {
    case 'red': case 'orange': return AlertTriangle;
    case 'green': return ShieldCheck;
    case 'blue': return Zap;
    case 'purple': return Brain;
    default: return Info;
  }
}

function getInsightBadge(insight: Insight, color: InsightColor): string {
  if (insight.insightType === 'pattern') return '🔁 Patrón';
  if (insight.insightType === 'prediction') return '🔮 Predicción';
  if (insight.insightType === 'learning') return '🧠 Aprendizaje';
  if (insight.insightType === 'anomaly') return '⚠️ Anomalía';
  return BADGE_LABELS[color];
}

interface Props {
  periodSelection: PeriodSelection;
  hasTransactions: boolean;
}

export default function InsightsMiniCards({ periodSelection, hasTransactions }: Props) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [patternsCount, setPatternsCount] = useState(0);

  useEffect(() => {
    if (!hasTransactions) { setLoading(false); return; }
    fetchInsights();
    // Trigger memory update in background
    triggerMemoryUpdate();
  }, [periodSelection.type, periodSelection.month, periodSelection.quarter, periodSelection.year, hasTransactions]);

  const triggerMemoryUpdate = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      // Fire and forget - don't block UI
      fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-business-memory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      }).catch(() => {});
    } catch {}
  };

  const fetchInsights = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('cfo-insights', {
        body: {
          periodType: periodSelection.type,
          month: periodSelection.month,
          quarter: periodSelection.quarter,
          year: periodSelection.year,
        },
      });
      if (error) throw error;
      const sorted = (data?.insights || []).sort((a: Insight, b: Insight) => b.impact - a.impact);
      setInsights(sorted.slice(0, 3));
      setPatternsCount(data?.patterns_count || 0);
    } catch {
      setInsights([]);
    } finally {
      setLoading(false);
    }
  };

  if (!hasTransactions) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-muted-foreground/15 bg-muted/5 p-5">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-muted flex-shrink-0">
            <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-foreground text-sm">Insights de Nico</h3>
            <p className="text-xs text-muted-foreground">Sube un extracto para que Nico analice tu negocio.</p>
          </div>
          <Link to="/statement-upload">
            <Button variant="outline" size="sm" className="gap-2 text-xs">
              <Upload className="h-3.5 w-3.5" /> Subir extracto
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="grid gap-3 md:grid-cols-3">
        {[1, 2, 3].map(i => (
          <Card key={i} className="border-l-4 border-l-muted">
            <CardContent className="py-4 space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (insights.length === 0) return null;

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full overflow-hidden border border-success/30 flex-shrink-0">
            <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
          </div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">Nico analizó tu negocio hoy</h3>
            {patternsCount > 0 && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-accent/10 text-[10px] font-medium text-accent-foreground">
                <Brain className="h-2.5 w-2.5" />
                {patternsCount} patrones
              </span>
            )}
          </div>
        </div>
        <Link to="/financial-health">
          <Button variant="ghost" size="sm" className="text-xs gap-1 text-primary">
            Ver análisis completo <ArrowRight className="h-3 w-3" />
          </Button>
        </Link>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {insights.map((insight) => {
          const color = getInsightColor(insight);
          const styles = COLOR_STYLES[color];
          const Icon = getIcon(color, insight.insightType);
          const badgeLabel = getInsightBadge(insight, color);
          return (
            <Link key={insight.key} to="/financial-health" className="block">
              <Card className={`border-l-4 ${styles.border} ${styles.bg} hover:shadow-md transition-all duration-200 h-full cursor-pointer`}>
                <CardContent className="py-4 px-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-3.5 w-3.5 ${styles.iconColor}`} />
                    <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${styles.badge}`}>
                      {badgeLabel}
                    </span>
                  </div>
                  <h4 className="text-xs font-semibold text-foreground line-clamp-1">{insight.title}</h4>
                  <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">{insight.text}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
