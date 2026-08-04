/**
 * F0 — LA fecha de corte global del inventario por variante.
 *
 * stock = inicial + contenedor − remisiones, contando solo los movimientos
 * con fecha POSTERIOR a F0 (decisión de Nico, 2026-08-04). Es un solo número,
 * visible arriba a la derecha del panel, editable por admin, y se mueve solo
 * al confirmar un cierre de inventario.
 */

import { supabase } from '@/integrations/supabase/client';

const db = supabase as never as { from: (t: string) => any };

const hoyIso = () => new Date().toISOString().slice(0, 10);

/**
 * Lee F0. Si la migración todavía no está aplicada (o nunca se guardó), cae
 * al día del último re-anclaje de maestra (max stock_inicial_date) — lo más
 * parecido al comportamiento previo — y en último caso a hoy.
 */
export async function fetchFechaCorte(): Promise<string> {
  try {
    const { data, error } = await db
      .from('inventory_config')
      .select('fecha_corte_stock')
      .limit(1);
    if (!error && (data ?? []).length) {
      const f = String((data as { fecha_corte_stock: string }[])[0].fecha_corte_stock).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(f)) return f;
    }
  } catch { /* tabla sin crear: fallback */ }

  try {
    const { data } = await db
      .from('inventory_variants')
      .select('stock_inicial_date')
      .not('stock_inicial_date', 'is', null)
      .order('stock_inicial_date', { ascending: false })
      .limit(1);
    const f = String((data as { stock_inicial_date: string }[] | null)?.[0]?.stock_inicial_date ?? '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(f)) return f;
  } catch { /* sin variantes todavía */ }
  return hoyIso();
}

/** Guarda F0 (upsert de la única fila; el trigger pone user_id). */
export async function saveFechaCorte(fecha: string): Promise<void> {
  const f = fecha.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new Error(`Fecha de corte inválida: ${fecha}`);
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) throw new Error('Sin sesión.');
  // El upsert necesita el user_id para el ON CONFLICT (PK); RLS + el trigger
  // igual fuerzan el data owner correcto.
  const { error } = await db
    .from('inventory_config')
    .upsert({ user_id: uid, fecha_corte_stock: f, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

/** Best-effort: mover F0 sin romper el flujo que la llama (cierres, maestra). */
export async function trySaveFechaCorte(fecha: string): Promise<boolean> {
  try {
    await saveFechaCorte(fecha);
    return true;
  } catch {
    return false; // migración sin aplicar: el fallback de lectura cubre
  }
}
