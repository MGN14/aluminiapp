import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useDataOwner } from '@/hooks/useDataOwner';

/**
 * Sincronización automática con Siigo al entrar a la app.
 *
 * Antes había que ir a Inventarios y darle "Traer de Siigo", y entrar a
 * Facturas de Venta, para refrescar los datos. Ahora, si la cuenta tiene Siigo
 * conectado y la última sincronización fue hace rato, disparamos el sync de
 * facturas + productos en background apenas carga la app y refrescamos las
 * vistas que dependen de eso (cartera, inventario, balance, dashboard).
 *
 * - Usa la sesión del usuario (las edge functions toman el JWT) → sin cron ni
 *   secretos ni edge functions nuevas.
 * - Throttle en dos niveles: el backend ya trae solo lo nuevo desde
 *   last_*_pulled_at, y acá evitamos reintentar en cada refresh con un guard
 *   de tiempo (localStorage) + el propio last_*_pulled_at.
 * - Silencioso (sin toasts): es trabajo de fondo.
 */

// No re-sincronizar si el último pull fue hace menos de esto.
const STALE_MS = 4 * 60 * 60 * 1000;      // 4 horas
// No reintentar (aunque el backend diga que toca) más seguido que esto, para
// no spamear ante refreshes repetidos o fallos transitorios.
const MIN_ATTEMPT_GAP_MS = 30 * 60 * 1000; // 30 min
const ATTEMPT_KEY = 'siigo_autosync_last_attempt';

function olderThan(iso: string | null | undefined, ms: number): boolean {
  if (!iso) return true;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > ms;
}

export function useSiigoAutoSync() {
  const { user, loading: authLoading } = useAuth();
  const { isCollaborator, loading: ownerLoading } = useDataOwner();
  const qc = useQueryClient();
  const ranRef = useRef(false);

  useEffect(() => {
    if (authLoading || ownerLoading) return;
    if (!user) return;
    // Las credenciales de Siigo son del owner; un colaborador no tiene las
    // suyas (las edge functions resuelven por el JWT del caller).
    if (isCollaborator) return;
    // Una sola corrida por carga de app (el hook se monta una vez en App).
    if (ranRef.current) return;

    // Guard anti-spam entre refreshes seguidos.
    try {
      const last = Number(localStorage.getItem(ATTEMPT_KEY));
      if (Number.isFinite(last) && Date.now() - last < MIN_ATTEMPT_GAP_MS) return;
    } catch { /* ignore */ }

    ranRef.current = true;

    void (async () => {
      try {
        const { data: creds } = await supabase
          .from('user_siigo_credentials')
          .select('connection_status, last_invoice_pulled_at, last_products_pulled_at')
          .maybeSingle();
        if (!creds || creds.connection_status !== 'connected') return;

        const needInvoices = olderThan((creds as { last_invoice_pulled_at: string | null }).last_invoice_pulled_at, STALE_MS);
        const needProducts = olderThan((creds as { last_products_pulled_at: string | null }).last_products_pulled_at, STALE_MS);
        if (!needInvoices && !needProducts) return;

        try { localStorage.setItem(ATTEMPT_KEY, String(Date.now())); } catch { /* ignore */ }

        let invoicesOk = false;
        let productsOk = false;
        await Promise.allSettled([
          needInvoices
            ? supabase.functions.invoke('siigo-sync-invoices', { body: {} }).then((r) => { invoicesOk = !r.error; })
            : Promise.resolve(),
          needProducts
            ? supabase.functions.invoke('siigo-sync-products', { body: {} }).then((r) => { productsOk = !r.error; })
            : Promise.resolve(),
        ]);

        // Refrescar lo que depende de Siigo. Predicate amplio pero acotado a
        // las familias de queries afectadas (no invalida toda la cache).
        if (invoicesOk || productsOk) {
          const affected = ['invoice', 'inventory', 'balance-sheet', 'financial-actuals',
            'collection', 'cartera', 'operative', 'pyg', 'informe-banco', 'import_reference_history'];
          qc.invalidateQueries({
            predicate: (q) => {
              const key = Array.isArray(q.queryKey) ? String(q.queryKey[0] ?? '') : String(q.queryKey);
              return affected.some((a) => key.toLowerCase().includes(a));
            },
          });
        }
      } catch {
        // Silencioso: el sync manual desde Ajustes/Inventarios sigue disponible.
      }
    })();
  }, [user, authLoading, isCollaborator, ownerLoading, qc]);
}
