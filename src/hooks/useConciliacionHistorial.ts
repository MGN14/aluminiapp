/**
 * Historial de conciliación compartido (sugerencias + alertas + reglas
 * sugeridas). Un solo fetch cacheado — lo comparten todas las filas de la
 * tabla y la tarjeta de reglas. La key vive bajo ['conciliacion'] para que
 * las invalidaciones existentes del módulo lo refresquen.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchHistorialConciliacion } from '@/lib/conciliacionHistorial';

export function useConciliacionHistorial(enabled = true) {
  const { data: historial = null, isLoading } = useQuery({
    queryKey: ['conciliacion', 'historial'],
    queryFn: fetchHistorialConciliacion,
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  return { historial, isLoading };
}
