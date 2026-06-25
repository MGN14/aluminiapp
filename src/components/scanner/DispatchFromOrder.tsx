import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { normalizeRef } from '@/lib/qrLabel';
import { beep } from '@/lib/scanFeedback';
import AppLayout from '@/components/layout/AppLayout';
import GuidedPick, { type CompanyInfo } from '@/components/scanner/GuidedPick';
import { ArrowLeft, Loader2, PackageCheck, ChevronRight, ClipboardList } from 'lucide-react';

interface RemItem { id: string; reference: string; product_name: string | null; units: number | null; }
interface Rem {
  id: string; date: string; number: string; beneficiary: string | null;
  status: string; module_origin: string; remision_type: string;
  remision_items: RemItem[];
}

function formatDate(s: string) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

interface Props { company: CompanyInfo | null | undefined; onExit: () => void; }

export default function DispatchFromOrder({ company, onExit }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: pendientes = [], isLoading, refetch } = useQuery({
    queryKey: ['despacho-pedidos', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await (supabase.from('remisiones') as any)
        .select('id, date, number, beneficiary, status, module_origin, remision_type, remision_items(id, reference, product_name, units)')
        .eq('status', 'pendiente')
        .eq('remision_type', 'venta')
        .order('date', { ascending: false });
      if (error) throw error;
      return (data || []) as Rem[];
    },
    enabled: !!user?.id,
  });

  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useMemo(() => pendientes.find(r => r.id === activeId) || null, [pendientes, activeId]);

  if (active) {
    return (
      <GuidedPick
        key={active.id}
        remision={active}
        company={company}
        userId={user?.id ?? null}
        toast={toast}
        onBack={() => setActiveId(null)}
        onDispatched={() => { setActiveId(null); refetch(); }}
      />
    );
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between gap-3 mb-6">
          <button onClick={onExit} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" /> Volver
          </button>
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-blue-600/10 flex items-center justify-center">
              <ClipboardList className="h-5 w-5 text-blue-600" />
            </div>
            <h1 className="text-lg font-bold">Despachar un pedido</h1>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : pendientes.length === 0 ? (
          <div className="text-center py-24">
            <PackageCheck className="h-12 w-12 mx-auto text-green-500 mb-3" />
            <p className="text-lg font-semibold">No hay pedidos pendientes</p>
            <p className="text-sm text-muted-foreground mt-1">Las remisiones de venta en estado “pendiente” aparecen acá para despachar con guía por ubicación.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground px-1">{pendientes.length} pedido{pendientes.length === 1 ? '' : 's'} pendiente{pendientes.length === 1 ? '' : 's'}</p>
            {pendientes.map(r => {
              const items = r.remision_items || [];
              const refs = new Set(items.map(i => normalizeRef(i.reference)).filter(Boolean)).size;
              const units = items.reduce((s, i) => s + (Number(i.units) || 0), 0);
              return (
                <button
                  key={r.id}
                  onClick={() => { beep('ok'); setActiveId(r.id); }}
                  className="w-full text-left bg-white rounded-2xl border p-4 sm:p-5 flex items-center justify-between hover:border-blue-400 hover:shadow-sm transition active:scale-[0.99]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-base">{r.number}</span>
                      {r.module_origin === 'gerencial' && <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">Gerencial</span>}
                    </div>
                    <div className="text-sm text-muted-foreground truncate">{r.beneficiary || 'Sin beneficiario'}</div>
                    <div className="text-xs text-muted-foreground mt-1">{formatDate(r.date)} · {refs} referencia{refs === 1 ? '' : 's'} · {units} unidades</div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
