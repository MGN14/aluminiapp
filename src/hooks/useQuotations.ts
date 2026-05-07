import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import type {
  Quotation,
  QuotationItem,
  QuotationItemDraft,
  QuotationStatus,
} from '@/types/quotation';
import { computeQuotationTotals } from '@/types/quotation';

export interface QuotationListRow extends Quotation {
  responsible_name: string | null;
}

export interface QuotationDetail extends Quotation {
  responsible: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    nit: string | null;
  } | null;
  items: QuotationItem[];
}

export interface CreateQuotationInput {
  responsible_id: string;
  issue_date: string;
  valid_until: string;
  labor_pct: number;
  profit_pct: number;
  notes?: string | null;
  items: QuotationItemDraft[];
}

export interface UpdateQuotationInput extends CreateQuotationInput {
  id: string;
}

const LIST_KEY = 'quotations';
const DETAIL_KEY = 'quotation-detail';

export function useQuotations(filters?: {
  status?: QuotationStatus | 'all';
  search?: string;
}) {
  const { user } = useAuth();

  return useQuery({
    queryKey: [LIST_KEY, user?.id, filters?.status ?? 'all', filters?.search ?? ''],
    queryFn: async (): Promise<QuotationListRow[]> => {
      let q = supabase
        .from('quotations' as never)
        .select(
          `
          *,
          responsibles:responsible_id (name)
        `,
        )
        .order('issue_date', { ascending: false })
        .order('created_at', { ascending: false }) as any;

      if (filters?.status && filters.status !== 'all') {
        q = q.eq('status', filters.status);
      }
      const { data, error } = await q;
      if (error) throw error;

      const rows = (data ?? []) as Array<
        Quotation & { responsibles: { name: string } | null }
      >;
      let mapped: QuotationListRow[] = rows.map((r) => ({
        ...r,
        responsible_name: r.responsibles?.name ?? null,
      }));

      if (filters?.search?.trim()) {
        const s = filters.search.trim().toLowerCase();
        mapped = mapped.filter(
          (r) =>
            r.quote_number.toLowerCase().includes(s) ||
            (r.responsible_name ?? '').toLowerCase().includes(s),
        );
      }
      return mapped;
    },
    enabled: !!user?.id,
  });
}

export function useQuotationDetail(quoteId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: [DETAIL_KEY, quoteId, user?.id],
    enabled: !!user?.id && !!quoteId,
    queryFn: async (): Promise<QuotationDetail | null> => {
      const { data: quote, error: qErr } = await (supabase
        .from('quotations' as never)
        .select(
          `
          *,
          responsible:responsible_id (id, name, email, phone, address, nit)
        `,
        )
        .eq('id', quoteId!)
        .maybeSingle() as any);
      if (qErr) throw qErr;
      if (!quote) return null;

      const { data: items, error: iErr } = await (supabase
        .from('quotation_items' as never)
        .select('*')
        .eq('quotation_id', quoteId!)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }) as any);
      if (iErr) throw iErr;

      return { ...(quote as any), items: (items ?? []) as QuotationItem[] };
    },
  });
}

export function useQuotationMutations() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: [LIST_KEY] });
    qc.invalidateQueries({ queryKey: [DETAIL_KEY] });
  };

  const create = useMutation({
    mutationFn: async (input: CreateQuotationInput): Promise<{ id: string; quote_number: string }> => {
      if (!user) throw new Error('No autenticado');
      if (!input.items.length) throw new Error('La cotización debe tener al menos un ítem');

      const totals = computeQuotationTotals(input.items, input.labor_pct, input.profit_pct);

      const { data: created, error: cErr } = await (supabase
        .from('quotations' as never)
        .insert({
          user_id: user.id,
          responsible_id: input.responsible_id,
          issue_date: input.issue_date,
          valid_until: input.valid_until,
          labor_pct: input.labor_pct,
          profit_pct: input.profit_pct,
          subtotal_base: totals.subtotal_base,
          labor_amount: totals.labor_amount,
          profit_amount: totals.profit_amount,
          total: totals.total,
          notes: input.notes?.trim() || null,
        } as never)
        .select('id, quote_number')
        .single() as any);
      if (cErr) throw cErr;

      const itemsToInsert = input.items.map((it, idx) => {
        const area = (Number(it.width_m) || 0) * (Number(it.height_m) || 0) * (Number(it.quantity) || 0);
        const subtotal = area * (Number(it.price_per_m2) || 0);
        return {
          quotation_id: created.id,
          description: it.description?.trim() || null,
          system: it.system,
          color: it.color,
          width_m: it.width_m,
          height_m: it.height_m,
          quantity: it.quantity,
          area_m2: round4(area),
          price_per_m2: it.price_per_m2,
          line_subtotal: round2(subtotal),
          sort_order: idx,
        };
      });

      const { error: iErr } = await (supabase
        .from('quotation_items' as never)
        .insert(itemsToInsert as never) as any);
      if (iErr) {
        // Rollback best-effort: borrar cabecera si fallaron items
        await (supabase.from('quotations' as never).delete().eq('id', created.id) as any);
        throw iErr;
      }

      return { id: created.id, quote_number: created.quote_number };
    },
    onSuccess: invalidateAll,
  });

  const update = useMutation({
    mutationFn: async (input: UpdateQuotationInput): Promise<void> => {
      if (!user) throw new Error('No autenticado');
      const totals = computeQuotationTotals(input.items, input.labor_pct, input.profit_pct);

      const { error: uErr } = await (supabase
        .from('quotations' as never)
        .update({
          responsible_id: input.responsible_id,
          issue_date: input.issue_date,
          valid_until: input.valid_until,
          labor_pct: input.labor_pct,
          profit_pct: input.profit_pct,
          subtotal_base: totals.subtotal_base,
          labor_amount: totals.labor_amount,
          profit_amount: totals.profit_amount,
          total: totals.total,
          notes: input.notes?.trim() || null,
        } as never)
        .eq('id', input.id) as any);
      if (uErr) throw uErr;

      // Reemplazo de items: delete + insert (más simple que diff)
      const { error: dErr } = await (supabase
        .from('quotation_items' as never)
        .delete()
        .eq('quotation_id', input.id) as any);
      if (dErr) throw dErr;

      const itemsToInsert = input.items.map((it, idx) => {
        const area = (Number(it.width_m) || 0) * (Number(it.height_m) || 0) * (Number(it.quantity) || 0);
        const subtotal = area * (Number(it.price_per_m2) || 0);
        return {
          quotation_id: input.id,
          description: it.description?.trim() || null,
          system: it.system,
          color: it.color,
          width_m: it.width_m,
          height_m: it.height_m,
          quantity: it.quantity,
          area_m2: round4(area),
          price_per_m2: it.price_per_m2,
          line_subtotal: round2(subtotal),
          sort_order: idx,
        };
      });
      const { error: iErr } = await (supabase
        .from('quotation_items' as never)
        .insert(itemsToInsert as never) as any);
      if (iErr) throw iErr;
    },
    onSuccess: invalidateAll,
  });

  const remove = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await (supabase
        .from('quotations' as never)
        .delete()
        .eq('id', id) as any);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const setStatus = useMutation({
    mutationFn: async (params: { id: string; status: QuotationStatus }): Promise<void> => {
      const patch: Record<string, unknown> = { status: params.status };
      const now = new Date().toISOString();
      if (params.status === 'sent') patch.sent_at = now;
      if (params.status === 'accepted') patch.accepted_at = now;
      if (params.status === 'rejected') patch.rejected_at = now;
      const { error } = await (supabase
        .from('quotations' as never)
        .update(patch as never)
        .eq('id', params.id) as any);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  const duplicate = useMutation({
    mutationFn: async (id: string): Promise<{ id: string; quote_number: string }> => {
      if (!user) throw new Error('No autenticado');

      const { data: src, error: sErr } = await (supabase
        .from('quotations' as never)
        .select('*')
        .eq('id', id)
        .single() as any);
      if (sErr) throw sErr;
      const { data: srcItems, error: siErr } = await (supabase
        .from('quotation_items' as never)
        .select('*')
        .eq('quotation_id', id)
        .order('sort_order', { ascending: true }) as any);
      if (siErr) throw siErr;

      const today = new Date().toISOString().slice(0, 10);
      const validity = (src as any).valid_until && (src as any).issue_date
        ? Math.max(
            1,
            Math.round(
              (new Date((src as any).valid_until).getTime() -
                new Date((src as any).issue_date).getTime()) /
                86400000,
            ),
          )
        : 15;
      const validUntil = new Date(Date.now() + validity * 86400000)
        .toISOString()
        .slice(0, 10);

      const { data: created, error: cErr } = await (supabase
        .from('quotations' as never)
        .insert({
          user_id: user.id,
          responsible_id: (src as any).responsible_id,
          issue_date: today,
          valid_until: validUntil,
          status: 'draft',
          labor_pct: (src as any).labor_pct,
          profit_pct: (src as any).profit_pct,
          subtotal_base: (src as any).subtotal_base,
          labor_amount: (src as any).labor_amount,
          profit_amount: (src as any).profit_amount,
          total: (src as any).total,
          notes: (src as any).notes,
        } as never)
        .select('id, quote_number')
        .single() as any);
      if (cErr) throw cErr;

      if ((srcItems ?? []).length > 0) {
        const itemsCopy = ((srcItems as any[]) ?? []).map((it) => ({
          quotation_id: created.id,
          description: it.description,
          system: it.system,
          color: it.color,
          width_m: it.width_m,
          height_m: it.height_m,
          quantity: it.quantity,
          area_m2: it.area_m2,
          price_per_m2: it.price_per_m2,
          line_subtotal: it.line_subtotal,
          sort_order: it.sort_order,
        }));
        const { error: iErr } = await (supabase
          .from('quotation_items' as never)
          .insert(itemsCopy as never) as any);
        if (iErr) {
          await (supabase.from('quotations' as never).delete().eq('id', created.id) as any);
          throw iErr;
        }
      }

      return { id: created.id, quote_number: created.quote_number };
    },
    onSuccess: invalidateAll,
  });

  const markSent = useMutation({
    mutationFn: async (params: {
      id: string;
      channel: 'email' | 'whatsapp';
      recipient: string;
      pdfStoragePath?: string | null;
    }): Promise<void> => {
      const patch: Record<string, unknown> = {
        status: 'sent',
        sent_at: new Date().toISOString(),
      };
      if (params.channel === 'email') patch.sent_email_to = params.recipient;
      if (params.channel === 'whatsapp') patch.sent_whatsapp_to = params.recipient;
      if (params.pdfStoragePath) patch.pdf_storage_path = params.pdfStoragePath;
      const { error } = await (supabase
        .from('quotations' as never)
        .update(patch as never)
        .eq('id', params.id) as any);
      if (error) throw error;
    },
    onSuccess: invalidateAll,
  });

  return { create, update, remove, setStatus, duplicate, markSent };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
