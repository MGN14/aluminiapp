import { useNico } from '@/hooks/useNicoContext';
import nicoAvatar from '@/assets/nico-avatar.png';

export default function NicoFAB() {
  const { openNico, isOpen } = useNico();

  if (isOpen) return null;

  return (
    <button
      onClick={openNico}
      className="fixed bottom-6 right-6 z-40 group flex items-center gap-0 hover:gap-2.5 overflow-hidden rounded-full bg-success shadow-lg hover:shadow-xl transition-all duration-300 ease-out hover:pr-4 focus:outline-none focus:ring-2 focus:ring-success/50 focus:ring-offset-2"
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
  );
}
