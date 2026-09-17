import { useState } from 'react';
import { CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { HandCoins, CheckCircle2, Pencil, Trash2 } from 'lucide-react';
import { useExpectedPayments, type ExpectedPayment } from '@/hooks/useExpectedPayments';
import { parseLocalDate } from '@/lib/dateUtils';
import AcordarPagoModal from '@/components/expected-payments/AcordarPagoModal';
import { DashCard, DashHeader, DashBig, DashItem, DashFooter, DashEmpty, DashLoading, UrgencyPill, Pill, urgencyOf, fmtCop, fmtFecha } from './cardKit';

const MAX_ITEMS = 5;

/** Iniciales del cliente para el cuadro de la fila. */
function initials(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

// Dashboard card: próximos cobros esperados (próx 7 días) + vencidos.
// Cada item tiene: ✓ cobrado, ✎ editar, 🗑 borrar.
export default function UpcomingPaymentsCard() {
  const { data, isLoading, markCumplido, remove } = useExpectedPayments();
  const [editing, setEditing] = useState<ExpectedPayment | null>(null);

  const handleRemove = (p: ExpectedPayment) => {
    const ok = window.confirm(
      `¿Borrar el cobro acordado de ${p.responsible_name ?? 'cliente'} por $${p.amount.toLocaleString('es-CO')}?`,
    );
    if (!ok) return;
    remove.mutate(p.id);
  };

  // Vencidos primero, después próximos 7 días.
  const items = [
    ...(data?.vencidos ?? []),
    ...(data?.proximos_7d ?? []),
  ].slice(0, MAX_ITEMS);

  const total7d = data?.total_7d ?? 0;
  const totalVencido = data?.total_vencido ?? 0;
  const totalACobrar = total7d + totalVencido;

  if (isLoading) return <DashLoading lines={2} />;

  if (items.length === 0) {
    return (
      <Link to="/reportes/cuentas-por-cobrar" className="block group h-full">
        <DashEmpty
          icon={HandCoins}
          title="Cobros próximos"
          headline="Sin cobros agendados"
          hint='Acordá pagos con tus clientes desde "Lo que me deben".'
          cta="Ir a Lo que me deben"
        />
      </Link>
    );
  }

  return (
    <DashCard tone={totalVencido > 0 ? 'alarm' : 'success'} className="group cursor-default">
      <CardContent className="p-4 sm:p-5 h-full flex flex-col">
        <DashHeader
          icon={HandCoins}
          tone={totalVencido > 0 ? 'alarm' : 'success'}
          title="Cobros próximos"
          subtitle={
            <>
              7 días + vencidos
              {totalVencido > 0 && <span className="text-destructive font-semibold"> · {fmtCop(totalVencido)} vencido</span>}
            </>
          }
          right={totalVencido > 0 ? <Pill className="bg-destructive text-destructive-foreground">Vencidos</Pill> : undefined}
        >
          <DashBig>{fmtCop(totalACobrar)}</DashBig>
        </DashHeader>

        <div className="space-y-2">
          {items.map(p => {
            const dueDate = parseLocalDate(p.due_date);
            const u = urgencyOf(p.days_until);
            return (
              <DashItem
                key={p.id}
                urgency={u}
                titleAttr={p.notes ?? undefined}
                leading={
                  <span className="h-7 w-7 rounded-lg bg-success/15 text-success flex items-center justify-center shrink-0 text-[11px] font-bold">
                    {initials(p.responsible_name)}
                  </span>
                }
                title={p.responsible_name ?? '(sin cliente)'}
                subtitle={<>{fmtFecha(dueDate)}{p.invoice_number && ` · Fact. ${p.invoice_number}`}{p.notes && ` · ${p.notes}`}</>}
                value={fmtCop(p.amount)}
                pill={<UrgencyPill days={p.days_until} overdueWord="Hace" />}
                actions={
                  <span className="flex items-center gap-0.5 shrink-0">
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-success hover:bg-success/15 rounded-md" title="Marcar como cobrado" onClick={() => markCumplido.mutate(p.id)} disabled={markCumplido.isPending}>
                      <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md" title="Editar fecha / monto / nota" onClick={() => setEditing(p)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md" title="Borrar cobro acordado" onClick={() => handleRemove(p)} disabled={remove.isPending}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </span>
                }
              />
            );
          })}
        </div>

        <Link to="/reportes/cuentas-por-cobrar" className="block group mt-auto">
          <DashFooter note={`${items.length} acordado${items.length !== 1 ? 's' : ''}`}>Ver todos en Lo que me deben</DashFooter>
        </Link>

        <AcordarPagoModal
          open={!!editing}
          onOpenChange={(v) => { if (!v) setEditing(null); }}
          editing={editing}
        />
      </CardContent>
    </DashCard>
  );
}
