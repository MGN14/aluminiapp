// Lo que el cargue guarda en el iPad para que salir y volver NO borre nada:
// que estabas practicando, el plan (copia local), la lista de seguridad, el
// paso y las fotos de práctica. Solo se limpia al despachar o al tocar
// «Terminar práctica».

const get = <T,>(k: string): T | null => {
  try { const raw = localStorage.getItem(k); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
};
const set = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* lleno o bloqueado */ } };
const del = (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

export const claves = (id: string) => ({
  practica: `cargue:practica:v1:${id}`,
  plan: (practica: boolean) => `cargue:plan-local:v1:${practica ? 'p:' : ''}${id}`,
  seguridad: (practica: boolean) => `cargue:seguridad:v1:${practica ? 'p:' : ''}${id}`,
  paso: (practica: boolean) => `cargue:paso:v1:${practica ? 'p:' : ''}${id}`,
  fotosPractica: `cargue:fotos-practica:v1:${id}`,
});

export const leer = get;
export const guardar = set;
export const borrar = del;

export function estaPracticando(id: string): boolean {
  return get<boolean>(claves(id).practica) === true;
}

export function marcarPractica(id: string, si: boolean) {
  if (si) set(claves(id).practica, true); else del(claves(id).practica);
}

/** «Terminar práctica»: borra todo lo de la práctica de esa remisión. */
export function limpiarPractica(id: string) {
  const c = claves(id);
  del(c.practica); del(c.plan(true)); del(c.seguridad(true)); del(c.paso(true)); del(c.fotosPractica);
}

/** Después de despachar de verdad: ya no hace falta la copia local. */
export function limpiarCargueReal(id: string) {
  const c = claves(id);
  del(c.plan(false)); del(c.seguridad(false)); del(c.paso(false));
}
