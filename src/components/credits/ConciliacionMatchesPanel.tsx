import { useQuery } from '@tanstack/react-query';
import { Link2, Wallet } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { CreditWithSummary } from '@/hooks/useCredits';

function fmt(n: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n);
}

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

interface Props {
  credit: CreditWithSummary;
}

interface BankTx {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  type: string | null;
  category_id: string | null;
}

/**
 * Busca transacciones bancarias candidatas a ser pagos del crédito.
 * Heurística: egresos en una ventana de ±14 días alrededor de la próxima
 * cuota o de cuotas pendientes próximas, con monto dentro del ±15%.
 *
 * También intenta match por descripción (nombre del crédito o banco).
 */
export default function ConciliacionMatchesPanel({ credit }: Props) {
  const { user } = useAuth();

  // Próximas 3 cuotas pendientes (las que más probablemente tengan match)
  const upcomingCuotas = credit.summary.scheduleWithStatus
    .filter((r) => r.estado === 'pendiente')
    .slice(0, 3);

  const { data: candidates, isLoading } = useQuery({
    queryKey: ['credit-conciliacion-matches', user?.id, credit.credit.id, upcomingCuotas.map((c) => c.fecha).join(',')],
    enabled: !!user?.id && upcomingCuotas.length > 0,
    queryFn: async () => {
      if (upcomingCuotas.length === 0) return [];

      // Ventana global: 14 días antes de la primera cuota → 14 días después de la última
      const dates = upcomingCuotas.map((c) => c.fecha);
      const minDate = new Date(dates[0] + 'T12:00:00');
      minDate.setDate(minDate.getDate() - 14);
      const maxDate = new Date(dates[dates.length - 1] + 'T12:00:00');
      maxDate.setDate(maxDate.getDate() + 14);

      const fromIso = minDate.toISOString().slice(0, 10);
      const toIso = maxDate.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from('transactions')
        .select('id, date, amount, description, type, category_id')
        .eq('user_id', user!.id)
        .is('deleted_at', null)
        .eq('type', 'egreso')
        .gte('date', fromIso)
        .lte('date', toIso);

      if (error) throw error;

      const txs = (data ?? []) as BankTx[];
      const out: Array<{ tx: BankTx; cuotaNumero: number; cuotaFecha: string; matchScore: number; matchReason: string[] }> = [];

      const creditNameLower = credit.credit.name.toLowerCase();
      const bankNameLower = (credit.credit.bank_name || '').toLowerCase();

      for (const tx of txs) {
        const txAmount = Math.abs(Number(tx.amount) || 0);
        const desc = (tx.description || '').toLowerCase();

        for (const cuota of upcomingCuotas) {
          const expected = cuota.cuotaTotal;
          if (expected <= 0) continue;
          const diff = Math.abs(txAmount - expected) / expected;
          // ±15% de margen
          if (diff > 0.15) continue;

          // Distancia en días
          const txDate = new Date(tx.date + 'T12:00:00');
          const cuotaDate = new Date(cuota.fecha + 'T12:00:00');
          const daysDiff = Math.abs((txDate.getTime() - cuotaDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysDiff > 14) continue;

          const reasons: string[] = [];
          let score = 100 - daysDiff * 2 - diff * 100;
          reasons.push(`Monto similar (±${(diff * 100).toFixed(0)}%)`);
          reasons.push(`A ${Math.round(daysDiff)}d de la cuota`);

          if (creditNameLower && desc.includes(creditNameLower)) {
            score += 30;
            reasons.push('Nombre crédito en descripción');
          }
          if (bankNameLower && bankNameLower.length > 3 && desc.includes(bankNameLower)) {
            score += 20;
            reasons.push('Banco en descripción');
          }

          out.push({ tx, cuotaNumero: cuota.cuotaNumero, cuotaFecha: cuota.fecha, matchScore: score, matchReason: reasons });
        }
      }

      // Ordenar por score descendente, deduplicar por tx.id (mejor match por tx)
      const bestByTx = new Map<string, typeof out[number]>();
      for (const m of out) {
        const prev = bestByTx.get(m.tx.id);
        if (!prev || m.matchScore > prev.matchScore) bestByTx.set(m.tx.id, m);
      }
      return Array.from(bestByTx.values()).sort((a, b) => b.matchScore - a.matchScore).slice(0, 5);
    },
  });

  if (upcomingCuotas.length === 0) return null;
  if (isLoading) {
    return (
      <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
        Buscando posibles pagos en tu extracto...
      </div>
    );
  }
  if (!candidates || candidates.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-muted-foreground/30 p-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Wallet className="h-3.5 w-3.5" />
          <span>Sin coincidencias en tu extracto bancario para las próximas cuotas. Cuando importes el extracto del mes, las verás acá.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-cyan-200 bg-cyan-50/40 dark:bg-cyan-950/10 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-cyan-900 dark:text-cyan-200">
        <Link2 className="h-3.5 w-3.5" />
        Posibles pagos en extracto bancario
      </div>
      <div className="space-y-1.5">
        {candidates.map((m) => (
          <div key={m.tx.id} className="flex items-start justify-between gap-3 text-xs p-2 rounded border border-cyan-100 bg-white dark:bg-black/20">
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{m.tx.description || '(sin descripción)'}</p>
              <p className="text-[10px] text-muted-foreground">
                {formatDate(m.tx.date)} · {m.matchReason.join(' · ')}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="tabular-nums font-semibold">{fmt(Math.abs(Number(m.tx.amount)))}</p>
              <p className="text-[10px] text-cyan-700 dark:text-cyan-300">→ Cuota {m.cuotaNumero}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground italic">
        Sugerencias automáticas. Para registrar el pago, usá "Pagar esta cuota" en la tabla de arriba.
      </p>
    </div>
  );
}
