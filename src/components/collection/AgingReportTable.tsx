// Tabla de aging report colombiano: por cliente, distribuye saldo en buckets
// (Corriente / 1-30 / 31-60 / 61-90 / >90) y muestra score IA si existe.

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertCircle, BarChart3, Sparkles, MessageSquarePlus, Brain, Loader2, RefreshCw } from 'lucide-react';
import { useCollectionData, type ClientScore, type ScoreCategory } from '@/hooks/useCollectionData';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import RegistrarTouchpointModal from './RegistrarTouchpointModal';
import TouchpointsTimeline from './TouchpointsTimeline';
import SuggestMessageModal from './SuggestMessageModal';

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

const CATEGORY_COLOR: Record<ScoreCategory, string> = {
  excelente: 'bg-success/10 text-success border-success/30',
  bueno:     'bg-success/5  text-success border-success/20',
  medio:     'bg-warning/10 text-warning border-warning/30',
  riesgo:    'bg-orange-500/10 text-orange-600 border-orange-500/30',
  critico:   'bg-destructive/10 text-destructive border-destructive/30',
};
const CATEGORY_LABEL: Record<ScoreCategory, string> = {
  excelente: 'Excelente',
  bueno: 'Bueno',
  medio: 'Medio',
  riesgo: 'Riesgo',
  critico: 'Crítico',
};

interface Props {
  year: number;
}

export default function AgingReportTable({ year }: Props) {
  const { data, isLoading, refetch } = useCollectionData(year);
  const { toast } = useToast();
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [touchpointTarget, setTouchpointTarget] = useState<{ name: string; responsible_id: string | null } | null>(null);
  const [suggestTarget, setSuggestTarget] = useState<{ name: string; responsible_id: string | null } | null>(null);
  const [rescoring, setRescoring] = useState(false);

  const handleRescore = async () => {
    setRescoring(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sesión expirada');
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/score-collection-clients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const result = await res.json();
      toast({
        title: 'Scoring recalculado',
        description: `${result.scored ?? 0} clientes analizados con Claude.`,
      });
      await refetch();
    } catch (err) {
      toast({ title: 'Error al recalcular', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setRescoring(false);
    }
  };

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Calculando aging y scores…
        </CardContent>
      </Card>
    );
  }

  const { aging, scoresByClient, touchpointsByClient, lastScoredAt } = data;

  if (aging.clients.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No hay clientes con deuda este año. 🎉
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                Aging Report — Envejecimiento de cartera
              </CardTitle>
              <CardDescription className="text-xs mt-1 flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-primary" />
                Score IA: probabilidad de pago calculada con Claude por cliente.
                {lastScoredAt && (
                  <span className="ml-1 text-muted-foreground">
                    · Actualizado: {new Date(lastScoredAt).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRescore}
              disabled={rescoring}
              className="gap-1.5"
            >
              {rescoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {rescoring ? 'Calculando…' : 'Recalcular scores IA'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Distribución porcentual */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            <div className="p-2 rounded border border-success/30 bg-success/5">
              <p className="text-muted-foreground">Corriente</p>
              <p className="font-bold font-mono">{fmtPct(aging.pct.corriente)}</p>
              <p className="text-[10px] text-muted-foreground">{fmtMoney(aging.totals.corriente)}</p>
            </div>
            <div className="p-2 rounded border border-warning/30 bg-warning/5">
              <p className="text-muted-foreground">1-30 días</p>
              <p className="font-bold font-mono">{fmtPct(aging.pct.d1_30)}</p>
              <p className="text-[10px] text-muted-foreground">{fmtMoney(aging.totals.d1_30)}</p>
            </div>
            <div className="p-2 rounded border border-orange-500/30 bg-orange-500/5">
              <p className="text-muted-foreground">31-60 días</p>
              <p className="font-bold font-mono">{fmtPct(aging.pct.d31_60)}</p>
              <p className="text-[10px] text-muted-foreground">{fmtMoney(aging.totals.d31_60)}</p>
            </div>
            <div className="p-2 rounded border border-orange-600/40 bg-orange-600/5">
              <p className="text-muted-foreground">61-90 días</p>
              <p className="font-bold font-mono">{fmtPct(aging.pct.d61_90)}</p>
              <p className="text-[10px] text-muted-foreground">{fmtMoney(aging.totals.d61_90)}</p>
            </div>
            <div className="p-2 rounded border border-destructive/40 bg-destructive/5">
              <p className="text-muted-foreground flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> +90 días
              </p>
              <p className="font-bold font-mono">{fmtPct(aging.pct.d90_plus)}</p>
              <p className="text-[10px] text-muted-foreground">{fmtMoney(aging.totals.d90_plus)}</p>
            </div>
          </div>

          {/* Tabla */}
          <div className="overflow-x-auto">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[260px]">Cliente</TableHead>
                  <TableHead className="text-center w-[110px]">Score IA</TableHead>
                  <TableHead className="text-right">Corriente</TableHead>
                  <TableHead className="text-right">1-30</TableHead>
                  <TableHead className="text-right">31-60</TableHead>
                  <TableHead className="text-right">61-90</TableHead>
                  <TableHead className="text-right">+90</TableHead>
                  <TableHead className="text-right font-semibold">Total</TableHead>
                  <TableHead className="w-[140px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aging.clients.map((c) => {
                  const scoreKey = c.responsible_id ?? `__name:${c.client_name.toLowerCase().trim()}`;
                  const score = scoresByClient.get(scoreKey);
                  const touchpoints = touchpointsByClient.get(scoreKey) ?? [];
                  const isExpanded = expandedClient === scoreKey;
                  return (
                    <>
                      <TableRow
                        key={`${c.client_id}-row`}
                        className={c.oldest_overdue_days > 60 ? 'bg-destructive/5' : ''}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setExpandedClient(isExpanded ? null : scoreKey)}
                              className="hover:underline text-left truncate max-w-[220px]"
                              title={c.client_name}
                            >
                              {c.client_name}
                            </button>
                            {c.oldest_overdue_days > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                · {c.oldest_overdue_days}d
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          {score ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className={CATEGORY_COLOR[score.category]}>
                                  {score.score} · {CATEGORY_LABEL[score.category]}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs">
                                {score.reasoning && <p>{score.reasoning}</p>}
                                {score.recommended_action && (
                                  <p className="mt-1 font-semibold">→ {score.recommended_action}</p>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">—</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {c.buckets.corriente > 0 ? fmtMoney(c.buckets.corriente) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {c.buckets.d1_30 > 0 ? <span className="text-warning">{fmtMoney(c.buckets.d1_30)}</span> : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {c.buckets.d31_60 > 0 ? <span className="text-orange-600">{fmtMoney(c.buckets.d31_60)}</span> : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {c.buckets.d61_90 > 0 ? <span className="text-orange-700 font-semibold">{fmtMoney(c.buckets.d61_90)}</span> : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {c.buckets.d90_plus > 0 ? <span className="text-destructive font-semibold">{fmtMoney(c.buckets.d90_plus)}</span> : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">{fmtMoney(c.buckets.total)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 justify-end">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0"
                                  onClick={() => setSuggestTarget({ name: c.client_name, responsible_id: c.responsible_id })}
                                  title="Sugerir mensaje con IA"
                                >
                                  <Brain className="h-3.5 w-3.5 text-primary" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Sugerir mensaje con IA</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0"
                                  onClick={() => setTouchpointTarget({ name: c.client_name, responsible_id: c.responsible_id })}
                                  title="Registrar contacto"
                                >
                                  <MessageSquarePlus className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Registrar contacto</TooltipContent>
                            </Tooltip>
                            {touchpoints.length > 0 && (
                              <Badge variant="outline" className="text-[10px] h-7 px-1.5">
                                {touchpoints.length}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${c.client_id}-expanded`}>
                          <TableCell colSpan={9} className="bg-muted/30">
                            <TouchpointsTimeline
                              touchpoints={touchpoints}
                              onRefresh={refetch}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
                {/* Fila TOTAL */}
                <TableRow className="font-bold bg-muted/50 border-t-2">
                  <TableCell colSpan={2}>TOTAL</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(aging.totals.corriente)}</TableCell>
                  <TableCell className="text-right font-mono text-warning">{fmtMoney(aging.totals.d1_30)}</TableCell>
                  <TableCell className="text-right font-mono text-orange-600">{fmtMoney(aging.totals.d31_60)}</TableCell>
                  <TableCell className="text-right font-mono text-orange-700">{fmtMoney(aging.totals.d61_90)}</TableCell>
                  <TableCell className="text-right font-mono text-destructive">{fmtMoney(aging.totals.d90_plus)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtMoney(aging.totals.total)}</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <RegistrarTouchpointModal
        open={!!touchpointTarget}
        onOpenChange={(o) => !o && setTouchpointTarget(null)}
        client={touchpointTarget}
        onSaved={refetch}
      />

      <SuggestMessageModal
        open={!!suggestTarget}
        onOpenChange={(o) => !o && setSuggestTarget(null)}
        client={suggestTarget}
      />
    </TooltipProvider>
  );
}
