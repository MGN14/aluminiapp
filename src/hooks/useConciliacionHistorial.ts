/**
 * Historial de conciliación compartido (sugerencias + alertas + reglas
 * sugeridas + auditoría). Un solo fetch cacheado.
 *
 * IMPORTANTE: la query guarda las transacciones PLANAS y el índice (que usa
 * Maps) se arma acá con useMemo — el cache persistente serializa a JSON y
 * los Map no sobreviven la rehidratación (crash "porDesc.get is not a
 * function", reporte de Nico 2026-08-06).
 */

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { indexarHistorial, fetchHistorialConciliacion } from '@/lib/conciliacionHistorial';
import { fetchExclusiones, agregarExclusion, quitarExclusion } from '@/lib/conciliacionExclusiones';
import { normalizeForMatch } from '@/lib/stringUtils';

export function useConciliacionHistorial(enabled = true) {
  const qc = useQueryClient();

  const { data: txs = null, isLoading } = useQuery({
    queryKey: ['conciliacion', 'historial'],
    queryFn: fetchHistorialConciliacion,
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });

  const historial = useMemo(() => (txs ? indexarHistorial(txs) : null), [txs]);

  // Descripciones "no auditar": beneficiario/categoría varían legítimamente
  // (pagos de clientes por transferencia/consignación/Nequi).
  const { data: exclusionesArr = [] } = useQuery({
    queryKey: ['conciliacion', 'exclusiones'],
    queryFn: fetchExclusiones,
    enabled,
    staleTime: 5 * 60_000,
  });
  const excluidas = useMemo(() => new Set(exclusionesArr), [exclusionesArr]);

  const invalidar = () => qc.invalidateQueries({ queryKey: ['conciliacion', 'exclusiones'] });
  const excluir = useMutation({ mutationFn: agregarExclusion, onSuccess: invalidar });
  const reactivar = useMutation({ mutationFn: quitarExclusion, onSuccess: invalidar });

  /** ¿Esta descripción está marcada como "no auditar"? */
  const esExcluida = (descripcion: string | null | undefined) =>
    excluidas.has(normalizeForMatch(descripcion ?? ''));

  return { historial, isLoading, excluidas, esExcluida, excluir, reactivar };
}
