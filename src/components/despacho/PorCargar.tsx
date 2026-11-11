import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOnline } from '@/hooks/useOnline';
import { beep } from '@/lib/scanFeedback';
import { normalizeRef } from '@/lib/qrLabel';
import {
  pendientesPorRemision, loadLocal, saveLocal, syncOps, aplicarResultadoSync, type SyncClient,
} from '@/lib/dispatchQueue';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Truck, ChevronRight, PackageCheck, ScanLine, GraduationCap, Loader2, CloudOff, CheckCircle2, Clock,
} from 'lucide-react';

interface ItemLite { id: string; reference: string; product_name: string | null; units: number | null }
interface RemLite {
  id: string; date: string; number: string; beneficiary: string | null; status: string;
  module_origin: string; remision_items: ItemLite[];
}

interface Props {
  onOpen: (remisionId: string) => void;
  onPractice: (remisionId: string) => void;
  onLibre: () => void;
  /** Referencias de un despacho sin pedido que quedó a medias en este iPad. */
  libreEnCurso: number;
}

const fmt = (n: number) => n.toLocaleString('es-CO');
function fmtFecha(s: string) {
  const [y, m, d] = (s || '').split('-');
  return d && m && y ? `${d}/${m}/${y}` : s;
}
function totales(r: RemLite) {
  const items = r.remision_items || [];
  return {
    refs: new Set(items.map((i) => normalizeRef(i.reference)).filter(Boolean)).size,
    unidades: items.reduce((s, i) => s + (Number(i.units) || 0), 0),
  };
}
const SELECT = 'id, date, number, beneficiary, status, module_origin, remision_items(id, reference, product_name, units)';

export default function PorCargar({ onOpen, onPractice, onLibre, libreEnCurso }: Props) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const online = useOnline();
  const qc = useQueryClient();
  const [practicaOpen, setPracticaOpen] = useState(false);

  const { data: pendientes = [], isLoading } = useQuery({
    queryKey: ['despacho-por-cargar', userId],
    enabled: !!userId,
    refetchInterval: online ? 15_000 : false, // los pedidos nuevos de la oficina aparecen solos
    queryFn: async () => {
      const { data, error } = await (supabase.from('remisiones') as any)
        .select(SELECT)
        .eq('status', 'pendiente')
        .eq('remision_type', 'venta')
        .order('date', { ascending: true });
      if (error) throw error;
      return (data || []) as RemLite[];
    },
  });

  const ids = useMemo(() => pendientes.map((r) => r.id), [pendientes]);
  const { data: progreso = {} } = useQuery({
    queryKey: ['despacho-progreso', ids.join(',')],
    enabled: ids.length > 0,
    refetchInterval: online ? 10_000 : false,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('dispatch_scans').select('remision_id, quantity').in('remision_id', ids);
      if (error) return {};
      const out: Record<string, number> = {};
      for (const s of (data || []) as Array<{ remision_id: string; quantity: number }>) {
        out[s.remision_id] = (out[s.remision_id] ?? 0) + (Number(s.quantity) || 0);
      }
      return out;
    },
  });

  const { data: hoy = [] } = useQuery({
    queryKey: ['despacho-hoy', userId],
    enabled: !!userId,
    refetchInterval: online ? 30_000 : false,
    queryFn: async () => {
      const inicio = new Date();
      inicio.setHours(0, 0, 0, 0);
      const { data, error } = await (supabase.from('remisiones') as any)
        .select('id, number, beneficiary, verified_at, verified_units')
        .eq('status', 'despachado')
        .gte('verified_at', inicio.toISOString())
        .order('verified_at', { ascending: false });
      if (error) throw error;
      return (data || []) as Array<{ id: string; number: string; beneficiary: string | null; verified_at: string; verified_units: number | null }>;
    },
  });

  const { data: paraPracticar = [], isLoading: loadingPractica } = useQuery({
    queryKey: ['despacho-practica', userId],
    enabled: !!userId && practicaOpen,
    queryFn: async () => {
      const desde = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await (supabase.from('remisiones') as any)
        .select(SELECT)
        .eq('status', 'despachado')
        .eq('remision_type', 'venta')
        .gte('date', desde)
        .order('date', { ascending: false })
        .limit(40);
      if (error) throw error;
      // Sin ítems no hay nada que practicar.
      return ((data || []) as RemLite[]).filter((r) => (r.remision_items || []).length > 0);
    },
  });

  // Conteos que quedaron guardados en el iPad sin subir (se fue el wifi y el
  // operario volvió a la lista): se suben solos desde acá también.
  const [sinSubir, setSinSubir] = useState<Record<string, number>>(() => pendientesPorRemision());
  useEffect(() => {
    if (!userId) return;
    const client: SyncClient = {
      insert: async (e) => ({ error: (await (supabase as any).from('dispatch_scans').insert({ ...e, user_id: userId })).error }),
      remove: async (id) => ({ error: (await (supabase as any).from('dispatch_scans').delete().eq('id', id)).error }),
    };
    let busy = false;
    const flush = async () => {
      const pend = pendientesPorRemision();
      setSinSubir(pend);
      if (busy || !navigator.onLine || Object.keys(pend).length === 0) return;
      busy = true;
      try {
        for (const remId of Object.keys(pend)) {
          const st = loadLocal(remId);
          const res = await syncOps(st.ops, client);
          saveLocal(remId, aplicarResultadoSync(loadLocal(remId), res));
          if (res.error) break;
        }
        qc.invalidateQueries({ queryKey: ['despacho-progreso'] });
      } finally {
        busy = false;
        setSinSubir(pendientesPorRemision());
      }
    };
    flush();
    const t = window.setInterval(flush, 8000);
    return () => window.clearInterval(t);
  }, [userId, qc]);

  const abrir = (id: string) => { beep('ok'); onOpen(id); };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Encabezado */}
      <div className="flex items-center gap-4 flex-wrap rounded-3xl border border-border bg-card p-4">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Truck className="h-6 w-6 text-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Despacho</h1>
          <p className="text-sm text-muted-foreground">Elegí un pedido y contá lo que sube al camión.</p>
        </div>
        {!online && (
          <span className="h-9 px-3 rounded-full border border-warning/50 bg-warning/15 text-warning text-sm font-semibold inline-flex items-center gap-1.5">
            <CloudOff className="h-4 w-4" /> Sin señal
          </span>
        )}
      </div>

      {/* Pedidos por cargar */}
      <section className="space-y-3">
        <h2 className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-base font-bold">
          Por cargar {pendientes.length > 0 && <span className="text-muted-foreground font-semibold tabular-nums">· {pendientes.length}</span>}
        </h2>
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : pendientes.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-card px-6 py-12 text-center">
            <PackageCheck className="h-12 w-12 mx-auto text-success mb-3" />
            <p className="text-lg font-semibold">No hay pedidos por cargar</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Cuando la oficina crea una remisión de venta y la deja en <strong>Pendiente</strong>, aparece acá sola.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {pendientes.map((r) => {
              const t = totales(r);
              const cargado = Math.max(0, progreso[r.id] ?? 0);
              const local = sinSubir[r.id] ?? 0;
              const pct = t.unidades ? Math.min(100, (cargado / t.unidades) * 100) : 0;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => abrir(r.id)}
                  className="w-full text-left rounded-3xl border border-border bg-card p-5 transition active:scale-[0.99] hover:border-foreground/30"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-muted-foreground">{r.number}</span>
                        {cargado > 0 ? (
                          <span className="text-xs font-semibold rounded-full bg-primary/10 px-2 py-0.5 tabular-nums">En cargue · {fmt(cargado)} de {fmt(t.unidades)}</span>
                        ) : (
                          <span className="text-xs font-semibold rounded-full bg-muted px-2 py-0.5">Nuevo</span>
                        )}
                        {local > 0 && (
                          <span className="text-xs font-semibold rounded-full bg-warning/15 text-warning px-2 py-0.5 tabular-nums">{local} sin subir</span>
                        )}
                      </div>
                      <div className="text-xl font-bold leading-tight mt-1 truncate">{r.beneficiary || 'Sin cliente'}</div>
                      <div className="text-sm text-muted-foreground mt-1 tabular-nums">
                        {fmtFecha(r.date)} · {t.refs} referencia{t.refs === 1 ? '' : 's'} · {fmt(t.unidades)} und
                      </div>
                    </div>
                    <ChevronRight className="h-6 w-6 text-muted-foreground flex-shrink-0 mt-2" />
                  </div>
                  {cargado > 0 && (
                    <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-success" style={{ width: `${pct}%` }} /></div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Otras formas de despachar */}
      <section className="grid gap-3 lg:grid-cols-2">
        <button type="button" onClick={onLibre} className="text-left rounded-3xl border border-border bg-card p-4 flex items-center gap-3 active:scale-[0.99]">
          <div className="h-11 w-11 rounded-2xl bg-muted flex items-center justify-center flex-shrink-0"><ScanLine className="h-5 w-5" /></div>
          <div className="min-w-0">
            <div className="font-bold">Despacho sin pedido</div>
            <div className="text-sm text-muted-foreground">
              {libreEnCurso > 0 ? `Tenés uno en curso con ${libreEnCurso} referencias` : 'Armás la remisión escaneando lo que sale'}
            </div>
          </div>
        </button>
        <button type="button" onClick={() => setPracticaOpen(true)} className="text-left rounded-3xl border border-border bg-card p-4 flex items-center gap-3 active:scale-[0.99]">
          <div className="h-11 w-11 rounded-2xl bg-warning/15 flex items-center justify-center flex-shrink-0"><GraduationCap className="h-5 w-5 text-warning" /></div>
          <div className="min-w-0">
            <div className="font-bold">Practicar</div>
            <div className="text-sm text-muted-foreground">Cargá una remisión ya despachada sin guardar nada</div>
          </div>
        </button>
      </section>

      {/* Despachados hoy */}
      {hoy.length > 0 && (
        <section className="space-y-2">
          <h2 className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-base font-bold">Despachados hoy <span className="text-muted-foreground font-semibold tabular-nums">· {hoy.length}</span></h2>
          <div className="rounded-3xl border border-border bg-card divide-y divide-border">
            {hoy.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
                <span className="font-semibold text-sm w-20 flex-shrink-0">{r.number}</span>
                <span className="flex-1 min-w-0 truncate text-sm">{r.beneficiary || 'Sin cliente'}</span>
                <span className="text-sm tabular-nums text-muted-foreground">{fmt(Number(r.verified_units) || 0)} und</span>
                <span className="text-sm tabular-nums text-muted-foreground inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {new Date(r.verified_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Elegir remisión para practicar */}
      <Dialog open={practicaOpen} onOpenChange={setPracticaOpen}>
        <DialogContent className="sm:max-w-lg max-h-[88dvh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-xl">Practicar un cargue</DialogTitle>
            <DialogDescription className="text-sm">
              Elegí una remisión que ya salió. Contás y escaneás como si fuera de verdad, pero no se guarda nada.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-2">
            {loadingPractica ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : paraPracticar.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No hay remisiones despachadas en los últimos 90 días.</p>
            ) : (
              paraPracticar.map((r) => {
                const t = totales(r);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => { setPracticaOpen(false); beep('ok'); onPractice(r.id); }}
                    className="w-full text-left rounded-2xl border border-border bg-card px-4 py-3 flex items-center gap-3 active:scale-[0.99]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-bold truncate">{r.number} · {r.beneficiary || 'Sin cliente'}</div>
                      <div className="text-sm text-muted-foreground tabular-nums">{fmtFecha(r.date)} · {t.refs} refs · {fmt(t.unidades)} und</div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
