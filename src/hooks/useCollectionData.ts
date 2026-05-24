// Hook unificado del Módulo de Cobranza.
// Combina: cartera por cliente + metadata de facturas (due_date/dias_credito)
// + scores IA cacheados + touchpoints recientes.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { calculateAllClientReceivables, type ClientReceivable } from '@/lib/clientReceivables';
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

export interface CollectionData {
  receivables: Awaited<ReturnType<typeof calculateAllClientReceivables>>;
  aging: AgingReport;
  scoresByClient: Map<string, ClientScore>; // key: responsible_id || `__name:${lower(name)}`
  touchpointsByClient: Map<string, TouchpointRow[]>; // misma key
  lastScoredAt: string | null;
}

function clientKey(c: { responsible_id?: string | null; client_id?: string; client_name: string }): string {
  if (c.responsible_id) return c.responsible_id;
  if (c.client_id && c.client_id.startsWith('__name:')) return c.client_id;
  return `__name:${c.client_name.toLowerCase().trim()}`;
}

function scoreKey(s: { responsible_id: string | null; client_name: string }): string {
  if (s.responsible_id) return s.responsible_id;
  return `__name:${s.client_name.toLowerCase().trim()}`;
}

export function useCollectionData(year: number) {
  const { user } = useAuth();

  return useQuery<CollectionData | null>({
    queryKey: ['collection-data', user?.id, year],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return null;

      // 1) Cartera por cliente (lógica canónica existente)
      const receivables = await calculateAllClientReceivables(year);

      // 2) Metadata de facturas para aging: due_date, dias_credito por invoice_id
      const allInvoiceIds = new Set<string>();
      for (const c of receivables.clients) {
        c.invoices_pendientes.forEach(inv => allInvoiceIds.add(inv.id));
      }
      const invoiceMeta = new Map<string, { due_date: string | null; dias_credito: number | null }>();
      if (allInvoiceIds.size > 0) {
        const ids = Array.from(allInvoiceIds);
        // Batch para evitar URL muy larga
        const chunkSize = 200;
        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize);
          const { data } = await supabase
            .from('invoices')
            .select('id, due_date, dias_credito')
            .in('id', chunk);
          for (const row of (data ?? []) as { id: string; due_date: string | null; dias_credito: number | null }[]) {
            invoiceMeta.set(row.id, { due_date: row.due_date, dias_credito: row.dias_credito });
          }
        }
      }

      // 3) Resolver responsible_id por cliente para hacer match con touchpoints/scores
      const clientsEnriched = receivables.clients.map((c: ClientReceivable) => {
        const respId = c.client_id.startsWith('__name:') ? null : c.client_id;
        return { ...c, responsible_id: respId };
      });

      // 4) Aging
      const aging = calculateAgingFromClients(clientsEnriched, invoiceMeta);

      // 5) Scores IA cacheados
      const { data: scoresData } = await supabase
        .from('client_collection_scores' as never)
        .select('responsible_id, client_name, score, category, reasoning, recommended_action, total_owed, oldest_overdue_days, scored_at')
        .eq('user_id', user.id);
      const scoresByClient = new Map<string, ClientScore>();
      let lastScoredAt: string | null = null;
      for (const s of ((scoresData as unknown) as ClientScore[]) ?? []) {
        scoresByClient.set(scoreKey(s), s);
        if (!lastScoredAt || s.scored_at > lastScoredAt) lastScoredAt = s.scored_at;
      }

      // 6) Touchpoints (últimos 50 por cliente, ordenados desc)
      const { data: touchpointsData } = await supabase
        .from('collection_touchpoints' as never)
        .select('id, responsible_id, client_name, invoice_id, channel, outcome, notes, contacted_at, created_at')
        .eq('user_id', user.id)
        .order('contacted_at', { ascending: false })
        .limit(500);
      const touchpointsByClient = new Map<string, TouchpointRow[]>();
      for (const t of ((touchpointsData as unknown) as TouchpointRow[]) ?? []) {
        const k = t.responsible_id ?? `__name:${t.client_name.toLowerCase().trim()}`;
        if (!touchpointsByClient.has(k)) touchpointsByClient.set(k, []);
        touchpointsByClient.get(k)!.push(t);
      }

      return {
        receivables,
        aging,
        scoresByClient,
        touchpointsByClient,
        lastScoredAt,
      };
    },
  });
}

export { clientKey };
