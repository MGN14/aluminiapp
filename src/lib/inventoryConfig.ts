/**
 * F0 — LA fecha de corte global del inventario por variante.
 *
 * stock = inicial + contenedor − remisiones, contando solo los movimientos
 * con fecha POSTERIOR a F0 (decisión de Nico, 2026-08-04).
 *
 * REGLA DURA (Nico, 2026-08-05): **si el usuario no la toca, NO cambia.**
 * Antes el fallback la derivaba de `max(stock_inicial_date)`, que se corre a
 * "hoy" cada vez que un contenedor crea una referencia — la fecha saltaba
 * sola al recargar y con F0 = hoy NINGUNA remisión descuenta (el stock se
 * infla entero). Ahora: se persiste en `inventory_config` Y en localStorage;
 * el valor derivado se usa UNA sola vez, para sembrar, y queda fijo.
 */

import { supabase } from '@/integrations/supabase/client';

const db = supabase as never as { from: (t: string) => any };

const LS_KEY = 'aluminia:inventory:fecha_corte_stock:v1';
const esFecha = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const hoyIso = () => new Date().toISOString().slice(0, 10);

function leerLocal(): string | null {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v && esFecha(v) ? v : null;
  } catch { return null; }
}
function escribirLocal(f: string): void {
  try { localStorage.setItem(LS_KEY, f); } catch { /* modo privado */ }
}

/** ¿La fecha vive en la base, o solo en este navegador? Lo usa la UI para
 *  avisar que falta aplicar la migración. */
export let fechaCorteEsLocal = false;

/**
 * Lee F0 con prioridad: tabla → localStorage → semilla derivada (una vez).
 * Lo que se lee se persiste localmente, así el valor queda estable aunque la
 * migración no esté aplicada.
 */
export async function fetchFechaCorte(): Promise<string> {
  try {
    const { data, error } = await db
      .from('inventory_config')
      .select('fecha_corte_stock')
      .limit(1);
    if (!error) {
      const f = String((data as { fecha_corte_stock: string }[] | null)?.[0]?.fecha_corte_stock ?? '').slice(0, 10);
      if (esFecha(f)) {
        fechaCorteEsLocal = false;
        escribirLocal(f);
        return f;
      }
      // Tabla existe pero sin fila: si hay valor local, ese manda y se sube.
      const local = leerLocal();
      if (local) {
        fechaCorteEsLocal = false;
        void trySaveFechaCorte(local);
        return local;
      }
    } else {
      const local = leerLocal();
      if (local) { fechaCorteEsLocal = true; return local; }
    }
  } catch {
    const local = leerLocal();
    if (local) { fechaCorteEsLocal = true; return local; }
  }

  // Primera vez y sin nada guardado: se SIEMBRA con el último contenedor
  // entregado (la sugerencia que pidió Nico) y queda fija desde ahí.
  const semilla = (await fetchUltimoContenedorEntregado()) ?? hoyIso();
  escribirLocal(semilla);
  const ok = await trySaveFechaCorte(semilla);
  fechaCorteEsLocal = !ok;
  return semilla;
}

/** Fecha de arribo del contenedor entregado más reciente (sugerencia de F0). */
export async function fetchUltimoContenedorEntregado(): Promise<string | null> {
  try {
    const { data, error } = await db
      .from('imports')
      .select('fecha_arribo_real')
      .in('estado', ['entregado', 'cerrado'])
      .not('fecha_arribo_real', 'is', null)
      .order('fecha_arribo_real', { ascending: false })
      .limit(1);
    if (error) return null;
    const f = String((data as { fecha_arribo_real: string }[] | null)?.[0]?.fecha_arribo_real ?? '').slice(0, 10);
    return esFecha(f) ? f : null;
  } catch { return null; }
}

/** Guarda F0 (upsert de la única fila; el trigger pone user_id). */
export async function saveFechaCorte(fecha: string): Promise<void> {
  const f = fecha.slice(0, 10);
  if (!esFecha(f)) throw new Error(`Fecha de corte inválida: ${fecha}`);
  escribirLocal(f); // el navegador la conserva aunque la base falle
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) throw new Error('Sin sesión.');
  // El upsert necesita el user_id para el ON CONFLICT (PK); RLS + el trigger
  // igual fuerzan el data owner correcto.
  const { error } = await db
    .from('inventory_config')
    .upsert({ user_id: uid, fecha_corte_stock: f, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) { fechaCorteEsLocal = true; throw error; }
  fechaCorteEsLocal = false;
}

/** Best-effort: mover F0 sin romper el flujo que la llama (cierre de conteo). */
export async function trySaveFechaCorte(fecha: string): Promise<boolean> {
  try {
    await saveFechaCorte(fecha);
    return true;
  } catch {
    return false; // migración sin aplicar: queda en localStorage
  }
}
