import { useQuery } from '@tanstack/react-query';
import { useImportPayments, fetchTrmForDate } from '@/hooks/useImportPayments';
import { computeExchangeDiff } from '@/lib/exchangeDiff';
import type { ImportEstado } from '@/hooks/useImports';
import { TrendingUp, TrendingDown, Info, AlertTriangle } from 'lucide-react';

const fmtCop = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Math.round(n));
const fmtTrm = (n: number | null) =>
  n === null ? '—' : `$${n.toLocaleString('es-CO', { maximumFractionDigits: 2 })}`;

/**
 * Diferencia en cambio de una importación: cuánto te costó (o ganaste por) el
 * movimiento del dólar entre que causaste la deuda y la pagás/la debés hoy.
 *
 * Todo se deriva EN VIVO de los abonos (useImportPayments) + el monto total y
 * la TRM de causación del formulario, para no mezclar valores persistidos con
 * editados. En pedidos entregados/cancelados no se revalúa el saldo (la deuda
 * ya no fluctúa): solo queda la diferencia realizada de los abonos.
 */
export default function ExchangeDiffPanel({
  importId, trmCausacion, montoTotalUsd, anticipoPagadoUsd, estado,
}: {
  importId: string;
  trmCausacion: number | null;
  montoTotalUsd: number;
  anticipoPagadoUsd: number;
  estado: ImportEstado;
}) {
  const { payments } = useImportPayments(importId);

  const todayIso = new Date().toISOString().split('T')[0];
  const { data: trmHoy } = useQuery({
    queryKey: ['trm-today', todayIso],
    queryFn: () => fetchTrmForDate(todayIso),
    staleTime: 6 * 60 * 60 * 1000,
  });

  const pagadoAbonos = payments.reduce((s, p) => s + (Number(p.amount_usd) || 0), 0);
  // "Pagado" efectivo: abonos si existen, sino el anticipo manual del form.
  const pagado = pagadoAbonos > 0 ? pagadoAbonos : Math.max(0, anticipoPagadoUsd);
  const saldoUsd = Math.max(0, (Number(montoTotalUsd) || 0) - pagado);
  // En pedidos cerrados la deuda ya no fluctúa → no se revalúa el saldo.
  const cerrado = estado === 'entregado' || estado === 'cancelado';

  const diff = computeExchangeDiff({
    trmCausacion,
    payments: payments.map((p) => ({ amount_usd: p.amount_usd, trm: p.trm, fecha: p.fecha })),
    saldoUsd,
    trmHoy: cerrado ? null : (trmHoy ?? null),
  });

  // Aviso: hay anticipo manual cargado pero sin abonos con TRM → la parte
  // realizada de ese anticipo no se puede calcular (no sabemos a qué TRM se pagó).
  const anticipoSinTrm = pagadoAbonos === 0 && anticipoPagadoUsd > 0;

  if (diff.trmReferencia === null) {
    return (
      <div className="rounded-lg border border-dashed border-border p-3 text-[11px] text-muted-foreground flex items-start gap-1.5">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        Para ver la diferencia en cambio, poné la TRM de causación arriba o registrá un abono (de ahí sale la TRM de referencia).
      </div>
    );
  }

  const esPerdida = diff.total > 0;
  const Icon = esPerdida ? TrendingDown : TrendingUp;
  const color = Math.abs(diff.total) < 1 ? 'text-muted-foreground' : esPerdida ? 'text-destructive' : 'text-success';

  return (
    <div className="rounded-lg border border-border p-3 space-y-2 bg-muted/10">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">Diferencia en cambio</span>
        <span className="text-[10px] text-muted-foreground">
          ref. {fmtTrm(diff.trmReferencia)}{!cerrado && ` · hoy ${fmtTrm(trmHoy ?? null)}`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className={`text-lg font-bold tabular-nums ${color}`}>{fmtCop(Math.abs(diff.total))}</span>
        <span className={`text-[11px] font-medium ${color}`}>{Math.abs(diff.total) < 1 ? 'sin efecto' : esPerdida ? 'pérdida' : 'ganancia'}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-md bg-background border border-border/60 px-2 py-1.5">
          <p className="text-muted-foreground">Realizada (abonos)</p>
          <p className={`font-mono font-medium ${diff.realizada > 0 ? 'text-destructive' : diff.realizada < 0 ? 'text-success' : ''}`}>
            {diff.realizada >= 0 ? '' : '−'}{fmtCop(Math.abs(diff.realizada))}
          </p>
        </div>
        <div className="rounded-md bg-background border border-border/60 px-2 py-1.5">
          <p className="text-muted-foreground">{cerrado ? 'No realizada (cerrado)' : 'No realizada (saldo)'}</p>
          <p className={`font-mono font-medium ${diff.noRealizada > 0 ? 'text-destructive' : diff.noRealizada < 0 ? 'text-success' : ''}`}>
            {diff.noRealizada >= 0 ? '' : '−'}{fmtCop(Math.abs(diff.noRealizada))}
          </p>
        </div>
      </div>
      {anticipoSinTrm && (
        <p className="text-[10px] text-amber-600 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          Cargaste un anticipo de {fmtCop(anticipoPagadoUsd)} USD sin registrar el abono con su TRM. La diferencia realizada de ese anticipo no se incluye — registrá los abonos para el cálculo completo.
        </p>
      )}
      <p className="text-[10px] text-muted-foreground leading-snug">
        Estimación de análisis: este panel <strong>no</strong> la registra en el Estado de Resultados. Si querés que impacte la utilidad/renta, regístrala manualmente como gasto/ingreso financiero.
        {' '}{esPerdida ? 'El dólar subió desde la causación: la deuda en USD te cuesta más COP.' : 'El dólar bajó o se mantuvo: la deuda en USD te sale más barata.'}
      </p>
    </div>
  );
}
