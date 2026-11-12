import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { buscarCargues, type ResultadoBusqueda } from '@/lib/cargueStore';
import { Camera, ChevronRight, Loader2, Package, Search, Tag } from 'lucide-react';

const fmtFecha = (s: string) => { const [y, m, d] = (s || '').split('-'); return d && m && y ? `${d}/${m}/${y}` : s; };

/**
 * Reclamos: "al cliente le faltó un paquete de PC635-3" → buscás por cliente,
 * número de remisión, referencia o el serial de la etiqueta, y abrís el
 * registro del cargue con las fotos.
 */
export default function BuscarCargueDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<ResultadoBusqueda[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const q = texto.trim();
    if (q.length < 2) { setResultados([]); return; }
    let vivo = true;
    const t = window.setTimeout(async () => {
      setBuscando(true); setError(null);
      try { const r = await buscarCargues(q); if (vivo) setResultados(r); }
      catch (e) { if (vivo) setError(e instanceof Error ? e.message : 'No se pudo buscar.'); }
      finally { if (vivo) setBuscando(false); }
    }, 350);
    return () => { vivo = false; window.clearTimeout(t); };
  }, [texto, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[88dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl">Buscar cargue</DialogTitle>
          <DialogDescription className="text-sm">Para un reclamo: buscá por cliente, número de remisión, referencia o el serial de la etiqueta del paquete.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Todoalum, REM-73, PC635-3, SA325B-0042…" className="pl-9 h-12 text-base" />
        </div>
        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-2 min-h-[120px]">
          {buscando && <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!buscando && texto.trim().length >= 2 && resultados.length === 0 && !error && (
            <p className="text-sm text-muted-foreground text-center py-6">No hay remisiones de venta con «{texto.trim()}».</p>
          )}
          {resultados.map((r) => (
            <button
              key={r.remision_id}
              type="button"
              onClick={() => { onOpenChange(false); navigate(`/remisiones/${r.remision_id}/cargue`); }}
              className="w-full text-left rounded-2xl border border-border bg-card px-4 py-3 flex items-center gap-3 active:scale-[0.99] hover:border-foreground/30"
            >
              <div className="min-w-0 flex-1">
                <div className="font-bold truncate">{r.number} · {r.beneficiary || 'Sin cliente'}</div>
                <div className="text-sm text-muted-foreground tabular-nums">
                  {fmtFecha(r.date)} · {r.status === 'despachado' ? 'despachada' : r.status}
                  {r.cargue?.paquetes != null && <> · {r.cargue.paquetes} paq</>}
                </div>
                <div className="mt-1 flex items-center gap-2 flex-wrap text-xs">
                  <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${r.fotos ? 'border-border' : 'border-warning/60 text-warning'}`}>
                    <Camera className="h-3 w-3" /> {r.fotos ? `${r.fotos} foto${r.fotos === 1 ? '' : 's'}` : 'sin foto'}
                  </span>
                  {r.refs.slice(0, 3).map((ref) => <span key={ref} className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5"><Package className="h-3 w-3" />{ref}</span>)}
                  {r.seriales.slice(0, 3).map((s) => <span key={s.serial} className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 font-mono"><Tag className="h-3 w-3" />{s.serial}</span>)}
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
