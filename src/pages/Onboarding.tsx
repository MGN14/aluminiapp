import { useState } from 'react';
import * as Sentry from '@sentry/react';
import { CheckCircle2, ArrowRight, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import OnboardingShell from '@/components/onboarding/OnboardingShell';
import { INITIAL_STATE, type OnboardingState } from '@/components/onboarding/state';
import Step01Welcome from '@/components/onboarding/steps/Step01Welcome';
import Step02Persona from '@/components/onboarding/steps/Step02Persona';
import Step03NIT from '@/components/onboarding/steps/Step03NIT';
import Step04Regimen from '@/components/onboarding/steps/Step04Regimen';
import Step05Responsabilidades from '@/components/onboarding/steps/Step05Responsabilidades';
import Step06Actividad from '@/components/onboarding/steps/Step06Actividad';
import Step07Siigo from '@/components/onboarding/steps/Step07Siigo';
import Step08Resumen from '@/components/onboarding/steps/Step08Resumen';
import Step09Welcome from '@/components/onboarding/steps/Step09Welcome';
import Step10Tour from '@/components/onboarding/steps/Step10Tour';

import { useAuth } from '@/hooks/useAuth';
import { useFiscalConfig } from '@/hooks/useFiscalConfig';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { supabase } from '@/integrations/supabase/client';

const LEFT_CONTENT: Array<{ headline: React.ReactNode; subtitle?: React.ReactNode }> = [
  {
    headline: (
      <>
        Tu negocio,
        <br />
        <span style={{ color: 'oklch(0.60 0.14 155)' }}>entendido</span> desde el día 1
      </>
    ),
    subtitle: 'Pocas preguntas, ejemplos claros, y alertas que sí sirven desde el primer login.',
  },
  {
    headline: (
      <>
        ¿Quién <span style={{ color: 'oklch(0.60 0.14 155)' }}>factura</span>?
      </>
    ),
    subtitle: 'La misma venta se declara diferente si es una persona o una empresa. Arrancamos por lo básico.',
  },
  {
    headline: (
      <>
        Tu <span style={{ color: 'oklch(0.60 0.14 155)' }}>NIT</span>,
        <br />y nada más
      </>
    ),
    subtitle:
      'Necesitamos dos dígitos para saber cuándo te toca declarar. No reportamos nada a la DIAN en tu nombre.',
  },
  {
    headline: (
      <>
        ¿Bajo qué <span style={{ color: 'oklch(0.60 0.14 155)' }}>régimen</span> operas?
      </>
    ),
    subtitle: 'Cambia qué impuestos calculamos y qué reportes sugerimos. Si no sabes, pregúntale al contador.',
  },
  {
    headline: (
      <>
        ¿Qué <span style={{ color: 'oklch(0.60 0.14 155)' }}>impuestos</span> tocan?
      </>
    ),
    subtitle: 'Marcas lo que aplica a tu negocio. Si no estás seguro, "No" — siempre se cambia después.',
  },
  {
    headline: (
      <>
        ¿A qué te <span style={{ color: 'oklch(0.60 0.14 155)' }}>dedicas</span>?
      </>
    ),
    subtitle: 'Ajustamos los KPIs, las alertas y los reportes al tipo de operación que tienes.',
  },
  {
    headline: (
      <>
        Conecta <span style={{ color: 'oklch(0.60 0.14 155)' }}>Siigo</span> de una
      </>
    ),
    subtitle: 'Si ya usas Siigo, traemos tus ventas sin que digites nada. Si no, saltamos y listo.',
  },
  {
    headline: (
      <>
        Última <span style={{ color: 'oklch(0.60 0.14 155)' }}>revisada</span>
      </>
    ),
    subtitle: 'Verifica que todo esté bien antes de guardar. Todo se puede editar después.',
  },
  {
    headline: (
      <>
        <span style={{ color: 'oklch(0.60 0.14 155)' }}>Listo</span> para arrancar
      </>
    ),
    subtitle: 'Tu perfil quedó guardado. Ahora te mostramos lo que puedes hacer con AluminIA.',
  },
  {
    headline: (
      <>
        Empieza donde <span style={{ color: 'oklch(0.60 0.14 155)' }}>prefieras</span>
      </>
    ),
    subtitle: 'AluminIA tiene 5 partes principales. Entra donde más te urja, puedes volver a este tour cuando quieras.',
  },
];

export default function Onboarding() {
  const { user } = useAuth();
  const { saveConfig } = useFiscalConfig();
  const { markComplete } = useOnboardingStatus();

  const [stepIndex, setStepIndex] = useState(0);
  const [state, setState] = useState<OnboardingState>({
    ...INITIAL_STATE,
    nombreUsuario: user?.user_metadata?.full_name ?? '',
  });
  const [saving, setSaving] = useState(false);

  const update = <K extends keyof OnboardingState>(key: K, value: OnboardingState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
  };

  const goTo = (idx: number) => setStepIndex(Math.max(0, Math.min(idx, LEFT_CONTENT.length - 1)));

  const requiredComplete =
    state.personaType !== null &&
    state.nitUltimoDigito.trim() !== '' &&
    state.digitoVerificacion.trim() !== '' &&
    state.regimen !== null &&
    state.responsableIva !== null &&
    state.agenteRetencion !== null &&
    state.autorretenedor !== null &&
    state.responsableIca !== null &&
    state.facturacionElectronica !== null &&
    state.actividadPrincipal !== null &&
    state.codigoCiiu.trim() !== '';

  const canGoNextForStep = (i: number): boolean => {
    switch (i) {
      case 0:
        return true;
      case 1:
        return state.personaType !== null;
      case 2:
        return state.nitUltimoDigito.trim() !== '' && state.digitoVerificacion.trim() !== '';
      case 3:
        return state.regimen !== null;
      case 4:
        return (
          state.responsableIva !== null &&
          state.agenteRetencion !== null &&
          state.autorretenedor !== null &&
          state.responsableIca !== null &&
          state.facturacionElectronica !== null
        );
      case 5:
        return state.actividadPrincipal !== null && state.codigoCiiu.trim() !== '';
      case 6:
        if (state.siigoChoice === 'yes') {
          return state.siigoUsername.trim() !== '' && state.siigoAccessKey.trim() !== '';
        }
        return state.siigoChoice !== null;
      case 7:
        return requiredComplete;
      default:
        return true;
    }
  };

  const handleConfirm = async () => {
    if (!requiredComplete) {
      toast.error('Revisa los campos marcados. Algunos están incompletos.');
      return;
    }
    setSaving(true);

    const fiscalPayload = {
      persona_type: state.personaType!,
      nit_ultimo_digito: parseInt(state.nitUltimoDigito),
      nit_digit: parseInt(state.digitoVerificacion),
      renta_type: (state.personaType === 'natural' ? 'natural' : 'juridica') as 'natural' | 'juridica',
      regimen: state.regimen!,
      responsable_iva: state.responsableIva!,
      agente_retencion: state.agenteRetencion!,
      autorretenedor: state.autorretenedor!,
      responsable_ica: state.responsableIca!,
      facturacion_electronica: state.facturacionElectronica!,
      nombre_facturador: state.nombreFacturador.trim() || null,
      nivel_ingresos: state.nivelIngresos,
      actividad_principal: state.actividadPrincipal!,
      codigo_ciiu: state.codigoCiiu.trim(),
    };

    try {
      if (user?.id) {
        localStorage.setItem(`fiscal_config:${user.id}`, JSON.stringify(fiscalPayload));
        localStorage.setItem(`onboarding_completed:${user.id}`, 'true');
      }
    } catch {
      /* localStorage may be unavailable */
    }

    try {
      await saveConfig.mutateAsync(fiscalPayload);
    } catch (err: any) {
      console.warn('[onboarding] fiscal_config DB save failed, keeping local copy:', err?.message);
      Sentry.captureException(err, { tags: { feature: 'onboarding', step: 'fiscal_config_save' } });
    }

    try {
      const profilePayload: Record<string, any> = {
        user_id: user!.id,
        onboarding_completed: true,
      };
      if (state.nombreComercial.trim()) profilePayload.company_name = state.nombreComercial.trim();
      if (state.nombreUsuario.trim()) profilePayload.full_name = state.nombreUsuario.trim();
      const { error: profileError } = await (supabase as any)
        .from('profiles')
        .upsert(profilePayload, { onConflict: 'user_id' });
      if (profileError) throw profileError;
    } catch (err: any) {
      console.warn('[onboarding] profile upsert failed:', err?.message);
      Sentry.captureException(err, { tags: { feature: 'onboarding', step: 'profile_upsert' } });
    }

    // Siigo connect (best-effort; don't block onboarding on failure)
    if (state.siigoChoice === 'yes' && state.siigoUsername && state.siigoAccessKey) {
      try {
        const { data, error } = await supabase.functions.invoke('siigo-connect', {
          body: {
            username: state.siigoUsername,
            access_key: state.siigoAccessKey,
            partner_id: state.siigoPartnerId || 'aluminiapp',
          },
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || 'Conexión rechazada por Siigo');
        toast.success('Siigo conectado correctamente');
      } catch (err: any) {
        console.warn('[onboarding] siigo-connect failed:', err?.message);
        Sentry.captureException(err, { tags: { feature: 'onboarding', step: 'siigo_connect' } });
        toast.warning(
          'No se pudo conectar Siigo ahora, pero tu perfil quedó guardado. Reintenta desde Ajustes.',
        );
      }
    }

    try {
      await markComplete();
    } catch (err) {
      Sentry.captureException(err, { tags: { feature: 'onboarding', step: 'mark_complete_call' } });
    }

    toast.success('Perfil fiscal guardado');
    setSaving(false);
    setStepIndex(8); // advance to welcome
  };

  const handleTourNavigate = (path: string) => {
    // Hard navigation to ensure fresh state (onboarding_completed=true already set)
    window.location.assign(path);
  };

  // Render step content + CTAs ─────────────────────────────────────────────
  const leftMeta = LEFT_CONTENT[stepIndex];
  const isConfirmStep = stepIndex === 7;
  const isWelcomeStep = stepIndex === 8;

  let stepContent: React.ReactNode = null;
  let nextLabel = 'Continuar';
  let nextIcon: React.ReactNode | undefined;
  let hideNext = false;
  let hideBack = false;

  switch (stepIndex) {
    case 0:
      stepContent = <Step01Welcome />;
      nextLabel = 'Empezar';
      nextIcon = <Sparkles style={{ width: 14, height: 14 }} />;
      hideBack = true;
      break;
    case 1:
      stepContent = <Step02Persona state={state} update={update} />;
      break;
    case 2:
      stepContent = <Step03NIT state={state} update={update} />;
      break;
    case 3:
      stepContent = <Step04Regimen state={state} update={update} />;
      break;
    case 4:
      stepContent = <Step05Responsabilidades state={state} update={update} />;
      break;
    case 5:
      stepContent = <Step06Actividad state={state} update={update} />;
      break;
    case 6:
      stepContent = <Step07Siigo state={state} update={update} />;
      break;
    case 7:
      stepContent = <Step08Resumen state={state} update={update} goTo={goTo} />;
      nextLabel = 'Confirmar y guardar';
      nextIcon = <CheckCircle2 style={{ width: 14, height: 14 }} />;
      break;
    case 8:
      stepContent = <Step09Welcome userName={state.nombreUsuario || user?.user_metadata?.full_name} />;
      nextLabel = 'Empezar tour';
      nextIcon = <ArrowRight style={{ width: 14, height: 14 }} />;
      hideBack = true;
      break;
    case 9:
      stepContent = <Step10Tour onNavigate={handleTourNavigate} />;
      hideNext = true;
      hideBack = false;
      break;
  }

  const handleNext = () => {
    if (isConfirmStep) {
      handleConfirm();
      return;
    }
    if (isWelcomeStep) {
      setStepIndex(9);
      return;
    }
    setStepIndex((i) => Math.min(i + 1, LEFT_CONTENT.length - 1));
  };

  const handleBack = () => setStepIndex((i) => Math.max(i - 1, 0));

  return (
    <OnboardingShell
      stepIndex={stepIndex}
      leftHeadline={leftMeta.headline}
      leftSubtitle={leftMeta.subtitle}
      onBack={hideBack ? undefined : handleBack}
      onNext={hideNext ? undefined : handleNext}
      canGoNext={canGoNextForStep(stepIndex)}
      nextLabel={nextLabel}
      nextLoading={saving}
      nextIcon={nextIcon}
      hideBack={hideBack || stepIndex === 0}
      hideNext={hideNext}
    >
      {stepContent}
    </OnboardingShell>
  );
}
