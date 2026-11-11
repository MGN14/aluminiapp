/**
 * "Terceros que parecen el mismo" — unir con un clic desde el listado.
 *
 * Nació del caso Polyacril (Nico 2026-11-11): la sincronización dejó sus
 * facturas en una ficha provisional "Cliente NIT 901317432" y los pagos se
 * conciliaban contra "Polyacril". Dos fichas = dos cuentas corrientes, así
 * que los pagos no le bajaban el saldo a la factura. El detector vive en
 * src/lib/tercerosPartidos.ts; la unión la hace el RPC merge_responsibles
 * (reasigna facturas, pagos, remisiones, cotizaciones, reglas… y le copia el
 * NIT al que queda, para que la próxima factura caiga en la ficha correcta).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllPaged } from '@/lib/fetchAllPaged';
import { detectarTercerosPartidos, llavePar, type ParPartido, type TerceroParaUnir } from '@/lib/tercerosPartidos';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { GitMerge, Loader2, X } from 'lucide-react';

const DESCARTADOS_KEY = 'aluminia_terceros_no_son_el_mismo_v1';

function leerDescartados(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(DESCARTADOS_KEY) ?? '[]');
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const db = supabase as never as { from: (t: string) => any };

interface Props {
  /** Terceros activos del listado. */
  terceros: TerceroParaUnir[];
  /** Movimientos + facturas por tercero (decide cuál se conserva). */
  actividad: Map<string, number>;
}

export default function TercerosDuplicadosBanner({ terceros, actividad }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [descartados, setDescartados] = useState<string[]>(() => leerDescartados());
  const [par, setPar] = useState<ParPartido | null>(null);
  const [invertido, setInvertido] = useState(false);
  const [uniendo, setUniendo] = useState(false);

  // Arrays planos (el cache persistido es JSON). Paginado: el servidor corta en 1.000.
  const { data } = useQuery({
    queryKey: ['terceros', 'partidos-datos'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [aliases, facturas] = await Promise.all([
        fetchAllPaged<{ responsible_id: string; alias: string }>((a, b) =>
          db.from('responsible_aliases').select('responsible_id, alias').order('id').range(a, b)),
        fetchAllPaged<{ responsible_id: string | null; counterparty_name: string | null }>((a, b) =>
          db.from('invoices').select('responsible_id, counterparty_name').not('responsible_id', 'is', null).order('id').range(a, b)),
      ]);
      return { aliases, facturas };
    },
  });

  const pares = useMemo(() => {
    if (!data || terceros.length < 2) return [];
    return detectarTercerosPartidos({ terceros, aliases: data.aliases, facturas: data.facturas, actividad })
      .filter((p) => !descartados.includes(llavePar(p.absorber.id, p.conservar.id)));
  }, [data, terceros, actividad, descartados]);

  if (!pares.length && !par) return null;

  const descartar = (p: ParPartido) => {
    const next = [...descartados, llavePar(p.absorber.id, p.conservar.id)];
    setDescartados(next);
    try { localStorage.setItem(DESCARTADOS_KEY, JSON.stringify(next)); } catch { /* modo privado */ }
  };

  const queda = par ? (invertido ? par.absorber : par.conservar) : null;
  const seVa = par ? (invertido ? par.conservar : par.absorber) : null;

  const unir = async () => {
    if (!queda || !seVa) return;
    setUniendo(true);
    try {
      const { error } = await (supabase.rpc as any)('merge_responsibles', {
        p_legacy_id: seVa.id,
        p_canonical_id: queda.id,
      });
      if (error) throw error;
      toast({
        title: 'Terceros unidos',
        description: `«${seVa.name}» quedó dentro de «${queda.name}»: sus facturas, pagos, remisiones y cotizaciones ya son de una sola ficha.`,
        duration: 9000,
      });
      setPar(null);
      // La unión reasigna facturas, movimientos, remisiones, cotizaciones y
      // reglas: todo lo que esté en pantalla tiene que volver a leerse.
      queryClient.invalidateQueries();
    } catch (e) {
      toast({
        title: 'No se pudieron unir',
        description: (e as { message?: string })?.message ?? 'Error desconocido',
        variant: 'destructive',
      });
    } finally {
      setUniendo(false);
    }
  };

  return (
    <>
      {pares.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.07] px-4 py-3 text-xs space-y-2">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
              <GitMerge className="h-4 w-4 shrink-0" />
              {pares.length === 1 ? 'Hay dos fichas que parecen el mismo tercero' : `Hay ${pares.length} pares de fichas que parecen el mismo tercero`}
            </p>
            <p className="text-muted-foreground mt-0.5">
              Mientras estén separadas, los pagos de una no le descuentan las facturas a la otra.
            </p>
          </div>
          {pares.map((p) => (
            <div key={llavePar(p.absorber.id, p.conservar.id)} className="flex items-start justify-between gap-3 flex-wrap">
              <p className="text-foreground min-w-0">
                <strong>{p.absorber.name}</strong> y <strong>{p.conservar.name}</strong>
                <span className="text-muted-foreground">
                  {p.seguro ? ': ' : ' (posible): '}{p.detalle}.
                </span>
              </p>
              <span className="shrink-0 inline-flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1.5"
                  onClick={() => { setInvertido(false); setPar(p); }}>
                  <GitMerge className="h-3.5 w-3.5" /> Unir
                </Button>
                <button type="button" onClick={() => descartar(p)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  title="No volver a proponer este par en este navegador. No cambia ningún dato.">
                  <X className="h-3 w-3" /> No son el mismo
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={!!par} onOpenChange={(o) => { if (!o && !uniendo) setPar(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unir «{seVa?.name}» dentro de «{queda?.name}»</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Todas las facturas, pagos, remisiones y cotizaciones de <strong className="text-foreground">{seVa?.name}</strong> pasan
                  a <strong className="text-foreground">{queda?.name}</strong>, y el nombre que se va queda como alias.
                  Si a {queda?.name} le falta el NIT, hereda el de la otra ficha.
                </p>
                <p className="font-medium text-foreground">No se puede deshacer.</p>
                <button type="button" className="text-xs text-primary hover:underline" disabled={uniendo}
                  onClick={() => setInvertido((v) => !v)}>
                  Mejor conservar «{seVa?.name}» y absorber «{queda?.name}»
                </button>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={uniendo}>Cancelar</AlertDialogCancel>
            <Button onClick={unir} disabled={uniendo} className="gap-1.5">
              {uniendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
              Unir
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
