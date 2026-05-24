import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trash2, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { TouchpointRow } from '@/hooks/useCollectionData';

const CHANNEL_ICON: Record<string, string> = {
  llamada: '📞', email: '📧', whatsapp: '💬', sms: '✉️', visita: '🏃', reunion: '🤝', otro: '🔘',
};

const OUTCOME_LABEL: Record<string, string> = {
  contactado: 'Contactado',
  no_contesto: 'No contestó',
  prometio_pago: 'Prometió pagar',
  compromiso_parcial: 'Acordó cuotas',
  disputa: 'Disputa',
  sin_respuesta: 'Sin respuesta',
  otro: 'Otro',
};

const OUTCOME_COLOR: Record<string, string> = {
  contactado: 'bg-success/10 text-success border-success/30',
  no_contesto: 'bg-muted text-muted-foreground',
  prometio_pago: 'bg-warning/10 text-warning border-warning/30',
  compromiso_parcial: 'bg-primary/10 text-primary border-primary/30',
  disputa: 'bg-destructive/10 text-destructive border-destructive/30',
  sin_respuesta: 'bg-muted text-muted-foreground',
  otro: 'bg-muted text-muted-foreground',
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

interface Props {
  touchpoints: TouchpointRow[];
  onRefresh?: () => void;
}

export default function TouchpointsTimeline({ touchpoints, onRefresh }: Props) {
  const { toast } = useToast();

  const handleDelete = async (id: string) => {
    if (!window.confirm('¿Eliminar este registro?')) return;
    const { error } = await supabase.from('collection_touchpoints' as never).delete().eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Contacto eliminado' });
      onRefresh?.();
    }
  };

  if (touchpoints.length === 0) {
    return (
      <div className="py-4 px-3 text-xs text-muted-foreground italic">
        Sin contactos registrados con este cliente. Cuando registres llamadas/emails/visitas, van a aparecer acá.
      </div>
    );
  }

  return (
    <div className="py-2 space-y-1.5">
      <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1 mb-1">
        <Clock className="h-3 w-3" />
        Historial de contactos ({touchpoints.length})
      </p>
      <div className="space-y-1.5 max-h-72 overflow-y-auto">
        {touchpoints.map((t) => (
          <div key={t.id} className="flex items-start gap-2 p-2 rounded bg-card border border-border text-xs">
            <span className="text-base shrink-0" title={t.channel}>
              {CHANNEL_ICON[t.channel] ?? '🔘'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={`text-[10px] ${OUTCOME_COLOR[t.outcome] ?? ''}`}>
                  {OUTCOME_LABEL[t.outcome] ?? t.outcome}
                </Badge>
                <span className="text-[10px] text-muted-foreground">{formatDate(t.contacted_at)}</span>
              </div>
              {t.notes && (
                <p className="mt-1 text-foreground text-xs whitespace-pre-wrap">{t.notes}</p>
              )}
            </div>
            <button
              onClick={() => handleDelete(t.id)}
              className="text-destructive hover:bg-destructive/10 p-1 rounded shrink-0"
              title="Eliminar"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
