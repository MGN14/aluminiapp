/**
 * Aviso de extractos faltantes DENTRO de Conciliación (auditoría 2026-11-11).
 *
 * El detector de huecos solo vivía en la pantalla de subir extractos: al
 * conciliar nadie veía que la tarjeta se había quedado en junio mientras el
 * banco seguía mostrando su pago automático cada mes — esas compras nunca
 * entraron a la app. Acá se muestran las dos cosas:
 *   · cuentas ATRASADAS (su último extracto quedó muy atrás de la cuenta más
 *     al día), con cuántos traspasos sin contraparte hay desde entonces —
 *     la evidencia de que la cuenta sí se sigue moviendo;
 *   · HUECOS de días entre extractos de la misma cuenta.
 *
 * "No avisar de esta cuenta" es por navegador (localStorage): sirve para una
 * cuenta que ya no se usa. No toca ningún dato.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { FileWarning, X } from 'lucide-react';
import { findCoverageGaps, findSeriesAtrasadas, type StatementPeriodLike } from '@/lib/statementGaps';
import { parseLocalDate } from '@/lib/dateUtils';

const NO_AVISAR_KEY = 'aluminia_extractos_no_avisar_v1';

function leerNoAvisar(): string[] {
  try {
    const raw = localStorage.getItem(NO_AVISAR_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const fmtDia = (iso: string) => format(parseLocalDate(iso), "d 'de' MMM", { locale: es });

interface Props {
  statements: StatementPeriodLike[];
  /** Traspasos sin pierna espejo (ya calculados por la página). */
  traspasosSinEspejo: { date?: string }[];
}

export default function ExtractosFaltantesBanner({ statements, traspasosSinEspejo }: Props) {
  const [noAvisar, setNoAvisar] = useState<string[]>(() => leerNoAvisar());

  const atrasadas = useMemo(
    () => findSeriesAtrasadas(statements).filter((s) => !noAvisar.includes(s.bank)),
    [statements, noAvisar],
  );
  const huecos = useMemo(
    () => findCoverageGaps(statements).filter((g) => !noAvisar.includes(g.bank)),
    [statements, noAvisar],
  );

  if (!atrasadas.length && !huecos.length) return null;

  const silenciar = (bank: string) => {
    setNoAvisar((prev) => {
      const next = prev.includes(bank) ? prev : [...prev, bank];
      try { localStorage.setItem(NO_AVISAR_KEY, JSON.stringify(next)); } catch { /* modo privado */ }
      return next;
    });
  };

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.07] px-4 py-3 text-xs space-y-1.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
          <FileWarning className="h-4 w-4 shrink-0" />
          Faltan extractos por subir
        </p>
        <Link to="/statement-upload" className="text-xs font-medium text-primary hover:underline">
          Subir extractos
        </Link>
      </div>

      {atrasadas.map((s) => {
        const sinEspejo = traspasosSinEspejo.filter((t) => (t.date ?? '') > s.hasta).length;
        return (
          <div key={`a-${s.bank}`} className="flex items-start justify-between gap-3">
            <p className="text-foreground">
              <strong>{s.bank}</strong>: cargado hasta el {fmtDia(s.hasta)}, {s.diasAtras} días atrás de tu cuenta más al día.
              {sinEspejo > 0 && (
                <span className="text-muted-foreground">
                  {' '}Desde entonces hay {sinEspejo} traspaso{sinEspejo === 1 ? '' : 's'} sin contraparte: esos movimientos todavía no están en la app.
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={() => silenciar(s.bank)}
              className="shrink-0 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              title="Usalo si esta cuenta ya no se mueve. Solo deja de avisar en este navegador; no cambia ningún dato."
            >
              <X className="h-3 w-3" /> No avisar de esta cuenta
            </button>
          </div>
        );
      })}

      {huecos.map((g) => (
        <p key={`h-${g.bank}-${g.from}`} className="text-foreground">
          <strong>{g.bank}</strong>: {g.days === 1 ? 'falta el' : `faltan ${g.days} días, del`} {fmtDia(g.from)}
          {g.days === 1 ? '' : ` al ${fmtDia(g.to)}`}, entre dos extractos.
        </p>
      ))}
    </div>
  );
}
