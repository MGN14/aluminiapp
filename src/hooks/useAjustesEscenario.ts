/**
 * Ajustes por contenedor del tablero Escenarios: mercancía USD y peso kg
 * corregidos a mano.
 *
 * Caso real (Nico 2026-08-31): "el valor de la mercancía lo debo poder editar,
 * ese 124k USD está erróneo porque la china envió de más — por ende no envió
 * 28.400 sino como 28.800 kg". La factura definitiva llega DESPUÉS de que el
 * pedido se montó, y el tablero tiene que poder trabajar con el número real
 * antes de que alguien actualice el pedido.
 *
 * Vive en localStorage a propósito: es un ajuste de trabajo del tablero, no
 * un dato contable. Para dejarlo permanente hay que corregir el pedido en la
 * pestaña Pedidos — la UI lo dice.
 */

import { useCallback, useEffect, useState } from 'react';

export interface AjusteEscenario {
  mercanciaUsd?: number | null;
  pesoKg?: number | null;
  /** Unidades realmente despachadas — el flete se prorratea entre ellas. */
  unidades?: number | null;
}

const KEY = 'aluminia_escenario_ajustes_v1';

function leerTodo(): Record<string, AjusteEscenario> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {}; // modo privado / storage bloqueado
  }
}

export function useAjustesEscenario(importId: string | null | undefined) {
  const [todos, setTodos] = useState<Record<string, AjusteEscenario>>(() => leerTodo());

  // Si otra pestaña lo cambia, reflejarlo.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setTodos(leerTodo()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const ajuste = (importId ? todos[importId] : null) ?? {};

  const setAjuste = useCallback((patch: AjusteEscenario) => {
    if (!importId) return;
    setTodos((prev) => {
      const actual = { ...(prev[importId] ?? {}), ...patch };
      // Limpiar claves nulas para que "sin ajuste" sea ausencia, no null.
      for (const k of Object.keys(actual) as Array<keyof AjusteEscenario>) {
        if (actual[k] == null || !Number.isFinite(Number(actual[k])) || Number(actual[k]) <= 0) delete actual[k];
      }
      const next = { ...prev, [importId]: actual };
      if (Object.keys(actual).length === 0) delete next[importId];
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* no bloquea la UI */ }
      return next;
    });
  }, [importId]);

  const limpiar = useCallback(
    () => setAjuste({ mercanciaUsd: null, pesoKg: null, unidades: null }),
    [setAjuste],
  );

  return {
    mercanciaUsd: ajuste.mercanciaUsd ?? null,
    pesoKg: ajuste.pesoKg ?? null,
    unidades: ajuste.unidades ?? null,
    tocado: ajuste.mercanciaUsd != null || ajuste.pesoKg != null || ajuste.unidades != null,
    setAjuste,
    limpiar,
  };
}
