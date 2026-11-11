import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle, CheckCircle2, Loader2, Truck, WifiOff, Ban, ArrowLeft } from 'lucide-react';
import type { ResumenCargue } from '@/lib/despachoCargue';
import type { FueraItem } from '@/lib/dispatchQueue';

interface Props {
  open: boolean;
  onClose: () => void;
  numero: string;
  resumen: ResumenCargue;
  fuera: FueraItem[];
  onResolverFuera: (id: string) => void;
  online: boolean;
  practica: boolean;
  onConfirm: (ajustar: boolean) => Promise<void>;
}

const fmt = (n: number) => n.toLocaleString('es-CO');

export default function CierreDialog({ open, onClose, numero, resumen, fuera, onResolverFuera, online, practica, onConfirm }: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bloqueadoPorFuera = fuera.length > 0;
  const nadaCargado = resumen.totalCargado <= 0;
  const sinSenal = !online && !practica;
  const puedeCerrar = !bloqueadoPorFuera && !nadaCargado;

  const confirmar = async (ajustar: boolean) => {
    setError(null);
    setRunning(true);
    try {
      await onConfirm(ajustar);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar el cargue.');
    } finally {
      setRunning(false);
    }
  };

  const faltan = resumen.faltantes.reduce((s, f) => s + f.diferencia, 0);
  const sobran = resumen.sobrantes.reduce((s, f) => s + f.diferencia, 0);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !running) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Cerrar cargue · {numero}</DialogTitle>
          <DialogDescription className="text-sm">
            {practica ? 'Modo práctica: nada de esto se guarda.' : 'Revisá antes de despachar: después de esto la remisión queda despachada.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2">
          <Metric label="Pedido" value={`${fmt(resumen.totalPedido)} und`} />
          <Metric label="Cargado" value={`${fmt(resumen.totalCargado)} und`} />
          <Metric label="Refs completas" value={`${resumen.refsCompletas} de ${resumen.refsTotal}`} />
        </div>

        {bloqueadoPorFuera && (
          <div className="rounded-2xl border border-destructive/50 bg-destructive/10 p-3 space-y-2">
            <div className="flex items-center gap-2 font-bold text-destructive"><Ban className="h-5 w-5" /> Hay mercancía que no va en este pedido</div>
            {fuera.map((f) => (
              <div key={f.id} className="flex items-center gap-3">
                <span className="flex-1 text-sm font-semibold text-destructive">{f.reference} ×{f.quantity}</span>
                <button type="button" onClick={() => onResolverFuera(f.id)} className="h-11 px-4 rounded-xl border border-destructive/50 bg-card text-sm font-semibold text-destructive active:scale-95">
                  La saqué
                </button>
              </div>
            ))}
          </div>
        )}

        {nadaCargado && !bloqueadoPorFuera && (
          <div className="rounded-2xl border border-border bg-muted/50 p-3 text-sm">Todavía no has cargado nada de este pedido.</div>
        )}

        {!nadaCargado && resumen.cuadra && (
          <div className="rounded-2xl border border-success/40 bg-success/10 p-3 flex items-center gap-2 text-success font-semibold">
            <CheckCircle2 className="h-5 w-5 flex-shrink-0" /> Todo cuadra con el pedido.
          </div>
        )}

        {!nadaCargado && !resumen.cuadra && (
          <div className="space-y-2">
            {resumen.faltantes.length > 0 && (
              <div className="rounded-2xl border border-warning/50 bg-warning/10 p-3">
                <div className="flex items-center gap-2 font-bold text-warning"><AlertTriangle className="h-5 w-5" /> Faltan {fmt(faltan)} und</div>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {resumen.faltantes.map((f) => (
                    <li key={f.key} className="flex justify-between gap-3 tabular-nums">
                      <span className="font-semibold">{f.reference}</span>
                      <span>{fmt(f.cargado)} de {fmt(f.pedido)} · faltan {fmt(f.diferencia)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {resumen.sobrantes.length > 0 && (
              <div className="rounded-2xl border border-destructive/50 bg-destructive/10 p-3">
                <div className="flex items-center gap-2 font-bold text-destructive"><AlertTriangle className="h-5 w-5" /> Sobran {fmt(sobran)} und</div>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {resumen.sobrantes.map((s) => (
                    <li key={s.key} className="flex justify-between gap-3 tabular-nums">
                      <span className="font-semibold">{s.reference}</span>
                      <span>{fmt(s.cargado)} de {fmt(s.pedido)} · sobran {fmt(s.diferencia)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {error && <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-sm font-medium text-destructive">{error}</div>}

        <div className="space-y-2 pt-1">
          {puedeCerrar && resumen.cuadra && (
            <button
              type="button"
              disabled={running || sinSenal}
              onClick={() => confirmar(false)}
              className="w-full h-14 rounded-2xl bg-success text-success-foreground text-lg font-bold inline-flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60"
            >
              {running ? <Loader2 className="h-6 w-6 animate-spin" /> : sinSenal ? <WifiOff className="h-6 w-6" /> : <Truck className="h-6 w-6" />}
              {sinSenal ? 'Sin señal: esperá el wifi para cerrar' : practica ? 'Simular despacho' : 'Despachar'}
            </button>
          )}
          {puedeCerrar && !resumen.cuadra && (
            <>
              <button
                type="button"
                disabled={running || sinSenal}
                onClick={() => confirmar(true)}
                className="w-full min-h-[56px] py-3 px-4 rounded-2xl bg-primary text-primary-foreground text-base font-bold inline-flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60"
              >
                {running ? <Loader2 className="h-6 w-6 animate-spin flex-shrink-0" /> : sinSenal ? <WifiOff className="h-6 w-6 flex-shrink-0" /> : <Truck className="h-6 w-6 flex-shrink-0" />}
                {sinSenal ? 'Sin señal: esperá el wifi para cerrar' : practica ? 'Simular: despachar lo cargado y ajustar' : 'Despachar lo cargado y ajustar la remisión'}
              </button>
              <p className="text-xs text-muted-foreground text-center">
                La remisión queda con lo que se cargó y el inventario se recalcula solo. Queda una nota con lo que faltó o sobró.
              </p>
            </>
          )}
          <button
            type="button"
            disabled={running}
            onClick={onClose}
            className="w-full h-12 rounded-2xl border border-border bg-card text-base font-semibold inline-flex items-center justify-center gap-2 active:scale-[0.98]"
          >
            <ArrowLeft className="h-5 w-5" /> Volver al cargue
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
    </div>
  );
}
