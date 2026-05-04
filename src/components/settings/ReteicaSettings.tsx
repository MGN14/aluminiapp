import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Save, Receipt, Info } from 'lucide-react';

interface ReteicaConfig {
  reteica_city: string | null;
  reteica_rate: number;
}

export default function ReteicaSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [config, setConfig] = useState<ReteicaConfig>({
    reteica_city: '',
    reteica_rate: 0,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  useEffect(() => {
    loadConfig();
  }, [user]);

  const loadConfig = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('reteica_city, reteica_rate')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setConfig({
          reteica_city: data.reteica_city || '',
          reteica_rate: data.reteica_rate || 0,
        });
      }
    } catch (error) {
      console.error('Error loading RETEICA config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;

    setSaving(true);
    try {
      // Validate rate is between 0 and 5%
      const rateDecimal = config.reteica_rate;
      if (rateDecimal < 0 || rateDecimal > 0.05) {
        toast({
          title: 'Tasa inválida',
          description: 'La tasa debe estar entre 0% y 5%.',
          variant: 'destructive',
        });
        return;
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          reteica_city: config.reteica_city?.trim() || null,
          reteica_rate: rateDecimal,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);

      if (error) throw error;

      toast({
        title: 'Configuración guardada',
        description: 'La configuración de ReteICA ha sido actualizada.',
      });
    } catch (error) {
      console.error('Error saving RETEICA config:', error);
      toast({
        title: 'Error',
        description: 'No se pudo guardar la configuración.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRecalculate = async () => {
    if (!user || config.reteica_rate <= 0) return;

    setRecalculating(true);
    try {
      // Recalculate RETEICA for all transactions marked with has_reteica = true
      // Only for income transactions (amount > 0)
      const { data: transactions, error: fetchError } = await supabase
        .from('transactions')
        .select('id, amount')
        .eq('has_reteica', true)
        .gt('amount', 0)
        .is('deleted_at', null);

      if (fetchError) throw fetchError;

      if (transactions && transactions.length > 0) {
        // Update each transaction with the new calculated amount
        const updates = transactions.map(tx => ({
          id: tx.id,
          reteica_amount: Math.round((tx.amount ?? 0) * config.reteica_rate),
        }));

        for (const update of updates) {
          await supabase
            .from('transactions')
            .update({ reteica_amount: update.reteica_amount })
            .eq('id', update.id);
        }

        toast({
          title: 'Recálculo completado',
          description: `Se actualizaron ${transactions.length} transacciones con la nueva tasa.`,
        });
      } else {
        toast({
          title: 'Sin cambios',
          description: 'No hay transacciones con ReteICA marcado para recalcular.',
        });
      }
    } catch (error) {
      console.error('Error recalculating RETEICA:', error);
      toast({
        title: 'Error',
        description: 'No se pudo recalcular el ReteICA.',
        variant: 'destructive',
      });
    } finally {
      setRecalculating(false);
    }
  };

  // Convert rate to percentage for display (show actual value user entered)
  const [rateInputValue, setRateInputValue] = useState('');

  // Sync input value when config loads
  useEffect(() => {
    if (config.reteica_rate > 0) {
      setRateInputValue((config.reteica_rate * 100).toString());
    }
  }, [loading]);

  const handleRateChange = (value: string) => {
    // Normalize comma to dot for decimal
    const normalized = value.replace(',', '.');
    
    // Allow empty, numbers, and single decimal point
    if (normalized === '' || /^\d*\.?\d*$/.test(normalized)) {
      setRateInputValue(normalized);
      
      // Convert percentage input to decimal for storage
      const percent = parseFloat(normalized) || 0;
      setConfig(prev => ({ ...prev, reteica_rate: percent / 100 }));
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Receipt className="h-5 w-5 text-muted-foreground" />
          ReteICA
        </CardTitle>
        <CardDescription>
          Configura la retención de Industria y Comercio para tu empresa
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="bg-muted/50 border-muted">
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Las tarifas de ReteICA varían según la ciudad y la actividad económica. 
            Verifica la tasa aplicable con tu contador o municipio.
          </AlertDescription>
        </Alert>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="reteica_city">Ciudad de declaración</Label>
            <Input
              id="reteica_city"
              value={config.reteica_city || ''}
              onChange={(e) => setConfig(prev => ({ ...prev, reteica_city: e.target.value }))}
              placeholder="Ej: Bogotá, Medellín"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="reteica_rate">Tasa de ReteICA (%)</Label>
            <Input
              id="reteica_rate"
              type="text"
              inputMode="decimal"
              value={rateInputValue}
              onChange={(e) => handleRateChange(e.target.value)}
              placeholder="Ej: 0.966, 0.4, 1.25"
              className="[appearance:textfield]"
            />
            <p className="text-xs text-muted-foreground">
              Ejemplo: 0.966% = 9,66 por mil
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Guardar configuración
              </>
            )}
          </Button>

          {config.reteica_rate > 0 && (
            <Button 
              variant="outline" 
              onClick={handleRecalculate} 
              disabled={recalculating}
            >
              {recalculating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Recalculando...
                </>
              ) : (
                'Recalcular transacciones'
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
