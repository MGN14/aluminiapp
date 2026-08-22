// Centro de migración — estado DERIVADO de cada paso.
//
// Mismo principio que useQuoteCycle y Terceros: el progreso nunca se digita,
// se deriva de los datos reales. Si hay productos, el paso está hecho; si el
// usuario los borra, el paso vuelve a pendiente solo. Conteos con head:true
// (no traen filas). RLS filtra por current_data_owner(), así que no se
// filtra user_id salvo en tablas keyed por owner explícito.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface MigrationStatus {
  /** Wizard fiscal completado (persona, NIT, régimen, actividad). */
  fiscal_done: boolean;
  /** Estado inicial: fecha de corte + al menos un saldo cargado. */
  initial_done: boolean;
  initial_details: number;
  /** Siigo conectado (opcional — el camino manual es igual de válido). */
  siigo_done: boolean;
  /** Productos en el maestro de inventario. */
  products_done: boolean;
  products_count: number;
  /** Facturas (o Siigo conectado, que las trae solo). */
  invoices_done: boolean;
  invoices_count: number;
  /** Extractos bancarios procesados. */
  bank_done: boolean;
  statements_count: number;
  transactions_count: number;
  /** Colaborador invitado (opcional). */
  team_done: boolean;
}

export const MIGRATION_REQUIRED_KEYS = [
  'fiscal_done', 'initial_done', 'products_done', 'invoices_done', 'bank_done',
] as const satisfies ReadonlyArray<keyof MigrationStatus>;

export function migrationProgress(s: MigrationStatus): { done: number; total: number; pct: number } {
  const done = MIGRATION_REQUIRED_KEYS.filter((k) => s[k]).length;
  const total = MIGRATION_REQUIRED_KEYS.length;
  return { done, total, pct: Math.round((done / total) * 100) };
}

export function useMigrationStatus() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['migration-status', user?.id],
    enabled: !!user?.id,
    staleTime: 30_000,
    queryFn: async (): Promise<MigrationStatus> => {
      const uid = user!.id;
      const [
        fiscalRes, stateRes, detailsRes, siigoRes, prodRes, invRes, stmtRes, txRes, collabRes,
      ] = await Promise.all([
        supabase.from('profiles').select('onboarding_completed').eq('user_id', uid).maybeSingle(),
        (supabase as any).from('initial_financial_state').select('fecha_inicio').maybeSingle(),
        (supabase as any).from('initial_state_details').select('id', { count: 'exact', head: true }),
        (supabase as any).from('user_siigo_credentials').select('user_id', { count: 'exact', head: true }).eq('user_id', uid).limit(1),
        supabase.from('inventory_products').select('id', { count: 'exact', head: true }).eq('active', true),
        supabase.from('invoices').select('id', { count: 'exact', head: true }),
        supabase.from('bank_statements').select('id', { count: 'exact', head: true }).eq('processed', true).is('deleted_at', null),
        supabase.from('transactions').select('id', { count: 'exact', head: true }).is('deleted_at', null),
        supabase.from('collaborators').select('id', { count: 'exact', head: true }).eq('owner_user_id', uid).limit(1),
      ]);

      const siigo = (siigoRes.count ?? 0) > 0;
      const details = detailsRes.count ?? 0;
      const invoices = invRes.count ?? 0;

      return {
        fiscal_done: (fiscalRes.data as any)?.onboarding_completed === true,
        initial_done: !!(stateRes.data as any)?.fecha_inicio && details > 0,
        initial_details: details,
        siigo_done: siigo,
        products_done: (prodRes.count ?? 0) > 0,
        products_count: prodRes.count ?? 0,
        invoices_done: invoices > 0 || siigo,
        invoices_count: invoices,
        bank_done: (stmtRes.count ?? 0) > 0,
        statements_count: stmtRes.count ?? 0,
        transactions_count: txRes.count ?? 0,
        team_done: (collabRes.count ?? 0) > 0,
      };
    },
  });
}
