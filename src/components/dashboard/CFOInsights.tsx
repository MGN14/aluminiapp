import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'react-router-dom';
import { Brain, ArrowRight, TrendingUp, TrendingDown, Upload, MessageCircle, AlertTriangle, Info, Zap, ShieldCheck } from 'lucide-react';
import { PeriodSelection } from './UnifiedPeriodFilter';
import { supabase } from '@/integrations/supabase/client';
import { useNico } from '@/hooks/useNicoContext';
import nicoAvatar from '@/assets/nico-avatar.png';

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
  title?: string;
  subtitle?: string;
  emptySubtitle?: string;
}

type InsightColor = 'red' | 'orange' | 'blue' | 'green' | 'gray';

function getInsightColor(insight: Insight): InsightColor {
  // Conciliación
  if (insight.key === 'conciliacion' && insight.trend === 'up') return 'green';
  if (insight.key === 'conciliacion' && insight.trend === 'down') return 'red';

  // Alerts: negative flow, overdue CxC, high concentration
  if (insight.key === 'flujo' && insight.trend === 'down') return 'red';
  if (insight.key === 'cxc') return 'red';
  if (insight.key === 'concentracion' && insight.impact >= 8) return 'red';

  // Risks: concentration moderate, outliers, advances
  if (insight.key === 'concentracion') return 'orange';
  if (insight.key === 'outlier') return 'orange';
  if (insight.key === 'anticipos') return 'orange';

  // Positive: flow up
  if (insight.key === 'flujo' && insight.trend === 'up') return 'green';

  // Opportunity: taxes
  if (insight.key === 'impuestos') return 'blue';

  return 'gray';
}

const COLOR_STYLES: Record<InsightColor, { border: string; bg: string; iconBg: string; iconColor: string; badge: string }> = {
  red: {
    border: 'border-l-destructive',
    bg: 'bg-destructive/5',
    iconBg: 'bg-destructive/10',
    iconColor: 'text-destructive',
    badge: 'bg-destructive/10 text-destructive',
  },
  orange: {
    border: 'border-l-warning',
    bg: 'bg-warning/5',
    iconBg: 'bg-warning/10',
    iconColor: 'text-warning',
    badge: 'bg-warning/10 text-warning',
  },
  blue: {
    border: 'border-l-primary',
    bg: 'bg-primary/5',
    iconBg: 'bg-primary/10',
    iconColor: 'text-primary',
    badge: 'bg-primary/10 text-primary',
  },
  green: {
    border: 'border-l-success',
    bg: 'bg-success/5',
    iconBg: 'bg-success/10',
    iconColor: 'text-success',
    badge: 'bg-success/10 text-success',
  },
  gray: {
    border: 'border-l-muted-foreground',
    bg: 'bg-muted/30',
    iconBg: 'bg-muted',
    iconColor: 'text-muted-foreground',
    badge: 'bg-muted text-muted-foreground',
  },
};

function getInsightIcon(color: InsightColor) {
  switch (color) {
    case 'red': return AlertTriangle;
    case 'orange': return AlertTriangle;
    case 'green': return ShieldCheck;
    case 'blue': return Zap;
    default: return Info;
  }
}

const BADGE_LABELS: Record<InsightColor, string> = {
  red: 'Alerta',
  orange: 'Riesgo',
  blue: 'Oportunidad',
  green: 'Positivo',
  gray: 'Info',
};

function buildNicoQuestion(insight: Insight): string {
    switch (insight.key) {
    case 'flujo':
      return `Explícame en detalle el flujo de caja de este periodo. ${insight.text}`;
    case 'impuestos':
      return `Dame un resumen de mis obligaciones tributarias de este periodo. ${insight.text}`;
    case 'anticipos':
      return `Explícame qué anticipos tengo sin facturar y cómo los resuelvo. ${insight.text}`;
    case 'cxc':
      return `¿Cuáles son mis cuentas por cobrar más urgentes? ${insight.text}`;
    case 'concentracion':
      return `Explícame el riesgo de concentración de clientes. ${insight.text}`;
    case 'outlier':
      return `Analiza este gasto inusual que detectaste. ${insight.text}`;
    case 'conciliacion':
      return `Analiza el estado de mi conciliación bancaria. ${insight.text}`;
    default:
      return `Explícame más sobre esto: ${insight.text}`;
  }
}

export default function CFOInsights({ periodSelection, hasTransactions, title, subtitle, emptySubtitle }: CFOInsightsProps) {
  const heading = title ?? 'Nico analizó tu negocio hoy';
  const loadingSubtitle = subtitle ?? 'Analizando tus números...';
  const activeSubtitle = subtitle ?? 'Esto es lo más importante que encontró en tus números.';
  const emptyCopy = emptySubtitle ?? 'Aún no tengo suficiente información para darte insights. Sube un extracto y una factura para arrancar.';
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { openNico, setPageContext } = useNico();

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
      // Sort by impact descending
      const sorted = (data?.insights || []).sort((a: Insight, b: Insight) => b.impact - a.impact);
      setInsights(sorted);
    } catch (err: any) {
      console.error('[CFOInsights] Error fetching insights:', err);
      setError(err.message || 'Error al cargar insights');
    } finally {
      setLoading(false);
    }
  };

  const handleAskNico = (insight: Insight) => {
    const question = buildNicoQuestion(insight);
    setPageContext({
      page: 'dashboard',
      filters: {
        period: periodSelection.type,
        month: periodSelection.month,
        year: periodSelection.year,
      },
    });
    // Open Nico and pre-fill the question via a custom event
    openNico();
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('nico-prefill', { detail: { message: question } }));
    }, 300);
  };

  if (!hasTransactions) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-muted-foreground/15 bg-muted/5 p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-muted flex-shrink-0">
            <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-foreground mb-1">{heading}</h3>
            <p className="text-sm text-muted-foreground">{emptyCopy}</p>
          </div>
          <Link to="/statement-upload">
            <Button variant="outline" size="sm" className="gap-2">
              <Upload className="h-4 w-4" />
              Subir extracto
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-success/30 flex-shrink-0">
            <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">{heading}</h2>
            <p className="text-sm text-muted-foreground">{loadingSubtitle}</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map(i => (
            <Card key={i} className="border-l-4 border-l-muted">
              <CardContent className="py-5 space-y-3">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <div className="flex gap-2 pt-2">
                  <Skeleton className="h-8 w-24" />
                  <Skeleton className="h-8 w-28" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error || insights.length === 0) {
    return null;
  }

  const [heroInsight, ...secondaryInsights] = insights;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-success/30 flex-shrink-0">
          <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-foreground">{heading}</h2>
          <p className="text-sm text-muted-foreground">{activeSubtitle}</p>
        </div>
      </div>

      {/* Hero Insight - Larger card */}
      {heroInsight && <InsightCard insight={heroInsight} isHero onAskNico={handleAskNico} />}

      {/* Secondary Insights Grid */}
      {secondaryInsights.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {secondaryInsights.map((insight) => (
            <InsightCard key={insight.key} insight={insight} onAskNico={handleAskNico} />
          ))}
        </div>
      )}
    </div>
  );
}

function InsightCard({
  insight,
  isHero = false,
  onAskNico,
}: {
  insight: Insight;
  isHero?: boolean;
  onAskNico: (insight: Insight) => void;
}) {
  const color = getInsightColor(insight);
  const styles = COLOR_STYLES[color];
  const Icon = getInsightIcon(color);

  return (
    <Card
      className={`group border-l-4 ${styles.border} ${styles.bg} hover:shadow-md transition-all duration-200 ${
        isHero ? 'md:col-span-2 lg:col-span-3' : ''
      }`}
    >
      <CardContent className={`${isHero ? 'py-6 px-6' : 'py-5 px-5'} space-y-3`}>
        {/* Badge + Trend */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg ${styles.iconBg}`}>
              <Icon className={`h-4 w-4 ${styles.iconColor}`} />
            </div>
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${styles.badge}`}>
              {BADGE_LABELS[color]}
            </span>
          </div>
          {insight.trend && (
            <div className={`flex items-center gap-1 text-xs font-medium ${
              insight.trend === 'up' ? 'text-success' : 'text-destructive'
            }`}>
              {insight.trend === 'up' ? (
                <TrendingUp className="h-3.5 w-3.5" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5" />
              )}
              {insight.changePercent != null && (
                <span>{insight.changePercent > 0 ? '+' : ''}{insight.changePercent}%</span>
              )}
            </div>
          )}
        </div>

        {/* Title */}
        <h3 className={`font-semibold text-foreground ${isHero ? 'text-base' : 'text-sm'}`}>
          {insight.title}
        </h3>

        {/* Body text */}
        <p className={`text-muted-foreground leading-relaxed ${isHero ? 'text-sm' : 'text-xs'}`}>
          {insight.text}
        </p>

        {/* Recommendation */}
        <p className={`text-foreground/80 italic leading-relaxed ${isHero ? 'text-sm' : 'text-xs'}`}>
          {insight.recommendation}
        </p>

        {/* Dual action buttons */}
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <Link to={insight.action.path}>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8 gap-1.5"
            >
              {insight.action.label}
              <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-8 gap-1.5 text-success hover:text-success hover:bg-success/10"
            onClick={() => onAskNico(insight)}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Preguntar a Nico
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
