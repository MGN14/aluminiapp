// Banner que se muestra cuando hay una nueva versión deployada en Vercel.
// Polea /version.json cada 5 min, compara contra __APP_VERSION__ que se
// inyectó en build time (vite.config.ts BUILD_VERSION). Si difieren,
// muestra un banner sticky con botón "Recargar".
//
// Caso de uso: el owner sube un fix, se deployea en Vercel, pero el browser
// del colaborador tiene el bundle viejo cacheado y no se entera. Antes había
// que decirle por chat. Ahora la app se entera sola.

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, Sparkles } from 'lucide-react';

const POLL_INTERVAL_MS = 5 * 60_000; // cada 5 min
// En dev __APP_VERSION__ = el timestamp del último restart de vite. No es
// realista comparar — desactivamos el banner.
const IS_DEV = import.meta.env.DEV;

export default function UpdateNotifier() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (IS_DEV) return;

    const localVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null;
    if (!localVersion) return;

    const check = async () => {
      try {
        // Cache-bust con query string — Vercel sirve /version.json sin cache
        // configurado pero algunos browsers cachean igual.
        const res = await fetch(`/version.json?t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.version && data.version !== localVersion) {
          setUpdateAvailable(true);
        }
      } catch {
        // network blip — silencioso, reintenta en el próximo tick
      }
    };

    // Check inmediato + intervalo
    check();
    const id = window.setInterval(check, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  if (!updateAvailable) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        background: 'oklch(0.43 0.14 155)',
        color: 'white',
        padding: '10px 14px',
        borderRadius: 12,
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        maxWidth: '92vw',
        fontSize: 14,
      }}
      role="status"
      aria-live="polite"
    >
      <Sparkles className="h-4 w-4 shrink-0" />
      <span className="font-medium">Nueva versión disponible</span>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          // Reload duro: ignora el bundle cacheado.
          window.location.reload();
        }}
        className="gap-1.5 h-8"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Recargar
      </Button>
    </div>
  );
}
