import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { supabase } from '@/integrations/supabase/client';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import PlanBadge from '@/components/subscription/PlanBadge';
import TaxSettingsCard from '@/components/settings/TaxSettingsCard';
import TaxRecalculationButton from '@/components/settings/TaxRecalculationButton';
import InitialFinancialStateCard from '@/components/settings/InitialFinancialStateCard';
import AutoRulesButton from '@/components/settings/AutoRulesButton';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Mail, Building2, Shield, LogOut, Key, Save, Calculator, Wand2 } from 'lucide-react';

export default function Settings() {
  const { user, signOut } = useAuth();
  const { plan, isFounder } = useSubscription();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [companyName, setCompanyName] = useState('');
  const [companyInitial, setCompanyInitial] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load profile data
  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('company_name, company_initial')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          setCompanyName(data.company_name || '');
          setCompanyInitial(data.company_initial || '');
        }
      } catch (error) {
        console.error('Error loading profile:', error);
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [user]);

  const handleSaveCompany = async () => {
    if (!user) return;

    setSaving(true);
    try {
      const validInitial = companyInitial.trim().charAt(0).toUpperCase() || null;

      const { error } = await supabase
        .from('profiles')
        .update({
          company_name: companyName.trim() || null,
          company_initial: validInitial,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);

      if (error) throw error;

      setCompanyInitial(validInitial || '');

      toast({
        title: 'Cambios guardados',
        description: 'La información de tu empresa ha sido actualizada.',
      });
    } catch (error) {
      console.error('Error saving profile:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron guardar los cambios.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = () => {
    navigate('/forgot-password');
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Ajustes</h1>
          <p className="text-muted-foreground mt-1">Administra tu cuenta, empresa y seguridad.</p>
        </div>

        {/* Section 1: Account */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Mail className="h-5 w-5 text-muted-foreground" />
              Cuenta
            </CardTitle>
            <CardDescription>Información de tu cuenta y plan</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Correo electrónico</Label>
              <div className="flex items-center h-10 px-3 bg-muted/50 rounded-md border border-input">
                <span className="text-sm text-foreground">{user?.email}</span>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <Label className="text-muted-foreground">Plan actual</Label>
              <div className="flex items-center gap-3">
                <PlanBadge plan={plan} size="md" isFounder={isFounder} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 2: Company */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              Empresa
            </CardTitle>
            <CardDescription>Información de tu empresa</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="companyName">Nombre de la empresa</Label>
              <Input
                id="companyName"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Ej: Mi Empresa S.A.S."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="companyInitial">Inicial de la empresa</Label>
              <Input
                id="companyInitial"
                value={companyInitial}
                onChange={(e) => setCompanyInitial(e.target.value.charAt(0).toUpperCase())}
                placeholder="Ej: M"
                maxLength={1}
                className="w-20"
              />
              <p className="text-xs text-muted-foreground">
                Esta letra se mostrará en tu avatar del header.
              </p>
            </div>

            <Button
              onClick={handleSaveCompany}
              disabled={saving}
              className="w-full sm:w-auto"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Guardar cambios
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Section 3: Tax Configuration */}
        <TaxSettingsCard />

        {/* Section 4: Tax Recalculation */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Calculator className="h-5 w-5 text-muted-foreground" />
              Reglas fiscales
            </CardTitle>
            <CardDescription>
              Recalcula los montos de IVA, ReteICA y Retefuente
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TaxRecalculationButton />
          </CardContent>
        </Card>

        {/* Section 5: Auto-categorization Rules */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wand2 className="h-5 w-5 text-muted-foreground" />
              Categorización automática
            </CardTitle>
            <CardDescription>
              Aplica reglas de categorización basadas en la descripción de cada transacción
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AutoRulesButton />
          </CardContent>
        </Card>

        {/* Section 6: Security */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-5 w-5 text-muted-foreground" />
              Seguridad
            </CardTitle>
            <CardDescription>Gestiona tu contraseña y sesión</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <Button variant="outline" onClick={handleChangePassword}>
                <Key className="h-4 w-4 mr-2" />
                Cambiar contraseña
              </Button>

              <Button variant="destructive" onClick={handleSignOut}>
                <LogOut className="h-4 w-4 mr-2" />
                Cerrar sesión
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
