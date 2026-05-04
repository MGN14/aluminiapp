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
import PaymentMethodCard from '@/components/subscription/PaymentMethodCard';
import TaxSettingsCard from '@/components/settings/TaxSettingsCard';
import InitialFinancialStateCard from '@/components/settings/InitialFinancialStateCard';
import SiigoConnectionCard from '@/components/settings/SiigoConnectionCard';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Mail, Building2, Shield, LogOut, Key, Save, ClipboardList, Pencil, Crown, Sparkles, Rocket, ArrowUpRight, Zap, Clock } from 'lucide-react';

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
  const {
    plan,
    isFounder,
    isAdmin,
    isTrialing,
    trialExpired,
    trialDaysLeft,
    subscriptionEnd,
  } = useSubscription();
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

  // Plan & Suscripción — props de display
  const planInfo = (() => {
    if (isFounder) return { name: 'Básico (Admin)', icon: Crown, accent: 'bg-purple-600', subtitle: 'Acceso administrativo interno' };
    if (plan === 'admin') return { name: 'Enterprise', icon: Shield, accent: 'bg-purple-600', subtitle: 'Acceso completo sin límites' };
    if (isTrialing) return { name: 'Empresarial Gratuito', icon: Zap, accent: 'bg-accent', subtitle: 'Período de prueba — todas las funciones desbloqueadas' };
    if (trialExpired) return { name: 'Prueba Expirada', icon: Clock, accent: 'bg-destructive', subtitle: 'Activá un plan para seguir usando AluminIA' };
    if (plan === 'empresarial') return { name: 'Empresarial', icon: Rocket, accent: 'bg-success', subtitle: 'Plan más completo — incluye inventario y todas las funciones' };
    if (plan === 'pro') return { name: 'Pro', icon: Crown, accent: 'bg-warning', subtitle: 'Plan Pro' };
    if (plan === 'basico') return { name: 'Básico', icon: Sparkles, accent: 'bg-primary', subtitle: 'Gestión financiera para tu negocio' };
    return { name: 'Sin plan', icon: Sparkles, accent: 'bg-muted', subtitle: '' };
  })();
  const PlanIcon = planInfo.icon;

  const planExpiryText = (() => {
    if (isTrialing && trialDaysLeft !== null) {
      return `${trialDaysLeft} día${trialDaysLeft !== 1 ? 's' : ''} restante${trialDaysLeft !== 1 ? 's' : ''} de prueba`;
    }
    if (trialExpired) return 'Prueba expirada';
    if (subscriptionEnd) {
      const expiresAt = new Date(subscriptionEnd);
      const days = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (days <= 0) return 'Expirado';
      return `Renueva en ${days} día${days !== 1 ? 's' : ''}`;
    }
    return null;
  })();

  const showUpgradeCTA = !isFounder && !isAdmin;
  const isPaidPlan = !isFounder && (plan === 'empresarial' || plan === 'pro' || plan === 'basico');

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Ajustes</h1>
          <p className="text-muted-foreground mt-1">Administra tu cuenta, empresa y seguridad.</p>
        </div>

        {/* Plan & Suscripción — full width, prominent */}
        <Card className="border-0 shadow-sm overflow-hidden">
          <div className="relative p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${planInfo.accent}`}>
                  <PlanIcon className="h-6 w-6 text-white" />
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Plan actual</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-xl font-bold leading-tight">{planInfo.name}</h2>
                    {isPaidPlan && !trialExpired && (
                      <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/30">Activo</Badge>
                    )}
                    {isTrialing && (
                      <Badge variant="outline" className="text-[10px] bg-accent/10 text-accent border-accent/30">Trial</Badge>
                    )}
                    {trialExpired && (
                      <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">Expirado</Badge>
                    )}
                  </div>
                  {planInfo.subtitle && (
                    <p className="text-sm text-muted-foreground">{planInfo.subtitle}</p>
                  )}
                  {planExpiryText && (
                    <p className="text-xs text-muted-foreground">{planExpiryText}</p>
                  )}
                </div>
              </div>

              {showUpgradeCTA && (
                <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                  <Button
                    onClick={() => navigate('/pricing')}
                    className="gap-1.5"
                  >
                    {trialExpired
                      ? 'Activar plan'
                      : isTrialing
                        ? 'Ver planes'
                        : 'Cambiar plan'}
                    <ArrowUpRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Método de pago — sólo plan pagado */}
        {isPaidPlan && <PaymentMethodCard />}

        {/* Top grid: Cuenta + Empresa */}
        <div className="grid lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Mail className="h-5 w-5 text-muted-foreground" />
                Cuenta
              </CardTitle>
              <CardDescription>Tu correo de acceso</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Correo electrónico</Label>
                <div className="flex items-center h-10 px-3 bg-muted/50 rounded-md border border-input">
                  <span className="text-sm text-foreground">{user?.email}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Building2 className="h-5 w-5 text-muted-foreground" />
                Empresa
              </CardTitle>
              <CardDescription>Nombre de tu empresa</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="companyName">Nombre de la empresa</Label>
                <Input
                  id="companyName"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Ej: Mi Empresa S.A.S."
                />
                <p className="text-xs text-muted-foreground">
                  La inicial de tu avatar se toma de la primera letra del nombre.
                </p>
              </div>
              <Button onClick={handleSaveCompany} disabled={saving} size="sm">
                {saving ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Guardando...</>
                ) : (
                  <><Save className="h-4 w-4 mr-2" />Guardar</>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Perfil fiscal (puede ser largo) */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ClipboardList className="h-5 w-5 text-muted-foreground" />
                  Perfil fiscal
                </CardTitle>
                <CardDescription>Cómo está clasificada tu empresa ante la DIAN</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate('/onboarding')}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />Editar
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!fiscalConfig ? (
              <p className="text-sm text-muted-foreground">Aún no has configurado tu perfil fiscal.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3 text-sm">
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

                <div className="space-y-1.5 pt-2 border-t">
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
              </>
            )}
          </CardContent>
        </Card>

        {/* Configuración de impuestos + Hoja membretada en grid */}
        <div className="grid lg:grid-cols-2 gap-6">
          <TaxSettingsCard />
          <LetterheadSection />
        </div>

        {/* Categorías deducibles + Estado financiero inicial — full width c/u */}
        <CategoriesDeductibleSettings />
        <InitialFinancialStateCard />

        {/* Conexiones contables/fiscales */}
        <SiigoConnectionCard />

        {/* Seguridad */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-5 w-5 text-muted-foreground" />
              Seguridad
            </CardTitle>
            <CardDescription>Contraseña y sesión</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button variant="outline" onClick={handleChangePassword}>
                <Key className="h-4 w-4 mr-2" />Cambiar contraseña
              </Button>
              <Button variant="destructive" onClick={handleSignOut}>
                <LogOut className="h-4 w-4 mr-2" />Cerrar sesión
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
