import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Save, Calculator } from 'lucide-react';

export default function QuotationDefaultsCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [laborPct, setLaborPct] = useState('');
  const [validityDays, setValidityDays] = useState('15');
  const [terms, setTerms] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data, error } = await (supabase
          .from('profiles')
          .select('quote_labor_pct_default, quote_validity_days_default, quote_terms_default')
          .eq('user_id', user.id)
          .maybeSingle() as unknown as Promise<{
            data: {
              quote_labor_pct_default: number | null;
              quote_validity_days_default: number | null;
              quote_terms_default: string | null;
            } | null;
            error: { message: string } | null;
          }>);
        if (error) throw error;
        if (data) {
          setLaborPct(
            data.quote_labor_pct_default !== null && data.quote_labor_pct_default !== undefined
              ? String(data.quote_labor_pct_default)
              : '',
          );
          setValidityDays(
            data.quote_validity_days_default !== null &&
              data.quote_validity_days_default !== undefined
              ? String(data.quote_validity_days_default)
              : '15',
          );
          setTerms(data.quote_terms_default ?? '');
        }
      } catch (err) {
        console.error('QuotationDefaults load error:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const handleNumberInput = (val: string, setter: (s: string) => void) => {
    const norm = val.replace(',', '.');
    if (norm === '' || /^\d*\.?\d*$/.test(norm)) setter(norm);
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const labor = parseFloat(laborPct) || 0;
      const validity = parseInt(validityDays, 10) || 15;

      if (labor < 0 || labor > 200) {
        toast({
          title: 'Mano de obra inválida',
          description: 'Ingresá un porcentaje entre 0 y 200.',
          variant: 'destructive',
        });
        setSaving(false);
        return;
      }
      if (validity < 1 || validity > 365) {
        toast({
          title: 'Validez inválida',
          description: 'Ingresá un número entre 1 y 365 días.',
          variant: 'destructive',
        });
        setSaving(false);
        return;
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          quote_labor_pct_default: labor,
          quote_validity_days_default: validity,
          quote_terms_default: terms.trim() || null,
        } as never)
        .eq('user_id', user.id);

      if (error) throw error;
      toast({ title: 'Configuración guardada' });
    } catch (err: any) {
      toast({
        title: 'No se pudo guardar',
        description: err?.message || 'Error desconocido',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-muted-foreground" />
          <div>
            <CardTitle>Cotizaciones</CardTitle>
            <CardDescription>
              Valores por defecto al crear una nueva cotización. Podés ajustarlos en cada
              cotización individual.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="quote-labor-pct">% Mano de obra (fijo)</Label>
            <Input
              id="quote-labor-pct"
              type="text"
              inputMode="decimal"
              placeholder="30"
              value={laborPct}
              onChange={(e) => handleNumberInput(e.target.value, setLaborPct)}
            />
            <p className="text-[11px] text-muted-foreground">
              Se aplica al subtotal de m² × precio. Ej: 30 = 30%.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quote-validity">Validez (días)</Label>
            <Input
              id="quote-validity"
              type="number"
              min={1}
              max={365}
              placeholder="15"
              value={validityDays}
              onChange={(e) => setValidityDays(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Días desde la emisión hasta el vencimiento por defecto.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="quote-terms">Términos y condiciones por defecto</Label>
          <Textarea
            id="quote-terms"
            placeholder={`Ej:\n• Anticipo del 50% al aceptar la cotización.\n• Saldo contra entrega.\n• Tiempo de fabricación: 15 días hábiles.`}
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            rows={4}
          />
          <p className="text-[11px] text-muted-foreground">
            Aparecen al final del PDF de cada cotización (editable por cotización).
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : (
              <Save className="h-4 w-4 mr-1.5" />
            )}
            Guardar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
