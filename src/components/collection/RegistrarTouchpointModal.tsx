import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Loader2, MessageSquarePlus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

const CHANNELS = [
  { value: 'llamada', label: '📞 Llamada' },
  { value: 'email', label: '📧 Email' },
  { value: 'whatsapp', label: '💬 WhatsApp' },
  { value: 'sms', label: '✉️ SMS' },
  { value: 'visita', label: '🏃 Visita personal' },
  { value: 'reunion', label: '🤝 Reunión' },
  { value: 'otro', label: '🔘 Otro' },
];

const OUTCOMES = [
  { value: 'contactado', label: '✅ Lo contacté (habló conmigo)' },
  { value: 'no_contesto', label: '📵 No contestó / no atendió' },
  { value: 'prometio_pago', label: '🤞 Prometió pagar' },
  { value: 'compromiso_parcial', label: '📅 Acordó cuotas / pago parcial' },
  { value: 'disputa', label: '⚠️ Discute la deuda' },
  { value: 'sin_respuesta', label: '🔇 Mandé mensaje, sin respuesta' },
  { value: 'otro', label: '🔘 Otro' },
];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  client: { name: string; responsible_id: string | null } | null;
  onSaved?: () => void;
}

export default function RegistrarTouchpointModal({ open, onOpenChange, client, onSaved }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [channel, setChannel] = useState('llamada');
  const [outcome, setOutcome] = useState('contactado');
  const [notes, setNotes] = useState('');
  const [contactedAt, setContactedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setChannel('llamada');
      setOutcome('contactado');
      setNotes('');
      setContactedAt(new Date().toISOString().slice(0, 16));
    }
  }, [open]);

  const handleSave = async () => {
    if (!user || !client) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('collection_touchpoints' as never).insert({
        user_id: user.id,
        responsible_id: client.responsible_id,
        client_name: client.name,
        channel,
        outcome,
        notes: notes.trim() || null,
        contacted_at: new Date(contactedAt).toISOString(),
      } as never);
      if (error) throw error;
      toast({ title: 'Contacto registrado' });
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      toast({ title: 'Error al registrar', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!client) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquarePlus className="h-5 w-5 text-primary" />
            Registrar contacto
          </DialogTitle>
          <DialogDescription className="text-xs">
            Cliente: <strong>{client.name}</strong>. Llevá la bitácora completa de tu cobranza.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Canal</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHANNELS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Resultado</Label>
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OUTCOMES.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">¿Cuándo fue?</Label>
            <Input type="datetime-local" value={contactedAt} onChange={(e) => setContactedAt(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Notas (opcional pero recomendado)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: Habló con María (asistente), prometió pagar el viernes 30."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Guardar contacto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
