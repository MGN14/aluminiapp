import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Send, Loader2, Mail, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactionCount: number;
  buildWorkbookBlob: () => Promise<Blob>;
}

type Recipient =
  | { kind: 'contadora'; email: string; name: string }
  | { kind: 'saved'; email: string }
  | { kind: 'custom' };

export default function EnviarExportModal({ open, onOpenChange, transactionCount, buildWorkbookBlob }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [contadoraEmail, setContadoraEmail] = useState<string | null>(null);
  const [contadoraName, setContadoraName] = useState<string>('');
  const [savedEmail, setSavedEmail] = useState<string | null>(null);
  const [customEmail, setCustomEmail] = useState<string>('');
  const [recipientKind, setRecipientKind] = useState<Recipient['kind']>('custom');
  const [message, setMessage] = useState<string>('');
  const [sending, setSending] = useState(false);
  const [saveAsDefault, setSaveAsDefault] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    loadRecipientOptions();
  }, [open, user?.id]);

  const loadRecipientOptions = async () => {
    if (!user) return;

    // 1. Buscar colaborador con rol contadora activa
    const { data: contadora } = await supabase
      .from('collaborators')
      .select('collaborator_email, name')
      .eq('owner_user_id', user.id)
      .eq('role', 'contadora')
      .eq('status', 'active')
      .maybeSingle();

    // 2. Buscar correo contable guardado en profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('accounting_email')
      .eq('user_id', user.id)
      .maybeSingle();

    const contE = contadora?.collaborator_email ?? null;
    const savedE = (profile as any)?.accounting_email ?? null;

    setContadoraEmail(contE);
    setContadoraName(contadora?.name || '');
    setSavedEmail(savedE);

    // Pre-select en orden: contadora > correo guardado > custom
    if (contE) setRecipientKind('contadora');
    else if (savedE) setRecipientKind('saved');
    else setRecipientKind('custom');

    // Mensaje default
    const today = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long' });
    setMessage(`Hola, adjunto los movimientos contables de ${today}. Saludos.`);
  };

  const resolveEmail = (): string => {
    if (recipientKind === 'contadora' && contadoraEmail) return contadoraEmail;
    if (recipientKind === 'saved' && savedEmail) return savedEmail;
    return customEmail.trim();
  };

  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSend = async () => {
    const toEmail = resolveEmail();
    if (!isValidEmail(toEmail)) {
      toast({ title: 'Correo inválido', description: 'Ingresá un correo válido.', variant: 'destructive' });
      return;
    }
    if (transactionCount === 0) {
      toast({ title: 'Sin datos', description: 'No hay transacciones para enviar.', variant: 'destructive' });
      return;
    }

    setSending(true);
    try {
      // Generar el Excel en el cliente
      const blob = await buildWorkbookBlob();
      const arrayBuffer = await blob.arrayBuffer();
      // Convertir a base64 por chunks (evita "Maximum call stack" en arrays grandes)
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
      }
      const base64 = btoa(binary);

      // Guardar correo como predeterminado si pidió
      if (saveAsDefault && recipientKind === 'custom' && isValidEmail(customEmail)) {
        await supabase
          .from('profiles')
          .update({ accounting_email: customEmail.trim() } as any)
          .eq('user_id', user!.id);
      }

      // Invocar edge function
      const fileName = `aluminia_movimientos_${new Date().toISOString().split('T')[0]}.xlsx`;
      const { data, error } = await supabase.functions.invoke('send-export-email', {
        body: {
          to_email: toEmail,
          message,
          file_base64: base64,
          file_name: fileName,
          transaction_count: transactionCount,
        },
      });

      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      toast({
        title: '✓ Correo enviado',
        description: `Se envió el Excel a ${toEmail}`,
      });
      onOpenChange(false);
    } catch (err: any) {
      console.error('Send export email error:', err);
      toast({
        title: 'No se pudo enviar',
        description: err?.message || 'Revisá tu conexión e intentá de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const canSend = resolveEmail().length > 0 && !sending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Enviar movimientos por correo
          </DialogTitle>
          <DialogDescription>
            Se enviará un Excel con {transactionCount} transacción{transactionCount === 1 ? '' : 'es'} al correo que elijas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Selector de destinatario */}
          <div className="space-y-2">
            <Label>Enviar a</Label>
            <Select value={recipientKind} onValueChange={(v) => setRecipientKind(v as Recipient['kind'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {contadoraEmail && (
                  <SelectItem value="contadora">
                    👩‍💼 Contadora{contadoraName ? ` (${contadoraName})` : ''} — {contadoraEmail}
                  </SelectItem>
                )}
                {savedEmail && (
                  <SelectItem value="saved">
                    💾 Correo contable guardado — {savedEmail}
                  </SelectItem>
                )}
                <SelectItem value="custom">✏️ Otro correo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Input custom si aplica */}
          {recipientKind === 'custom' && (
            <div className="space-y-2">
              <Label htmlFor="custom-email">Correo destino</Label>
              <Input
                id="custom-email"
                type="email"
                placeholder="contable@tuempresa.com"
                value={customEmail}
                onChange={(e) => setCustomEmail(e.target.value)}
                autoFocus
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveAsDefault}
                  onChange={(e) => setSaveAsDefault(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <Save className="h-3 w-3" />
                Guardar como correo contable predeterminado
              </label>
            </div>
          )}

          {/* Mensaje */}
          <div className="space-y-2">
            <Label htmlFor="message">Mensaje (opcional)</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="Hola, adjunto los movimientos del mes..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={handleSend} disabled={!canSend}>
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Enviar Excel
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
