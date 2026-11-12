import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { CanonFn, CargueLine } from '@/lib/despachoCargue';
import { cargadoEnPaquetes, CRITERIOS, SEGURIDAD, type EmpaqueRef } from '@/lib/cargueEmpaque';
import { listarFotos, urlsFirmadas, type CargueRow } from '@/lib/cargueStore';
import type { DispatchEvent } from '@/lib/dispatchQueue';
import type { RemisionCargue } from './useCargue';
import { TINT, fmt, fmtKg, tap } from './CargueUI';
import { Camera, CheckSquare, GraduationCap, Info, Loader2, Package, ShieldCheck, Sparkles, Square, Tag, Truck } from 'lucide-react';

interface Props {
  remision: RemisionCargue;
  lines: CargueLine[];
  canon: CanonFn;
  empaques: Record<string, EmpaqueRef>;
  cargue: CargueRow | null;
  onPracticar: (() => void) | null;
}

const fechaHora = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** Lo que quedó del cargue de una remisión despachada: para un reclamo. */
export default function RegistroCargue({ remision, lines, canon, empaques, cargue, onPracticar }: Props) {
  const { data: eventos = [], isLoading: cargandoEventos } = useQuery({
    queryKey: ['dispatch-scans', remision.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('dispatch_scans').select('id, reference, serial, quantity, scanned_at, operator_id, location, remision_id').eq('remision_id', remision.id);
      if (error) throw error;
      return (data ?? []) as DispatchEvent[];
    },
  });
  const { data: fotosData } = useQuery({ queryKey: ['remision-cargue-fotos', remision.id], queryFn: () => listarFotos(remision.id) });
  const fotos = useMemo(() => fotosData?.fotos ?? [], [fotosData]);
  const { data: urls = {} } = useQuery({
    queryKey: ['remision-cargue-fotos-urls', fotos.map((f) => f.storage_path).join('|')],
    enabled: fotos.length > 0,
    staleTime: 30 * 60_000,
    queryFn: () => urlsFirmadas(fotos.map((f) => f.storage_path)),
  });

  const porRef = useMemo(() => cargadoEnPaquetes(eventos, canon), [eventos, canon]);
  const serialesPorRef = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const e of eventos) {
      if (!e.serial || Number(e.quantity) <= 0) continue;
      const k = canon(e.reference ?? '');
      (out[k] ?? (out[k] = [])).push(e.serial);
    }
    return out;
  }, [eventos, canon]);
  const totalPaq = Object.values(porRef).reduce((s, x) => s + x.paquetes, 0);
  const sinRegistro = !cargue && eventos.length === 0 && fotos.length === 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-start">
      <div className="space-y-3 min-w-0">
        <section className="rounded-3xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2"><Truck className="h-5 w-5" /><h2 className="text-lg font-bold">Registro del cargue</h2></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Dato label="Estado" value={remision.status === 'despachado' ? 'Despachada' : remision.status} />
            <Dato label="Despachada" value={fechaHora(cargue?.cerrado_at ?? remision.verified_at)} />
            <Dato label="Paquetes" value={cargue?.paquetes != null ? fmt(cargue.paquetes) : totalPaq ? fmt(totalPaq) : '—'} />
            <Dato label="Peso aprox." value={cargue?.peso_kg ? fmtKg(cargue.peso_kg) : '—'} />
          </div>
          {cargue && (
            <div className="text-sm space-y-1">
              {(cargue.vehiculo || cargue.conductor) && <p><span className="text-muted-foreground">Vehículo: </span><span className="font-semibold">{[cargue.vehiculo, cargue.conductor].filter(Boolean).join(' · ')}</span></p>}
              <p><span className="text-muted-foreground">Orden de cargue: </span><span className="font-semibold">{CRITERIOS.find((c) => c.id === cargue.criterio)?.label ?? 'a mano'}</span></p>
            </div>
          )}
          {sinRegistro && (
            <div className={`rounded-xl border border-warning/50 ${TINT.warning} px-3 py-2 text-sm font-semibold text-warning flex gap-2`}>
              <Info className="h-5 w-5 flex-shrink-0" />
              Esta remisión se despachó sin cargue en la app (sin paquetes contados ni foto).
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2"><Package className="h-5 w-5" /><h2 className="text-lg font-bold">Qué salió</h2></div>
          {cargandoEventos ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
            <ul className="divide-y divide-border">
              {lines.map((l) => {
                const c = porRef[l.key];
                const seriales = serialesPorRef[l.key] ?? [];
                return (
                  <li key={l.key} className="py-2.5">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold truncate">{l.reference}</div>
                        <div className="text-sm text-muted-foreground truncate">{l.name || 'Sin descripción'}</div>
                      </div>
                      <div className="text-right tabular-nums">
                        <div className="font-bold">{c ? `${fmt(c.paquetes)} paq` : '—'}</div>
                        <div className="text-xs text-muted-foreground">{fmt(l.pedido)} und en la remisión{empaques[l.key]?.porPaquete ? ` · de a ${empaques[l.key]!.porPaquete}` : ''}</div>
                      </div>
                    </div>
                    {seriales.length > 0 && (
                      <div className="mt-1 flex items-center gap-1.5 flex-wrap text-xs">
                        <Tag className="h-3 w-3 text-muted-foreground" />
                        {seriales.map((s) => <span key={s} className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono">{s}</span>)}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {cargue && (
          <section className="rounded-3xl border border-border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /><h2 className="text-lg font-bold">Seguridad confirmada</h2></div>
            {SEGURIDAD.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-sm">
                {cargue.seguridad?.[s.id] ? <CheckSquare className="h-5 w-5 text-success" /> : <Square className="h-5 w-5 text-muted-foreground" />}
                <span>{s.label}</span>
              </div>
            ))}
          </section>
        )}
      </div>

      <div className="space-y-3 lg:sticky lg:top-[74px]">
        <section className="rounded-3xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2"><Camera className="h-5 w-5" /><h2 className="text-lg font-bold">Fotos del cargue</h2></div>
          {fotosData?.faltaMigracion && <p className="text-sm text-muted-foreground">Las fotos se guardan cuando se aplique la actualización de la base del cargue.</p>}
          {!fotosData?.faltaMigracion && fotos.length === 0 && <p className="text-sm text-muted-foreground">No hay fotos de este cargue.</p>}
          <div className="grid grid-cols-2 gap-2">
            {fotos.map((f) => (
              <div key={f.id} className="rounded-2xl border border-border overflow-hidden bg-background">
                {urls[f.storage_path]
                  ? <a href={urls[f.storage_path]} target="_blank" rel="noreferrer"><img src={urls[f.storage_path]} alt={`Foto del cargue de ${remision.number}`} className="w-full aspect-[4/3] object-cover" /></a>
                  : <div className="w-full aspect-[4/3] flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
                <div className="px-2.5 py-2 text-xs space-y-0.5">
                  <div className="text-muted-foreground">{fechaHora(f.tomada_at)}</div>
                  {f.conteo_ia != null && <div className="font-semibold inline-flex items-center gap-1"><Sparkles className="h-3.5 w-3.5" /> IA: ~{fmt(f.conteo_ia)} paquetes</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
        {onPracticar && (
          <button type="button" onClick={tap(onPracticar)} className="w-full h-14 rounded-2xl border border-border bg-card text-base font-bold inline-flex items-center justify-center gap-2 active:scale-[0.98]">
            <GraduationCap className="h-5 w-5" /> Practicar este cargue
          </button>
        )}
      </div>
    </div>
  );
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 px-3 py-2 min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-bold tabular-nums leading-tight truncate">{value}</div>
    </div>
  );
}
