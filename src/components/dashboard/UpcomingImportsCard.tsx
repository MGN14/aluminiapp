import { CardContent } from '@/components/ui/card';
import { Link } from 'react-router-dom';
import { Ship } from 'lucide-react';
import { useImports, IMPORT_ESTADO_LABEL } from '@/hooks/useImports';
import { parseLocalDate } from '@/lib/dateUtils';
import { DashCard, DashHeader, DashBig, DashItem, DashChip, DashFooter, DashEmpty, DashLoading, UrgencyPill, Pill, urgencyOf, fmtUsd, fmtFecha } from './cardKit';

const MAX_ITEMS = 5;
const VIOLET_TILE = 'bg-violet-500/15 text-violet-600 dark:text-violet-400';

// Card del Dashboard: importaciones abiertas. Saldo USD pendiente total +
// las 5 con ETA más cercana. Click → /importaciones.
export default function UpcomingImportsCard() {
  const { data, isLoading } = useImports();

  if (isLoading) return <DashLoading lines={2} />;

  const abiertos = data?.abiertos ?? [];

  if (abiertos.length === 0) {
    return (
      <Link to="/importaciones" className="block group h-full">
        <DashEmpty
          icon={Ship}
          title="Importaciones"
          headline="Sin pedidos abiertos"
          hint="Registrá un pedido a Shandong / JH / etc. para empezar a trackear."
          cta="Ir a Importaciones"
        />
      </Link>
    );
  }

  // Top N por ETA más cercana (los sin ETA al final).
  const today0 = Date.now();
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
  const tone = vencidos.length > 0 ? 'alarm' : 'default';

  return (
    <Link to="/importaciones" className="block group h-full">
      <DashCard tone={tone}>
        <CardContent className="p-4 sm:p-5 h-full flex flex-col">
          <DashHeader
            icon={Ship}
            tone={tone}
            tileClassName={tone === 'default' ? VIOLET_TILE : undefined}
            title="Importaciones abiertas"
            subtitle={
              <>
                {abiertos.length} pedido{abiertos.length !== 1 ? 's' : ''} · saldo por girar
                {vencidos.length > 0 && <span className="text-destructive font-semibold"> · {vencidos.length} con ETA vencida</span>}
              </>
            }
            right={vencidos.length > 0 ? <Pill className="bg-destructive text-destructive-foreground">ETA vencida</Pill> : undefined}
          >
            <DashBig>
              {fmtUsd(totalSaldo)} <span className="text-sm font-semibold text-muted-foreground">USD</span>
            </DashBig>
          </DashHeader>

          <div className="space-y-2">
            {items.map(r => {
              const eta = r.fecha_estimada_llegada;
              const daysUntil = eta ? Math.floor((parseLocalDate(eta).getTime() - today0) / 86400000) : null;
              const u = daysUntil == null ? 'later' : urgencyOf(daysUntil);
              return (
                <DashItem
                  key={r.id}
                  urgency={u}
                  leading={<DashChip className={VIOLET_TILE}>{r.ref_pedido?.trim() || <Ship className="h-4 w-4" strokeWidth={2.25} />}</DashChip>}
                  title={r.proveedor_nombre}
                  subtitle={<>{IMPORT_ESTADO_LABEL[r.estado]}{eta ? ` · llega ${fmtFecha(parseLocalDate(eta))}` : ' · sin ETA'}</>}
                  value={fmtUsd(r.saldo_pendiente_usd)}
                  pill={daysUntil != null ? <UrgencyPill days={daysUntil} overdueWord="Hace" /> : <Pill className="bg-muted text-muted-foreground">Sin ETA</Pill>}
                />
              );
            })}
          </div>

          <DashFooter>Ver todos en Importaciones</DashFooter>
        </CardContent>
      </DashCard>
    </Link>
  );
}
