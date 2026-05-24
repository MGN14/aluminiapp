import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Brain, Loader2, Copy, Check, Sparkles, MessageSquare } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const CHANNELS = [
  { value: 'email', label: '📧 Email' },
  { value: 'whatsapp', label: '💬 WhatsApp' },
  { value: 'llamada_guion', label: '📞 Guión de llamada' },
];

const TONES = [
  { value: 'amable', label: '😊 Amable (cliente VIP)' },
  { value: 'recordatorio', label: '🙂 Recordatorio neutral' },
  { value: 'firme', label: '😐 Firme (ya pasó tiempo)' },
  { value: 'escalado', label: '⚠️ Escalado (último aviso)' },
];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  client: { name: string; responsible_id: string | null } | null;
}

export default function SuggestMessageModal({ open, onOpenChange, client }: Props) {
  const { toast } = useToast();
  const [channel, setChannel] = useState('email');
  const [tone, setTone] = useState('recordatorio');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setChannel('email');
      setTone('recordatorio');
      setMessage('');
      setCopied(false);
      setError(null);
    }
  }, [open]);

  const handleGenerate = async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sesión expirada');
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/draft-collection-message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
        body: JSON.stringify({
          client_name: client.name,
          responsible_id: client.responsible_id,
          channel,
          tone,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setMessage(data.message ?? '(sin contenido)');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: 'Mensaje copiado' });
  };

  if (!client) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Sugerir mensaje de cobranza
            <Sparkles className="h-4 w-4 text-primary" />
          </DialogTitle>
          <DialogDescription className="text-xs">
            Claude analiza el historial del cliente <strong>{client.name}</strong> (saldo, días vencido, comportamiento) y redacta un mensaje adaptado.
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
              <Label className="text-xs">Tono</Label>
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TONES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={handleGenerate} disabled={loading} className="w-full gap-1.5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
            {loading ? 'Claude está pensando…' : (message ? 'Regenerar' : 'Generar mensaje con Claude')}
          </Button>

          {error && (
            <p className="text-xs text-destructive">Error: {error}</p>
          )}

          {message && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  Mensaje sugerido (editable)
                </Label>
                <Button size="sm" variant="ghost" onClick={handleCopy} className="h-7 gap-1.5">
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? 'Copiado' : 'Copiar'}
                </Button>
              </div>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={12}
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Por ahora copialo y pegalo en tu cliente de email/WhatsApp. En la próxima fase lo enviamos directo.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
