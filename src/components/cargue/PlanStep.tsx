import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { CargueLine } from '@/lib/despachoCargue';
import {
  CRITERIOS, paquetesDe, textoPaquetes, pesoLinea, moverEnOrden,
  type EmpaqueRef, type TotalesCargue,
} from '@/lib/cargueEmpaque';
import type { PlanCargue } from '@/lib/cargueStore';
import NumPad from './NumPad';
import { TINT, fmt, fmtKg, tap } from './CargueUI';
import { ArrowDown, ArrowUp, ArrowRight, MapPin, Package, Scale, ShieldCheck, Truck, AlertTriangle, Pencil } from 'lucide-react';

interface Props {
  lines: CargueLine[];            // ya en orden de cargue
  empaques: Record<string, EmpaqueRef>;
  ubicaciones: Record<string, string[]>;
  totales: TotalesCargue;
  plan: PlanCargue;
  orden: string[];
  onChange: (p: PlanCargue) => void;
  readOnly: boolean;
  onEmpezar: () => void;
}

const FUENTE: Record<EmpaqueRef['fuente'], string> = {
  plan: 'ajustado a mano',
  contenedor: 'del packing list',
  'contenedor-familia': 'del packing list (otro color)',
  maestro: 'del maestro',
  'sin-dato': 'sin dato',
};

export default function PlanStep({ lines, empaques, ubicaciones, totales, plan, orden, onChange, readOnly, onEmpezar }: Props) {
  const [editEmpaque, setEditEmpaque] = useState<string | null>(null);
  const [editCapacidad, setEditCapacidad] = useState(false);
  const lineaEdit = editEmpaque ? lines.find((l) => l.key === editEmpaque) ?? null : null;
  const excede = !!plan.capacidad_kg && totales.pesoKg > plan.capacidad_kg;

  const mover = (key: string, delta: number) => onChange({ ...plan, criterio: 'manual', orden: moverEnOrden(orden, key, delta) });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] items-start">
      {/* Orden de cargue */}
      <div className="space-y-3 min-w-0">
        <div className="rounded-3xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            <h2 className="text-lg font-bold">¿En qué orden se carga?</h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {CRITERIOS.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={readOnly}
                onClick={tap(() => onChange({ ...plan, criterio: c.id, orden: [] }))}
                aria-pressed={plan.criterio === c.id}
                className={`text-left rounded-2xl border px-3 py-2.5 min-h-[64px] active:scale-[0.99] disabled:opacity-60 ${
                  plan.criterio === c.id ? 'border-primary ring-2 ring-primary bg-background' : 'border-border bg-background'
                }`}
              >
                <div className="text-sm font-bold">{c.label}</div>
                <div className="text-xs text-muted-foreground">{c.ayuda}</div>
              </button>
            ))}
          </div>
          {plan.criterio === 'manual' && (
            <p className="text-xs font-semibold text-muted-foreground">Orden a mano (lo moviste con las flechas). Tocá un criterio para volver a ordenarlo solo.</p>
          )}
          {plan.criterio === 'peso' && totales.refsSinPeso > 0 && (
            <p className="text-xs font-semibold text-warning">{totales.refsSinPeso} referencia{totales.refsSinPeso === 1 ? '' : 's'} sin peso conocido van al final: acomodalas con las flechas si son pesadas.</p>
          )}
        </div>

        <ol className="space-y-2">
          {lines.map((l, i) => {
            const e = empaques[l.key];
            const paq = paquetesDe(l.pedido, e?.porPaquete ?? null);
            const peso = pesoLinea(l.pedido, e?.kgPorUnidad ?? null);
            const ubic = ubicaciones[l.key] ?? [];
            return (
              <li key={l.key} className="rounded-2xl border border-border bg-card px-3 py-3 flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center text-lg font-extrabold tabular-nums flex-shrink-0" title="Orden de cargue">
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-base font-bold leading-tight truncate">{l.reference}</div>
                  <div className="text-sm text-muted-foreground truncate">{l.name || 'Sin descripción'}</div>
                  <div className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap text-xs tabular-nums">
                    <span className="font-semibold">{fmt(l.pedido)} und</span>
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={tap(() => setEditEmpaque(l.key))}
                      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-semibold ${e?.porPaquete ? 'border-border' : 'border-warning/60 text-warning'}`}
                      title={`Medida de paquete ${FUENTE[e?.fuente ?? 'sin-dato']}`}
                    >
                      <Package className="h-3 w-3" />
                      {e?.porPaquete ? textoPaquetes(paq, e.porPaquete) : 'Poner medida de paquete'}
                      {!readOnly && <Pencil className="h-3 w-3 opacity-60" />}
                    </button>
                    <span className="inline-flex items-center gap-0.5 text-muted-foreground"><Scale className="h-3 w-3" />{peso != null ? `≈ ${fmtKg(peso)}` : 'sin peso'}</span>
                    {ubic.length > 0 && <span className="inline-flex items-center gap-0.5 text-muted-foreground"><MapPin className="h-3 w-3" />{ubic.join(', ')}</span>}
                  </div>
                </div>
                {!readOnly && (
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    <button type="button" aria-label="Cargar antes" disabled={i === 0} onClick={tap(() => mover(l.key, -1))} className="h-10 w-12 rounded-xl border border-border bg-background flex items-center justify-center active:scale-95 disabled:opacity-30"><ArrowUp className="h-5 w-5" /></button>
                    <button type="button" aria-label="Cargar después" disabled={i === lines.length - 1} onClick={tap(() => mover(l.key, 1))} className="h-10 w-12 rounded-xl border border-border bg-background flex items-center justify-center active:scale-95 disabled:opacity-30"><ArrowDown className="h-5 w-5" /></button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Totales, vehículo y seguridad */}
      <div className="space-y-3 lg:sticky lg:top-4">
        <div className="rounded-3xl border border-border bg-card p-4 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Dato label="Paquetes" value={fmt(totales.paquetesPlan)} />
            <Dato label="Unidades" value={fmt(lines.reduce((s, l) => s + l.pedido, 0))} />
            <Dato label="Peso aprox." value={totales.pesoKg > 0 ? fmtKg(totales.pesoKg) : '—'} />
          </div>
          {totales.refsSinEmpaque > 0 && (
            <p className="text-xs font-semibold text-warning">{totales.refsSinEmpaque} referencia{totales.refsSinEmpaque === 1 ? '' : 's'} sin medida de paquete: se cuentan como un paquete con todo. Tocá «Poner medida».</p>
          )}
          {totales.refsSinPeso > 0 && totales.pesoKg > 0 && (
            <p className="text-xs text-muted-foreground">El peso no incluye {totales.refsSinPeso} referencia{totales.refsSinPeso === 1 ? '' : 's'} sin dato en los packing lists.</p>
          )}
        </div>

        <div className="rounded-3xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2 font-bold"><Truck className="h-5 w-5" /> Vehículo</div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Placa</span>
              <Input value={plan.vehiculo ?? ''} disabled={readOnly} placeholder="TKM 123" onChange={(e) => onChange({ ...plan, vehiculo: e.target.value.toUpperCase() })} className="h-11 text-base uppercase" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Conductor</span>
              <Input value={plan.conductor ?? ''} disabled={readOnly} placeholder="Nombre" onChange={(e) => onChange({ ...plan, conductor: e.target.value })} className="h-11 text-base" />
            </label>
          </div>
          <button
            type="button"
            disabled={readOnly}
            onClick={tap(() => setEditCapacidad(true))}
            className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm font-semibold flex items-center justify-between disabled:opacity-60"
          >
            <span className="text-muted-foreground">Capacidad del vehículo</span>
            <span className="tabular-nums">{plan.capacidad_kg ? fmtKg(plan.capacidad_kg) : 'Poner kg'}</span>
          </button>
          {excede && (
            <div className={`rounded-xl border border-destructive/60 ${TINT.destructive} px-3 py-2 text-sm font-semibold text-destructive flex gap-2`}>
              <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              La carga (≈ {fmtKg(totales.pesoKg)}) pasa la capacidad del vehículo ({fmtKg(plan.capacidad_kg!)}). Partila en dos viajes.
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-border bg-card p-4 text-sm space-y-1.5">
          <div className="flex items-center gap-2 font-bold"><ShieldCheck className="h-5 w-5" /> Seguridad</div>
          <p className="text-muted-foreground">El número 1 sube primero. Lo más pesado y largo va abajo y adelante, lo liviano arriba, y todo amarrado. Al cerrar se confirma con una lista y una foto del camión.</p>
        </div>

        {!readOnly && (
          <button type="button" onClick={tap(onEmpezar)} className="w-full h-14 rounded-2xl bg-primary text-primary-foreground text-lg font-bold inline-flex items-center justify-center gap-2 active:scale-[0.98]">
            Empezar a cargar <ArrowRight className="h-5 w-5" />
          </button>
        )}
      </div>

      <NumPad
        open={!!lineaEdit}
        title={lineaEdit ? `¿Cuántas piezas trae un paquete de ${lineaEdit.reference}?` : ''}
        description={lineaEdit
          ? `${empaques[lineaEdit.key]?.porPaquete ? `Hoy dice ${empaques[lineaEdit.key]!.porPaquete} (${FUENTE[empaques[lineaEdit.key]!.fuente]}). ` : ''}Es la medida estándar; el último paquete puede venir incompleto.`
          : undefined}
        initial={lineaEdit ? empaques[lineaEdit.key]?.porPaquete ?? 0 : 0}
        onClose={() => setEditEmpaque(null)}
        onSubmit={(v) => {
          if (lineaEdit) {
            const empaquesPlan = { ...plan.empaques };
            if (v > 0) empaquesPlan[lineaEdit.key] = v; else delete empaquesPlan[lineaEdit.key];
            onChange({ ...plan, empaques: empaquesPlan });
          }
          setEditEmpaque(null);
        }}
      />
      <NumPad
        open={editCapacidad}
        title="Capacidad del vehículo (kg)"
        description="Lo que puede llevar el camión. La app avisa si la carga la pasa."
        initial={plan.capacidad_kg ?? 0}
        onClose={() => setEditCapacidad(false)}
        onSubmit={(v) => { onChange({ ...plan, capacidad_kg: v > 0 ? v : null }); setEditCapacidad(false); }}
      />
    </div>
  );
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
    </div>
  );
}
