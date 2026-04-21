import { useEffect, useMemo, useState } from 'react';
import NicoAgentChat, { AgentKey } from './NicoAgentChat';
import nicoAvatar from '@/assets/nico-avatar.png';
import { Calculator, ShieldAlert, Wallet, Boxes, Compass, Briefcase, TrendingUp } from 'lucide-react';
import { useModuleContext } from '@/hooks/useModuleContext';

type AgentDef = {
  key: AgentKey;
  label: string;
  short: string;
  tagline: string;
  icon: React.ReactNode;
  suggestions: string[];
  /**
   * Modos en los que aparece este agente.
   * - 'both' (default): visible siempre
   * - 'dian': solo cuando estás en el módulo DIAN
   * - 'gerencial': solo cuando estás en el módulo Gerencial (admin)
   */
  availableIn?: 'both' | 'dian' | 'gerencial';
};

const AGENTS: AgentDef[] = [
  {
    key: 'cfo',
    label: 'Nico CFO',
    short: 'CFO',
    tagline: 'Tu mano derecha. Vista global del negocio.',
    icon: <Briefcase className="w-4 h-4" />,
    suggestions: [
      '¿Cómo va mi negocio este mes?',
      '¿Dónde estoy perdiendo plata?',
      'Dame un diagnóstico completo',
      '¿Qué debería priorizar esta semana?',
    ],
  },
  {
    key: 'contador',
    label: 'Contador',
    short: 'Contador',
    tagline: 'Impuestos, IVA, retenciones y DIAN.',
    icon: <Calculator className="w-4 h-4" />,
    suggestions: [
      '¿Cuánto debo provisionar de IVA?',
      '¿Cómo va mi saldo a favor?',
      '¿Qué retenciones tengo pendientes?',
      '¿Cuándo es mi próxima declaración?',
    ],
  },
  {
    key: 'visita_dian',
    label: 'Visita DIAN',
    short: 'Visita DIAN',
    tagline: 'Score de salud fiscal e inconsistencias.',
    icon: <ShieldAlert className="w-4 h-4" />,
    suggestions: [
      '¿Cuál es mi score actual?',
      '¿Qué inconsistencias tengo?',
      '¿Estoy en riesgo de sanción?',
      '¿Qué me preguntaría la DIAN hoy?',
    ],
  },
  {
    key: 'tesoreria',
    label: 'Tesorería',
    short: 'Tesorería',
    tagline: 'Caja, cartera y conciliación.',
    icon: <Wallet className="w-4 h-4" />,
    suggestions: [
      '¿Quién me debe plata?',
      '¿Cuánto tengo por pagar?',
      '¿Hay anticipos sin facturar?',
      '¿Cómo está mi conciliación bancaria?',
    ],
  },
  {
    key: 'inventario',
    label: 'Inventario',
    short: 'Inventario',
    tagline: 'Siigo vs físico, fugas, capital detenido.',
    icon: <Boxes className="w-4 h-4" />,
    suggestions: [
      '¿Cómo va mi inventario?',
      '¿Tengo faltantes en bodega?',
      '¿Qué productos están detenidos?',
      '¿Hay posibles ventas sin factura?',
    ],
  },
  {
    key: 'estrategia',
    label: 'Estrategia',
    short: 'Estrategia',
    tagline: 'Decisiones grandes hacia el futuro.',
    icon: <Compass className="w-4 h-4" />,
    suggestions: [
      '¿Es buen momento para contratar?',
      '¿En qué debería invertir?',
      '¿Qué me dicen los patrones del negocio?',
      '¿Qué pasaría si subo precios 10%?',
    ],
  },
  {
    key: 'gerencial',
    label: 'Gerencial',
    short: 'Gerencial',
    tagline: 'Brecha DIAN, efectivo y rentabilidad real de formalizar.',
    icon: <TrendingUp className="w-4 h-4" />,
    availableIn: 'gerencial',
    suggestions: [
      '¿Cuál es mi brecha real vs lo facturado?',
      '¿Me conviene formalizar ese efectivo?',
      '¿Cuánto me costaría si me auditan hoy?',
      '¿Estoy en zona penal?',
    ],
  },
];

export default function NicoAgentsView() {
  const { isGerencial } = useModuleContext();

  // En modo gerencial: mostramos todos excepto los marcados 'dian' (ninguno hoy).
  // En modo DIAN: ocultamos los agentes marcados 'gerencial' (ej. Nico Gerencial).
  const visibleAgents = useMemo(
    () =>
      AGENTS.filter((a) => {
        const mode = a.availableIn ?? 'both';
        if (mode === 'both') return true;
        if (mode === 'gerencial') return isGerencial;
        if (mode === 'dian') return !isGerencial;
        return true;
      }),
    [isGerencial],
  );

  // Default: en modo gerencial arrancás con Nico Gerencial (es la razón de venir acá).
  // En modo DIAN, con Nico CFO como siempre.
  const defaultKey: AgentKey = isGerencial ? 'gerencial' : 'cfo';
  const [active, setActive] = useState<AgentKey>(defaultKey);

  // Si cambiás de módulo y el agente activo ya no está visible, saltamos al default del modo.
  useEffect(() => {
    if (!visibleAgents.some((a) => a.key === active)) {
      setActive(defaultKey);
    }
  }, [visibleAgents, active, defaultKey]);

  const activeAgent =
    visibleAgents.find((a) => a.key === active) ?? visibleAgents[0];

  return (
    <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4 h-[calc(100vh-180px)] min-h-[500px]">
      {/* Sidebar */}
      <aside className="bg-card border border-border rounded-2xl p-3 overflow-y-auto">
        <div className="flex items-center gap-2 px-2 py-2 mb-2">
          <div className="w-8 h-8 rounded-full overflow-hidden border border-border bg-muted">
            <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
          </div>
          <div>
            <div className="text-xs font-semibold text-foreground">Agentes de Nico</div>
            <div className="text-[10px] text-muted-foreground">Cada uno con su memoria</div>
          </div>
        </div>
        <nav className="space-y-1">
          {visibleAgents.map((a) => {
            const isActive = a.key === active;
            return (
              <button
                key={a.key}
                onClick={() => setActive(a.key)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-all flex items-start gap-2 ${
                  isActive
                    ? 'bg-success/10 border border-success/30 text-foreground'
                    : 'border border-transparent hover:bg-muted/60 text-muted-foreground'
                }`}
              >
                <span className={`mt-0.5 ${isActive ? 'text-success' : 'text-muted-foreground'}`}>{a.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className={`block text-sm font-semibold ${isActive ? 'text-foreground' : ''}`}>{a.label}</span>
                  <span className="block text-[11px] text-muted-foreground leading-tight">{a.tagline}</span>
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Chat */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden flex flex-col min-h-0">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-card">
          <div className="w-9 h-9 rounded-full overflow-hidden border border-border bg-muted">
            <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-foreground flex items-center gap-2">
              {activeAgent.label}
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-success/10 text-success">con memoria</span>
            </div>
            <div className="text-xs text-muted-foreground truncate">{activeAgent.tagline}</div>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <NicoAgentChat
            key={active}
            agentKey={active}
            variant="page"
            suggestions={activeAgent.suggestions}
          />
        </div>
      </div>
    </div>
  );
}
