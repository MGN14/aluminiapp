import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Ship, X, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { fetchTrmForDate } from '@/hooks/useImportPayments';
import { fetchOpenImports, linkImportPayment, withImportMarker, errMsg, type OpenImport } from '@/lib/importLink';

export interface GiroSinVincular {
  id: string;
  date: string;
  /** Monto del extracto (negativo). */
  amount: number;
  description: string | null;
  notes: string | null;
}

interface Props {
  giros: GiroSinVincular[];
  totalCop: number;
  /** "No es de importación": descarta uno (o todos) para no volver a mostrarlo. */
  onDismiss: (ids: string[]) => void;
  /** Se vinculó un giro: el padre recalcula la lista. */
  onLinked: () => void;
}

const fmtCop = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
const fmtUsd = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/**
 * Alerta del Dashboard: giros al exterior que ningún abono de importación
 * registra. Se vinculan (o se descartan) ACÁ MISMO, fila por fila.
 *
 * Antes el botón "Vincular" mandaba a Conciliación bancaria, pero estos giros
 * ya están conciliados (tienen beneficiario y categoría) así que no aparecen
 * en "Pendientes" y no había nada que hacer allá (Nico 2026-09-16: "le di
 * vincular y me llevó a conciliación y no me dejó conciliar ninguna").
 */
export default function GirosSinVincularCard({ giros, totalCop, onDismiss, onLinked }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [imports, setImports] = useState<OpenImport[] | null>(null);
  const [trmHoy, setTrmHoy] = useState<number | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  // Contenedores abiertos: se cargan al desplegar (una vez).
  useEffect(() => {
    if (!open || imports !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const [imps, trm] = await Promise.all([
          fetchOpenImports(),
          fetchTrmForDate(new Date().toISOString().slice(0, 10)),
        ]);
        if (cancelled) return;
        setImports(imps);
        setTrmHoy(trm);
      } catch (err) {
        if (cancelled) return;
        setImports([]);
        toast({ title: 'No se pudieron cargar los contenedores', description: errMsg(err), variant: 'destructive' });
      }
    })();
    return () => { cancelled = true; };
  }, [open, imports, toast]);

  const handleLink = async (giro: GiroSinVincular, imp: OpenImport) => {
    if (!user) return;
    setLinkingId(giro.id);
    try {
      const result = await linkImportPayment({
        userId: user.id,
        importId: imp.id,
        transactionId: giro.id,
        txDate: giro.date,
        txCopAbs: Math.abs(Number(giro.amount ?? 0)),
      });
      // Marcador en las notas: es lo que pinta el chip en Conciliación.
      const { error: notesErr } = await supabase
        .from('transactions')
        .update({ notes: withImportMarker(giro.notes, imp.label) })
        .eq('id', giro.id);
      if (notesErr) console.warn('[giros] no se pudo escribir el marcador en notas', notesErr);

      if (result.outcome === 'adopted') {
        toast({
          title: 'Vinculado al abono que ya habías registrado',
          description: `Este giro es el mismo abono manual del ${result.manualFecha} (USD ${result.manualUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}). No se registró doble.`,
        });
      } else if (result.outcome === 'already_linked') {
        toast({ title: 'Este giro ya respalda un abono', description: 'Está vinculado a un contenedor (este u otro). No se registró un abono adicional.' });
      } else {
        toast({
          title: `Abono registrado en "${imp.label}"`,
          description: `USD ${result.usd.toLocaleString('en-US', { minimumFractionDigits: 2 })} con TRM ${result.trm.toLocaleString('es-CO')} del día del giro.`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['import_payments'] });
      queryClient.invalidateQueries({ queryKey: ['import_liquidation'] });
      queryClient.invalidateQueries({ queryKey: ['imports'] });
      queryClient.invalidateQueries({ queryKey: ['import-payments-available-tx'] });
      queryClient.invalidateQueries({ queryKey: ['conciliacion'] });
      setImports(null); // saldo del contenedor cambió: recargar al próximo despliegue
      onLinked();
    } catch (err) {
      toast({ title: 'No se pudo vincular la importación', description: errMsg(err), variant: 'destructive' });
    } finally {
      setLinkingId(null);
    }
  };

  return (
    <Card className="border-l-4 border-l-warning bg-warning/5">
      <CardContent className="py-3 px-4 space-y-3">
        <div className="flex items-center gap-3">
          <Ship className="h-4 w-4 text-warning shrink-0" />
          <p className="text-xs text-muted-foreground flex-1 min-w-0">
            <span className="font-semibold text-foreground">
              {giros.length} giro{giros.length === 1 ? '' : 's'} al exterior sin vincular a ningún contenedor
            </span>
            {' — '}
            {fmtCop(totalCop)} que ningún abono de importación registra.
          </p>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1 shrink-0" onClick={() => setOpen((v) => !v)}>
            {open ? 'Ocultar' : 'Vincular'}
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
          <button
            className="shrink-0 text-muted-foreground hover:text-destructive"
            title="No son de importación — no volver a mostrar estos giros"
            onClick={() => onDismiss(giros.map((g) => g.id))}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {open && (
          <div className="rounded-md border bg-background overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left p-2 font-medium">Fecha</th>
                  <th className="text-left p-2 font-medium">Giro</th>
                  <th className="text-right p-2 font-medium">COP</th>
                  <th className="text-right p-2 font-medium">≈ USD</th>
                  <th className="text-left p-2 font-medium">Contenedor</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {giros.map((g) => {
                  const cop = Math.abs(Number(g.amount ?? 0));
                  const usd = trmHoy ? cop / trmHoy : null;
                  const busy = linkingId === g.id;
                  return (
                    <tr key={g.id} className="border-t">
                      <td className="p-2 whitespace-nowrap">{fmtDate(g.date)}</td>
                      <td className="p-2 max-w-[220px] truncate" title={g.description ?? ''}>{g.description}</td>
                      <td className="p-2 text-right tabular-nums whitespace-nowrap">{fmtCop(cop)}</td>
                      <td className="p-2 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                        {usd != null ? fmtUsd(usd) : '—'}
                      </td>
                      <td className="p-2 min-w-[220px]">
                        {imports === null ? (
                          <span className="text-muted-foreground">Cargando…</span>
                        ) : imports.length === 0 ? (
                          <span className="text-muted-foreground">No hay contenedores abiertos en Importaciones.</span>
                        ) : (
                          <Select
                            disabled={busy}
                            value=""
                            onValueChange={(id) => {
                              const imp = imports.find((i) => i.id === id);
                              if (imp) void handleLink(g, imp);
                            }}
                          >
                            <SelectTrigger className="h-7 text-xs">
                              {busy
                                ? <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Vinculando…</span>
                                : <SelectValue placeholder="Vincular a contenedor…" />}
                            </SelectTrigger>
                            <SelectContent>
                              {imports.map((imp) => {
                                const matchesSaldo = usd != null && imp.saldoUsd > 0
                                  ? Math.abs(imp.saldoUsd - usd) / imp.saldoUsd <= 0.15
                                  : false;
                                return (
                                  <SelectItem key={imp.id} value={imp.id} className="text-xs">
                                    <span className="font-medium">{imp.label}</span>
                                    <span className="text-muted-foreground"> · {imp.proveedor !== imp.label ? `${imp.proveedor} · ` : ''}saldo USD {fmtUsd(imp.saldoUsd)}</span>
                                    {matchesSaldo && <span className="ml-1 text-[9px] uppercase tracking-wider text-primary font-semibold">≈ saldo</span>}
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="p-2 text-right whitespace-nowrap">
                        <button
                          className="text-muted-foreground hover:text-destructive text-[11px] underline-offset-2 hover:underline disabled:opacity-50"
                          disabled={busy}
                          title="Este giro no es de una importación (o es de un pedido anterior al módulo): no volver a mostrarlo"
                          onClick={() => onDismiss([g.id])}
                        >
                          No es importación
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="px-2 py-1.5 text-[10px] text-muted-foreground border-t">
              Al vincular, el abono queda en el contenedor con USD = COP ÷ TRM del día del giro. Si ya lo habías
              registrado a mano en Importaciones, se adopta ese abono (no se duplica). Para soltarlo: la X del chip en Conciliación.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
