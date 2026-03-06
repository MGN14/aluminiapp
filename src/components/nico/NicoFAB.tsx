import { useNico } from '@/hooks/useNicoContext';
import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import nicoAvatar from '@/assets/nico-avatar.png';

const CTA_MESSAGES = [
  '¿Cuánto gasté este mes?',
  '¿Cómo va mi IVA?',
  '¿Quién me debe plata?',
  'Analiza mis gastos',
];

export default function NicoFAB() {
  const { openNico, isOpen } = useNico();
  const [showTooltip, setShowTooltip] = useState(false);
  const [ctaIndex, setCtaIndex] = useState(0);

  // Show tooltip after 3s on mount, then rotate messages
  useEffect(() => {
    const showTimer = setTimeout(() => setShowTooltip(true), 3000);
    return () => clearTimeout(showTimer);
  }, []);

  useEffect(() => {
    if (!showTooltip) return;
    const interval = setInterval(() => {
      setCtaIndex((i) => (i + 1) % CTA_MESSAGES.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [showTooltip]);

  if (isOpen) return null;

  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
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
            onClick={(e) => { e.stopPropagation(); setShowTooltip(false); }}
            className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Cerrar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {/* FAB */}
      <button
        onClick={openNico}
        onMouseEnter={() => setShowTooltip(true)}
        className="group flex items-center gap-0 hover:gap-2.5 overflow-hidden rounded-full bg-success shadow-lg hover:shadow-xl transition-all duration-300 ease-out hover:pr-4 focus:outline-none focus:ring-2 focus:ring-success/50 focus:ring-offset-2"
        aria-label="Pregúntale a Nico"
        title="Pregúntale a Nico"
      >
        <div className="w-14 h-14 rounded-full overflow-hidden flex-shrink-0 border-2 border-white/20">
          <img
            src={nicoAvatar}
            alt="Nico"
            className="w-full h-full object-cover object-top scale-110"
          />
        </div>
        <span className="text-sm font-semibold text-white whitespace-nowrap max-w-0 group-hover:max-w-xs transition-all duration-300 overflow-hidden">
          Pregúntale a Nico
        </span>
      </button>
    </div>
  );
}
