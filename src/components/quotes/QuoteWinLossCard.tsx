// Ganadas vs perdidas — la lección de precio que las cotizaciones ya guardaban.
// Colapsada por defecto: es análisis, no operación diaria.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ChevronDown, Trophy, Lightbulb } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { computeWinLoss, MIN_N, type WinLossQuote, type WinLossBucket } from '@/lib/quoteWinLoss';

const fmtCOP = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0, notation: 'compact' }).format(v);

function useQuoteWinLoss() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['quote-win-loss', user?.id],
    enabled: !!user?.id,
    staleTime: 120_000,
    queryFn: async () => {
      const [qRes, iRes] = await Promise.all([
        (supabase as any)
          .from('quotations')
          .select('id, status, total, profit_pct, responsible_id, sent_at, accepted_at, rejected_at, responsible:responsible_id(name)')
          .in('status', ['accepted', 'rejected']),
        (supabase as any).from('quotation_items').select('quotation_id, system'),
      ]);
      if (qRes.error) throw qRes.error;
      const systemsByQuote = new Map<string, string[]>();
      for (const it of (iRes.data ?? []) as Array<{ quotation_id: string; system: string | null }>) {
        if (!it.system) continue;
        const arr = systemsByQuote.get(it.quotation_id) ?? [];
        arr.push(it.system);
        systemsByQuote.set(it.quotation_id, arr);
      }
      const quotes: WinLossQuote[] = ((qRes.data ?? []) as any[]).map((r) => ({
        id: r.id,
        status: r.status,
        total: Number(r.total) || 0,
        profit_pct: Number(r.profit_pct) || 0,
        responsible_id: r.responsible_id ?? null,
        responsible_name: r.responsible?.name ?? null,
        sent_at: r.sent_at,
        accepted_at: r.accepted_at,
        rejected_at: r.rejected_at,
        systems: systemsByQuote.get(r.id) ?? [],
      }));
      return computeWinLoss(quotes);
    },
  });
}

function BucketRows({ title, buckets }: { title: string; buckets: WinLossBucket[] }) {
  if (buckets.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{title}</p>
      <div className="space-y-1">
        {buckets.map((b) => (
          <div key={b.key} className="flex items-center gap-2 text-xs">
            <span className="w-40 truncate shrink-0">{b.label}</span>
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden min-w-[60px]">
              <div
                className={cn('h-full', b.winRate >= 60 ? 'bg-success' : b.winRate >= 40 ? 'bg-warning' : 'bg-destructive')}
                style={{ width: `${b.winRate}%` }}
              />
            </div>
            <span className="w-24 text-right tabular-nums text-muted-foreground shrink-0">
              {b.winRate}% ({b.won}/{b.total})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function QuoteWinLossCard() {
  const [open, setOpen] = useState(false);
  const { data: r } = useQuoteWinLoss();

  // Sin datos suficientes ni para el titular: no ocupar espacio.
  if (!r || r.decided < MIN_N) return null;

  return (
    <Card>
      <CardContent className="py-3 px-4">
        <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 text-left">
          <Trophy className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium flex-1">
            Ganadas vs perdidas
            <span className="text-muted-foreground font-normal">
              {' '}— ganás el <span className={cn('font-semibold', r.winRate >= 50 ? 'text-success' : 'text-warning')}>{r.winRate}%</span> ({r.won}/{r.decided}) · {fmtCOP(r.wonValue)} ganados · {fmtCOP(r.lostValue)} perdidos
            </span>
          </span>
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform shrink-0', open && 'rotate-180')} />
        </button>

        {r.insight && (
          <p className="mt-2 text-xs flex items-start gap-1.5 rounded-md bg-primary/5 border border-primary/20 px-2.5 py-1.5">
            <Lightbulb className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
            {r.insight}
          </p>
        )}

        {open && (
          <div className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-4">
            <BucketRows title="Por margen" buckets={r.byMargin} />
            <BucketRows title="Por tamaño de cotización" buckets={r.byTicket} />
            <BucketRows title="Por cliente (top)" buckets={r.byClient} />
            <BucketRows title="Por sistema" buckets={r.bySystem} />
            {r.avgResponseDays !== null && (
              <p className="text-[11px] text-muted-foreground sm:col-span-2">
                Entre enviar y tener respuesta pasan en promedio <Badge variant="outline" className="text-[10px] mx-0.5">{r.avgResponseDays} días</Badge>
                — las cotizaciones sin decidir más viejas que eso valen un seguimiento.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
