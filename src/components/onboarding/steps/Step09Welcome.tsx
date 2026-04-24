import { PartyPopper, Package, Bot, TrendingUp, FileSpreadsheet } from 'lucide-react';
import { BRAND, INK, INK2 } from '../OnboardingShell';

const FEATURES = [
  {
    Icon: Package,
    title: 'Inventario operativo',
    text: 'Registra productos, controla stock y genera alertas automáticas cuando algo baja.',
  },
  {
    Icon: TrendingUp,
    title: 'Entradas y salidas',
    text: 'Rastrea movimientos de mercancía y analiza tendencias de rotación.',
  },
  {
    Icon: FileSpreadsheet,
    title: 'Conciliación Siigo',
    text: 'Compara tu inventario físico con lo que dice Siigo y detecta descuadres.',
  },
  {
    Icon: Bot,
    title: 'Nico, tu copiloto',
    text: 'Te envía insights automáticos: qué productos están críticos, qué capital tienes detenido.',
  },
];

interface Props {
  userName?: string | null;
}

export default function Step09Welcome({ userName }: Props) {
  const firstName = userName?.trim().split(/\s+/)[0] || '';

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
          marginBottom: 16,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.05s both',
          opacity: 0,
        }}
      >
        <PartyPopper style={{ width: 12, height: 12 }} />
        ¡CONFIGURACIÓN COMPLETA!
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
        Bienvenido{firstName ? `, ${firstName}` : ''}
      </h2>
      <p
        style={{
          fontSize: 15,
          color: INK2,
          lineHeight: 1.6,
          marginBottom: 20,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.15s both',
          opacity: 0,
        }}
      >
        Tu perfil fiscal quedó guardado. Empezamos con el plan <strong style={{ color: INK }}>gratuito</strong>,
        que incluye todo lo siguiente sin límite:
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          marginBottom: 20,
        }}
      >
        {FEATURES.map((f, i) => (
          <div
            key={f.title}
            style={{
              padding: 14,
              background: '#f5f5f7',
              borderRadius: 12,
              animation: `fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) ${0.22 + i * 0.06}s both`,
              opacity: 0,
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                background: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 10,
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              }}
            >
              <f.Icon style={{ width: 17, height: 17, color: BRAND }} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: INK, marginBottom: 3 }}>{f.title}</div>
            <div style={{ fontSize: 11.5, color: INK2, lineHeight: 1.5 }}>{f.text}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          padding: 14,
          background: 'oklch(0.43 0.14 155 / 0.06)',
          border: '1px solid oklch(0.43 0.14 155 / 0.14)',
          borderRadius: 12,
          fontSize: 12.5,
          color: INK2,
          lineHeight: 1.55,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.50s both',
          opacity: 0,
        }}
      >
        Cuando estés listo para reportes avanzados (P&G, CxC, CxP, anticipos, Visita DIAN), puedes activar el
        plan <strong style={{ color: INK }}>Empresarial</strong> desde Ajustes.
      </div>
    </div>
  );
}
