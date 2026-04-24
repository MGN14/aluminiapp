import { Pencil, CheckCircle2 } from 'lucide-react';
import type { StepProps } from '../state';
import { BRAND, INK, INK2, INK3 } from '../OnboardingShell';
import { findCiiuByCode } from '@/data/ciiuCodes';

const PERSONA_LABEL = { natural: 'Persona natural', juridica: 'Persona jurídica' };
const REGIMEN_LABEL = { comun: 'Régimen Común', simple: 'Régimen Simple (SIMPLE)', especial: 'Régimen Especial' };
const ACTIVIDAD_LABEL = {
  distribuidor: 'Distribuidor',
  fabricante: 'Fabricante',
  servicios: 'Servicios',
  construccion: 'Construcción',
  mixto: 'Mixto',
};
const INGRESOS_LABEL = {
  menos_92k_uvt: 'Menos de 92.000 UVT',
  mas_92k_uvt: 'Más de 92.000 UVT',
};
const SIIGO_LABEL = {
  yes: 'Conectado',
  no: 'No uso Siigo',
  later: 'Pendiente para después',
};

interface Row {
  label: string;
  value: string | React.ReactNode;
}

function Section({
  title,
  step,
  rows,
  onEdit,
}: {
  title: string;
  step: number;
  rows: Row[];
  onEdit: () => void;
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid rgba(0,0,0,0.06)',
        borderRadius: 14,
        padding: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
          paddingBottom: 10,
          borderBottom: '1px solid rgba(0,0,0,0.05)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              display: 'inline-flex',
              width: 22,
              height: 22,
              borderRadius: 6,
              background: 'oklch(0.43 0.14 155 / 0.10)',
              color: BRAND,
              fontSize: 11,
              fontWeight: 700,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {step}
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{title}</span>
        </div>
        <button
          type="button"
          onClick={onEdit}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            border: 'none',
            background: 'transparent',
            color: BRAND,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            padding: 2,
            fontFamily: 'inherit',
          }}
        >
          <Pencil style={{ width: 11, height: 11 }} />
          Editar
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr',
              gap: 10,
              fontSize: 12.5,
              alignItems: 'baseline',
            }}
          >
            <span style={{ color: INK3 }}>{r.label}</span>
            <span style={{ color: INK, fontWeight: 500 }}>
              {r.value || <span style={{ color: INK3, fontStyle: 'italic' }}>— sin definir —</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Step08Resumen({ state, goTo }: StepProps) {
  const ciiu = state.codigoCiiu ? findCiiuByCode(state.codigoCiiu) : null;

  return (
    <div>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          borderRadius: 99,
          background: 'oklch(0.43 0.14 155 / 0.10)',
          color: BRAND,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.3,
          marginBottom: 12,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.05s both',
          opacity: 0,
        }}
      >
        <CheckCircle2 style={{ width: 12, height: 12 }} />
        ÚLTIMO PASO
      </div>

      <h2
        style={{
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: '-0.8px',
          color: INK,
          marginBottom: 10,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.1s both',
          opacity: 0,
        }}
      >
        Revisa tu configuración
      </h2>
      <p
        style={{
          fontSize: 14.5,
          color: INK2,
          lineHeight: 1.6,
          marginBottom: 24,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.15s both',
          opacity: 0,
        }}
      >
        Verifica que todo esté bien. Si hay algo incorrecto, puedes editarlo. Al confirmar, guardamos tu perfil.
      </p>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.22s both',
          opacity: 0,
        }}
      >
        <Section
          title="Persona"
          step={2}
          onEdit={() => goTo?.(1)}
          rows={[{ label: 'Tipo', value: state.personaType ? PERSONA_LABEL[state.personaType] : '' }]}
        />

        <Section
          title="NIT y nombre"
          step={3}
          onEdit={() => goTo?.(2)}
          rows={[
            {
              label: 'NIT',
              value:
                state.nitUltimoDigito && state.digitoVerificacion
                  ? `…${state.nitUltimoDigito}-${state.digitoVerificacion}`
                  : '',
            },
            { label: 'Nombre comercial', value: state.nombreComercial },
            { label: 'Usuario', value: state.nombreUsuario },
          ]}
        />

        <Section
          title="Régimen"
          step={4}
          onEdit={() => goTo?.(3)}
          rows={[{ label: 'Tipo', value: state.regimen ? REGIMEN_LABEL[state.regimen] : '' }]}
        />

        <Section
          title="Responsabilidades"
          step={5}
          onEdit={() => goTo?.(4)}
          rows={[
            { label: 'IVA', value: state.responsableIva === null ? '' : state.responsableIva ? 'Sí' : 'No' },
            { label: 'Retenciones', value: state.agenteRetencion === null ? '' : state.agenteRetencion ? 'Sí' : 'No' },
            { label: 'Autorretenedor', value: state.autorretenedor === null ? '' : state.autorretenedor ? 'Sí' : 'No' },
            { label: 'ICA', value: state.responsableIca === null ? '' : state.responsableIca ? 'Sí' : 'No' },
            {
              label: 'Fact. electrónica',
              value:
                state.facturacionElectronica === null
                  ? ''
                  : state.facturacionElectronica
                    ? `Sí${state.nombreFacturador ? ` — ${state.nombreFacturador}` : ''}`
                    : 'No',
            },
          ]}
        />

        <Section
          title="Actividad"
          step={6}
          onEdit={() => goTo?.(5)}
          rows={[
            {
              label: 'Principal',
              value: state.actividadPrincipal ? ACTIVIDAD_LABEL[state.actividadPrincipal] : '',
            },
            {
              label: 'Código CIIU',
              value: ciiu ? (
                <span>
                  <span style={{ fontFamily: 'ui-monospace, monospace', color: BRAND, fontWeight: 600 }}>
                    {ciiu.code}
                  </span>{' '}
                  — {ciiu.label}
                </span>
              ) : (
                ''
              ),
            },
            {
              label: 'Ingresos anteriores',
              value: state.nivelIngresos ? INGRESOS_LABEL[state.nivelIngresos] : '',
            },
          ]}
        />

        <Section
          title="Siigo"
          step={7}
          onEdit={() => goTo?.(6)}
          rows={[
            { label: 'Estado', value: state.siigoChoice ? SIIGO_LABEL[state.siigoChoice] : '' },
            ...(state.siigoChoice === 'yes'
              ? [{ label: 'Usuario', value: state.siigoUsername }]
              : []),
          ]}
        />
      </div>
    </div>
  );
}
