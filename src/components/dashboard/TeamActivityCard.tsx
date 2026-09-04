/**
 * Actividad del equipo — "quién hizo qué y cuándo" (Nico 2026-09-04:
 * "Lina agregó a las 5pm del viernes la remisión de Yenny Molano").
 *
 * Lee activity_log (triggers en remisiones/invoices, solo acciones humanas).
 * La RLS ya garantiza que SOLO el dueño de los datos ve filas; el gate de
 * admin acá evita hasta el fetch en cuentas de colaborador.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { History } from 'lucide-react';
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

const ACTION_BADGE: Record<ActivityRow['action'], string> = {
  creo: 'bg-success/10 text-success border-success/30',
  edito: 'bg-warning/10 text-warning border-warning/30',
  elimino: 'bg-destructive/10 text-destructive border-destructive/30',
};

export default function TeamActivityCard() {
  const { user } = useAuth();
  const { isAdmin } = usePermissions();

  const { data: rows } = useQuery<ActivityRow[]>({
    queryKey: ['team-activity', user?.id],
    enabled: !!user && isAdmin,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from('activity_log' as never) as any)
        .select('id, actor_id, actor_email, action, entity_type, entity_label, created_at')
        .order('created_at', { ascending: false })
        .limit(25);
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

  if (!isAdmin) return null;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base font-semibold text-foreground">Actividad del equipo</CardTitle>
          <span className="text-[10px] text-muted-foreground">(quién hizo qué, con hora exacta)</span>
        </div>
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
          <History className="h-4 w-4 text-primary" />
        </div>
      </CardHeader>
      <CardContent>
        {!rows?.length ? (
          <div className="flex flex-col items-center justify-center py-6 text-center gap-1.5">
            <History className="h-8 w-8 text-muted-foreground/25" />
            <p className="text-sm font-medium text-muted-foreground">Sin actividad registrada todavía</p>
            <p className="text-[11px] text-muted-foreground/80 max-w-[280px] leading-relaxed">
              Desde ahora, cada remisión o factura que alguien del equipo cree, edite o
              elimine queda anotada acá con su hora.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {rows.map((r) => {
              const nombre = nombreDe(r);
              return (
                <div key={r.id} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-[11px] font-bold text-primary uppercase">
                    {nombre.slice(0, 1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground leading-snug">
                      <span className="font-semibold">{nombre}</span>{' '}
                      {VERBO[r.action]} {ENTIDAD[r.entity_type] ?? r.entity_type}{' '}
                      <span className="font-medium">{r.entity_label || '(sin etiqueta)'}</span>
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {format(new Date(r.created_at), "EEE d MMM · h:mm a", { locale: es })}
                    </p>
                  </div>
                  <Badge variant="outline" className={`text-[9px] px-1.5 py-0 shrink-0 ${ACTION_BADGE[r.action]}`}>
                    {r.action === 'creo' ? 'Nuevo' : r.action === 'edito' ? 'Editado' : 'Eliminado'}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
