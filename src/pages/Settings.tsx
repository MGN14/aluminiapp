import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { useFiscalConfig } from '@/hooks/useFiscalConfig';
import { supabase } from '@/integrations/supabase/client';
import AppLayout from '@/components/layout/AppLayout';
import LetterheadSection from '@/components/settings/LetterheadSection';
import CategoriesDeductibleSettings from '@/components/settings/CategoriesDeductibleSettings';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import PlanBadge from '@/components/subscription/PlanBadge';
import PaymentMethodCard from '@/components/subscription/PaymentMethodCard';
import TaxSettingsCard from '@/components/settings/TaxSettingsCard';
import InitialFinancialStateCard from '@/components/settings/InitialFinancialStateCard';
import SiigoConnectionCard from '@/components/settings/SiigoConnectionCard';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Mail, Building2, Shield, LogOut, Key, Save, ClipboardList, Pencil } from 'lucide-react';

function SummaryRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">
        {value === null || value === undefined || value === '' ? '—' : value}
      </span>
    </div>
  );
}

const PERSONA_LABEL: Record<string, string> = {
  natural: 'Persona natural',
  juridica: 'Persona jurídica',
};

const REGIMEN_LABEL: Record<string, string> = {
  comun: 'Régimen Común',
  simple: 'Régimen Simple',
  especial: 'Régimen Especial',
};

const INGRESOS_LABEL: Record<string, string> = {
  menos_92k_uvt: 'Menos de 92.000 UVT',
  mas_92k_uvt: 'Más de 92.000 UVT',
};

const ACTIVIDAD_LABEL: Record<string, string> = {
  distribuidor: 'Distribuidor',
  fabricante: 'Fabricante',
  servicios: 'Servicios',
  construccion: 'Construcción',
  mixto: 'Mixto',
  // Legacy fallback (pre-migration rows)
  comercial: 'Distribuidor',
  industrial: 'Fabricante',
  otro: 'Mixto',
};

export default function Settings() {
  const { user, signOut } = useAuth();
  const { plan, isFounder } = useSubscription();
  const { config: fiscalConfig } = useFiscalConfig();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load profile data
  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('company_name')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          setCompanyName(data.company_name || '');
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
      const trimmedName = companyName.trim();
      // Inicial se deriva automáticamente de la primera letra del nombre
      const derivedInitial = trimmedName.charAt(0).toUpperCase() || null;

      const { error } = await supabase
        .from('profiles')
        .update({
          company_name: trimmedName || null,
          company_initial: derivedInitial,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);

      if (error) throw error;

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

  // Responsabilidades seleccionadas como badges (sólo las que son true)
  const responsabilidades: { key: string; label: string }[] = [];
  if (fiscalConfig?.responsable_iva) responsabilidades.push({ key: 'iva', label: 'Responsable de IVA' });
  if (fiscalConfig?.agente_retencion) responsabilidades.push({ key: 'ret', label: 'Agente de retención' });
  if (fiscalConfig?.autorretenedor) responsabilidades.push({ key: 'auto', label: 'Autorretenedor' });
  if (fiscalConfig?.responsable_ica) responsabilidades.push({ key: 'ica', label: 'Paga ICA' });
  if (fiscalConfig?.facturacion_electronica) responsabilidades.push({ key: 'fe', label: 'Facturación electrónica' });

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

        {/* Payment method (recurring) — solo si tiene plan pago */}
        {!isFounder && (plan === 'empresarial' || plan === 'pro' || plan === 'basico') && (
          <PaymentMethodCard />
        )}

        {/* Section 2: Company + Fiscal Profile summary */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              Empresa
            </CardTitle>
            <CardDescription>Información de tu empresa y perfil fiscal</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="companyName">Nombre de la empresa</Label>
              <Input
                id="companyName"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Ej: Mi Empresa S.A.S."
              />
              <p className="text-xs text-muted-foreground">
                La inicial de tu avatar se toma automáticamente de la primera letra del nombre.
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

            <Separator />

            {/* Letterhead */}
            <LetterheadSection />

            <Separator />

            {/* Categorías deducibles DIAN */}
            <CategoriesDeductibleSettings />

            <Separator />

            {/* Fiscal summary (read-only) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-muted-foreground" />
                  <p className="font-medium">Perfil fiscal</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/onboarding')}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Editar perfil fiscal
                </Button>
              </div>

              {!fiscalConfig ? (
                <p className="text-sm text-muted-foreground">
                  Aún no has configurado tu perfil fiscal.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <SummaryRow label="Tipo de persona" value={fiscalConfig.persona_type ? PERSONA_LABEL[fiscalConfig.persona_type] : null} />
                  <SummaryRow
                    label="NIT"
                    value={
                      fiscalConfig.nit_ultimo_digito != null
                        ? `…${fiscalConfig.nit_ultimo_digito}${fiscalConfig.nit_digit != null ? `-${fiscalConfig.nit_digit}` : ''}`
                        : null
                    }
                  />
                  <SummaryRow label="Régimen" value={fiscalConfig.regimen ? REGIMEN_LABEL[fiscalConfig.regimen] : null} />
                  <SummaryRow label="Ingresos año anterior" value={fiscalConfig.nivel_ingresos ? INGRESOS_LABEL[fiscalConfig.nivel_ingresos] : null} />
                  <SummaryRow label="Actividad principal" value={fiscalConfig.actividad_principal ? ACTIVIDAD_LABEL[fiscalConfig.actividad_principal] : null} />
                  <SummaryRow label="Código CIIU" value={fiscalConfig.codigo_ciiu} />
                  {fiscalConfig.facturacion_electronica && (
                    <SummaryRow label="Facturador electrónico" value={fiscalConfig.nombre_facturador || '—'} />
                  )}
                </div>
              )}

              {fiscalConfig && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Responsabilidades</p>
                  {responsabilidades.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">Ninguna marcada</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {responsabilidades.map(r => (
                        <Badge key={r.key} variant="secondary" className="font-normal">
                          {r.label}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Section 3: Tax rates */}
        <TaxSettingsCard />

        {/* Section 4: Initial Financial State */}
        <InitialFinancialStateCard />

        {/* Section 4.5: Siigo integration */}
        <SiigoConnectionCard />

        {/* Section 5: Security */}
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
