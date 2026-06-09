import { useState, useRef, useCallback } from 'react';

// Anchos de columna redimensionables (drag en el borde, tipo Excel), persistidos
// en localStorage para que el usuario los deje como quiera y sobrevivan recargas.
export function useColumnWidths(defaults: Record<string, number>, storageKey: string) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return { ...defaults, ...(JSON.parse(raw) as Record<string, number>) };
    } catch { /* private mode / corrupto → defaults */ }
    return defaults;
  });

  const drag = useRef<{ key: string; startX: number; startW: number } | null>(null);

  const startResize = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { key, startX: e.clientX, startW: widths[key] ?? 120 };

    const onMove = (ev: MouseEvent) => {
      if (!drag.current) return;
      const dx = ev.clientX - drag.current.startX;
      const next = Math.max(56, drag.current.startW + dx); // mínimo 56px
      setWidths((w) => ({ ...w, [drag.current!.key]: next }));
    };
    const onUp = () => {
      drag.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setWidths((w) => {
        try { localStorage.setItem(storageKey, JSON.stringify(w)); } catch { /* ignore */ }
        return w;
      });
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [widths]);

  const total = Object.values(widths).reduce((a, b) => a + b, 0);
  return { widths, startResize, total };
}

// Manija de resize en el borde derecho del <th>. El th debe ser position:relative.
export function ColResizer({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      onClick={(e) => e.stopPropagation()} // no disparar el sort del header
      className="group absolute right-0 top-0 z-10 flex h-full w-2 cursor-col-resize items-stretch justify-center"
      style={{ touchAction: 'none' }}
      title="Arrastrá para cambiar el ancho"
    >
      <div className="h-full w-px bg-border transition-all group-hover:w-[2px] group-hover:bg-primary" />
    </div>
  );
}
