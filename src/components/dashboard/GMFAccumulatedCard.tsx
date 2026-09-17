import { MetricCard } from './cardKit';
import { Landmark } from 'lucide-react';

interface GMFAccumulatedCardProps {
  total: number;
  year: number;
  transactionCount: number;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

// Helper to detect GMF/4x1000 transactions.
// Captura variantes con espacios variables: "4x1000", "4 x 1000", "4 x mil",
// "4 por mil", "4 por 1000", "cuatro por mil", "imp gobierno 4x1000",
// "gravamen movimientos financieros", "REV IMPTO GOBIERNO 4X1000", etc.
export function isGMFTransaction(description: string): boolean {
  if (!description) return false;
  const desc = description.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Regex que matchea "4 [espacios opcionales] x|por [espacios] (1000|mil)"
  if (/4\s*[x×*]\s*(1000|1\.000|mil)\b/.test(desc)) return true;
  if (/4\s*por\s*(1000|1\.000|mil)\b/.test(desc)) return true;
  if (/cuatro\s*(x|por)\s*(1000|mil)\b/.test(desc)) return true;

  return (
    desc.includes('gmf') ||
    desc.includes('gravamen movimiento') || // captura "movimiento" y "movimientos"
    desc.includes('impuesto gmf') ||
    desc.includes('imp gmf') ||
    desc.includes('impto gobierno') ||
    desc.includes('imp gobierno') ||
    desc.includes('imp. gobierno')
  );
}

export function GMFAccumulatedCard({ total, year, transactionCount }: GMFAccumulatedCardProps) {
  return (
    <MetricCard
      icon={Landmark}
      tileClassName="bg-slate-500/15 text-slate-600 dark:text-slate-300"
      title="4x1000 Acumulado"
      value={formatCurrency(total)}
      subtitle={`Año ${year} · ${transactionCount} movimiento${transactionCount !== 1 ? 's' : ''}`}
    />
  );
}
