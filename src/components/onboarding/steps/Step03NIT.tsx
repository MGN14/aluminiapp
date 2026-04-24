import { Shield } from 'lucide-react';
import TextField from '../TextField';
import type { StepProps } from '../state';
import { INK, INK2 } from '../OnboardingShell';

export default function Step03NIT({ state, update }: StepProps) {
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
        Tu NIT y nombre comercial
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
        Necesitamos los dos dígitos del NIT para saber cuándo te toca declarar. Nada más.
      </p>

      {/* NIT digits */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginBottom: 16,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.15s both',
          opacity: 0,
        }}
      >
        <TextField
          label="Último dígito del NIT"
          hint="Antes del guion"
          value={state.nitUltimoDigito}
          onChange={(v) => update('nitUltimoDigito', v)}
          placeholder="Ej: 6"
          onlyDigits
          maxLength={1}
          centered
          monospace
          fontSize={22}
        />
        <TextField
          label="Dígito de verificación"
          hint="Después del guion"
          value={state.digitoVerificacion}
          onChange={(v) => update('digitoVerificacion', v)}
          placeholder="Ej: 7"
          onlyDigits
          maxLength={1}
          centered
          monospace
          fontSize={22}
        />
      </div>

      {/* Disclaimer simulador */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          padding: 14,
          background: 'oklch(0.52 0.16 240 / 0.06)',
          border: '1px solid oklch(0.52 0.16 240 / 0.16)',
          borderRadius: 12,
          marginBottom: 24,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.22s both',
          opacity: 0,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'oklch(0.52 0.16 240 / 0.14)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Shield style={{ width: 16, height: 16, color: 'oklch(0.52 0.16 240)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: INK,
              marginBottom: 4,
            }}
          >
            AluminIA no reporta a la DIAN
          </div>
          <p style={{ fontSize: 12.5, color: INK2, lineHeight: 1.55, margin: 0 }}>
            Somos una herramienta de <strong>simulación y análisis</strong> — no somos facturador electrónico ni
            reportamos información fiscal en tu nombre. Usamos tu NIT solo para saber tus fechas de declaración. Tu
            contador sigue siendo quien presenta todo ante la DIAN.
          </p>
        </div>
      </div>

      {/* Nombre comercial + usuario */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.28s both',
          opacity: 0,
        }}
      >
        <TextField
          label="Nombre comercial (opcional)"
          hint="Cómo conocen a tu empresa tus clientes."
          value={state.nombreComercial}
          onChange={(v) => update('nombreComercial', v)}
          placeholder="Ej: Distribuidora El Sol"
        />
        <TextField
          label="Tu nombre (opcional)"
          hint="Así te saludamos en la app."
          value={state.nombreUsuario}
          onChange={(v) => update('nombreUsuario', v)}
          placeholder="Tu nombre completo"
        />
      </div>
    </div>
  );
}
