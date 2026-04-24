import { Plug, Clock, X, Info } from 'lucide-react';
import OptionCard from '../OptionCard';
import TextField from '../TextField';
import type { StepProps } from '../state';
import { INK, INK2 } from '../OnboardingShell';

export default function Step07Siigo({ state, update }: StepProps) {
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
        ¿Usas Siigo?
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
        Si ya facturas con Siigo, lo conectamos aquí mismo y traemos tus ventas sin que digites nada.
      </p>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.15s both',
          opacity: 0,
        }}
      >
        <OptionCard
          selected={state.siigoChoice === 'yes'}
          onClick={() => update('siigoChoice', 'yes')}
          icon={<Plug style={{ width: 20, height: 20 }} />}
          title="Sí, ya uso Siigo"
          description="Tengo credenciales API y quiero conectarlo ahora."
          footnote="Lo pedimos: usuario de Siigo + access key. Si no los tienes, mira Siigo → Ajustes → Integraciones."
        />
        <OptionCard
          selected={state.siigoChoice === 'no'}
          onClick={() => update('siigoChoice', 'no')}
          icon={<X style={{ width: 20, height: 20 }} />}
          title="No uso Siigo"
          description="Uso otro facturador o todavía no facturo electrónicamente."
          footnote="Cargarás ventas manualmente o desde CSV — cero problema."
        />
        <OptionCard
          selected={state.siigoChoice === 'later'}
          onClick={() => update('siigoChoice', 'later')}
          icon={<Clock style={{ width: 20, height: 20 }} />}
          title="Todavía no, lo configuro después"
          description="Prefiero saltar este paso y conectarlo desde Ajustes cuando tenga las credenciales."
          footnote="Se puede activar en cualquier momento sin perder data."
        />
      </div>

      {/* Siigo credentials (only when 'yes') */}
      {state.siigoChoice === 'yes' && (
        <div
          style={{
            marginTop: 20,
            padding: 16,
            background: '#f5f5f7',
            borderRadius: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            animation: 'fieldIn 0.4s cubic-bezier(0.16,1,0.3,1) both',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <Info
              style={{
                width: 16,
                height: 16,
                color: 'oklch(0.43 0.14 155)',
                flexShrink: 0,
                marginTop: 2,
              }}
            />
            <p style={{ fontSize: 12, color: INK2, lineHeight: 1.5, margin: 0 }}>
              Estas credenciales se guardan encriptadas. Si la conexión falla, te dejamos seguir sin Siigo y
              puedes reintentar desde Ajustes.
            </p>
          </div>

          <TextField
            label="Usuario Siigo"
            value={state.siigoUsername}
            onChange={(v) => update('siigoUsername', v)}
            placeholder="usuario@empresa.com"
          />
          <TextField
            label="Access Key"
            type="password"
            value={state.siigoAccessKey}
            onChange={(v) => update('siigoAccessKey', v)}
            placeholder="Access key de la API"
          />
          <TextField
            label="Partner ID"
            value={state.siigoPartnerId}
            onChange={(v) => update('siigoPartnerId', v)}
            placeholder="aluminiapp"
            hint="Déjalo en 'aluminiapp' si no sabes."
          />
        </div>
      )}
    </div>
  );
}
