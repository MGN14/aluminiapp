import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useFiscalConfig } from '@/hooks/useFiscalConfig';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Save, Percent, Info } from 'lucide-react';

interface TaxConfig {
  reteica_city: string;
  reteica_rate: string; // percentage string for display
  autoretefuente_rate: string;
  retefuente_compra_rate: string;
}

export default function TaxSettingsCard() {
  const { user } = useAuth();
  const { config: fiscalConfig } = useFiscalConfig();
  const { toast } = useToast();
  const [config, setConfig] = useState<TaxConfig>({
    reteica_city: '',
    reteica_rate: '',
    autoretefuente_rate: '',
    retefuente_compra_rate: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isAutorretenedor = fiscalConfig?.autorretenedor ?? false;

  useEffect(() => {
    if (!user) return;
    loadConfig();
  }, [user]);

  const loadConfig = async () => {
    try {
      const { data, error } = await supabase
        .from('tax_settings')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setConfig({
          reteica_city: data.reteica_city || '',
          reteica_rate: data.reteica_rate ? (data.reteica_rate * 100).toString() : '',
          autoretefuente_rate: data.autoretefuente_rate ? (data.autoretefuente_rate * 100).toString() : '',
          retefuente_compra_rate: data.retefuente_compra_rate ? (data.retefuente_compra_rate * 100).toString() : '',
        });
      }
    } catch (error) {
      console.error('Error loading tax config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRateInput = (field: keyof TaxConfig, value: string) => {
    const normalized = value.replace(',', '.');
    if (normalized === '' || /^\d*\.?\d*$/.test(normalized)) {
      setConfig(prev => ({ ...prev, [field]: normalized }));
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    try {
      const reteicaRate = parseFloat(config.reteica_rate) || 0;
      const autoretefuenteRate = parseFloat(config.autoretefuente_rate) || 0;
      const retefuenteCompraRate = parseFloat(config.retefuente_compra_rate) || 0;

      // Validate rates are reasonable (0-20%)
      for (const [name, val] of [['ReteICA', reteicaRate], ['Autorretefuente', autoretefuenteRate], ['Retefuente compra', retefuenteCompraRate]] as [string, number][]) {
        if (val < 0 || val > 20) {
          toast({ title: 'Tasa inválida', description: `${name} debe estar entre 0% y 20%.`, variant: 'destructive' });
          setSaving(false);
          return;
        }
      }

      const payload = {
        user_id: user.id,
        reteica_city: config.reteica_city.trim() || null,
        reteica_rate: reteicaRate / 100,
        autoretefuente_rate: autoretefuenteRate / 100,
        retefuente_compra_rate: retefuenteCompraRate / 100,
        is_autorretenedor: isAutorretenedor,
        updated_at: new Date().toISOString(),
      };

      // Upsert into tax_settings
      const { error } = await supabase
        .from('tax_settings')
        .upsert(payload, { onConflict: 'user_id' });

      if (error) throw error;

      // Also sync reteica to profiles for backward compatibility (dashboard reads from there)
      await supabase
        .from('profiles')
        .update({
          reteica_city: payload.reteica_city,
          reteica_rate: payload.reteica_rate,
          updated_at: payload.updated_at,
        })
        .eq('user_id', user.id);

      toast({ title: 'Configuración guardada', description: 'Las tasas fiscales han sido actualizadas.' });
    } catch (error) {
      console.error('Error saving tax config:', error);
      toast({ title: 'Error', description: 'No se pudo guardar la configuración.', variant: 'destructive' });
    } finally {
      setSaving(false);
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
          <Percent className="h-5 w-5 text-muted-foreground" />
          Tasas fiscales
        </CardTitle>
        <CardDescription>
          Porcentajes usados para calcular automáticamente los impuestos en facturas y transacciones
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Alert className="bg-muted/50 border-muted">
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Configurá estas tasas antes de subir facturas. Los valores se aplicarán automáticamente sobre la base gravable de cada factura.
          </AlertDescription>
        </Alert>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Autorretefuente */}
          {isAutorretenedor && (
            <div className="space-y-2">
              <Label>Tasa Autorretefuente (%)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={config.autoretefuente_rate}
                onChange={(e) => handleRateInput('autoretefuente_rate', e.target.value)}
                placeholder="Ej: 0.4"
              />
              <p className="text-xs text-muted-foreground">Se aplica sobre ventas</p>
            </div>
          )}

          {/* Retefuente compras */}
          <div className="space-y-2">
            <Label>Tasa Retefuente Compras (%)</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={config.retefuente_compra_rate}
              onChange={(e) => handleRateInput('retefuente_compra_rate', e.target.value)}
              placeholder="Ej: 2.5"
            />
            <p className="text-xs text-muted-foreground">Se aplica sobre compras</p>
          </div>

          {/* ReteICA city */}
          <div className="space-y-2">
            <Label>Ciudad ReteICA</Label>
            <Input
              value={config.reteica_city}
              onChange={(e) => setConfig(prev => ({ ...prev, reteica_city: e.target.value }))}
              placeholder="Ej: Bogotá, Medellín"
            />
          </div>

          {/* ReteICA rate */}
          <div className="space-y-2">
            <Label>Tasa ReteICA (%)</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={config.reteica_rate}
              onChange={(e) => handleRateInput('reteica_rate', e.target.value)}
              placeholder="Ej: 0.966"
            />
            <p className="text-xs text-muted-foreground">Ejemplo: 0.966% = 9,66 por mil</p>
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Guardar configuración fiscal
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
