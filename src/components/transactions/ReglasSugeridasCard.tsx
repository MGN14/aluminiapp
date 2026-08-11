/**
 * REGLAS SUGERIDAS — cierra el ciclo de la conciliación (Nico, 2026-08-06).
 *
 * La app mira el historial y, cuando un patrón es firme, propone la regla ya
 * armada: "«pago pse compensar-oi» → Nómina · Compensar, 4 de 4 veces". Un
 * clic la crea Y la aplica de una a todos los movimientos pendientes — cada
 * mes que se concilia, más se auto-clasifica y menos se digita.
 *
 * Dos detectores (lib/conciliacionHistorial.sugerirReglas):
 *   A. descripción consistente (≥4 casos, ≥90% misma categoría+beneficiario);
 *   B. monto estable con descripción ambigua (las transferencias de nómina:
 *      ≥4 pagos en banda de ±8%, siempre al mismo beneficiario).
 */

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Lightbulb, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useReconciliationRules } from '@/hooks/useReconciliationRules';
import { useConciliacionHistorial } from '@/hooks/useConciliacionHistorial';
import { sugerirReglas, type ReglaSugerida } from '@/lib/conciliacionHistorial';
import type { Category, Responsible } from '@/types/transaction';

interface Props {
  categories: Category[];
  responsibles: Responsible[];
}

export default function ReglasSugeridasCard({ categories, responsibles }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { historial } = useConciliacionHistorial(true);
  const { rules, createRule, applyPendingRulesViaRPC } = useReconciliationRules();
  const [abierto, setAbierto] = useState(false);
  const [creando, setCreando] = useState<string | null>(null);
  const [descartadas, setDescartadas] = useState<Set<string>>(new Set());

  const sugerencias = useMemo(() => {
    if (!historial) return [];
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const respName = new Map(responsibles.map((r) => [r.id, r.name]));
    return sugerirReglas(historial, rules, {
      categoria: (id) => catName.get(id) ?? '¿?',
      responsable: (id) => respName.get(id) ?? '¿?',
    }).filter((s) => !descartadas.has(s.titulo));
  }, [historial, rules, categories, responsibles, descartadas]);

  async function crear(s: ReglaSugerida) {
    setCreando(s.titulo);
    try {
      await createRule.mutateAsync(s.regla);
      // Cierra el ciclo: la regla recién creada barre los pendientes ya
      // (misma pasada server-side que usa Nico → Reglas).
      await applyPendingRulesViaRPC(5000, { quiet: true });
      qc.invalidateQueries({ queryKey: ['conciliacion'] });
      toast({
        title: `Regla creada: ${s.regla.name}`,
        description: 'Los movimientos pendientes que matchean quedaron conciliados; los próximos se conciliarán solos.',
        duration: 9000,
      });
    } catch (e) {
      toast({ title: 'No se pudo crear la regla', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setCreando(null);
    }
  }

  if (!sugerencias.length) return null;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/[0.03] px-4 py-2.5">
      <button className="flex items-center gap-2 text-sm font-medium w-full text-left"
        onClick={() => setAbierto((v) => !v)}>
        {abierto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Lightbulb className="h-4 w-4 text-primary" />
        {sugerencias.length} regla(s) sugerida(s) por tu historial
        <span className="text-xs text-muted-foreground font-normal ml-1">
          — un clic y la app concilia esto sola de ahora en adelante
        </span>
      </button>
      {abierto && (
        <div className="mt-2 space-y-1.5">
          {sugerencias.map((s) => (
            <div key={s.titulo}
              className="flex items-center justify-between gap-3 flex-wrap rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs">
              <div className="min-w-0">
                <p className="font-medium truncate">{s.titulo}</p>
                <p className="text-muted-foreground">{s.evidencia}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="sm" className="h-7 text-xs" disabled={creando !== null}
                  onClick={() => crear(s)}>
                  {creando === s.titulo
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <><Plus className="h-3.5 w-3.5 mr-1" /> Crear regla</>}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
                  disabled={creando !== null}
                  onClick={() => setDescartadas((p) => new Set(p).add(s.titulo))}>
                  Ahora no
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
