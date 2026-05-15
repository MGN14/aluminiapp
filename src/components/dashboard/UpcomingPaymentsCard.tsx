import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { CalendarClock, ArrowRight, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useExpectedPayments } from '@/hooks/useExpectedPayments';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';

const MAX_ITEMS = 5;

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

function urgencyColor(days: number): string {
  if (days < 0) return 'text-destructive';
  if (days <= 1) return 'text-destructive';
  if (days <= 3) return 'text-orange-600 dark:text-orange-400';
  if (days <= 7) return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

// Dashboard card: muestra próximos cobros esperados (próx 7 días) + vencidos.
// Cada item tiene botón "Cobrado" para marcar manualmente. Click → factura.
export default function UpcomingPaymentsCard() {
  const { data, isLoading, markCumplido } = useExpectedPayments();

  // Mostrar vencidos primero, después próximos 7 días.
  const items = [
    ...(data?.vencidos ?? []),
    ...(data?.proximos_7d ?? []),
  ].slice(0, MAX_ITEMS);

  const total7d = data?.total_7d ?? 0;
  const totalVencido = data?.total_vencido ?? 0;
  const totalACobrar = total7d + totalVencido;

  if (isLoading) {
    return (
      <Card className="h-full">
        <CardContent className="p-4 flex items-center justify-center h-full">
          <p className="text-xs text-muted-foreground">Cargando...</p>
        </CardContent>
      </Card>
    );
  }

  // Sin cobros agendados.
  if (items.length === 0) {
    return (
      <Link to="/reportes/cuentas-por-cobrar" className="block group">
        <Card className="overflow-hidden border border-border hover:border-primary/20 transition-colors cursor-pointer h-full">
          <CardContent className="p-4 h-full flex flex-col justify-center">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center shrink-0">
                <CalendarClock className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground">Cobros próximos</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">Sin cobros agendados</p>
                <p className="text-[11px] text-muted-foreground leading-snug mt-1">
                  Acordá pagos con tus clientes desde "Lo que me deben".
                </p>
                <div className="flex items-center gap-1 text-[11px] text-primary/70 group-hover:text-primary font-medium transition-colors pt-2">
                  Ir a Lo que me deben <ArrowRight className="h-3 w-3" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }

  return (
    <Card className="overflow-hidden h-full">
      <CardContent className="p-4 h-full flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <CalendarClock className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">Cobros próximos (7 días + vencidos)</p>
            <p className="text-xl font-bold text-foreground mt-0.5 tabular-nums">{formatCurrency(totalACobrar)}</p>
            {totalVencido > 0 && (
              <p className="text-[11px] text-destructive font-medium mt-0.5 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {formatCurrency(totalVencido)} vencido
              </p>
            )}
          </div>
        </div>

        <ul className="space-y-1.5">
          {items.map(p => {
            const dueDate = parseLocalDate(p.due_date);
            const daysLabel = p.is_overdue
              ? `Hace ${Math.abs(p.days_until)}d`
              : p.days_until === 0
                ? 'Hoy'
                : p.days_until === 1
                  ? 'Mañana'
                  : `En ${p.days_until}d`;
            return (
              <li
                key={p.id}
                className="flex items-center gap-2 p-2 rounded-md bg-muted/30 text-xs"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{p.responsible_name ?? '(sin cliente)'}</span>
                    <span className={`text-[10px] font-medium ${urgencyColor(p.days_until)}`}>
                      • {daysLabel}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground text-[10px]">
                    <span>{format(dueDate, 'dd MMM', { locale: es })}</span>
                    {p.invoice_number && <span>Fact. {p.invoice_number}</span>}
                    {p.notes && <span className="italic truncate">{p.notes}</span>}
                  </div>
                </div>
                <span className="font-mono font-semibold tabular-nums whitespace-nowrap">
                  {formatCurrency(p.amount)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-success hover:bg-success/10 shrink-0"
                  title="Marcar como cobrado"
                  onClick={() => markCumplido.mutate(p.id)}
                  disabled={markCumplido.isPending}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>

        <Link
          to="/reportes/cuentas-por-cobrar"
          className="flex items-center justify-end gap-1 text-[11px] text-primary hover:underline mt-auto"
        >
          Ver todos en Lo que me deben <ArrowRight className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}
