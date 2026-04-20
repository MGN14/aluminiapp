import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useFiscalConfig } from '@/hooks/useFiscalConfig';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { ClipboardList, Loader2, Save, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

type PersonaType = 'natural' | 'juridica';
type Regimen = 'comun' | 'simple' | 'especial';
type NivelIngresos = 'menos_92k_uvt' | 'mas_92k_uvt';
type ActividadPrincipal = 'comercial' | 'servicios' | 'industrial' | 'construccion' | 'otro';

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
        'w-full text-left rounded-lg border-2 px-3 py-2 transition-all',
        selected
          ? 'border-accent bg-accent/5 text-foreground'
          : 'border-border bg-background hover:border-accent/50 text-muted-foreground hover:text-foreground',
      )}
    >
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            'w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center',
            selected ? 'border-accent bg-accent' : 'border-muted-foreground',
          )}
        >
          {selected && <div className="w-1 h-1 rounded-full bg-white" />}
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
    </button>
  );
}

function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <OptionCard selected={value === true} onClick={() => onChange(true)} label="Sí" />
      <OptionCard selected={value === false} onClick={() => onChange(false)} label="No" />
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {children}
    </div>
  );
}

export default function FiscalProfileCard() {
  const { user } = useAuth();
  const { config, isLoading, saveConfig } = useFiscalConfig();

  const [personaType, setPersonaType] = useState<PersonaType | null>(null);
  const [nitUltimoDigito, setNitUltimoDigito] = useState('');
  const [digitoVerificacion, setDigitoVerificacion] = useState('');
  const [regimen, setRegimen] = useState<Regimen | null>(null);
  const [responsableIva, setResponsableIva] = useState<boolean | null>(null);
  const [agenteRetencion, setAgenteRetencion] = useState<boolean | null>(null);
  const [autorretenedor, setAutorretenedor] = useState<boolean | null>(null);
  const [responsableIca, setResponsableIca] = useState<boolean | null>(null);
  const [facturacionElectronica, setFacturacionElectronica] = useState<boolean | null>(null);
  const [nombreFacturador, setNombreFacturador] = useState('');
  const [nivelIngresos, setNivelIngresos] = useState<NivelIngresos | null>(null);
  const [actividadPrincipal, setActividadPrincipal] = useState<ActividadPrincipal | null>(null);
  const [codigoCiiu, setCodigoCiiu] = useState('');
  const [saving, setSaving] = useState(false);

  // Prefill state from DB once config loads
  useEffect(() => {
    if (!config) return;
    setPersonaType(config.persona_type);
    setNitUltimoDigito(config.nit_ultimo_digito != null ? String(config.nit_ultimo_digito) : '');
    setDigitoVerificacion(config.nit_digit != null ? String(config.nit_digit) : '');
    setRegimen(config.regimen);
    setResponsableIva(config.responsable_iva);
    setAgenteRetencion(config.agente_retencion);
    setAutorretenedor(config.autorretenedor);
    setResponsableIca(config.responsable_ica);
    setFacturacionElectronica(config.facturacion_electronica);
    setNombreFacturador(config.nombre_facturador ?? '');
    setNivelIngresos(config.nivel_ingresos);
    setActividadPrincipal(config.actividad_principal);
    setCodigoCiiu(config.codigo_ciiu ?? '');
  }, [config]);

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

  const handleSave = async () => {
    if (!requiredComplete) {
      toast.error('Completá todos los campos obligatorios (*)');
      return;
    }
    setSaving(true);
    try {
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

      // Ensure onboarding is marked complete after an edit from Settings too.
      await (supabase as any)
        .from('profiles')
        .upsert(
          { user_id: user!.id, onboarding_completed: true },
          { onConflict: 'user_id' },
        );
    } catch {
      // saveConfig shows its own toast on error
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
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
          <ClipboardList className="h-5 w-5 text-muted-foreground" />
          Perfil Fiscal
        </CardTitle>
        <CardDescription>
          Tu identidad fiscal y responsabilidades tributarias (las 10 preguntas del onboarding).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert className="border-destructive/30 bg-destructive/5">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <AlertDescription className="text-xs text-foreground">
            Cambiar estos datos puede afectar cálculos fiscales importantes. Modificá sólo si hay un error en la configuración original.
          </AlertDescription>
        </Alert>

        {/* Identificación */}
        <div className="space-y-4">
          <Field label="Tipo de persona" required>
            <div className="grid grid-cols-2 gap-2">
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

          <div className="grid grid-cols-2 gap-3">
            <Field label="Último dígito NIT" required>
              <Input
                type="text"
                inputMode="numeric"
                placeholder="Ej: 6"
                value={nitUltimoDigito}
                onChange={e => setNitUltimoDigito(e.target.value.replace(/\D/g, '').slice(0, 1))}
                className="h-10 text-center font-mono"
              />
            </Field>
            <Field label="Dígito de verificación" required>
              <Input
                type="text"
                inputMode="numeric"
                placeholder="Ej: 7"
                value={digitoVerificacion}
                onChange={e => setDigitoVerificacion(e.target.value.replace(/\D/g, '').slice(0, 1))}
                className="h-10 text-center font-mono"
              />
            </Field>
          </div>
        </div>

        {/* Régimen */}
        <Field label="Régimen tributario" required>
          <div className="space-y-2">
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
              description="Simplificación del cumplimiento para pequeños contribuyentes"
            />
            <OptionCard
              selected={regimen === 'especial'}
              onClick={() => setRegimen('especial')}
              label="Régimen Especial"
              description="Cooperativas, fundaciones, asociaciones sin ánimo de lucro"
            />
          </div>
        </Field>

        {/* Responsabilidades */}
        <div className="space-y-4">
          <Field label="¿Responsable de IVA?" required>
            <YesNo value={responsableIva} onChange={setResponsableIva} />
          </Field>
          <Field label="¿Realiza retenciones en la fuente?" required>
            <YesNo value={agenteRetencion} onChange={setAgenteRetencion} />
          </Field>
          <Field label="¿Autorretenedor?" required>
            <YesNo value={autorretenedor} onChange={setAutorretenedor} />
          </Field>
          <Field label="¿Paga ICA?" required>
            <YesNo value={responsableIca} onChange={setResponsableIca} />
          </Field>
          <Field label="¿Obligado a facturación electrónica?" required>
            <YesNo value={facturacionElectronica} onChange={setFacturacionElectronica} />
          </Field>

          {facturacionElectronica && (
            <Field label="Nombre del facturador electrónico">
              <Input
                placeholder="Ej: Siigo, Alegra, Facturante..."
                value={nombreFacturador}
                onChange={e => setNombreFacturador(e.target.value)}
                className="h-10"
              />
            </Field>
          )}
        </div>

        {/* Nivel de ingresos */}
        <Field label="Ingresos del año anterior (aprox.)">
          <div className="space-y-2">
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

        {/* Actividad económica */}
        <Field label="Actividad principal">
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
            className="h-10 font-mono"
            maxLength={6}
          />
          <p className="text-xs text-muted-foreground mt-1">Lo encontrás en tu RUT (casilla 46)</p>
        </Field>

        <Button onClick={handleSave} disabled={saving || !requiredComplete} className="w-full sm:w-auto">
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Guardar perfil fiscal
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
