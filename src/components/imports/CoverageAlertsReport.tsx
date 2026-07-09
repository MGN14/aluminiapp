/**
 * Reporte COMPLETO de alertas de abastecimiento — vive en la pestaña
 * Cobertura (decisión de Nico: el banner de Pedidos dice solo cuándo montar /
 * días / cuándo llega; el detalle de alertas se lee acá).
 *
 * Tres niveles, del más grave al más leve:
 *   🔴 FALTANTE REAL — el agote final (con todo el pipeline) cae antes de que
 *      llegue un pedido montado hoy. Ni un contenedor nuevo lo salva:
 *      reposición local o sumarlo YA al próximo pedido.
 *   🟠 ALERTA — quiebra antes del pedido grupal pero un pedido lo alcanzaría.
 *      No es masa para disparar contenedor: reposición local o al próximo.
 *   🟡 HUECO CORTO — queda en 0 unos días hasta que nacionaliza lo que YA
 *      viene en camino. Se resuelve solo (o apurando la nacionalización).
 */

import { useState } from 'react';
import type { ReorderSuggestion, QuiebreProducto } from '@/lib/reorderSuggestion';
import { Card, CardContent } from '@/components/ui/card';
import { TriangleAlert, ChevronDown, ChevronRight, ShieldAlert, Clock3 } from 'lucide-react';
import { cn } from '@/lib/utils';

function fmtFecha(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function AlertSection({
  titulo, descripcion, refs, fecha, tone, icon: Icon, accion,
}: {
  titulo: string;
  descripcion: string;
  refs: QuiebreProducto[];
  fecha: (q: QuiebreProducto) => string | null;
  tone: 'rojo' | 'ambar' | 'suave';
  icon: typeof TriangleAlert;
  accion: string;
}) {
  const [open, setOpen] = useState(refs.length <= 8);
  if (!refs.length) return null;
  const color = tone === 'rojo' ? 'text-destructive' : tone === 'ambar' ? 'text-warning' : 'text-muted-foreground';
  const borde = tone === 'rojo' ? 'border-destructive/30 bg-destructive/[0.03]'
    : tone === 'ambar' ? 'border-warning/30 bg-warning/[0.04]'
    : 'border-border bg-muted/20';
  return (
    <div className={cn('rounded-lg border px-4 py-3', borde)}>
      <button type="button" className="w-full flex items-start gap-2 text-left" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />}
        <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', color)} />
        <span className="text-sm">
          <strong className={color}>{titulo}</strong>
          <span className="text-foreground font-semibold"> · {refs.length} referencia{refs.length > 1 ? 's' : ''}</span>
          <span className="block text-xs text-muted-foreground mt-0.5">{descripcion}</span>
        </span>
      </button>
      {open && (
        <div className="mt-2 ml-10 space-y-1">
          {refs.map((q) => (
            <div key={q.reference} className="flex flex-wrap items-baseline gap-x-3 text-xs">
              <span className="font-mono font-semibold text-foreground">{q.reference}</span>
              <span className="text-muted-foreground">
                {fecha(q) ? <>se agota el <strong className="text-foreground">{fmtFecha(fecha(q)!)}</strong></> : 'sin fecha'}
              </span>
              <span className="text-muted-foreground">
                stock {Math.round(q.stock)} · {q.enTransito > 0 ? `+${Math.round(q.enTransito)} en camino` : 'nada en camino'} · {q.consumoDiario.toFixed(1)}/día
              </span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground pt-1 italic">→ {accion}</p>
        </div>
      )}
    </div>
  );
}

export default function CoverageAlertsReport({ sug }: { sug: ReorderSuggestion }) {
  const total = sug.faltantes.length + sug.alertas.length + sug.huecos.length;
  if (!total) {
    return (
      <Card>
        <CardContent className="py-3 px-4 text-xs text-muted-foreground">
          ✅ Sin alertas de abastecimiento: ninguna referencia queda descubierta antes del pedido grupal.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      <AlertSection
        titulo="Faltante real"
        descripcion="El agote final (contando TODO el pipeline) cae antes de que llegue un pedido montado hoy — ningún contenedor nuevo lo salva."
        refs={sug.faltantes}
        fecha={(q) => q.fechaQuiebreTeorica ?? q.fechaQuiebre}
        tone="rojo"
        icon={ShieldAlert}
        accion="Reposición local o sumalo YA al próximo pedido (llega igual tarde, pero corta el faltante lo antes posible)."
      />
      <AlertSection
        titulo="Alerta — quiebra antes del pedido grupal"
        descripcion="Un pedido la alcanzaría, pero sola no es masa para disparar contenedor: quedaría seca hasta que llegue el grupal."
        refs={sug.alertas}
        fecha={(q) => q.fechaQuiebreTeorica ?? q.fechaQuiebre}
        tone="ambar"
        icon={TriangleAlert}
        accion="Reposición local o inclúyela en el próximo pedido cuando lo montes."
      />
      <AlertSection
        titulo="Hueco corto — lo repone lo que viene en camino"
        descripcion="Queda en 0 unos días hasta que nacionaliza un contenedor que ya viene. Se resuelve solo."
        refs={sug.huecos}
        fecha={(q) => q.fechaHueco ?? q.fechaQuiebre}
        tone="suave"
        icon={Clock3}
        accion="Si el faltante duele, apurá la nacionalización o cubrí con reposición local puntual."
      />
    </div>
  );
}
