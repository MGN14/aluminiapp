import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useDataOwner } from '@/hooks/useDataOwner';
import { SEGURIDAD, type SeguridadId, type TotalesCargue } from '@/lib/cargueEmpaque';
import {
  listarFotos, subirFoto, borrarFoto, urlsFirmadas, contarPaquetesIA, comprimirFoto, type FotoCargue,
} from '@/lib/cargueStore';
import { claves, leer, guardar as guardarLocal } from './persistencia';
import type { CargueConteoApi } from './useCargue';
import { TINT, fmt, tap } from './CargueUI';
import {
  AlertTriangle, Camera, CheckCircle2, Loader2, ShieldCheck, Sparkles, Trash2, Truck, WifiOff, Ban, Square, CheckSquare,
} from 'lucide-react';

interface Props {
  remisionId: string;
  numero: string;
  api: CargueConteoApi;
  totales: TotalesCargue;
  practica: boolean;
  seguridad: Partial<Record<SeguridadId, boolean>>;
  onSeguridad: (s: Partial<Record<SeguridadId, boolean>>) => void;
  onDespachar: (ajustar: boolean, fotos: number) => Promise<void>;
}

export default function CierreStep({ remisionId, numero, api, totales, practica, seguridad, onSeguridad, onDespachar }: Props) {
  const { user } = useAuth();
  const { dataOwnerId } = useDataOwner();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [errorFoto, setErrorFoto] = useState<string | null>(null);
  const [contando, setContando] = useState<Record<string, boolean>>({});
  const [errorIA, setErrorIA] = useState<string | null>(null);
  // Práctica: las fotos quedan en el iPad (chicas) para que salir y volver no las borre.
  const [fotosPractica, setFotosPractica] = useState<string[]>(() => (practica ? leer<string[]>(claves(remisionId).fotosPractica) ?? [] : []));
  useEffect(() => { if (practica) guardarLocal(claves(remisionId).fotosPractica, fotosPractica); }, [practica, remisionId, fotosPractica]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fotosQ = useQuery({
    queryKey: ['remision-cargue-fotos', remisionId],
    enabled: !!remisionId && !practica,
    queryFn: () => listarFotos(remisionId),
  });
  const fotos = useMemo(() => fotosQ.data?.fotos ?? [], [fotosQ.data]);
  const faltaMigracion = !!fotosQ.data?.faltaMigracion;
  const { data: urls = {} } = useQuery({
    queryKey: ['remision-cargue-fotos-urls', fotos.map((f) => f.storage_path).join('|')],
    enabled: fotos.length > 0,
    staleTime: 30 * 60_000,
    queryFn: () => urlsFirmadas(fotos.map((f) => f.storage_path)),
  });

  const contar = async (foto: FotoCargue) => {
    setErrorIA(null);
    setContando((c) => ({ ...c, [foto.id]: true }));
    try {
      await contarPaquetesIA(foto.id);
      await qc.invalidateQueries({ queryKey: ['remision-cargue-fotos', remisionId] });
    } catch (e) {
      setErrorIA(e instanceof Error ? e.message : 'No se pudo contar con IA.');
    } finally {
      setContando((c) => ({ ...c, [foto.id]: false }));
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setErrorFoto(null);
    if (practica) {
      try {
        const blob = await comprimirFoto(file, 900, 0.7);
        const dataUrl = await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(fr.error);
          fr.readAsDataURL(blob);
        });
        setFotosPractica((p) => [...p, dataUrl].slice(-4));
      } catch { setErrorFoto('No se pudo leer la foto.'); }
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    if (!user?.id || !dataOwnerId) { setErrorFoto('Todavía no se cargó tu cuenta. Probá de nuevo en un momento.'); return; }
    setSubiendo(true);
    try {
      const foto = await subirFoto({ ownerId: dataOwnerId, remisionId, userId: user.id, file });
      await qc.invalidateQueries({ queryKey: ['remision-cargue-fotos', remisionId] });
      void contar(foto); // la IA cuenta los paquetes de la foto apenas sube
    } catch (e) {
      setErrorFoto(e instanceof Error ? `No se pudo subir la foto: ${e.message}` : 'No se pudo subir la foto.');
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const quitarFoto = async (foto: FotoCargue) => {
    if (!window.confirm('¿Borrar esta foto?')) return;
    try { await borrarFoto(foto); await qc.invalidateQueries({ queryKey: ['remision-cargue-fotos', remisionId] }); }
    catch (e) { setErrorFoto(e instanceof Error ? e.message : 'No se pudo borrar.'); }
  };

  const nFotos = practica ? fotosPractica.length : fotos.length;
  const paquetesContados = totales.paquetesCargados;
  const conteosIA = fotos.map((f) => f.conteo_ia).filter((n): n is number => n != null);
  const iaMax = conteosIA.length ? Math.max(...conteosIA) : null;
  const iaDifiere = iaMax != null && Math.abs(iaMax - paquetesContados) > Math.max(1, Math.round(paquetesContados * 0.1));

  const seguridadOk = SEGURIDAD.every((s) => seguridad[s.id]);
  const resumen = api.resumen;
  const faltan = resumen.faltantes.reduce((s, f) => s + f.diferencia, 0);
  const sobran = resumen.sobrantes.reduce((s, f) => s + f.diferencia, 0);
  const sinSenal = !api.online && !practica;

  const pendientesCierre: string[] = [];
  if (resumen.totalCargado <= 0) pendientesCierre.push('Contar lo que se cargó');
  if (api.fuera.length > 0) pendientesCierre.push('Sacar del camión lo que no va');
  if (nFotos === 0 && !faltaMigracion) pendientesCierre.push('Tomar la foto del camión cargado');
  if (!seguridadOk) pendientesCierre.push('Confirmar la lista de seguridad');
  const puede = pendientesCierre.length === 0 && !sinSenal;

  const despachar = async (ajustar: boolean) => {
    setError(null);
    setRunning(true);
    try { await onDespachar(ajustar, nFotos); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo despachar.'); }
    finally { setRunning(false); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2 items-start">
      <div className="space-y-4 min-w-0">
        {/* Fotos */}
        <section className="rounded-3xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            <h2 className="text-lg font-bold">Foto del camión cargado</h2>
          </div>
          <p className="text-sm text-muted-foreground">Siempre: es la prueba si hay un reclamo. Tomala de frente, que se vean las puntas de los paquetes. La IA cuenta los paquetes que ve.</p>
          {faltaMigracion && (
            <div className={`rounded-xl border border-warning/60 ${TINT.warning} px-3 py-2 text-sm font-semibold text-warning`}>
              Las fotos todavía no se pueden guardar: falta aplicar la actualización de la base (SQL del cargue). Mientras tanto se puede despachar sin foto.
            </div>
          )}
          <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <button
            type="button"
            disabled={subiendo || (faltaMigracion && !practica)}
            onClick={tap(() => inputRef.current?.click())}
            className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-lg font-bold inline-flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
          >
            {subiendo ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
            {subiendo ? 'Subiendo foto…' : nFotos ? 'Tomar otra foto' : 'Tomar foto'}
          </button>
          {errorFoto && <p className="text-sm font-medium text-destructive">{errorFoto}</p>}

          {(nFotos > 0) && (
            <div className="grid grid-cols-2 gap-2">
              {practica
                ? fotosPractica.map((u, i) => (
                  <div key={i} className="relative">
                    <img src={u} alt="Foto de práctica del cargue" className="w-full aspect-[4/3] object-cover rounded-2xl border border-border" />
                    <button type="button" aria-label="Borrar foto" onClick={tap(() => setFotosPractica((p) => p.filter((_, j) => j !== i)))}
                      className="absolute top-2 right-2 h-9 w-9 rounded-lg border border-border bg-card flex items-center justify-center text-muted-foreground"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))
                : fotos.map((f) => (
                  <div key={f.id} className="rounded-2xl border border-border overflow-hidden bg-background">
                    {urls[f.storage_path]
                      ? <a href={urls[f.storage_path]} target="_blank" rel="noreferrer"><img src={urls[f.storage_path]} alt="Foto del cargue" className="w-full aspect-[4/3] object-cover" /></a>
                      : <div className="w-full aspect-[4/3] flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
                    <div className="px-2.5 py-2 flex items-center gap-2 text-sm">
                      {contando[f.id]
                        ? <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Contando…</span>
                        : f.conteo_ia != null
                          ? <span className="inline-flex items-center gap-1 font-semibold tabular-nums"><Sparkles className="h-4 w-4" /> IA: ~{fmt(f.conteo_ia)} paq{f.conteo_ia_detalle?.confianza ? ` (${f.conteo_ia_detalle.confianza})` : ''}</span>
                          : <button type="button" onClick={tap(() => contar(f))} className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline"><Sparkles className="h-4 w-4" /> Contar con IA</button>}
                      <button type="button" aria-label="Borrar foto" onClick={tap(() => quitarFoto(f))} className="ml-auto h-9 w-9 rounded-lg border border-border flex items-center justify-center text-muted-foreground"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                ))}
            </div>
          )}
          {errorIA && <p className="text-sm text-muted-foreground">{errorIA}</p>}
          {iaMax != null && (
            <div className={`rounded-xl border px-3 py-2 text-sm font-semibold flex gap-2 ${iaDifiere ? `border-warning/60 ${TINT.warning} text-warning` : `border-success/40 ${TINT.success} text-success`}`}>
              {iaDifiere ? <AlertTriangle className="h-5 w-5 flex-shrink-0" /> : <CheckCircle2 className="h-5 w-5 flex-shrink-0" />}
              {iaDifiere
                ? `La IA ve ~${fmt(iaMax)} paquetes y contaste ${fmt(paquetesContados)}. Revisá el camión o tomá otra foto más de frente.`
                : `La IA ve ~${fmt(iaMax)} paquetes: cuadra con los ${fmt(paquetesContados)} que contaste.`}
            </div>
          )}
        </section>

        {/* Seguridad */}
        <section className="rounded-3xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /><h2 className="text-lg font-bold">Seguridad del cargue</h2></div>
          {SEGURIDAD.map((s) => {
            const ok = !!seguridad[s.id];
            return (
              <button
                key={s.id}
                type="button"
                onClick={tap(() => onSeguridad({ ...seguridad, [s.id]: !ok }))}
                aria-pressed={ok}
                className={`w-full text-left rounded-2xl border px-3 py-3 min-h-[56px] flex items-center gap-3 active:scale-[0.99] ${ok ? `border-success/50 ${TINT.success}` : 'border-border bg-background'}`}
              >
                {ok ? <CheckSquare className="h-6 w-6 text-success flex-shrink-0" /> : <Square className="h-6 w-6 text-muted-foreground flex-shrink-0" />}
                <span className="text-base font-semibold">{s.label}</span>
              </button>
            );
          })}
        </section>
      </div>

      {/* Resumen y despacho */}
      <section className="rounded-3xl border border-border bg-card p-4 space-y-3 lg:sticky lg:top-[74px]">
        <h2 className="text-lg font-bold">Cerrar cargue · {numero}</h2>
        <div className="grid grid-cols-3 gap-2">
          <Dato label="Paquetes" value={`${fmt(totales.paquetesCargados)} de ${fmt(totales.paquetesPlan)}`} />
          <Dato label="Unidades" value={`${fmt(resumen.totalCargado)} de ${fmt(resumen.totalPedido)}`} />
          <Dato label="Fotos" value={fmt(nFotos)} />
        </div>

        {api.fuera.length > 0 && (
          <div className={`rounded-2xl border border-destructive/50 ${TINT.destructive} p-3 space-y-2`}>
            <div className="flex items-center gap-2 font-bold text-destructive"><Ban className="h-5 w-5" /> Hay mercancía que no va en este pedido</div>
            {api.fuera.map((f) => (
              <div key={f.id} className="flex items-center gap-3">
                <span className="flex-1 text-sm font-semibold text-destructive">{f.reference} · paquete de {fmt(f.quantity)}</span>
                <button type="button" onClick={tap(() => api.resolverFuera(f.id))} className="h-11 px-4 rounded-xl border border-destructive/50 bg-card text-sm font-semibold text-destructive active:scale-95">Lo saqué</button>
              </div>
            ))}
          </div>
        )}

        {resumen.totalCargado > 0 && resumen.cuadra && (
          <div className={`rounded-2xl border border-success/40 ${TINT.success} p-3 flex items-center gap-2 text-success font-semibold`}>
            <CheckCircle2 className="h-5 w-5 flex-shrink-0" /> Todo cuadra con el pedido.
          </div>
        )}
        {resumen.totalCargado > 0 && !resumen.cuadra && (
          <div className="space-y-2">
            {resumen.faltantes.length > 0 && (
              <div className={`rounded-2xl border border-warning/50 ${TINT.warning} p-3`}>
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
              <div className={`rounded-2xl border border-destructive/50 ${TINT.destructive} p-3`}>
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

        {pendientesCierre.length > 0 && (
          <div className="rounded-2xl border border-border bg-background p-3 text-sm">
            <div className="font-bold mb-1">Para despachar falta:</div>
            <ul className="list-disc pl-5 space-y-0.5">{pendientesCierre.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
        {error && <div className={`rounded-xl border border-destructive/50 ${TINT.destructive} p-3 text-sm font-medium text-destructive`}>{error}</div>}

        {resumen.cuadra || resumen.totalCargado <= 0 ? (
          <button
            type="button"
            disabled={!puede || running}
            onClick={tap(() => despachar(false))}
            className="w-full h-16 rounded-2xl bg-success text-success-foreground text-lg font-bold inline-flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
          >
            {running ? <Loader2 className="h-6 w-6 animate-spin" /> : sinSenal ? <WifiOff className="h-6 w-6" /> : <Truck className="h-6 w-6" />}
            {sinSenal ? 'Sin señal: esperá el wifi' : practica ? 'Simular despacho' : 'Despachar'}
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={!puede || running}
              onClick={tap(() => despachar(true))}
              className="w-full min-h-[64px] py-3 px-4 rounded-2xl bg-primary text-primary-foreground text-base font-bold inline-flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
            >
              {running ? <Loader2 className="h-6 w-6 animate-spin flex-shrink-0" /> : sinSenal ? <WifiOff className="h-6 w-6 flex-shrink-0" /> : <Truck className="h-6 w-6 flex-shrink-0" />}
              {sinSenal ? 'Sin señal: esperá el wifi' : practica ? 'Simular: despachar lo cargado y ajustar' : 'Despachar lo cargado y ajustar la remisión'}
            </button>
            <p className="text-xs text-muted-foreground text-center">La remisión queda con lo que se cargó y el inventario se recalcula solo. Queda una nota con lo que faltó o sobró.</p>
          </>
        )}
      </section>
    </div>
  );
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-bold tabular-nums leading-tight">{value}</div>
    </div>
  );
}
