import { Sparkles, Clock, Shield, Zap } from 'lucide-react';
import { INK, INK2 } from '../OnboardingShell';

const BENEFITS = [
  { Icon: Clock, title: '5 minutos, ni uno más', text: 'Preguntas cortas, respuestas con ejemplos.' },
  { Icon: Shield, title: 'Tu data queda privada', text: 'Nadie la ve fuera de tu cuenta.' },
  { Icon: Zap, title: 'Ajustable después', text: 'Todo se puede cambiar desde Ajustes.' },
];

export default function Step01Welcome() {
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
          color: 'oklch(0.43 0.14 155)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.3,
          marginBottom: 16,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.05s both',
          opacity: 0,
        }}
      >
        <Sparkles style={{ width: 12, height: 12 }} />
        EMPECEMOS
      </div>

      <h2
        style={{
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: '-1px',
          color: INK,
          marginBottom: 12,
          lineHeight: 1.1,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.1s both',
          opacity: 0,
        }}
      >
        Preparemos tu cuenta
      </h2>
      <p
        style={{
          fontSize: 15,
          color: INK2,
          lineHeight: 1.6,
          marginBottom: 28,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.15s both',
          opacity: 0,
        }}
      >
        Necesitamos entender tu negocio para que AluminIA te dé alertas útiles — no genéricas. Te vamos a hacer
        unas preguntas sobre cómo vendes, cómo facturas y qué impuestos declaras.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {BENEFITS.map((b, i) => (
          <div
            key={b.title}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: 14,
              background: '#f5f5f7',
              borderRadius: 12,
              animation: `fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) ${0.22 + i * 0.06}s both`,
              opacity: 0,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              }}
            >
              <b.Icon style={{ width: 16, height: 16, color: 'oklch(0.43 0.14 155)' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: INK, marginBottom: 2 }}>
                {b.title}
              </div>
              <div style={{ fontSize: 12.5, color: INK2, lineHeight: 1.5 }}>{b.text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
