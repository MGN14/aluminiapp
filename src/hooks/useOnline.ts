import { useEffect, useState } from 'react';

/**
 * Estado de conexión del navegador (eventos online/offline). Para las
 * estaciones de escaneo en tablet: si el wifi de la bodega se cae, el operario
 * tiene que verlo ANTES de seguir escaneando contra el servidor.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}
