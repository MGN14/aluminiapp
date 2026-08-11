/**
 * Descripciones excluidas del análisis de conciliación ("no auditar").
 *
 * Nico (2026-08-06): transferencias / consignaciones / Nequi vienen de
 * CUALQUIER cliente — que la app no intente uniformar su beneficiario ni
 * proponga reglas sobre ellas. Se guardan por descripción NORMALIZADA en
 * `conciliacion_exclusiones`, con espejo en localStorage para que funcione
 * aunque la migración no esté aplicada (mismo patrón que la fecha de corte
 * del inventario).
 */

import { supabase } from '@/integrations/supabase/client';
import { normalizeForMatch } from '@/lib/stringUtils';

const db = supabase as never as { from: (t: string) => any };
const LS_KEY = 'aluminia:conciliacion:exclusiones:v1';

function leerLocal(): string[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]'); } catch { return []; }
}
function escribirLocal(descs: string[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(descs)); } catch { /* modo privado */ }
}

export async function fetchExclusiones(): Promise<string[]> {
  try {
    const { data, error } = await db
      .from('conciliacion_exclusiones')
      .select('desc_normalizada');
    if (!error) {
      const descs = ((data ?? []) as { desc_normalizada: string }[]).map((r) => r.desc_normalizada);
      // Merge con lo local (guardados offline / pre-migración) y re-subir.
      const locales = leerLocal().filter((d) => !descs.includes(d));
      if (locales.length) {
        void Promise.all(locales.map((d) => agregarExclusion(d).catch(() => {})));
        descs.push(...locales);
      }
      escribirLocal(descs);
      return descs;
    }
  } catch { /* tabla sin crear */ }
  return leerLocal();
}

export async function agregarExclusion(descripcion: string): Promise<void> {
  const desc = normalizeForMatch(descripcion);
  if (!desc) return;
  escribirLocal([...new Set([...leerLocal(), desc])]);
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return;
  await db
    .from('conciliacion_exclusiones')
    .upsert({ user_id: uid, desc_normalizada: desc }, { onConflict: 'user_id,desc_normalizada' });
}

export async function quitarExclusion(descripcion: string): Promise<void> {
  const desc = normalizeForMatch(descripcion);
  escribirLocal(leerLocal().filter((d) => d !== desc));
  try {
    await db.from('conciliacion_exclusiones').delete().eq('desc_normalizada', desc);
  } catch { /* tabla sin crear: con lo local basta */ }
}
