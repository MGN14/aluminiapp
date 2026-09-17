import { Building2 } from 'lucide-react';
import { MetricCard, fmtCop } from './cardKit';

const PINK_TILE = 'bg-pink-500/15 text-pink-600 dark:text-pink-400';

interface ReteicaMonthlyCardProps {
  total: number;
  periodLabel: string;
  transactionCount: number;
  city?: string;
  rate?: number;
}

export function ReteicaMonthlyCard({ total, periodLabel, transactionCount, city, rate }: ReteicaMonthlyCardProps) {
  const extra = [
    city,
    rate !== undefined && rate > 0 ? `${(rate * 100).toFixed(3)}%` : null,
    transactionCount > 0 ? `${transactionCount} venta${transactionCount !== 1 ? 's' : ''} con ReteICA` : null,
  ].filter(Boolean).join(' · ');
  return (
    <MetricCard
      icon={Building2}
      tileClassName={PINK_TILE}
      title="ReteICA por Pagar"
      value={fmtCop(total)}
      subtitle={<>{periodLabel}{extra && ` · ${extra}`}</>}
    />
  );
}

interface ReteicaYearlyCardProps {
  total: number;
  year: number;
  transactionCount: number;
}

export function ReteicaYearlyCard({ total, year, transactionCount }: ReteicaYearlyCardProps) {
  return (
    <MetricCard
      icon={Building2}
      tileClassName={PINK_TILE}
      title="ReteICA Acumulado"
      value={fmtCop(total)}
      subtitle={
        <>
          Año {year}
          {transactionCount > 0 && ` · ${transactionCount} venta${transactionCount !== 1 ? 's' : ''} con ReteICA`}
        </>
      }
    />
  );
}
