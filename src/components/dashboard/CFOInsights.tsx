import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { Brain, ArrowRight, TrendingUp, TrendingDown, FileWarning, Upload } from 'lucide-react';
import { PeriodSelection } from './UnifiedPeriodFilter';
import { supabase } from '@/integrations/supabase/client';

interface Insight {
  key: string;
  title: string;
  text: string;
  recommendation: string;
  action: { label: string; path: string };
  impact: number;
  trend?: 'up' | 'down' | null;
  changePercent?: number | null;
}

interface CFOInsightsProps {
  periodSelection: PeriodSelection;
  hasTransactions: boolean;
}

const INSIGHT_ICONS: Record<string, string> = {
  flujo: '💰',
  impuestos: '🧾',
  anticipos: '📋',
  cxc: '🔔',
  concentracion: '📊',
  outlier: '🔍',
};

export default function CFOInsights({ periodSelection, hasTransactions }: CFOInsightsProps) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasTransactions) {
      setLoading(false);
      return;
    }
    fetchInsights();
  }, [periodSelection.type, periodSelection.month, periodSelection.quarter, periodSelection.year, hasTransactions]);

  const fetchInsights = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log('[CFOInsights] Fetching insights for', periodSelection);
      const { data, error: fnError } = await supabase.functions.invoke('cfo-insights', {
        body: {
          periodType: periodSelection.type,
          month: periodSelection.month,
          quarter: periodSelection.quarter,
          year: periodSelection.year,
        },
      });

      if (fnError) throw fnError;

      console.log('[CFOInsights] Received', data?.insights?.length, 'insights');
      setInsights(data?.insights || []);
    } catch (err: any) {
      console.error('[CFOInsights] Error fetching insights:', err);
      setError(err.message || 'Error al cargar insights');
    } finally {
      setLoading(false);
    }
  };

  if (!hasTransactions) {
    return (
      <Card className="border-dashed border-2 border-muted-foreground/20 bg-muted/5">
        <CardContent className="flex items-center gap-4 py-6">
          <div className="p-3 rounded-full bg-muted">
            <Upload className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-foreground mb-1">Tu CFO hoy</h3>
            <p className="text-sm text-muted-foreground">
              Aún no tengo suficiente información para darte insights. Sube un extracto y una factura para arrancar.
            </p>
          </div>
          <Link to="/statement-upload">
            <Button variant="outline" size="sm">Subir extracto</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Brain className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Tu CFO hoy</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => (
            <Card key={i}>
              <CardContent className="py-5">
                <Skeleton className="h-5 w-32 mb-3" />
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-3/4 mb-4" />
                <Skeleton className="h-8 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error || insights.length === 0) {
    return null; // Don't show anything if no insights
  }

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-center gap-2 mb-1">
        <Brain className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold text-foreground">Tu CFO hoy</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {insights.map((insight) => (
          <Card
            key={insight.key}
            className="group hover:shadow-md transition-shadow border-l-4"
            style={{
              borderLeftColor: insight.key === 'flujo' && insight.trend === 'up'
                ? 'hsl(var(--success))'
                : insight.key === 'flujo' && insight.trend === 'down'
                ? 'hsl(var(--destructive))'
                : insight.key === 'concentracion'
                ? 'hsl(var(--warning, 40 96% 53%))'
                : insight.key === 'cxc' || insight.key === 'outlier'
                ? 'hsl(var(--destructive))'
                : 'hsl(var(--primary))',
            }}
          >
            <CardContent className="py-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-foreground text-sm">
                  {insight.title}
                </h3>
                {insight.trend && (
                  <div className={`flex items-center gap-1 text-xs font-medium ${
                    insight.trend === 'up' ? 'text-success' : 'text-destructive'
                  }`}>
                    {insight.trend === 'up' ? (
                      <TrendingUp className="h-3.5 w-3.5" />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5" />
                    )}
                    {insight.changePercent !== null && insight.changePercent !== undefined && (
                      <span>{insight.changePercent > 0 ? '+' : ''}{insight.changePercent}%</span>
                    )}
                  </div>
                )}
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                {insight.text}
              </p>

              <p className="text-xs text-foreground/80 italic leading-relaxed">
                {insight.recommendation}
              </p>

              <Link to={insight.action.path}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-primary hover:text-primary/80 p-0 h-auto text-xs font-medium group-hover:underline"
                >
                  {insight.action.label}
                  <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
