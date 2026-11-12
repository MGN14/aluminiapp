import { useEffect } from 'react';

type WakeLockSentinelLike = { release: () => Promise<void> };
type WakeLockNav = Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } };

/**
 * Mantiene la pantalla prendida mientras `active` (Safari iPad 16.4+, Chrome).
 * Sin esto el iPad se bloquea a mitad del cargue y hay que desbloquearlo con
 * las manos ocupadas. Si el navegador no lo soporta, no pasa nada.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const nav = navigator as WakeLockNav;
    if (!nav.wakeLock) return;
    let lock: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const l = await nav.wakeLock!.request('screen');
        if (cancelled) { l.release().catch(() => {}); return; }
        lock = l;
      } catch { /* sin permiso o pestaña en segundo plano */ }
    };
    // El navegador suelta el lock al ocultar la pestaña: lo pedimos de nuevo al volver.
    const onVisible = () => { if (document.visibilityState === 'visible') request(); };
    request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
