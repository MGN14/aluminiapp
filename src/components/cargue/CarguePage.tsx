import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useDataOwner } from '@/hooks/useDataOwner';
import { useScannerGun } from '@/hooks/useScannerGun';
import { useSidebar } from '@/components/ui/sidebar';
import { printRemisionToWindow } from '@/lib/printRemision';
import {
  resolverEmpaques, ordenarCargue, totalesCargue, pesoLinea, CRITERIOS, type EmpaqueRef, type SeguridadId,
} from '@/lib/cargueEmpaque';
import { cargarCargue, guardarPlan, marcarCargado, PLAN_VACIO, type CargueRow, type PlanCargue } from '@/lib/cargueStore';
import type { CierreResultado } from '@/lib/despachoCierre';
import { useCargueDatos, useCargueConteo } from './useCargue';
import { useWakeLock } from './useWakeLock';
import PlanStep from './PlanStep';
import ConteoStep from './ConteoStep';
import CierreStep from './CierreStep';
import RegistroCargue from './RegistroCargue';
import { ErrorFrame, SyncChip, TINT, fmt, tap } from './CargueUI';
import { claves, leer, guardar as guardarLocal, estaPracticando, marcarPractica, limpiarPractica, limpiarCargueReal } from './persistencia';
import { guardarEmpaqueReferencia, type CambioEmpaque } from '@/lib/referenciaEmpaque';
import { ArrowLeft, CheckCircle2, ClipboardList, Camera, GraduationCap, Loader2, PackageCheck, Printer } from 'lucide-react';

type Paso = 'plan' | 'cargar' | 'cerrar';
const PASOS: { id: Paso; label: string; Icon: typeof ClipboardList }[] = [
  { id: 'plan', label: 'Plan', Icon: ClipboardList },
  { id: 'cargar', label: 'Cargar', Icon: PackageCheck },
  { id: 'cerrar', label: 'Fotos y cierre', Icon: Camera },
];

type Company = { company_name?: string; company_nit?: string; company_address?: string; company_city?: string } | null;

/** /remisiones/:id/cargue — el despacho nace de la remisión. */
export default function CarguePage() {
  const { id = '' } = useParams();
  return <CargueRemision key={id} id={id} />;
}

function CargueRemision({ id }: { id: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { dataOwnerId } = useDataOwner();
  const datos = useCargueDatos(id);
  const rem = datos.remision;
  // Si estabas practicando, al volver sigue la práctica (no hay que darle otra vez).
  const [practica, setPracticaState] = useState<boolean>(() => estaPracticando(id));
  const setPractica = (si: boolean) => { marcarPractica(id, si); setPracticaState(si); };
  // El resultado vive acá: al despachar, la remisión pasa a "despachado" y sin
  // esto la página saltaría al registro sin mostrar la pantalla de cierre.
  const [hecho, setHecho] = useState<(CierreResultado & { practica: boolean }) | null>(null);

  const cargueQ = useQuery({
    queryKey: ['remision-cargue', id],
    enabled: !!id && !!user?.id,
    queryFn: () => cargarCargue(id),
  });

  // Durante el cargue el menú lateral se encoge a íconos (sigue ahí, a un toque).
  const { open: sidebarOpen, setOpen: setSidebarOpen, isMobile } = useSidebar();
  useEffect(() => {
    if (isMobile || !sidebarOpen) return;
    setSidebarOpen(false);
    return () => setSidebarOpen(true);
  }, []);

  const { data: company } = useQuery({
    queryKey: ['despacho-company', dataOwnerId],
    enabled: !!dataOwnerId,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles')
        .select('company_name, company_nit, company_address, company_city').eq('user_id', dataOwnerId!).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Company;
    },
  });

  const empaquesRegistro = useMemo(() => resolverEmpaques(datos.lines, datos.canon, {
    importItems: datos.importItems, productos: datos.products, referencias: datos.referencias, ajustes: cargueQ.data?.cargue?.empaques ?? {},
  }), [datos.lines, datos.canon, datos.importItems, datos.products, datos.referencias, cargueQ.data]);

  if (datos.loading || (cargueQ.isLoading && !cargueQ.data)) {
    return <div className="flex items-center justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }
  if (!rem) {
    return (
      <div className="max-w-xl mx-auto my-10 rounded-3xl border border-border bg-card p-8 text-center space-y-4">
        <p className="text-lg font-semibold">No se encontró esta remisión.</p>
        <button type="button" onClick={() => navigate('/remisiones')} className="h-12 px-5 rounded-2xl border border-border bg-background font-semibold">Volver a remisiones</button>
      </div>
    );
  }

  if (hecho) {
    return <CargueHecho res={hecho} company={company} onExit={() => { if (hecho.practica) { limpiarPractica(id); setPractica(false); } setHecho(null); navigate('/remisiones'); }} />;
  }

  const pendiente = rem.status === 'pendiente';
  if (!pendiente && !practica) {
    // Ya despachada (o cancelada): el registro del cargue, para reclamos.
    return (
      <div className="max-w-6xl mx-auto space-y-3">
        <Encabezado numero={rem.number} cliente={rem.beneficiary} onSalir={() => navigate('/remisiones')} derecha={null} />
        <RegistroCargue
          remision={rem}
          lines={datos.lines}
          canon={datos.canon}
          empaques={empaquesRegistro}
          cargue={cargueQ.data?.cargue ?? null}
          onPracticar={rem.status === 'despachado' ? () => setPractica(true) : null}
        />
      </div>
    );
  }

  return (
    <CargueActivo
      key={practica ? 'practica' : 'real'}
      remisionId={id}
      practica={practica}
      datos={datos}
      inicial={cargueQ.data ?? { cargue: null, local: null, faltaMigracion: false }}
      onHecho={setHecho}
      onSalir={() => navigate('/remisiones')}
      onTerminarPractica={() => { limpiarPractica(id); setPractica(false); }}
    />
  );
}

function CargueActivo({ remisionId: id, practica, datos, inicial, onHecho, onSalir, onTerminarPractica }: {
  remisionId: string;
  practica: boolean;
  datos: ReturnType<typeof useCargueDatos>;
  inicial: { cargue: CargueRow | null; local: PlanCargue | null; faltaMigracion: boolean };
  onHecho: (r: CierreResultado & { practica: boolean }) => void;
  onSalir: () => void;
  onTerminarPractica: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const rem = datos.remision!;
  const faltaMigracion = inicial.faltaMigracion;

  const k = claves(id);
  // Plan: la copia del iPad gana si es más nueva que la del servidor (un
  // cambio hecho justo antes de salir no se pierde aunque no alcance a subir).
  const [plan, setPlan] = useState<PlanCargue>(() => {
    const local = leer<{ plan: PlanCargue; savedAt: number }>(k.plan(practica));
    if (practica) return local?.plan ?? { ...PLAN_VACIO, criterio: 'peso' };
    const c = inicial.cargue;
    const delServidor = c ? { criterio: c.criterio as PlanCargue['criterio'], orden: c.orden ?? [], empaques: c.empaques ?? {}, vehiculo: c.vehiculo, conductor: c.conductor, capacidad_kg: c.capacidad_kg } : null;
    const servidorAt = c?.updated_at ? Date.parse(c.updated_at) : 0;
    if (local && (!delServidor || local.savedAt > servidorAt)) return local.plan;
    return delServidor ?? inicial.local ?? { ...PLAN_VACIO, criterio: 'peso' };
  });
  useEffect(() => { guardarLocal(k.plan(practica), { plan, savedAt: Date.now() }); }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps
  const [seguridad, setSeguridad] = useState<Partial<Record<SeguridadId, boolean>>>(() =>
    leer<Partial<Record<SeguridadId, boolean>>>(k.seguridad(practica)) ?? ((!practica && inicial.cargue?.seguridad) || {}));
  useEffect(() => { guardarLocal(k.seguridad(practica), seguridad); }, [seguridad]); // eslint-disable-line react-hooks/exhaustive-deps

  const empaques: Record<string, EmpaqueRef> = useMemo(() => resolverEmpaques(datos.lines, datos.canon, {
    importItems: datos.importItems, productos: datos.products, referencias: datos.referencias, ajustes: plan.empaques,
  }), [datos.lines, datos.canon, datos.importItems, datos.products, datos.referencias, plan.empaques]);
  const orden = useMemo(() => ordenarCargue(datos.lines, plan.criterio, {
    empaques, ubicaciones: datos.ubicaciones, ordenManual: plan.orden,
  }), [datos.lines, plan.criterio, plan.orden, empaques, datos.ubicaciones]);

  const conteo = useCargueConteo({
    remisionId: id, practica, lines: datos.lines, canon: datos.canon, aliases: datos.aliases,
    items: datos.items, empaques, remision: rem, orden,
  });
  const totales = useMemo(() => totalesCargue(datos.lines, empaques, conteo.paquetes), [datos.lines, empaques, conteo.paquetes]);
  // Peso de lo que de verdad subió (no del pedido), para el registro del cargue.
  const pesoCargado = useMemo(() => datos.lines.reduce(
    (s, l) => s + (pesoLinea(conteo.cargado[l.key] ?? 0, empaques[l.key]?.kgPorUnidad ?? null) ?? 0), 0,
  ), [datos.lines, conteo.cargado, empaques]);

  // Autoguardado del plan en el servidor (nunca en práctica). Si salís antes
  // de que se cumpla la espera, se sube igual al salir.
  const [guardado, setGuardado] = useState<'ok' | 'local' | 'guardando' | 'error' | null>(null);
  const primera = useRef(true);
  const pendiente = useRef<PlanCargue | null>(null);
  const userIdRef = useRef(user?.id ?? null);
  userIdRef.current = user?.id ?? null;
  useEffect(() => {
    if (practica || !user?.id) return;
    if (primera.current) { primera.current = false; return; }
    setGuardado('guardando');
    pendiente.current = { ...plan, orden };
    const t = window.setTimeout(async () => {
      const aSubir = pendiente.current;
      if (!aSubir) return;
      try {
        const res = await guardarPlan(id, aSubir, user.id);
        if (pendiente.current === aSubir) pendiente.current = null;
        setGuardado(res.guardadoLocal ? 'local' : 'ok');
      } catch { setGuardado('error'); }
    }, 700);
    return () => window.clearTimeout(t);
  }, [plan, orden, practica, user?.id, id]);
  useEffect(() => () => {
    const aSubir = pendiente.current;
    if (aSubir && userIdRef.current) void guardarPlan(id, aSubir, userIdRef.current).catch(() => undefined);
  }, [id]);

  // Paquete/peso a la referencia (no en práctica: ahí no se guarda nada).
  const onGuardarReferencia = practica || datos.referenciasSinMigracion
    ? null
    : async (reference: string, cambio: CambioEmpaque) => {
      const r = await guardarEmpaqueReferencia(reference, cambio, { variantes: datos.referencias });
      await qc.invalidateQueries({ queryKey: ['cargue-variantes-empaque'] });
      qc.invalidateQueries({ queryKey: ['variant-refs-maestro'] });
      return r;
    };

  // Paso actual (sobrevive una recarga). Si ya hay plan guardado, arranca en Cargar.
  const pasoKey = k.paso(practica);
  const [paso, setPasoState] = useState<Paso>(() => {
    try {
      const guardadoPaso = localStorage.getItem(pasoKey) as Paso | null;
      if (guardadoPaso) return guardadoPaso;
    } catch { /* ignore */ }
    return inicial.cargue && !practica ? 'cargar' : 'plan';
  });
  const setPaso = (p: Paso) => {
    setPasoState(p);
    try { localStorage.setItem(pasoKey, p); } catch { /* ignore */ }
    window.scrollTo({ top: 0 });
  };

  useWakeLock(true);
  useScannerGun({ onScan: conteo.handleScan, enabled: paso === 'cargar' });

  // Salir NO borra nada (ni en práctica): al volver sigue donde estaba.
  const salir = () => onSalir();
  const terminarPractica = () => {
    if (!window.confirm('¿Terminar la práctica? Se borra lo que contaste en esta práctica.')) return;
    conteo.descartarPractica();
    onTerminarPractica();
  };

  const despachar = async (ajustar: boolean, nFotos: number) => {
    const extra = [
      `Paquetes: ${fmt(totales.paquetesCargados)} de ${fmt(totales.paquetesPlan)}.`,
      `Fotos del cargue: ${nFotos}.`,
      plan.vehiculo ? `Vehículo ${plan.vehiculo}${plan.conductor ? ` (${plan.conductor})` : ''}.` : '',
      `Orden de cargue: ${CRITERIOS.find((c) => c.id === plan.criterio)?.label.toLowerCase() ?? 'a mano'}.`,
    ].filter(Boolean).join(' ');
    const res = await conteo.cerrar(ajustar, extra);
    if (!res.practica && user?.id && !faltaMigracion) {
      try {
        await marcarCargado(id, {
          userId: user.id, plan: { ...plan, orden }, seguridad,
          paquetes: totales.paquetesCargados, unidades: res.resumen.totalCargado,
          pesoKg: pesoCargado > 0 ? Math.round(pesoCargado) : null,
        });
      } catch (e) { console.warn('[cargue] la remisión quedó despachada pero no se guardó el registro del cargue', e); }
      qc.invalidateQueries({ queryKey: ['remision-cargue', id] });
      qc.invalidateQueries({ queryKey: ['remision-cargues'] });
    }
    if (practica) conteo.descartarPractica(); else limpiarCargueReal(id);
    onHecho(res);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-3">
      <ErrorFrame flash={conteo.flash} />
      <Encabezado
        numero={rem.number}
        cliente={rem.beneficiary}
        onSalir={salir}
        derecha={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {conteo.operadores > 1 && <span className="h-9 px-3 rounded-full border border-border bg-background text-sm font-semibold inline-flex items-center">{conteo.operadores} cargando</span>}
            {paso === 'plan' && guardado && !practica && (
              <span className="text-xs font-semibold text-muted-foreground">
                {guardado === 'guardando' ? 'Guardando plan…' : guardado === 'ok' ? 'Plan guardado' : guardado === 'local' ? 'Plan guardado en este equipo' : 'No se pudo guardar el plan'}
              </span>
            )}
            <SyncChip online={conteo.online} pendientes={conteo.pendientes} syncing={conteo.syncing} practica={practica} onSync={() => { void conteo.syncNow(); }} />
          </div>
        }
      />

      {practica && (
        <div className={`rounded-2xl border border-warning/50 ${TINT.warning} px-4 py-2.5 text-sm font-semibold text-warning flex items-center gap-2`}>
          <GraduationCap className="h-5 w-5 flex-shrink-0" />
          <span className="flex-1">Práctica: esta remisión ya salió. Planeá, contá y tomá fotos como si fuera de verdad; no toca la remisión. Si salís, al volver sigue donde quedó.</span>
          <button type="button" onClick={tap(terminarPractica)} className="h-10 px-3 rounded-xl border border-warning/60 bg-card text-sm font-semibold text-warning whitespace-nowrap active:scale-95">
            Terminar práctica
          </button>
        </div>
      )}
      {faltaMigracion && !practica && (
        <div className={`rounded-2xl border border-warning/50 ${TINT.warning} px-4 py-2.5 text-sm font-semibold text-warning`}>
          Falta aplicar la actualización de la base para el cargue: el plan se guarda solo en este equipo y las fotos no se guardan todavía.
        </div>
      )}
      {rem.notes?.trim() && <NotaOficina texto={rem.notes.trim()} />}

      <nav className="grid grid-cols-3 gap-2" aria-label="Pasos del cargue">
        {PASOS.map(({ id: p, label, Icon }, i) => (
          <button
            key={p}
            type="button"
            onClick={tap(() => setPaso(p))}
            aria-current={paso === p ? 'step' : undefined}
            className={`h-12 rounded-2xl border font-bold inline-flex items-center justify-center gap-2 active:scale-[0.98] ${
              paso === p ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border'
            }`}
          >
            <span className="tabular-nums">{i + 1}</span><Icon className="hidden lg:block h-5 w-5" /><span className="text-sm md:text-base whitespace-nowrap">{label}</span>
          </button>
        ))}
      </nav>

      {paso === 'plan' && (
        <PlanStep
          lines={orden.map((k) => datos.lines.find((l) => l.key === k)).filter((l): l is NonNullable<typeof l> => !!l)}
          empaques={empaques}
          ubicaciones={datos.ubicaciones}
          totales={totales}
          plan={plan}
          orden={orden}
          onChange={setPlan}
          readOnly={false}
          onEmpezar={() => setPaso('cargar')}
          onGuardarReferencia={onGuardarReferencia}
        />
      )}
      {paso === 'cargar' && (
        <ConteoStep api={conteo} empaques={empaques} ubicaciones={datos.ubicaciones} onCerrar={() => setPaso('cerrar')} bloqueado={false} />
      )}
      {paso === 'cerrar' && (
        <CierreStep
          remisionId={id}
          numero={rem.number}
          api={conteo}
          totales={totales}
          practica={practica}
          seguridad={seguridad}
          onSeguridad={setSeguridad}
          onDespachar={despachar}
        />
      )}
    </div>
  );
}

function Encabezado({ numero, cliente, onSalir, derecha }: { numero: string; cliente: string | null; onSalir: () => void; derecha: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 flex-wrap rounded-3xl border border-border bg-card p-3">
      <button type="button" onClick={tap(onSalir)} className="h-12 px-4 rounded-2xl border border-border bg-background font-semibold inline-flex items-center gap-1.5 active:scale-95">
        <ArrowLeft className="h-5 w-5" /> Remisiones
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-muted-foreground">Cargue de la remisión</div>
        <h1 className="text-xl md:text-2xl font-bold leading-tight truncate">{numero} · {cliente || 'Sin cliente'}</h1>
      </div>
      {derecha}
    </div>
  );
}

function NotaOficina({ texto }: { texto: string }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <button type="button" onClick={tap(() => setAbierta((v) => !v))} aria-expanded={abierta} className="w-full text-left rounded-2xl border border-border bg-card px-4 py-2.5 text-sm">
      <span className={`whitespace-pre-line ${abierta ? '' : 'line-clamp-2'}`}><span className="font-semibold">Nota de la oficina: </span>{texto}</span>
    </button>
  );
}

function CargueHecho({ res, company, onExit }: { res: CierreResultado & { practica: boolean }; company: Company | undefined; onExit: () => void }) {
  const imprimir = () => {
    const win = window.open('', '_blank', 'width=820,height=1040');
    if (!win) return;
    printRemisionToWindow(win, {
      company: { name: company?.company_name, nit: company?.company_nit, address: company?.company_address, city: company?.company_city },
      number: res.number, date: res.date, beneficiary: res.beneficiary, items: res.items,
    });
  };
  const r = res.resumen;
  return (
    <div className="max-w-xl mx-auto my-6 rounded-3xl border border-border bg-card p-6 md:p-8 space-y-5 text-center">
      <div className={`mx-auto h-20 w-20 rounded-full flex items-center justify-center ${res.practica ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'}`}>
        {res.practica ? <GraduationCap className="h-10 w-10" /> : <CheckCircle2 className="h-10 w-10" />}
      </div>
      <div>
        <h1 className="text-2xl font-bold">{res.practica ? 'Práctica terminada' : `${res.number} despachada`}</h1>
        <p className="text-base text-muted-foreground mt-1">{res.beneficiary} · {fmt(r.totalCargado)} de {fmt(r.totalPedido)} unidades</p>
      </div>
      <div className="rounded-2xl border border-border bg-background p-4 text-left text-sm space-y-2">
        {res.practica && <p className="font-semibold text-warning">No se guardó nada. Si fuera de verdad, esto habría pasado:</p>}
        <p>• La remisión {res.number} {res.practica ? 'quedaría' : 'quedó'} en <strong>Despachado</strong>, con el plan, los paquetes, las fotos y la lista de seguridad.</p>
        {r.cuadra
          ? <p>• Todo cuadró con el pedido.</p>
          : res.ajustada
            ? <p>• La remisión {res.practica ? 'se ajustaría' : 'se ajustó'} a lo cargado y el inventario {res.practica ? 'se recalcularía' : 'se recalculó'}.
                {r.faltantes.length > 0 && <> Faltó: {r.faltantes.map((f) => `${f.reference} ×${f.diferencia}`).join(', ')}.</>}
                {r.sobrantes.length > 0 && <> Sobró: {r.sobrantes.map((s) => `${s.reference} ×${s.diferencia}`).join(', ')}.</>}
              </p>
            : null}
        {!res.inventarioOk && <p className="text-destructive font-medium">• El inventario no se pudo recalcular ahora. Abrí Inventario → Por variante y se cuadra solo al cargar.</p>}
        {!res.practica && <p>• Si hay un reclamo, buscalo en Remisiones → «Buscar cargue».</p>}
      </div>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        {!res.practica && (
          <button type="button" onClick={imprimir} className="h-14 px-6 rounded-2xl border border-border bg-background text-base font-semibold inline-flex items-center justify-center gap-2 active:scale-95">
            <Printer className="h-5 w-5" /> Imprimir remisión
          </button>
        )}
        <button type="button" onClick={onExit} className="h-14 px-6 rounded-2xl bg-primary text-primary-foreground text-base font-bold inline-flex items-center justify-center gap-2 active:scale-95">
          Volver a remisiones
        </button>
      </div>
    </div>
  );
}
