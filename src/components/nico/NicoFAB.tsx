import { useNico } from '@/hooks/useNicoContext';
import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import NicoLogo from './NicoLogo';

const CTA_MESSAGES = [
  '¿Cuánto gasté este mes?',
  '¿Cómo va mi IVA?',
  '¿Quién me debe plata?',
  'Analiza mis gastos',
];

const TOOLTIP_DISMISSED_KEY = 'nico_fab_tooltip_dismissed';
const TOOLTIP_INITIAL_DELAY_MS = 10_000;

export default function NicoFAB() {
  const { openNico, isOpen } = useNico();
  const [showTooltip, setShowTooltip] = useState(false);
  const [ctaIndex, setCtaIndex] = useState(0);

  // Tooltip aparece a los 10s (en vez de 3s) y solo si el usuario no lo
  // descartó previamente. El descarte queda en localStorage para que no
  // vuelva a aparecer hasta que el user limpie storage.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(TOOLTIP_DISMISSED_KEY) === '1') return;
    const showTimer = setTimeout(() => setShowTooltip(true), TOOLTIP_INITIAL_DELAY_MS);
    return () => clearTimeout(showTimer);
  }, []);

  useEffect(() => {
    if (!showTooltip) return;
    const interval = setInterval(() => {
      setCtaIndex((i) => (i + 1) % CTA_MESSAGES.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [showTooltip]);

  const dismissTooltip = () => {
    setShowTooltip(false);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(TOOLTIP_DISMISSED_KEY, '1');
    }
  };

  if (isOpen) return null;

  return (
    <div
      className="md:hidden fixed z-40 flex flex-col items-end gap-2"
      style={{
        right: 'max(16px, env(safe-area-inset-right))',
        bottom: 'max(16px, env(safe-area-inset-bottom))',
      }}
    >
      {/* CTA tooltip */}
      {showTooltip && (
        <div className="animate-fade-in flex items-center gap-2 px-4 py-2.5 rounded-2xl rounded-br-sm bg-card border border-border shadow-lg hover:shadow-xl transition-all cursor-pointer group">
          <button onClick={openNico} className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Pregúntale a Nico:</span>
            <span className="text-xs font-medium text-foreground group-hover:text-success transition-colors">
              "{CTA_MESSAGES[ctaIndex]}"
            </span>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); dismissTooltip(); }}
            className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Cerrar y no volver a mostrar"
            title="No volver a mostrar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {/* FAB */}
      <button
        onClick={openNico}
        className="group flex items-center gap-0 hover:gap-2.5 overflow-hidden rounded-full bg-success shadow-lg hover:shadow-xl transition-all duration-300 ease-out hover:pr-4 focus:outline-none focus:ring-2 focus:ring-success/50 focus:ring-offset-2"
        aria-label="Pregúntale a Nico"
        title="Pregúntale a Nico"
      >
        <div className="w-14 h-14 rounded-full overflow-hidden flex-shrink-0 border-2 border-white/20 bg-success flex items-center justify-center">
          <NicoLogo size={32} color="#ffffff" />
        </div>
        <span className="text-sm font-semibold text-white whitespace-nowrap max-w-0 group-hover:max-w-xs transition-all duration-300 overflow-hidden">
          Pregúntale a Nico
        </span>
      </button>
    </div>
  );
}
