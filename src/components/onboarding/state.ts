// Shared onboarding form state shape. The orchestrator holds one instance
// of this and passes slices down to each step.

export interface OnboardingState {
  // Step 2 — Persona
  personaType: 'natural' | 'juridica' | null;

  // Step 3 — NIT
  nitUltimoDigito: string;
  digitoVerificacion: string;
  nombreComercial: string;
  nombreUsuario: string;

  // Step 4 — Régimen
  regimen: 'comun' | 'simple' | 'especial' | null;

  // Step 5 — Responsabilidades
  responsableIva: boolean | null;
  agenteRetencion: boolean | null;
  autorretenedor: boolean | null;
  responsableIca: boolean | null;
  facturacionElectronica: boolean | null;
  nombreFacturador: string;

  // Step 6 — Actividad
  actividadPrincipal: 'distribuidor' | 'fabricante' | 'servicios' | 'construccion' | 'mixto' | null;
  codigoCiiu: string;
  nivelIngresos: 'menos_92k_uvt' | 'mas_92k_uvt' | null;

  // Step 7 — Siigo
  siigoChoice: 'yes' | 'no' | 'later' | null;
  siigoUsername: string;
  siigoAccessKey: string;
  siigoPartnerId: string;
}

export const INITIAL_STATE: OnboardingState = {
  personaType: null,
  nitUltimoDigito: '',
  digitoVerificacion: '',
  nombreComercial: '',
  nombreUsuario: '',
  regimen: null,
  responsableIva: null,
  agenteRetencion: null,
  autorretenedor: null,
  responsableIca: null,
  facturacionElectronica: null,
  nombreFacturador: '',
  actividadPrincipal: null,
  codigoCiiu: '',
  nivelIngresos: null,
  siigoChoice: null,
  siigoUsername: '',
  siigoAccessKey: '',
  siigoPartnerId: 'aluminiapp',
};

export interface StepProps {
  state: OnboardingState;
  update: <K extends keyof OnboardingState>(key: K, value: OnboardingState[K]) => void;
  goTo?: (stepIndex: number) => void;
}
