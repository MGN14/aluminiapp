import { useEffect, useState } from 'react';
import { useSidebar } from '@/components/ui/sidebar';
import { useScannerGun } from '@/hooks/useScannerGun';
import { estadoLinea, type CargueLine } from '@/lib/despachoCargue';
import { printRemisionToWindow } from '@/lib/printRemision';
import type { CierreResultado } from '@/lib/despachoCierre';
import { useCargue, type CargueApi, type Flash } from './useCargue';
import { useWakeLock } from './useWakeLock';
import NumPad from './NumPad';
import CierreDialog from './CierreDialog';
import {
  ArrowLeft, Check, CheckCircle2, Circle, CircleDot, AlertTriangle, Minus, Plus, Undo2, MapPin,
  Loader2, CloudOff, CloudUpload, Cloud, Users, ScanLine, Keyboard, Ban, GraduationCap,
  Printer, StickyNote, PackageCheck,
} from 'lucide-react';

export interface CompanyInfo {
  company_name?: string | null; company_nit?: string | null; company_address?: string | null; company_city?: string | null;
}

interface Props {
  remisionId: string;
  practica: boolean;
  company: CompanyInfo | null | undefined;
  onExit: () => void;
}

const fmt = (n: number) => n.toLocaleString('es-CO');

// Tinte = color de fondo de tarjeta + capa translúcida encima (background-image).
// Así el aviso se lee igual en claro y en oscuro, sea cual sea el fondo de la página.
const TINT = {
  success: 'bg-card bg-gradient-to-r from-success/10 to-success/10',
  warning: 'bg-card bg-gradient-to-r from-warning/10 to-warning/10',
  destructive: 'bg-card bg-gradient-to-r from-destructive/10 to-destructive/10',
} as const;

/** Quita el foco del botón tocado: si no, el Enter de la pistola lo "presionaría". */
function tap(fn: () => void) {
  return () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    fn();
  };
}

export default function CargueScreen({ remisionId, practica, company, onExit }: Props) {
  const api = useCargue(remisionId, practica);
  const [numpadKey, setNumpadKey] = useState<string | null>(null);
  const [cierreOpen, setCierreOpen] = useState(false);
  const [hecho, setHecho] = useState<(CierreResultado & { practica: boolean }) | null>(null);
  const [notaAbierta, setNotaAbierta] = useState(false);

  useWakeLock(!hecho);
  useScannerGun({ onScan: api.handleScan, enabled: !numpadKey && !cierreOpen && !hecho });

  // Durante el cargue el menú lateral se encoge a íconos (sigue ahí, a un toque).
  const { open: sidebarOpen, setOpen: setSidebarOpen, isMobile } = useSidebar();
  useEffect(() => {
    if (isMobile || !sidebarOpen) return;
    setSidebarOpen(false);
    return () => setSidebarOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const salir = () => {
    if (practica) api.descartarPractica();
    onExit();
  };

  if (api.loading) {
    return <div className="flex items-center justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }
  if (!api.remision) {
    return (
      <div className="max-w-xl mx-auto my-10 rounded-3xl border border-border bg-card p-8 text-center space-y-4">
        <p className="text-lg font-semibold">No se encontró este pedido.</p>
        <button type="button" onClick={salir} className="h-12 px-5 rounded-2xl border border-border bg-card font-semibold">Volver a pedidos</button>
      </div>
    );
  }

  if (hecho) return <CargueHecho res={hecho} company={company} onExit={salir} />;

  const rem = api.remision;
  const yaCerrada = !practica && rem.status !== 'pendiente';
  const numpadLine = numpadKey ? api.lines.find((l) => l.key === numpadKey) ?? null : null;

  return (
    <div className="max-w-6xl mx-auto space-y-3">
      <ErrorFrame flash={api.flash} />

      {/* En horizontal: dos columnas desde arriba; el contador queda fijo a la
          derecha y siempre a la vista. En vertical: una sola columna. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] items-start">
        <div className="space-y-3 min-w-0">
          {/* Encabezado */}
          <div className="flex items-center gap-3 flex-wrap rounded-3xl border border-border bg-card p-3">
            <button type="button" onClick={tap(salir)} className="h-12 px-4 rounded-2xl border border-border bg-background font-semibold inline-flex items-center gap-1.5 active:scale-95">
              <ArrowLeft className="h-5 w-5" /> Pedidos
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl md:text-2xl font-bold leading-tight truncate">{rem.number} · {rem.beneficiary || 'Sin cliente'}</h1>
              <p className="text-sm text-muted-foreground tabular-nums">
                {api.lines.length} referencia{api.lines.length === 1 ? '' : 's'} · {fmt(api.resumen.totalPedido)} unidades · ordenado por ubicación
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {api.operadores > 1 && (
                <span className="h-9 px-3 rounded-full border border-border bg-card text-sm font-semibold inline-flex items-center gap-1.5">
                  <Users className="h-4 w-4" /> {api.operadores} cargando
                </span>
              )}
              <SyncChip api={api} practica={practica} />
            </div>
          </div>

          {practica && (
            <div className={`rounded-2xl border border-warning/50 ${TINT.warning} px-4 py-2.5 text-sm font-semibold text-warning flex items-center gap-2`}>
              <GraduationCap className="h-5 w-5 flex-shrink-0" />
              Modo práctica: contá y escaneá como si fuera de verdad. No se guarda nada ni se toca la remisión.
            </div>
          )}
          {yaCerrada && (
            <div className={`rounded-2xl border border-destructive/50 ${TINT.destructive} px-4 py-2.5 text-sm font-semibold text-destructive`}>
              Este pedido ya está "{rem.status}": lo cerró otra persona o lo cambiaron en la oficina.
            </div>
          )}
          {rem.notes?.trim() && (
            <button
              type="button"
              onClick={tap(() => setNotaAbierta((v) => !v))}
              className="w-full text-left rounded-2xl border border-border bg-card px-4 py-2.5 text-sm flex gap-2"
              aria-expanded={notaAbierta}
            >
              <StickyNote className="h-4 w-4 flex-shrink-0 mt-0.5 text-muted-foreground" />
              {/* Dos líneas para no empujar la lista; tocá para leerla entera. */}
              <span className={`whitespace-pre-line ${notaAbierta ? '' : 'line-clamp-2'}`}>
                <span className="font-semibold">Nota de la oficina: </span>{rem.notes.trim()}
              </span>
            </button>
          )}

          {/* Mercancía que no va en el pedido: queda a la vista hasta que la saquen */}
          {api.fuera.length > 0 && (
            <div className={`rounded-2xl border-2 border-destructive ${TINT.destructive} p-3 space-y-2`} role="alert">
              <div className="flex items-center gap-2 font-bold text-destructive text-base">
                <Ban className="h-5 w-5" /> Esto NO va en este pedido: sacalo del camión
              </div>
              {api.fuera.map((f) => (
                <div key={f.id} className="flex items-center gap-3">
                  <span className="flex-1 font-semibold text-destructive">{f.reference} ×{f.quantity}</span>
                  <button type="button" onClick={tap(() => api.resolverFuera(f.id))} className="h-11 px-4 rounded-xl border border-destructive/50 bg-card text-sm font-semibold text-destructive active:scale-95">
                    La saqué
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Lista del pedido */}
          <div className="space-y-2">
            {api.orderedLines.map((l) => (
              <LineaRow
                key={l.key}
                line={l}
                cargado={api.cargado[l.key] ?? 0}
                ubicaciones={api.ubicaciones[l.key] ?? []}
                active={l.key === api.activeKey}
                onSelect={tap(() => api.setActive(l.key))}
              />
            ))}
            {api.lines.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-12 border border-dashed border-border rounded-2xl bg-card">
                Este pedido no tiene ítems. Pedile a la oficina que lo revise.
              </div>
            )}
          </div>
        </div>

        {/* Contador grande (horizontal) */}
        <div className="hidden lg:block lg:sticky lg:top-4">
          <div className="rounded-3xl border border-border bg-card p-4 space-y-3">
            <FlashBanner flash={api.flash} />
            {api.activeLine
              ? <Contador api={api} line={api.activeLine} onEscribir={() => setNumpadKey(api.activeLine!.key)} />
              : <p className="text-sm text-muted-foreground text-center py-8">Tocá una referencia para contarla.</p>}
          </div>
        </div>
      </div>

      {/* Barra inferior: contador compacto (vertical) + acciones */}
      <div className="sticky bottom-3 z-20 rounded-3xl border border-border bg-card/95 backdrop-blur p-3 space-y-3 shadow-lg">
        <div className="lg:hidden space-y-3">
          <FlashBanner flash={api.flash} hideIdle />
          {api.activeLine && <Contador api={api} line={api.activeLine} compact onEscribir={() => setNumpadKey(api.activeLine!.key)} />}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={tap(api.deshacer)}
            disabled={!api.puedeDeshacer}
            className="h-12 px-4 rounded-2xl border border-border bg-card font-semibold inline-flex items-center gap-1.5 active:scale-95 disabled:opacity-40"
          >
            <Undo2 className="h-5 w-5" /> Deshacer
          </button>
          <div className="flex-1 min-w-0 text-sm tabular-nums">
            <span className="font-bold text-base">{fmt(api.resumen.totalCargado)}</span>
            <span className="text-muted-foreground"> de {fmt(api.resumen.totalPedido)} und · </span>
            <span className="font-bold">{api.resumen.refsCompletas}</span>
            <span className="text-muted-foreground"> de {api.resumen.refsTotal} refs</span>
            <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full transition-all ${api.resumen.sobrantes.length ? 'bg-destructive' : 'bg-success'}`}
                style={{ width: `${api.resumen.totalPedido ? Math.min(100, (api.resumen.totalCargado / api.resumen.totalPedido) * 100) : 0}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={tap(() => setCierreOpen(true))}
            disabled={yaCerrada}
            className="h-12 px-5 rounded-2xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 active:scale-95 disabled:opacity-50"
          >
            <PackageCheck className="h-5 w-5" /> Cerrar cargue
          </button>
        </div>
      </div>

      <NumPad
        open={!!numpadLine}
        title={numpadLine ? `¿Cuántas cargaste de ${numpadLine.reference}?` : ''}
        description={numpadLine ? `El pedido dice ${fmt(numpadLine.pedido)} y llevás ${fmt(api.cargado[numpadLine.key] ?? 0)}. Escribí el total cargado, no lo que vas a sumar.` : undefined}
        initial={numpadLine ? api.cargado[numpadLine.key] ?? 0 : 0}
        onClose={() => setNumpadKey(null)}
        onSubmit={(v) => { if (numpadLine) api.fijar(numpadLine.key, v); setNumpadKey(null); }}
      />

      <CierreDialog
        open={cierreOpen}
        onClose={() => setCierreOpen(false)}
        numero={rem.number}
        resumen={api.resumen}
        fuera={api.fuera}
        onResolverFuera={api.resolverFuera}
        online={api.online}
        practica={practica}
        onConfirm={async (ajustar) => {
          const res = await api.cerrar(ajustar);
          setCierreOpen(false);
          setHecho(res);
        }}
      />
    </div>
  );
}

// ───────────────────────────── piezas ─────────────────────────────

function SyncChip({ api, practica }: { api: CargueApi; practica: boolean }) {
  const base = 'h-9 px-3 rounded-full border text-sm font-semibold inline-flex items-center gap-1.5';
  if (practica) return <span className={`${base} border-warning/50 bg-warning/10 text-warning`}><GraduationCap className="h-4 w-4" /> Práctica</span>;
  if (!api.online) {
    return (
      <span className={`${base} border-warning/50 bg-warning/10 text-warning`}>
        <CloudOff className="h-4 w-4" /> Sin señal{api.pendientes ? ` · ${api.pendientes} guardado${api.pendientes === 1 ? '' : 's'} en el iPad` : ''}
      </span>
    );
  }
  if (api.pendientes > 0) {
    return (
      <button type="button" onClick={tap(() => { api.syncNow(); })} className={`${base} border-border bg-card`}>
        <CloudUpload className={`h-4 w-4 ${api.syncing ? 'animate-pulse' : ''}`} /> Subiendo {api.pendientes}…
      </button>
    );
  }
  return <span className={`${base} border-success/40 bg-success/10 text-success`}><Cloud className="h-4 w-4" /> Todo guardado</span>;
}

function LineaRow({ line, cargado, ubicaciones, active, onSelect }: {
  line: CargueLine; cargado: number; ubicaciones: string[]; active: boolean; onSelect: () => void;
}) {
  const estado = estadoLinea(line.pedido, cargado);
  const pct = line.pedido > 0 ? Math.min(100, (cargado / line.pedido) * 100) : 0;
  const tono =
    estado === 'completo' ? `border-success/40 ${TINT.success}`
    : estado === 'sobrante' ? `border-destructive/50 ${TINT.destructive}`
    : 'border-border bg-card';
  const Icon = estado === 'completo' ? CheckCircle2 : estado === 'sobrante' ? AlertTriangle : estado === 'parcial' ? CircleDot : Circle;
  const iconColor = estado === 'completo' ? 'text-success' : estado === 'sobrante' ? 'text-destructive' : estado === 'parcial' ? 'text-foreground' : 'text-muted-foreground';
  const numColor = estado === 'completo' ? 'text-success' : estado === 'sobrante' ? 'text-destructive' : 'text-foreground';

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`w-full text-left rounded-2xl border px-4 py-3 transition-colors active:scale-[0.99] ${tono} ${active ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
    >
      <div className="flex items-center gap-3">
        <Icon className={`h-6 w-6 flex-shrink-0 ${iconColor}`} />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold leading-tight truncate">{line.reference}</div>
          <div className="text-sm text-muted-foreground truncate">{line.name || 'Sin descripción'}</div>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {ubicaciones.length > 0
              ? ubicaciones.map((u) => (
                <span key={u} className="text-xs font-semibold rounded-md border border-border bg-background px-1.5 py-0.5 inline-flex items-center gap-0.5">
                  <MapPin className="h-3 w-3" />{u}
                </span>
              ))
              : <span className="text-xs text-muted-foreground">Sin ubicación</span>}
            {estado === 'parcial' && <span className="text-xs font-semibold text-muted-foreground">· faltan {fmt(line.pedido - cargado)}</span>}
            {estado === 'sobrante' && <span className="text-xs font-bold text-destructive">· sobran {fmt(cargado - line.pedido)}</span>}
          </div>
        </div>
        <div className={`text-2xl font-extrabold tabular-nums leading-none whitespace-nowrap ${numColor}`}>
          {fmt(cargado)}<span className="text-base font-bold text-muted-foreground">/{fmt(line.pedido)}</span>
        </div>
      </div>
      {estado === 'parcial' && (
        <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-foreground/70" style={{ width: `${pct}%` }} /></div>
      )}
    </button>
  );
}

function Contador({ api, line, compact = false, onEscribir }: { api: CargueApi; line: CargueLine; compact?: boolean; onEscribir: () => void }) {
  const cargado = api.cargado[line.key] ?? 0;
  const estado = estadoLinea(line.pedido, cargado);
  const numColor = estado === 'completo' ? 'text-success' : estado === 'sobrante' ? 'text-destructive' : 'text-foreground';
  const estadoTxt =
    estado === 'completo' ? 'Completa'
    : estado === 'sobrante' ? `Sobran ${fmt(cargado - line.pedido)}`
    : `Faltan ${fmt(line.pedido - cargado)}`;
  const btn = 'rounded-2xl border border-border bg-background font-bold inline-flex items-center justify-center gap-1.5 active:scale-95 active:bg-muted transition-transform select-none';

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold truncate">{line.reference}</div>
          <div className={`text-3xl font-extrabold tabular-nums leading-none ${numColor}`}>
            {fmt(cargado)}<span className="text-lg text-muted-foreground"> / {fmt(line.pedido)}</span>
          </div>
          <div className={`text-xs font-semibold ${estado === 'sobrante' ? 'text-destructive' : estado === 'completo' ? 'text-success' : 'text-muted-foreground'}`}>{estadoTxt}</div>
        </div>
        <button type="button" aria-label="Restar uno" onClick={tap(() => api.sumar(line.key, -1))} className={`${btn} h-16 w-16 text-3xl`}><Minus className="h-7 w-7" /></button>
        <button type="button" aria-label="Sumar uno" onClick={tap(() => api.sumar(line.key, 1))} className={`${btn} h-16 w-16 text-3xl`}><Plus className="h-7 w-7" /></button>
        <button type="button" onClick={tap(() => api.completar(line.key))} className={`${btn} h-16 px-3 text-sm flex-col gap-0`}>
          <Check className="h-5 w-5" /><span>Completa</span>
        </button>
        <button type="button" onClick={tap(onEscribir)} className={`${btn} h-16 px-3 text-sm flex-col gap-0`}>
          <Keyboard className="h-5 w-5" /><span>Escribir</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="text-base font-bold">{line.reference}</div>
        <div className="text-sm text-muted-foreground truncate">{line.name || 'Sin descripción'}</div>
        <div className={`mt-2 text-5xl font-extrabold tabular-nums leading-none ${numColor}`}>
          {fmt(cargado)}<span className="text-2xl text-muted-foreground"> / {fmt(line.pedido)}</span>
        </div>
        <div className={`mt-1 text-sm font-semibold ${estado === 'sobrante' ? 'text-destructive' : estado === 'completo' ? 'text-success' : 'text-muted-foreground'}`}>{estadoTxt}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" aria-label="Restar uno" onClick={tap(() => api.sumar(line.key, -1))} className={`${btn} h-16`}><Minus className="h-8 w-8" /></button>
        <button type="button" aria-label="Sumar uno" onClick={tap(() => api.sumar(line.key, 1))} className={`${btn} h-16`}><Plus className="h-8 w-8" /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={tap(() => api.completar(line.key))} className={`${btn} h-12 text-base`}>
          <Check className="h-5 w-5" /> Completa ({fmt(line.pedido)})
        </button>
        <button type="button" onClick={tap(onEscribir)} className={`${btn} h-12 text-base`}>
          <Keyboard className="h-5 w-5" /> Escribir
        </button>
      </div>
      <p className="text-xs text-muted-foreground text-center inline-flex items-center justify-center gap-1.5 w-full">
        <ScanLine className="h-4 w-4" /> Con la pistola, cada etiqueta suma sola a su referencia.
      </p>
    </div>
  );
}

function FlashBanner({ flash, hideIdle = false }: { flash: Flash | null; hideIdle?: boolean }) {
  if (!flash) {
    // En vertical el espacio de abajo vale oro: sin aviso no se muestra nada.
    if (hideIdle) return null;
    return (
      <div className="rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
        <ScanLine className="h-5 w-5" /> Escaneá una etiqueta o tocá una referencia
      </div>
    );
  }
  const tone =
    flash.kind === 'ok' || flash.kind === 'done' ? 'border-success/50 bg-success/10 text-success'
    : flash.kind === 'warn' ? 'border-warning/50 bg-warning/10 text-warning'
    : 'border-destructive bg-destructive/15 text-destructive';
  const Icon = flash.kind === 'ok' ? Check : flash.kind === 'done' ? CheckCircle2 : flash.kind === 'warn' ? AlertTriangle : Ban;
  return (
    <div key={flash.at} className={`rounded-2xl border-2 px-4 py-3 flex items-start gap-3 ${tone}`} role="status" aria-live="assertive">
      <Icon className="h-6 w-6 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="text-base font-bold leading-tight">{flash.title}</div>
        {flash.detail && <div className="text-sm font-medium opacity-90">{flash.detail}</div>}
      </div>
    </div>
  );
}

/** Marco rojo en toda la pantalla un instante: el error se ve aunque no estés mirando el iPad de frente. */
function ErrorFrame({ flash }: { flash: Flash | null }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!flash || (flash.kind !== 'error' && flash.kind !== 'warn')) return;
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 1100);
    return () => window.clearTimeout(t);
  }, [flash]);
  if (!visible || !flash) return null;
  const color = flash.kind === 'error' ? 'border-destructive' : 'border-warning';
  return <div aria-hidden className={`pointer-events-none fixed inset-0 z-50 border-[14px] ${color} animate-pulse`} />;
}

function CargueHecho({ res, company, onExit }: { res: CierreResultado & { practica: boolean }; company: CompanyInfo | null | undefined; onExit: () => void }) {
  const imprimir = () => {
    const win = window.open('', '_blank', 'width=820,height=1040');
    if (!win) return;
    printRemisionToWindow(win, {
      company: { name: company?.company_name, nit: company?.company_nit, address: company?.company_address, city: company?.company_city },
      number: res.number,
      date: res.date,
      beneficiary: res.beneficiary,
      items: res.items,
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
        <p className="text-base text-muted-foreground mt-1">
          {res.beneficiary} · {fmt(r.totalCargado)} de {fmt(r.totalPedido)} unidades cargadas
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-background p-4 text-left text-sm space-y-2">
        {res.practica && <p className="font-semibold text-warning">No se guardó nada. Si fuera de verdad, esto habría pasado:</p>}
        <p>• La remisión {res.number} {res.practica ? 'quedaría' : 'quedó'} en <strong>Despachado</strong>, con quién la cargó y a qué hora.</p>
        {r.cuadra
          ? <p>• Todo cuadró con el pedido.</p>
          : res.ajustada
            ? <p>• La remisión {res.practica ? 'se ajustaría' : 'se ajustó'} a lo cargado y el inventario {res.practica ? 'se recalcularía' : 'se recalculó'}.
                {r.faltantes.length > 0 && <> Faltó: {r.faltantes.map((f) => `${f.reference} ×${f.diferencia}`).join(', ')}.</>}
                {r.sobrantes.length > 0 && <> Sobró: {r.sobrantes.map((s) => `${s.reference} ×${s.diferencia}`).join(', ')}.</>}
              </p>
            : null}
        {!res.inventarioOk && (
          <p className="text-destructive font-medium">• El inventario no se pudo recalcular ahora. Abrí Inventario → Por variante y se cuadra solo al cargar.</p>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        {!res.practica && (
          <button type="button" onClick={imprimir} className="h-14 px-6 rounded-2xl border border-border bg-background text-base font-semibold inline-flex items-center justify-center gap-2 active:scale-95">
            <Printer className="h-5 w-5" /> Imprimir remisión
          </button>
        )}
        <button type="button" onClick={onExit} className="h-14 px-6 rounded-2xl bg-primary text-primary-foreground text-base font-bold inline-flex items-center justify-center gap-2 active:scale-95">
          Volver a pedidos
        </button>
      </div>
    </div>
  );
}
