import { useEffect, useRef } from 'react';

interface Options {
  /** Se llama con el texto crudo que la pistola "tecleó" (sin el Enter final). */
  onScan: (raw: string) => void;
  /** Cuando es false, el hook no escucha (ej: hay un modal de carga manual abierto). */
  enabled?: boolean;
  /** ms máximo entre teclas para considerarlas el mismo escaneo. */
  maxGapMs?: number;
  /** longitud mínima del buffer para aceptar un escaneo al Enter. */
  minLength?: number;
}

/**
 * Captura los escaneos de una pistola Bluetooth en modo HID, que se comporta
 * como un teclado: "teclea" el contenido del QR muy rápido y termina con Enter.
 *
 * Heurística de timing: las pistolas tipean <~30ms entre caracteres, un humano
 * mucho más lento. Acumulamos los caracteres y, al Enter, disparamos onScan con
 * el buffer. Si entre dos teclas pasa más de `maxGapMs`, reseteamos el buffer
 * (era tecleo humano, no un escaneo).
 *
 * Pensado para kiosko (tablet de despacho/conteo): escuchamos a nivel `window`
 * para NO depender de mantener el foco en un input — los botones de la UI roban
 * el foco y se perderían escaneos. Si el foco está en un campo editable (carga
 * manual, búsqueda), ignoramos: ahí el usuario está tecleando a propósito.
 */
export function useScannerGun({
  onScan,
  enabled = true,
  maxGapMs = 60,
  minLength = 2,
}: Options) {
  const bufferRef = useRef('');
  const lastTimeRef = useRef(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      // Atajos del navegador (Ctrl/Cmd/Alt + algo) no son escaneos.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Si el foco está en un campo editable, el usuario tipea a propósito.
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;

      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

      if (e.key === 'Enter') {
        const buf = bufferRef.current;
        bufferRef.current = '';
        if (buf.length >= minLength) {
          e.preventDefault();
          onScanRef.current(buf);
        }
        return;
      }

      // Solo caracteres imprimibles (las teclas especiales tienen key.length > 1).
      if (e.key.length === 1) {
        if (now - lastTimeRef.current > maxGapMs) bufferRef.current = '';
        bufferRef.current += e.key;
        lastTimeRef.current = now;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, maxGapMs, minLength]);
}
