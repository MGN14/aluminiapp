import { useState } from 'react';
import {
  LayoutDashboard,
  Package,
  BarChart2,
  Bot,
  Settings as SettingsIcon,
  ArrowRight,
  ChevronDown,
} from 'lucide-react';
import { BRAND, INK, INK2, INK3 } from '../OnboardingShell';

interface Destination {
  id: string;
  Icon: typeof LayoutDashboard;
  title: string;
  short: string;
  description: string;
  cta: string;
  path: string;
}

const DESTINATIONS: Destination[] = [
  {
    id: 'dashboard',
    Icon: LayoutDashboard,
    title: 'Dashboard',
    short: 'Tu resumen diario',
    description:
      'Los KPIs que importan en un solo lugar: cuánto entra, cuánto sale, tu margen, tu health score financiero y la próxima fecha de declaración.',
    cta: 'Ir al Dashboard',
    path: '/dashboard',
  },
  {
    id: 'inventory',
    Icon: Package,
    title: 'Inventario',
    short: 'Stock + alertas automáticas',
    description:
      'Carga productos (uno a uno o masivo por CSV), registra entradas y salidas, y deja que AluminIA te avise cuando algo se quede sin stock o tengas capital detenido.',
    cta: 'Ir al Inventario',
    path: '/inventory',
  },
  {
    id: 'reports',
    Icon: BarChart2,
    title: 'Reportes',
    short: 'P&G, CxC, CxP, anticipos',
    description:
      'Estado de resultados, anticipos, cuentas por cobrar, cuentas por pagar y preparación para visita DIAN. Requiere plan Empresarial.',
    cta: 'Ver reportes',
    path: '/reports/pyg',
  },
  {
    id: 'nico',
    Icon: Bot,
    title: 'Nico',
    short: 'Tu copiloto IA',
    description:
      'Nico analiza tu operación cada día y te manda alertas específicas: qué productos están críticos, qué clientes te deben hace mucho, cuánto capital tienes detenido.',
    cta: 'Conocer a Nico',
    path: '/dashboard',
  },
  {
    id: 'settings',
    Icon: SettingsIcon,
    title: 'Ajustes',
    short: 'Siigo, plan y equipo',
    description:
      'Conecta Siigo (si no lo hiciste ya), cambia de plan, invita usuarios a tu cuenta y edita tu perfil fiscal.',
    cta: 'Ir a Ajustes',
    path: '/settings',
  },
];

interface Props {
  onNavigate: (path: string) => void;
}

export default function Step10Tour({ onNavigate }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

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
        ¿Por dónde quieres empezar?
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
        Estas son las 5 partes principales de AluminIA. Toca una para saber más, o entra directo donde prefieras.
      </p>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          animation: 'fieldIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.15s both',
          opacity: 0,
        }}
      >
        {DESTINATIONS.map((d) => {
          const isOpen = expanded === d.id;
          return (
            <div
              key={d.id}
              style={{
                border: '1px solid rgba(0,0,0,0.07)',
                borderRadius: 12,
                overflow: 'hidden',
                background: '#fff',
                transition: 'box-shadow 0.2s',
                boxShadow: isOpen ? '0 6px 20px rgba(0,0,0,0.06)' : 'none',
              }}
            >
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : d.id)}
                style={{
                  width: '100%',
                  padding: 14,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  fontFamily: 'inherit',
                  textAlign: 'left',
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: isOpen ? 'oklch(0.43 0.14 155 / 0.12)' : '#f5f5f7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    color: isOpen ? BRAND : INK2,
                    transition: 'all 0.15s',
                  }}
                >
                  <d.Icon style={{ width: 19, height: 19 }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: INK }}>{d.title}</div>
                  <div style={{ fontSize: 12, color: INK2, marginTop: 1 }}>{d.short}</div>
                </div>
                <ChevronDown
                  style={{
                    width: 16,
                    height: 16,
                    color: INK3,
                    transform: isOpen ? 'rotate(180deg)' : 'rotate(0)',
                    transition: 'transform 0.2s',
                    flexShrink: 0,
                  }}
                />
              </button>

              {isOpen && (
                <div
                  style={{
                    padding: '0 14px 14px 66px',
                    animation: 'fieldIn 0.3s cubic-bezier(0.16,1,0.3,1) both',
                  }}
                >
                  <p style={{ fontSize: 13, color: INK2, lineHeight: 1.6, marginBottom: 12 }}>
                    {d.description}
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigate(d.path)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      height: 36,
                      padding: '0 14px',
                      background: BRAND,
                      border: 'none',
                      borderRadius: 9,
                      color: '#fff',
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      transition: 'transform 0.15s, box-shadow 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = '0 4px 12px oklch(0.43 0.14 155 / 0.25)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    {d.cta}
                    <ArrowRight style={{ width: 13, height: 13 }} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
