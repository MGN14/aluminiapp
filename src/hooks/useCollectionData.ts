// Hook unificado del Módulo de Cobranza — LA única query de la pantalla.
// Combina: cartera por cliente (calculateAllClientReceivables) + aging +
// scores IA cacheados + touchpoints + promesas de pago pendientes.
//
// AccountsReceivableReport y AgingReportTable consumen ESTE hook; antes cada
// uno corría su propia pasada de calculateAllClientReceivables con claves de
// cache distintas y quedaban desincronizados al vincular un pago (H8).
// Toda mutación de cobranza invalida ['collection-data'].

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { calculateAllClientReceivables } from '@/lib/clientReceivables';
import { calculateAgingFromClients, type AgingReport } from '@/lib/agingBuckets';

export type ScoreCategory = 'excelente' | 'bueno' | 'medio' | 'riesgo' | 'critico';

export interface ClientScore {
  responsible_id: string | null;
  client_name: string;
  score: number; // 0-100
  category: ScoreCategory;
  reasoning: string | null;
  recommended_action: string | null;
  total_owed: number | null;
  oldest_overdue_days: number | null;
  scored_at: string;
}

export interface TouchpointRow {
  id: string;
  responsible_id: string | null;
  client_name: string;
  invoice_id: string | null;
  channel: string;
  outcome: string;
  notes: string | null;
  contacted_at: string;
  created_at: string;
}

export interface PromesaRow {
  id: string;
  responsible_id: string | null;
  invoice_id: string | null;
  due_date: string;
  amount: number;
  notes: string | null;
}

export interface CollectionData {
  receivables: Awaited<ReturnType<typeof calculateAllClientReceivables>>;
  aging: AgingReport;
  scoresByClient: Map<string, ClientScore>; // key: responsible_id || `__name:${lower(name)}`
  touchpointsByClient: Map<string, TouchpointRow[]>; // misma key
  /** Promesas de pago (expected_payments status=pendiente) por responsible_id. */
  promesasByClient: Map<string, PromesaRow[]>;
  lastScoredAt: string | null;
}

function scoreKey(s: { responsible_id: string | null; client_name: string }): string {
  if (s.responsible_id) return s.responsible_id;
  return `__name:${s.client_name.toLowerCase().trim()}`;
}

/** Claves de React Query que toca cualquier mutación de cobranza (vincular
 *  pago, acordar cobro, registrar contacto, confirmar match). */
export const COLLECTION_QUERY_KEYS = [
  ['collection-data'],
  ['accounts-receivable-by-client'], // legacy — otros consumidores
  ['conciliacion'],
  ['expected-payments'],
] as const;

export function useInvalidateCollection() {
  const qc = useQueryClient();
  return () => {
    for (const key of COLLECTION_QUERY_KEYS) qc.invalidateQueries({ queryKey: [...key] });
  };
}

export function useCollectionData(year: number) {
  const { user } = useAuth();

  return useQuery<CollectionData | null>({
    queryKey: ['collection-data', user?.id, year],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return null;

      // 1) Cartera por cliente (lógica canónica). Las facturas ya traen
      //    due_date/dias_credito — no hace falta segunda query de metadata.
      const receivables = await calculateAllClientReceivables(year);

      const clientsEnriched = receivables.clients.map((c) => ({
        ...c,
        responsible_id: c.client_id.startsWith('__name:') ? null : c.client_id,
      }));

      // 2) Aging (invariante: Σ buckets == saldo_neto por cliente)
      const aging = calculateAgingFromClients(clientsEnriched);

      // 3) Scores IA cacheados + touchpoints + promesas, en paralelo
      const [scoresRes, touchpointsRes, promesasRes] = await Promise.all([
        supabase
          .from('client_collection_scores' as never)
          .select('responsible_id, client_name, score, category, reasoning, recommended_action, total_owed, oldest_overdue_days, scored_at'),
        supabase
          .from('collection_touchpoints' as never)
          .select('id, responsible_id, client_name, invoice_id, channel, outcome, notes, contacted_at, created_at')
          .order('contacted_at', { ascending: false })
          .limit(500),
        supabase
          .from('expected_payments' as never)
          .select('id, responsible_id, invoice_id, due_date, amount, notes')
          .eq('status', 'pendiente')
          .order('due_date', { ascending: true }),
      ]);

      const scoresByClient = new Map<string, ClientScore>();
      let lastScoredAt: string | null = null;
      for (const s of ((scoresRes.data as unknown) as ClientScore[]) ?? []) {
        scoresByClient.set(scoreKey(s), s);
        if (!lastScoredAt || s.scored_at > lastScoredAt) lastScoredAt = s.scored_at;
      }

      const touchpointsByClient = new Map<string, TouchpointRow[]>();
      for (const t of ((touchpointsRes.data as unknown) as TouchpointRow[]) ?? []) {
        const k = t.responsible_id ?? `__name:${t.client_name.toLowerCase().trim()}`;
        if (!touchpointsByClient.has(k)) touchpointsByClient.set(k, []);
        touchpointsByClient.get(k)!.push(t);
      }

      // Promesas por cliente. Las que vienen solo con invoice_id se resuelven
      // al cliente dueño de esa factura.
      const invoiceOwner = new Map<string, string>();
      for (const c of clientsEnriched) {
        for (const inv of [...c.invoices_pendientes, ...c.invoices_pagadas]) {
          if (c.responsible_id) invoiceOwner.set(inv.id, c.responsible_id);
        }
      }
      const promesasByClient = new Map<string, PromesaRow[]>();
      for (const p of ((promesasRes.data as unknown) as PromesaRow[]) ?? []) {
        const k = p.responsible_id ?? (p.invoice_id ? invoiceOwner.get(p.invoice_id) : undefined);
        if (!k) continue;
        if (!promesasByClient.has(k)) promesasByClient.set(k, []);
        promesasByClient.get(k)!.push(p);
      }

      return {
        receivables,
        aging,
        scoresByClient,
        touchpointsByClient,
        promesasByClient,
        lastScoredAt,
      };
    },
  });
}
