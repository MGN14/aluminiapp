// Hook genérico para persistir el state de un formulario en sessionStorage.
// Resuelve el problema reportado por Nico: si el usuario está editando un
// modal y cambia de pestaña / navega / se descarta el tab, al volver el form
// arrancaba vacío y había que tipear todo de nuevo.
//
// Uso:
//   const [form, setForm, clearForm] = usePersistedFormState('caja-gasto', INITIAL);
//   ... <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
//   // Al guardar exitoso: clearForm() para que la próxima vez arranque limpio.
//
// Notas:
//   - sessionStorage (no localStorage): el state vive solo en la pestaña del
//     navegador, así no contamina entre múltiples sesiones del mismo browser.
//   - El reviver se ejecuta al hidratar desde JSON. Útil para reconstruir
//     Date u otros objetos no JSON-serializables.
//   - Si JSON.parse falla por algún motivo, devuelve `initial` y limpia la
//     entrada corrupta.

import { useCallback, useEffect, useRef, useState } from 'react';

interface PersistedOpts<T> {
  /** Si false, el hook se comporta como useState normal. */
  enabled?: boolean;
  /** Transforma la data hidratada (ej: parsear Date strings). */
  reviver?: (data: unknown) => T;
}

export function usePersistedFormState<T>(
  storageKey: string,
  initial: T,
  opts: PersistedOpts<T> = {},
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const { enabled = true, reviver } = opts;
  // Mantener referencia estable al reviver — sino el useEffect se rompería en
  // cada render si el caller lo declara inline.
  const reviverRef = useRef(reviver);
  reviverRef.current = reviver;

  const [state, setState] = useState<T>(() => {
    if (!enabled || typeof window === 'undefined') return initial;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw == null) return initial;
      const parsed = JSON.parse(raw);
      return reviverRef.current ? reviverRef.current(parsed) : (parsed as T);
    } catch {
      try { window.sessionStorage.removeItem(storageKey); } catch { /* ignore */ }
      return initial;
    }
  });

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Quota excedida o private mode: silencioso, el form sigue en memoria.
    }
  }, [storageKey, state, enabled]);

  const clear = useCallback(() => {
    if (typeof window !== 'undefined') {
      try { window.sessionStorage.removeItem(storageKey); } catch { /* ignore */ }
    }
  }, [storageKey]);

  return [state, setState, clear];
}

/**
 * Helpers para serializar/parsear Date dentro del state del form.
 * Date no es JSON-nativo: JSON.stringify lo convierte a ISO string, así que
 * al hidratar hay que detectarlo y reconstruir.
 */
export function dateToIso(d: Date | undefined | null): string | null {
  if (!d) return null;
  return d.toISOString();
}

export function isoToDate(s: string | undefined | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}
