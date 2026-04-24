import { User, Building2 } from 'lucide-react';
import OptionCard from '../OptionCard';
import type { StepProps } from '../state';
import { INK, INK2 } from '../OnboardingShell';

export default function Step02Persona({ state, update }: StepProps) {
  return (
    <div>
      <h2
        style={{
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: '-0.8px',
          color: INK,
          marginBottom: 10,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.05s both',
          opacity: 0,
        }}
      >
        ¿Quién factura en tu negocio?
      </h2>
      <p
        style={{
          fontSize: 14.5,
          color: INK2,
          lineHeight: 1.6,
          marginBottom: 24,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.1s both',
          opacity: 0,
        }}
      >
        Esto cambia cómo se calculan tus impuestos y los plazos para declarar.
      </p>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.15s both',
          opacity: 0,
        }}
      >
        <OptionCard
          selected={state.personaType === 'natural'}
          onClick={() => update('personaType', 'natural')}
          icon={<User style={{ width: 22, height: 22 }} />}
          size="lg"
          title="Persona natural"
          description="Facturas con tu cédula. Típico de freelancers, profesionales independientes, emprendedores en sus primeros años."
          footnote="AluminIA calculará tu renta como natural y te avisará de fechas según tu cédula."
        />
        <OptionCard
          selected={state.personaType === 'juridica'}
          onClick={() => update('personaType', 'juridica')}
          icon={<Building2 style={{ width: 22, height: 22 }} />}
          size="lg"
          title="Persona jurídica"
          description="Tienes una empresa constituida (SAS, Ltda., S.A.). Facturas con NIT empresarial."
          footnote="AluminIA calculará impuestos corporativos y separará responsabilidades de socios."
        />
      </div>
    </div>
  );
}
