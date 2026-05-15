import { Card, CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import { Ship, ArrowRight, AlertTriangle } from 'lucide-react';
import { useImports, IMPORT_ESTADO_LABEL } from '@/hooks/useImports';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';

const MAX_ITEMS = 5;

const fmtUSD = (n: number) =>
  `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

function urgencyColor(daysUntil: number): string {
  if (daysUntil < 0) return 'text-destructive';
  if (daysUntil <= 7) return 'text-orange-600 dark:text-orange-400';
  if (daysUntil <= 15) return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

// Card del Dashboard: importaciones abiertas. Muestra saldo USD pendiente
// total + las 5 con ETA más cercana. Click → /importaciones.
export default function UpcomingImportsCard() {
  const { data, isLoading } = useImports();

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardContent className="p-4 flex items-center justify-center h-full">
          <p className="text-xs text-muted-foreground">Cargando...</p>
        </CardContent>
      </Card>
    );
  }

  const abiertos = data?.abiertos ?? [];

  if (abiertos.length === 0) {
    return (
      <Link to="/importaciones" className="block group">
        <Card className="overflow-hidden border border-border hover:border-primary/20 transition-colors cursor-pointer h-full">
          <CardContent className="p-4 h-full flex flex-col justify-center">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center shrink-0">
                <Ship className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground">Importaciones</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">Sin pedidos abiertos</p>
                <p className="text-[11px] text-muted-foreground leading-snug mt-1">
                  Registrá un pedido a Shandong / JH / etc. para empezar a trackear.
                </p>
                <div className="flex items-center gap-1 text-[11px] text-primary/70 group-hover:text-primary font-medium transition-colors pt-2">
                  Ir a Importaciones <ArrowRight className="h-3 w-3" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }

  // Top N por ETA más cercana (los sin ETA al final).
  const today = new Date();
  const today0 = today.getTime();
  const sortedByEta = [...abiertos].sort((a, b) => {
    const aHas = !!a.fecha_estimada_llegada;
    const bHas = !!b.fecha_estimada_llegada;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    if (!aHas && !bHas) return 0;
    return a.fecha_estimada_llegada!.localeCompare(b.fecha_estimada_llegada!);
  });
  const items = sortedByEta.slice(0, MAX_ITEMS);

  const totalSaldo = data?.total_saldo_pendiente_usd ?? 0;
  const vencidos = abiertos.filter(r =>
    r.fecha_estimada_llegada && parseLocalDate(r.fecha_estimada_llegada).getTime() < today0,
  );

  return (
    <Link to="/importaciones" className="block group">
      <Card className="overflow-hidden h-full hover:border-primary/30 transition-colors">
        <CardContent className="p-4 h-full flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Ship className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">Importaciones abiertas</p>
              <p className="text-xl font-bold text-foreground mt-0.5 tabular-nums">{fmtUSD(totalSaldo)} saldo</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {abiertos.length} pedido{abiertos.length !== 1 ? 's' : ''}
                {vencidos.length > 0 && (
                  <span className="text-destructive font-medium ml-1.5">
                    <AlertTriangle className="h-3 w-3 inline mr-0.5" />
                    {vencidos.length} con ETA vencida
                  </span>
                )}
              </p>
            </div>
          </div>

          <ul className="space-y-1.5">
            {items.map(r => {
              const eta = r.fecha_estimada_llegada;
              const daysUntil = eta
                ? Math.floor((parseLocalDate(eta).getTime() - today0) / 86400000)
                : null;
              return (
                <li
                  key={r.id}
                  className="flex items-center gap-2 p-2 rounded-md bg-muted/30 text-xs"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{r.proveedor_nombre}</span>
                      <span className="text-[9px] px-1.5 py-0 rounded border bg-background text-muted-foreground">
                        {IMPORT_ESTADO_LABEL[r.estado]}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground text-[10px]">
                      {eta ? (
                        <>
                          <span>{format(parseLocalDate(eta), 'dd MMM', { locale: es })}</span>
                          {daysUntil !== null && (
                            <span className={cn('font-medium', urgencyColor(daysUntil))}>
                              {daysUntil < 0 ? `Hace ${Math.abs(daysUntil)}d` : daysUntil === 0 ? 'Hoy' : `En ${daysUntil}d`}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="italic">Sin ETA</span>
                      )}
                    </div>
                  </div>
                  <span className="font-mono font-semibold tabular-nums whitespace-nowrap text-destructive">
                    {fmtUSD(r.saldo_pendiente_usd)}
                  </span>
                </li>
              );
            })}
          </ul>

          <span className="flex items-center justify-end gap-1 text-[11px] text-primary group-hover:underline mt-auto">
            Ver todos en Importaciones <ArrowRight className="h-3 w-3" />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}
