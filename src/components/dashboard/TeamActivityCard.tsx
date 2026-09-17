/**
 * Actividad del equipo — "quién hizo qué y cuándo" (Nico 2026-09-04:
 * "Lina agregó a las 5pm del viernes la remisión de Yenny Molano").
 *
 * Lee activity_log (triggers en remisiones/invoices, solo acciones humanas).
 * La RLS ya garantiza que SOLO el dueño de los datos ve filas; el gate de
 * admin acá evita hasta el fetch en cuentas de colaborador.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { SectionHeader, Pill } from './cardKit';
import { seriesColor } from '@/lib/chartColors';
import { History, Plus, Pencil, Trash2, type LucideIcon } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface ActivityRow {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: 'creo' | 'edito' | 'elimino';
  entity_type: string;
  entity_label: string;
  created_at: string;
}

interface CollabRow {
  collaborator_email: string;
  collaborator_user_id: string | null;
  name: string;
}

const VERBO: Record<ActivityRow['action'], string> = {
  creo: 'agregó',
  edito: 'editó',
  elimino: 'eliminó',
};

const ENTIDAD: Record<string, string> = {
  remision: 'la remisión',
  factura: 'la factura',
};

const ACTION_UI: Record<ActivityRow['action'], { icon: LucideIcon; tile: string; pill: string; label: string }> = {
  creo: { icon: Plus, tile: 'bg-success/15 text-success', pill: 'bg-success/15 text-success', label: 'Nuevo' },
  edito: { icon: Pencil, tile: 'bg-warning/15 text-warning', pill: 'bg-warning/15 text-warning', label: 'Editado' },
  elimino: { icon: Trash2, tile: 'bg-destructive/15 text-destructive', pill: 'bg-destructive/15 text-destructive', label: 'Eliminado' },
};

/** Color estable por persona (slot categórico según su orden de aparición). */
function personColor(index: number): string { return seriesColor(index % 8); }

function dayKey(iso: string): string { return iso.slice(0, 10); }
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1);
  const d0 = new Date(d); d0.setHours(0, 0, 0, 0);
  if (d0.getTime() === hoy.getTime()) return 'Hoy';
  if (d0.getTime() === ayer.getTime()) return 'Ayer';
  return format(d, "EEEE d 'de' MMMM", { locale: es });
}
function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const dd = Math.floor(h / 24);
  return `hace ${dd} d`;
}
export default function TeamActivityCard() {
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  const [persona, setPersona] = useState<string>('todos');

  const { data: rows } = useQuery<ActivityRow[]>({
    queryKey: ['team-activity', user?.id],
    enabled: !!user && isAdmin,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from('activity_log' as never) as any)
        .select('id, actor_id, actor_email, action, entity_type, entity_label, created_at')
        .order('created_at', { ascending: false })
        .limit(40);
      if (error) return [];
      return (data ?? []) as ActivityRow[];
    },
  });

  const { data: collabs } = useQuery<CollabRow[]>({
    queryKey: ['team-activity-collabs', user?.id],
    enabled: !!user && isAdmin,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('collaborators')
        .select('collaborator_email, collaborator_user_id, name' as never);
      if (error) return [];
      return (data ?? []) as unknown as CollabRow[];
    },
  });

  const nombreDe = useMemo(() => {
    const porId: Record<string, string> = {};
    const porEmail: Record<string, string> = {};
    for (const c of collabs ?? []) {
      if (c.name) {
        if (c.collaborator_user_id) porId[c.collaborator_user_id] = c.name;
        if (c.collaborator_email) porEmail[c.collaborator_email.toLowerCase()] = c.name;
      }
    }
    return (r: ActivityRow): string => {
      if (r.actor_id && r.actor_id === user?.id) return 'Vos';
      if (r.actor_id && porId[r.actor_id]) return porId[r.actor_id];
      const email = (r.actor_email ?? '').toLowerCase();
      if (email && porEmail[email]) return porEmail[email];
      return email ? email.split('@')[0] : 'Alguien';
    };
  }, [collabs, user?.id]);

  // Personas (orden de aparición → color estable), filtro y resumen de la semana.
  const { personas, colorDe, resumenSemana, grupos } = useMemo(() => {
    const all = rows ?? [];
    const personas: string[] = [];
    for (const r of all) { const n = nombreDe(r); if (!personas.includes(n)) personas.push(n); }
    const colorDe = (n: string) => personColor(Math.max(0, personas.indexOf(n)));
    const hace7 = Date.now() - 7 * 86400000;
    const semana = all.filter((r) => new Date(r.created_at).getTime() >= hace7);
    const cuenta = (tipo: string) => semana.filter((r) => r.entity_type === tipo && r.action !== 'elimino').length;
    const partes = [
      cuenta('remision') > 0 ? `${cuenta('remision')} remision${cuenta('remision') === 1 ? '' : 'es'}` : null,
      cuenta('factura') > 0 ? `${cuenta('factura')} factura${cuenta('factura') === 1 ? '' : 's'}` : null,
    ].filter(Boolean);
    const resumenSemana = partes.length ? `Esta semana: ${partes.join(' y ')}` : 'Sin movimientos esta semana';
    const visibles = persona === 'todos' ? all : all.filter((r) => nombreDe(r) === persona);
    const grupos: Array<{ key: string; label: string; items: ActivityRow[] }> = [];
    for (const r of visibles) {
      const k = dayKey(r.created_at);
      let g = grupos.find((x) => x.key === k);
      if (!g) { g = { key: k, label: dayLabel(r.created_at), items: [] }; grupos.push(g); }
      g.items.push(r);
    }
    return { personas, colorDe, resumenSemana, grupos };
  }, [rows, nombreDe, persona]);

  if (!isAdmin) return null;

  return (
    <Card className="rounded-2xl border border-border shadow-sm">
      <CardHeader className="pb-3">
        <SectionHeader
          icon={History}
          title="Actividad del equipo"
          subtitle={`${resumenSemana} · quién hizo qué, con hora exacta`}
          right={personas.length > 1 ? (
            <div className="flex flex-wrap gap-1 justify-end">
              {['todos', ...personas].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPersona(p)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${persona === p ? 'bg-foreground text-background border-foreground' : 'bg-card text-muted-foreground border-border hover:text-foreground'}`}
                >
                  {p === 'todos' ? 'Todos' : p}
                </button>
              ))}
            </div>
          ) : undefined}
        />
      </CardHeader>
      <CardContent>
        {!rows?.length ? (
          <div className="flex flex-col items-center justify-center py-8 text-center gap-1.5">
            <History className="h-9 w-9 text-muted-foreground/25" />
            <p className="text-sm font-medium text-muted-foreground">Sin actividad registrada todavía</p>
            <p className="text-xs text-muted-foreground/80 max-w-[300px] leading-relaxed">
              Desde ahora, cada remisión o factura que alguien del equipo cree, edite o
              elimine queda anotada acá con su hora.
            </p>
          </div>
        ) : (
          <div className="max-h-[520px] overflow-y-auto pr-1 space-y-4">
            {grupos.map((g) => (
              <div key={g.key}>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 sticky top-0 bg-card/95 backdrop-blur py-1">
                  {g.label} <span className="font-medium normal-case tracking-normal">· {g.items.length}</span>
                </p>
                <div className="space-y-2">
                  {g.items.map((r) => {
                    const nombre = nombreDe(r);
                    const ui = ACTION_UI[r.action];
                    const Icon = ui.icon;
                    const color = colorDe(nombre);
                    const [ref, ...resto] = (r.entity_label || '').split(' · ');
                    return (
                      <div key={r.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 hover:bg-muted/30 transition-colors">
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold uppercase"
                          style={{ backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`, color }}
                          title={nombre}
                        >
                          {nombre.slice(0, 1)}
                        </div>
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${ui.tile}`} title={ui.label}>
                          <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] text-foreground leading-snug truncate">
                            <span className="font-bold">{nombre}</span>{' '}
                            <span className="text-muted-foreground">{VERBO[r.action]} {ENTIDAD[r.entity_type] ?? r.entity_type}</span>{' '}
                            {ref && <span className="inline-block font-mono text-[11px] font-semibold px-1.5 py-px rounded-md bg-muted text-foreground align-middle">{ref}</span>}
                            {resto.length > 0 && <span className="font-medium"> · {resto.join(' · ')}</span>}
                            {!r.entity_label && <span className="font-medium">(sin etiqueta)</span>}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5" title={format(new Date(r.created_at), "EEEE d 'de' MMMM 'de' yyyy, h:mm a", { locale: es })}>
                            {format(new Date(r.created_at), 'h:mm a', { locale: es })} · {relTime(r.created_at)}
                          </p>
                        </div>
                        <Pill className={ui.pill}>{ui.label}</Pill>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
