import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileSpreadsheet, Loader2, CheckCircle2, Building2, Receipt, Landmark, BarChart2, Factory } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useFiscalConfig } from '@/hooks/useFiscalConfig';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ── Radio / Checkbox card ─────────────────────────────────────────────────────
function OptionCard({
  selected,
  onClick,
  label,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-xl border-2 px-4 py-3 transition-all',
        selected
          ? 'border-accent bg-accent/5 text-foreground'
          : 'border-border bg-background hover:border-accent/50 text-muted-foreground hover:text-foreground',
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn(
          'w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center',
          selected ? 'border-accent bg-accent' : 'border-muted-foreground',
        )}>
          {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
    </button>
  );
}

// ── Boolean pair (Sí / No) ────────────────────────────────────────────────────
function YesNo({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <OptionCard selected={value === true} onClick={() => onChange(true)} label="Sí" />
      <OptionCard selected={value === false} onClick={() => onChange(false)} label="No" />
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, number, title }: { icon: any; number: string; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-5 pb-3 border-b border-border">
      <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-accent" />
      </div>
      <div>
        <p className="text-[10px] font-semibold text-accent uppercase tracking-wider">{number}</p>
        <p className="text-sm font-semibold text-foreground">{title}</p>
      </div>
    </div>
  );
}

// ── Field wrapper ──────────────────────────────────────────────────────────────
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {children}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function Onboarding() {
  const { user } = useAuth();
  const { saveConfig } = useFiscalConfig();
  const { markComplete } = useOnboardingStatus();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  // 1. IDENTIFICACIÓN
  const [personaType, setPersonaType] = useState<'natural' | 'juridica' | null>(null);
  const [nitUltimoDigito, setNitUltimoDigito] = useState('');
  const [digitoVerificacion, setDigitoVerificacion] = useState('');
  const [nombreComercial, setNombreComercial] = useState('');
  const [nombreUsuario, setNombreUsuario] = useState(user?.user_metadata?.full_name ?? '');

  // 2. RÉGIMEN
  const [regimen, setRegimen] = useState<'comun' | 'simple' | 'especial' | null>(null);

  // 3. RESPONSABILIDADES
  const [responsableIva, setResponsableIva] = useState<boolean | null>(null);
  const [agenteRetencion, setAgenteRetencion] = useState<boolean | null>(null);
  const [autorretenedor, setAutorretenedor] = useState<boolean | null>(null);
  const [responsableIca, setResponsableIca] = useState<boolean | null>(null);
  const [facturacionElectronica, setFacturacionElectronica] = useState<boolean | null>(null);
  const [nombreFacturador, setNombreFacturador] = useState('');

  // 4. INGRESOS
  const [nivelIngresos, setNivelIngresos] = useState<'menos_92k_uvt' | 'mas_92k_uvt' | null>(null);

  // 5. ACTIVIDAD
  const [actividadPrincipal, setActividadPrincipal] = useState<'comercial' | 'servicios' | 'industrial' | 'construccion' | 'otro' | null>(null);
  const [codigoCiiu, setCodigoCiiu] = useState('');

  const requiredComplete =
    personaType !== null &&
    nitUltimoDigito.trim() !== '' &&
    digitoVerificacion.trim() !== '' &&
    regimen !== null &&
    responsableIva !== null &&
    agenteRetencion !== null &&
    autorretenedor !== null &&
    responsableIca !== null &&
    facturacionElectronica !== null &&
    codigoCiiu.trim() !== '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requiredComplete) {
      toast.error('Completa todos los campos obligatorios (*) para continuar');
      return;
    }
    setSaving(true);
    try {
      // Save fiscal config
      await saveConfig.mutateAsync({
        persona_type: personaType!,
        nit_ultimo_digito: parseInt(nitUltimoDigito),
        nit_digit: parseInt(digitoVerificacion),
        renta_type: personaType === 'natural' ? 'natural' : 'juridica',
        regimen: regimen!,
        responsable_iva: responsableIva!,
        agente_retencion: agenteRetencion!,
        autorretenedor: autorretenedor!,
        responsable_ica: responsableIca!,
        facturacion_electronica: facturacionElectronica!,
        nombre_facturador: nombreFacturador.trim() || null,
        nivel_ingresos: nivelIngresos,
        actividad_principal: actividadPrincipal,
        codigo_ciiu: codigoCiiu.trim(),
      });

      // Upsert profile: creates the row if it's missing, updates it otherwise.
      const profilePayload: Record<string, any> = {
        user_id: user!.id,
        onboarding_completed: true,
      };
      if (nombreComercial.trim()) profilePayload.company_name = nombreComercial.trim();
      if (nombreUsuario.trim()) profilePayload.full_name = nombreUsuario.trim();

      const { error: profileError } = await (supabase as any)
        .from('profiles')
        .upsert(profilePayload, { onConflict: 'user_id' });
      if (profileError) throw profileError;

      await markComplete();
      toast.success('Perfil fiscal guardado. Podés ajustarlo desde Ajustes.');
      navigate('/settings', { replace: true });
    } catch (err: any) {
      toast.error('Error al guardar: ' + (err?.message ?? 'Intenta de nuevo'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">Configuración inicial</p>
            <p className="text-xs text-muted-foreground">Completá tu perfil fiscal para comenzar</p>
          </div>
          <div className="text-xs text-muted-foreground">
            {[personaType, nitUltimoDigito, digitoVerificacion, regimen, responsableIva, agenteRetencion, autorretenedor, responsableIca, facturacionElectronica, codigoCiiu].filter(v => v !== null && v !== '').length} / 10 obligatorios
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto px-4 py-8 space-y-8">

        {/* ── 1. IDENTIFICACIÓN ─────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
          <SectionHeader icon={Building2} number="1" title="Identificación" />

          <Field label="Tipo de persona" required>
            <div className="grid grid-cols-2 gap-3">
              <OptionCard
                selected={personaType === 'natural'}
                onClick={() => setPersonaType('natural')}
                label="Persona natural"
              />
              <OptionCard
                selected={personaType === 'juridica'}
                onClick={() => setPersonaType('juridica')}
                label="Persona jurídica"
              />
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Último dígito del NIT (antes del -)" required>
              <Input
                type="number"
                min={0}
                max={9}
                maxLength={1}
                placeholder="Ej: 6"
                value={nitUltimoDigito}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 1);
                  setNitUltimoDigito(v);
                }}
                className="h-11 text-center text-lg font-mono"
              />
            </Field>

            <Field label="Dígito de verificación (después del -)" required>
              <Input
                type="number"
                min={0}
                max={9}
                maxLength={1}
                placeholder="Ej: 7"
                value={digitoVerificacion}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 1);
                  setDigitoVerificacion(v);
                }}
                className="h-11 text-center text-lg font-mono"
              />
            </Field>
          </div>

          <Field label="Nombre comercial de la empresa">
            <Input
              placeholder="Ej: Distribuidora El Sol"
              value={nombreComercial}
              onChange={e => setNombreComercial(e.target.value)}
              className="h-11"
            />
          </Field>

          <Field label="Nombre del usuario">
            <Input
              placeholder="Tu nombre completo"
              value={nombreUsuario}
              onChange={e => setNombreUsuario(e.target.value)}
              className="h-11"
            />
          </Field>
        </div>

        {/* ── 2. RÉGIMEN TRIBUTARIO ──────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
          <SectionHeader icon={Landmark} number="2" title="Régimen Tributario" />

          <Field label="Tipo de régimen" required>
            <div className="space-y-3">
              <OptionCard
                selected={regimen === 'comun'}
                onClick={() => setRegimen('comun')}
                label="Régimen Común"
                description="Personas jurídicas y naturales con ingresos significativos"
              />
              <OptionCard
                selected={regimen === 'simple'}
                onClick={() => setRegimen('simple')}
                label="Régimen Simple de Tributación"
                description="Simplificación del cumplimiento tributario para pequeños contribuyentes"
              />
              <OptionCard
                selected={regimen === 'especial'}
                onClick={() => setRegimen('especial')}
                label="Régimen Especial"
                description="Cooperativas, fundaciones, asociaciones sin ánimo de lucro"
              />
            </div>
          </Field>
        </div>

        {/* ── 3. RESPONSABILIDADES TRIBUTARIAS ──────────────────── */}
        <div className="rounded-2xl border border-border bg-card p-6 space-y-6">
          <SectionHeader icon={Receipt} number="3" title="Responsabilidades Tributarias" />

          <Field label="¿Eres responsable de IVA?" required>
            <YesNo value={responsableIva} onChange={setResponsableIva} />
          </Field>

          <Field label="¿Realizas retenciones en la fuente?" required>
            <YesNo value={agenteRetencion} onChange={setAgenteRetencion} />
          </Field>

          <Field label="¿Eres autorretenedor?" required>
            <YesNo value={autorretenedor} onChange={setAutorretenedor} />
          </Field>

          <Field label="¿Tu empresa paga ICA (Impuesto de Industria y Comercio)?" required>
            <YesNo value={responsableIca} onChange={setResponsableIca} />
          </Field>

          <Field label="¿Estás obligado a facturación electrónica?" required>
            <YesNo value={facturacionElectronica} onChange={setFacturacionElectronica} />
          </Field>

          {facturacionElectronica && (
            <Field label="Nombre del facturador electrónico">
              <Input
                placeholder="Ej: Siigo, Alegra, Facturante..."
                value={nombreFacturador}
                onChange={e => setNombreFacturador(e.target.value)}
                className="h-11"
              />
            </Field>
          )}
        </div>

        {/* ── 4. NIVEL DE INGRESOS ───────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
          <SectionHeader icon={BarChart2} number="4" title="Nivel de Ingresos" />
          <p className="text-xs text-muted-foreground -mt-2">
            Sugerimos usar los ingresos declarados ante la DIAN del año anterior.
          </p>

          <Field label="Ingresos del año anterior (aproximado)">
            <div className="space-y-3">
              <OptionCard
                selected={nivelIngresos === 'menos_92k_uvt'}
                onClick={() => setNivelIngresos('menos_92k_uvt')}
                label="Menos de 92.000 UVT"
                description="≈ menos de $4.300 millones COP (2024)"
              />
              <OptionCard
                selected={nivelIngresos === 'mas_92k_uvt'}
                onClick={() => setNivelIngresos('mas_92k_uvt')}
                label="Más de 92.000 UVT"
                description="≈ más de $4.300 millones COP (2024)"
              />
            </div>
          </Field>
        </div>

        {/* ── 5. ACTIVIDAD ECONÓMICA ─────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
          <SectionHeader icon={Factory} number="5" title="Actividad Económica" />

          <Field label="Actividad principal del negocio">
            <div className="space-y-2">
              {([
                { value: 'comercial', label: 'Comercial', desc: 'Compra y venta de bienes' },
                { value: 'servicios', label: 'Servicios', desc: 'Prestación de servicios' },
                { value: 'industrial', label: 'Industrial / producción', desc: 'Fabricación o transformación' },
                { value: 'construccion', label: 'Construcción', desc: 'Obras civiles e inmobiliarias' },
                { value: 'otro', label: 'Otro', desc: '' },
              ] as const).map(opt => (
                <OptionCard
                  key={opt.value}
                  selected={actividadPrincipal === opt.value}
                  onClick={() => setActividadPrincipal(opt.value)}
                  label={opt.label}
                  description={opt.desc || undefined}
                />
              ))}
            </div>
          </Field>

          <Field label="Código CIIU" required>
            <Input
              placeholder="Ej: 4711, 6201..."
              value={codigoCiiu}
              onChange={e => setCodigoCiiu(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="h-11 font-mono"
              maxLength={6}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Lo encontrás en tu RUT (casilla 46)
            </p>
          </Field>
        </div>

        {/* ── Submit ─────────────────────────────────────────────── */}
        <div className="pb-8">
          {!requiredComplete && (
            <p className="text-xs text-muted-foreground text-center mb-3">
              Completa los campos marcados con <span className="text-destructive">*</span> para continuar
            </p>
          )}
          <Button
            type="submit"
            className="w-full h-12 text-base"
            disabled={saving || !requiredComplete}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Completar configuración y entrar a AluminIA
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
