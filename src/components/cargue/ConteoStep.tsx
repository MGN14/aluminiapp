import { useState } from 'react';
import { estadoLinea, type CargueLine } from '@/lib/despachoCargue';
import { paquetesDe, siguientePaquete, type EmpaqueRef } from '@/lib/cargueEmpaque';
import type { CargueConteoApi } from './useCargue';
import NumPad from './NumPad';
import { FlashBanner, TINT, fmt, tap } from './CargueUI';
import {
  AlertTriangle, ArrowRight, Ban, CheckCircle2, Circle, CircleDot, Keyboard, MapPin, Minus, PackagePlus, Undo2, PackageOpen,
} from 'lucide-react';

interface Props {
  api: CargueConteoApi;
  empaques: Record<string, EmpaqueRef>;
  ubicaciones: Record<string, string[]>;
  onCerrar: () => void;
  bloqueado: boolean;
}

export default function ConteoStep({ api, empaques, ubicaciones, onCerrar, bloqueado }: Props) {
  const [numpad, setNumpad] = useState<null | { key: string; modo: 'especial' | 'paquetes' }>(null);
  const lineaNum = numpad ? api.ordenadas.find((l) => l.key === numpad.key) ?? null : null;
  const totalPaqPlan = api.ordenadas.reduce((s, l) => s + paquetesDe(l.pedido, empaques[l.key]?.porPaquete ?? null).total, 0);
  const totalPaq = api.ordenadas.reduce((s, l) => s + (api.paquetes[l.key]?.paquetes ?? 0), 0);

  return (
    <>
      {/* Mercancía que no va en el pedido: queda a la vista hasta que la saquen */}
      {api.fuera.length > 0 && (
        <div className={`rounded-2xl border-2 border-destructive ${TINT.destructive} p-3 space-y-2 mb-3`} role="alert">
          <div className="flex items-center gap-2 font-bold text-destructive text-base">
            <Ban className="h-5 w-5" /> Esto NO va en este pedido: sacalo del camión
          </div>
          {api.fuera.map((f) => (
            <div key={f.id} className="flex items-center gap-3">
              <span className="flex-1 font-semibold text-destructive">{f.reference} · paquete de {fmt(f.quantity)}</span>
              <button type="button" onClick={tap(() => api.resolverFuera(f.id))} className="h-11 px-4 rounded-xl border border-destructive/50 bg-card text-sm font-semibold text-destructive active:scale-95">
                Lo saqué
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start">
        <ol className="space-y-2 min-w-0">
          {api.ordenadas.map((l, i) => (
            <Fila
              key={l.key}
              n={i + 1}
              line={l}
              empaque={empaques[l.key]}
              unidades={api.cargado[l.key] ?? 0}
              paquetes={api.paquetes[l.key]?.paquetes ?? 0}
              ubicaciones={ubicaciones[l.key] ?? []}
              active={l.key === api.activeKey}
              onSelect={tap(() => api.setActive(l.key))}
            />
          ))}
        </ol>

        {/* Contador grande (horizontal) */}
        <div className="hidden lg:block lg:sticky lg:top-4">
          <div className="rounded-3xl border border-border bg-card p-4 space-y-3">
            <FlashBanner flash={api.flash} hideIdle />
            {api.activeLine && !bloqueado && (
              <Contador api={api} line={api.activeLine} empaque={empaques[api.activeLine.key]} n={api.ordenadas.findIndex((x) => x.key === api.activeKey) + 1} total={api.ordenadas.length}
                onEspecial={() => setNumpad({ key: api.activeLine!.key, modo: 'especial' })}
                onEscribir={() => setNumpad({ key: api.activeLine!.key, modo: 'paquetes' })} />
            )}
          </div>
        </div>
      </div>

      {/* Barra inferior: contador compacto (vertical) + acciones */}
      <div className="sticky bottom-3 z-20 mt-3 rounded-3xl border border-border bg-card/95 backdrop-blur p-3 space-y-3 shadow-lg">
        <div className="lg:hidden space-y-3">
          <FlashBanner flash={api.flash} hideIdle />
          {api.activeLine && !bloqueado && (
            <Contador compact api={api} line={api.activeLine} empaque={empaques[api.activeLine.key]} n={api.ordenadas.findIndex((x) => x.key === api.activeKey) + 1} total={api.ordenadas.length}
              onEspecial={() => setNumpad({ key: api.activeLine!.key, modo: 'especial' })}
              onEscribir={() => setNumpad({ key: api.activeLine!.key, modo: 'paquetes' })} />
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={tap(api.deshacer)}
            disabled={!api.puedeDeshacer || bloqueado}
            className="h-12 px-4 rounded-2xl border border-border bg-background font-semibold inline-flex items-center gap-1.5 active:scale-95 disabled:opacity-40"
          >
            <Undo2 className="h-5 w-5" /> Deshacer
          </button>
          <div className="flex-1 min-w-0 text-sm tabular-nums">
            <span className="font-bold text-base">{fmt(totalPaq)}</span>
            <span className="text-muted-foreground"> de {fmt(totalPaqPlan)} paq · {fmt(api.resumen.totalCargado)} de {fmt(api.resumen.totalPedido)} und</span>
            <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full transition-all ${api.resumen.sobrantes.length ? 'bg-destructive' : 'bg-success'}`}
                style={{ width: `${api.resumen.totalPedido ? Math.min(100, (api.resumen.totalCargado / api.resumen.totalPedido) * 100) : 0}%` }}
              />
            </div>
          </div>
          <button type="button" onClick={tap(onCerrar)} className="h-12 px-5 rounded-2xl bg-primary text-primary-foreground font-bold inline-flex items-center gap-2 active:scale-95">
            Fotos y cierre <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      <NumPad
        open={!!lineaNum}
        title={lineaNum
          ? numpad?.modo === 'especial' ? `Paquete especial de ${lineaNum.reference}: ¿cuántas piezas trae?` : `¿Cuántos paquetes de ${lineaNum.reference} van?`
          : ''}
        description={lineaNum
          ? numpad?.modo === 'especial'
            ? `La medida normal es ${empaques[lineaNum.key]?.porPaquete ?? '—'}. Usalo para el paquete que viene distinto.`
            : `Llevás ${fmt(api.paquetes[lineaNum.key]?.paquetes ?? 0)}. Escribí el TOTAL de paquetes cargados de la medida normal.`
          : undefined}
        initial={lineaNum ? (numpad?.modo === 'especial' ? 0 : api.paquetes[lineaNum.key]?.paquetes ?? 0) : 0}
        onClose={() => setNumpad(null)}
        onSubmit={(v) => {
          if (lineaNum && numpad) {
            if (numpad.modo === 'especial') { if (v > 0) api.agregarPaquete(lineaNum.key, v); }
            else api.fijarPaquetes(lineaNum.key, v);
          }
          setNumpad(null);
        }}
      />
    </>
  );
}

function Fila({ n, line, empaque, unidades, paquetes, ubicaciones, active, onSelect }: {
  n: number; line: CargueLine; empaque: EmpaqueRef | undefined; unidades: number; paquetes: number;
  ubicaciones: string[]; active: boolean; onSelect: () => void;
}) {
  const plan = paquetesDe(line.pedido, empaque?.porPaquete ?? null);
  const estado = estadoLinea(line.pedido, unidades);
  const tono = estado === 'completo' ? `border-success/40 ${TINT.success}` : estado === 'sobrante' ? `border-destructive/50 ${TINT.destructive}` : 'border-border bg-card';
  const Icon = estado === 'completo' ? CheckCircle2 : estado === 'sobrante' ? AlertTriangle : estado === 'parcial' ? CircleDot : Circle;
  const color = estado === 'completo' ? 'text-success' : estado === 'sobrante' ? 'text-destructive' : 'text-foreground';
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className={`w-full text-left rounded-2xl border px-3 py-3 transition-colors active:scale-[0.99] ${tono} ${active ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
      >
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-muted flex items-center justify-center text-base font-extrabold tabular-nums flex-shrink-0">{n}</div>
          <Icon className={`h-6 w-6 flex-shrink-0 ${estado === 'pendiente' ? 'text-muted-foreground' : color}`} />
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold leading-tight truncate">{line.reference}</div>
            <div className="text-sm text-muted-foreground truncate">{line.name || 'Sin descripción'}</div>
            <div className="mt-0.5 flex items-center gap-2 flex-wrap text-xs tabular-nums">
              <span className="text-muted-foreground">{fmt(unidades)} de {fmt(line.pedido)} und{empaque?.porPaquete ? ` · paq de ${empaque.porPaquete}` : ''}</span>
              {ubicaciones.map((u) => (
                <span key={u} className="font-semibold rounded-md border border-border bg-background px-1.5 py-0.5 inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" />{u}</span>
              ))}
              {estado === 'sobrante' && <span className="font-bold text-destructive">· sobran {fmt(unidades - line.pedido)} und</span>}
            </div>
          </div>
          <div className={`text-2xl font-extrabold tabular-nums leading-none whitespace-nowrap ${color}`}>
            {fmt(paquetes)}<span className="text-base font-bold text-muted-foreground">/{fmt(plan.total)}</span>
            <div className="text-xs font-semibold text-muted-foreground text-right mt-0.5">paq</div>
          </div>
        </div>
      </button>
    </li>
  );
}

function Contador({ api, line, empaque, n, total, compact = false, onEspecial, onEscribir }: {
  api: CargueConteoApi; line: CargueLine; empaque: EmpaqueRef | undefined; n: number; total: number;
  compact?: boolean; onEspecial: () => void; onEscribir: () => void;
}) {
  const unidades = api.cargado[line.key] ?? 0;
  const paq = api.paquetes[line.key]?.paquetes ?? 0;
  const plan = paquetesDe(line.pedido, empaque?.porPaquete ?? null);
  const siguiente = siguientePaquete(line.pedido, unidades, empaque?.porPaquete ?? null);
  const esUltimoIncompleto = !!empaque?.porPaquete && siguiente !== empaque.porPaquete;
  const estado = estadoLinea(line.pedido, unidades);
  const color = estado === 'completo' ? 'text-success' : estado === 'sobrante' ? 'text-destructive' : 'text-foreground';
  const btn = 'rounded-2xl border border-border bg-background font-bold inline-flex items-center justify-center gap-1.5 active:scale-95 active:bg-muted transition-transform select-none';
  const textoMas = esUltimoIncompleto ? `+ Último paquete (${fmt(siguiente)})` : `+ 1 paquete (${fmt(siguiente)})`;

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">#{n} de {total}</div>
            <div className="text-base font-bold truncate">{line.reference}</div>
          </div>
          <div className={`text-3xl font-extrabold tabular-nums leading-none ${color}`}>
            {fmt(paq)}<span className="text-lg text-muted-foreground"> / {fmt(plan.total)} paq</span>
          </div>
        </div>
        <div className="grid grid-cols-[64px_minmax(0,1fr)_auto_auto] gap-2">
          <button type="button" aria-label="Quitar el último paquete" onClick={tap(() => api.quitarPaquete(line.key))} className={`${btn} h-16`}><Minus className="h-7 w-7" /></button>
          <button type="button" onClick={tap(() => api.agregarPaquete(line.key))} className="h-16 rounded-2xl bg-primary text-primary-foreground text-base font-bold inline-flex items-center justify-center gap-1.5 active:scale-95 select-none px-2">
            <PackagePlus className="h-6 w-6 flex-shrink-0" /><span className="truncate">{textoMas}</span>
          </button>
          <button type="button" onClick={tap(onEspecial)} className={`${btn} h-16 px-3 text-sm flex-col gap-0`}><PackageOpen className="h-5 w-5" /><span>Especial</span></button>
          <button type="button" onClick={tap(onEscribir)} className={`${btn} h-16 px-3 text-sm flex-col gap-0`}><Keyboard className="h-5 w-5" /><span>Escribir</span></button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-center">
        <div className="text-xs font-semibold text-muted-foreground">#{n} de {total} en el plan</div>
        <div className="text-base font-bold">{line.reference}</div>
        <div className="text-sm text-muted-foreground truncate">{line.name || 'Sin descripción'}</div>
        <div className={`mt-1 text-5xl font-extrabold tabular-nums leading-none ${color}`}>
          {fmt(paq)}<span className="text-2xl text-muted-foreground"> / {fmt(plan.total)}</span>
        </div>
        <div className="text-sm font-semibold text-muted-foreground mt-1 tabular-nums">
          paquetes · {fmt(unidades)} de {fmt(line.pedido)} und{empaque?.porPaquete ? ` · de a ${empaque.porPaquete}` : ''}
        </div>
      </div>
      <button type="button" onClick={tap(() => api.agregarPaquete(line.key))} className="w-full h-16 rounded-2xl bg-primary text-primary-foreground text-xl font-extrabold inline-flex items-center justify-center gap-2 active:scale-[0.98] select-none">
        <PackagePlus className="h-7 w-7" /> {textoMas}
      </button>
      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={tap(() => api.quitarPaquete(line.key))} className={`${btn} h-12 text-sm gap-1`}><Minus className="h-4 w-4" /><span>Quitar</span></button>
        <button type="button" onClick={tap(onEspecial)} className={`${btn} h-12 text-sm gap-1`}><PackageOpen className="h-4 w-4" /><span>Especial</span></button>
        <button type="button" onClick={tap(onEscribir)} className={`${btn} h-12 text-sm gap-1`}><Keyboard className="h-4 w-4" /><span>Escribir</span></button>
      </div>
    </div>
  );
}
