import { Clock, RefreshCw, ClipboardCheck, AlertTriangle } from 'lucide-react';

interface Props {
  lastSiigoSyncAt: string | null;
  lastPhysicalCountAt: string | null;
}

function formatRelative(iso: string | null): { label: string; days: number } | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const now = Date.now();
  const days = Math.floor((now - then) / 86_400_000);
  const date = new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  if (days === 0) return { label: `hoy (${date})`, days };
  if (days === 1) return { label: `ayer (${date})`, days };
  if (days < 30) return { label: `hace ${days} días (${date})`, days };
  if (days < 60) return { label: `hace ~1 mes (${date})`, days };
  const months = Math.floor(days / 30);
  return { label: `hace ${months} meses (${date})`, days };
}

export default function InventoryFreshnessBanner({
  lastSiigoSyncAt,
  lastPhysicalCountAt,
}: Props) {
  const siigo = formatRelative(lastSiigoSyncAt);
  const physical = formatRelative(lastPhysicalCountAt);

  // Si la sync de Siigo es más fresca que el conteo físico por > 7 días,
  // mostrar alerta: el descuadre actual probablemente es por movimientos
  // entrados a Siigo sin reflejar en conteo físico.
  const staleByDays =
    siigo && physical ? physical.days - siigo.days : null;
  const showStaleWarning = staleByDays !== null && staleByDays > 7;
  const noPhysicalEver = physical === null && siigo !== null;

  return (
    <div className="rounded-lg border border-border bg-card p-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 text-xs">
      <div className="flex items-center gap-2">
        <RefreshCw className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
        <div>
          <span className="text-muted-foreground">Siigo (sistema):</span>{' '}
          <span className="font-medium tabular-nums">
            {siigo ? siigo.label : 'sin sincronizar'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
        <div>
          <span className="text-muted-foreground">Conteo físico:</span>{' '}
          <span className="font-medium tabular-nums">
            {physical ? physical.label : 'nunca realizado'}
          </span>
        </div>
      </div>

      {(showStaleWarning || noPhysicalEver) && (
        <div className="flex items-start gap-1.5 ml-auto rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 px-2.5 py-1.5 text-[11px]">
          <AlertTriangle className="h-3 w-3 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
          <span className="text-amber-900 dark:text-amber-100">
            {noPhysicalEver
              ? 'No se ha hecho conteo físico nunca. La diferencia mostrada no es confiable hasta el primer conteo.'
              : `El conteo físico está ${staleByDays} días atrasado vs. Siigo. Si llegó o salió mercancía después del último conteo, la diferencia es esperada.`}
          </span>
        </div>
      )}

      {!showStaleWarning && !noPhysicalEver && siigo && physical && (
        <div className="ml-auto text-[11px] text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Datos sincronizados
        </div>
      )}
    </div>
  );
}
