// Modal para generar y mostrar el link de pago Wompi de una factura.

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Link2, Loader2, Copy, Check, ExternalLink, ShieldCheck, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  invoice: {
    id: string;
    invoice_number: string | null;
    counterparty_name: string | null;
    pending: number;
  } | null;
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

export default function PaymentLinkModal({ open, onOpenChange, invoice }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState<string>('');

  useEffect(() => {
    if (open && invoice) {
      setLinkUrl(null);
      setError(null);
      setCopied(false);
      setCustomAmount(String(invoice.pending));
    }
  }, [open, invoice]);

  const handleGenerate = async () => {
    if (!invoice) return;
    setLoading(true);
    setError(null);
    setLinkUrl(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sesión expirada');
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const amountOverride = Number(customAmount);
      if (!Number.isFinite(amountOverride) || amountOverride <= 0) {
        throw new Error('Monto inválido');
      }
      if (amountOverride > invoice.pending) {
        throw new Error(`No podés cobrar más del saldo pendiente (${fmtMoney(invoice.pending)})`);
      }
      const res = await fetch(`${supabaseUrl}/functions/v1/create-invoice-payment-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
        },
        body: JSON.stringify({
          invoice_id: invoice.id,
          amount_override: amountOverride !== invoice.pending ? amountOverride : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setLinkUrl(data.url);
      toast({ title: 'Link generado', description: 'Listo para enviar al cliente.' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!linkUrl) return;
    await navigator.clipboard.writeText(linkUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: 'Link copiado' });
  };

  if (!invoice) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            Link de pago Wompi
          </DialogTitle>
          <DialogDescription className="text-xs space-y-1">
            <p>
              Factura <strong>{invoice.invoice_number ?? '—'}</strong> de <strong>{invoice.counterparty_name ?? '—'}</strong>
            </p>
            <p className="flex items-center gap-1 text-primary">
              <Sparkles className="h-3 w-3" />
              El cliente recibe un link, paga con PSE / tarjeta / Nequi, y se concilia automáticamente.
            </p>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">Monto a cobrar</Label>
            <Input
              type="number"
              step="1"
              min="1"
              max={invoice.pending}
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              className="font-mono"
              disabled={loading}
            />
            <p className="text-[11px] text-muted-foreground">
              Saldo pendiente: <strong>{fmtMoney(invoice.pending)}</strong>. Podés bajar el monto si querés cobrar un abono parcial.
            </p>
          </div>

          {!linkUrl && (
            <Button onClick={handleGenerate} disabled={loading || !customAmount} className="w-full gap-1.5">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              {loading ? 'Generando link…' : 'Generar link de pago'}
            </Button>
          )}

          {error && (
            <p className="text-xs text-destructive p-2 bg-destructive/5 rounded border border-destructive/30">
              Error: {error}
            </p>
          )}

          {linkUrl && (
            <div className="space-y-2">
              <Label className="text-xs flex items-center gap-1">
                <ShieldCheck className="h-3 w-3 text-success" />
                Link generado · enviáselo al cliente
              </Label>
              <div className="relative">
                <Input value={linkUrl} readOnly className="font-mono text-xs pr-24 select-all" />
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-1">
                  <Button size="sm" variant="ghost" onClick={handleCopy} className="h-7 gap-1">
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? 'OK' : 'Copiar'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => window.open(linkUrl, '_blank')} className="h-7" title="Abrir">
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div className="p-2 rounded bg-success/5 border border-success/30 text-[11px] text-foreground space-y-1">
                <p className="font-semibold">Qué pasa después:</p>
                <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                  <li>El cliente abre el link y elige cómo pagar (PSE, tarjeta, Nequi, etc.)</li>
                  <li>Cuando Wompi confirma el pago, llega webhook a tu app</li>
                  <li>Se crea automáticamente una transacción vinculada a esta factura</li>
                  <li>El saldo pendiente baja sin que hagas nada</li>
                </ul>
              </div>
              <Button variant="outline" size="sm" onClick={handleGenerate} disabled={loading} className="w-full">
                {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Generar otro link (single-use)
              </Button>
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
