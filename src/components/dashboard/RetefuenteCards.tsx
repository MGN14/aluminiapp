import { Percent } from 'lucide-react';
import { MetricCard, fmtCop } from './cardKit';

const ORANGE_TILE = 'bg-orange-500/15 text-orange-600 dark:text-orange-400';

interface RetefuenteMonthlyCardProps {
  total: number;
  periodLabel: string;
  transactionCount: number;
  title?: string;
}

export function RetefuenteMonthlyCard({ total, periodLabel, transactionCount, title = 'Retefuente por Pagar' }: RetefuenteMonthlyCardProps) {
  return (
    <MetricCard
      icon={Percent}
      tileClassName={ORANGE_TILE}
      title={title}
      value={fmtCop(total)}
      subtitle={
        <>
          {periodLabel}
          {transactionCount > 0 && ` · ${transactionCount} egreso${transactionCount !== 1 ? 's' : ''} con Retefuente`}
        </>
      }
    />
  );
}

interface RetefuenteYearlyCardProps {
  total: number;
  year: number;
  transactionCount: number;
}

export function RetefuenteYearlyCard({ total, year, transactionCount }: RetefuenteYearlyCardProps) {
  return (
    <MetricCard
      icon={Percent}
      tileClassName={ORANGE_TILE}
      title="Retefuente Acumulada"
      value={fmtCop(total)}
      subtitle={
        <>
          Año {year}
          {transactionCount > 0 && ` · ${transactionCount} egreso${transactionCount !== 1 ? 's' : ''} con Retefuente`}
        </>
      }
    />
  );
}
