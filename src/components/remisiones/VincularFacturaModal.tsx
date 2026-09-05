import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { CheckCircle, Search, FileText, X } from 'lucide-react';
import { clientNameMatches } from '@/lib/nameMatch';

interface Props {
  remisionId: string;
  remisionNumber: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(value);
}

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export default function VincularFacturaModal({ remisionId, remisionNumber, open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  // Datos de la remision: cliente (pre-filtro) + valor y fecha (sugerencias)
  const { data: remision } = useQuery({
    queryKey: ['remision-for-link', remisionId],
    queryFn: async () => {
      const { data } = await (supabase
        .from('remisiones') as any)
        .select('responsible_id, beneficiary, date, total_manual, remision_items(total_cost)')
        .eq('id', remisionId)
        .maybeSingle();
      return data as { responsible_id: string | null; beneficiary: string | null; date: string | null; total_manual: number | null; remision_items?: { total_cost: number }[] } | null;
    },
    enabled: !!remisionId && open,
  });
  const remTotal = remision
    ? (remision.total_manual
        ? Number(remision.total_manual)
        : (remision.remision_items ?? []).reduce((s, i) => s + Number(i.total_cost || 0), 0))
    : 0;

  // Facturas disponibles
  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices-for-link', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data } = await supabase
        .from('invoices')
        .select('id, invoice_number, issue_date, total_amount, counterparty_name, display_name, responsible_id')
        .eq('type', 'venta')
        // Anuladas por nota crédito NO se sugieren ni se pueden vincular
        // (bug real: 2 NCs y Remisiones seguía sugiriendo esas facturas,
        // Nico 2026-09-04). Las parciales siguen: tienen saldo vivo.
        .or('void_type.is.null,void_type.eq.partial')
        .order('issue_date', { ascending: false });
      return data || [];
    },
    enabled: !!user?.id && open,
  });

  // Toggle: mostrar todas las facturas o solo las del cliente de la remision
  const [showAll, setShowAll] = useState(false);

  // Facturas ya vinculadas a esta remisión
  const { data: linked = [] } = useQuery({
    queryKey: ['remision-invoices', remisionId],
    queryFn: async () => {
      const { data } = await (supabase
        .from('remision_invoices') as any)
        .select('invoice_id')
        .eq('remision_id', remisionId);
      return (data || []).map((r: any) => r.invoice_id);
    },
    enabled: !!remisionId && open,
  });

  // Mapa factura → remisión que YA la tiene. Una factura conciliada con otra
  // remisión no se ofrece ni se sugiere acá (casi-error de Nico 2026-08-01:
  // la ⭐ sugerida ya estaba vinculada a otra remisión y sin saldo). Solo
  // reaparece si se busca explícito, bloqueada y diciendo a cuál está atada;
  // para liberarla hay que borrar la unión desde esa remisión.
  const { data: linkedElsewhere } = useQuery({
    queryKey: ['remision-invoices-map'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await (supabase
        .from('remision_invoices') as any)
        .select('invoice_id, remision_id, remisiones(number)');
      const map = new Map<string, { remisionId: string; number: string }>();
      for (const r of (data ?? []) as any[]) {
        map.set(r.invoice_id, { remisionId: r.remision_id, number: r.remisiones?.number ?? 'otra remisión' });
      }
      return map;
    },
    enabled: open,
  });
  /** Si la factura está tomada por OTRA remisión, devuelve esa remisión. */
  const takenBy = (invoiceId: string): { remisionId: string; number: string } | null => {
    const l = linkedElsewhere?.get(invoiceId);
    return l && l.remisionId !== remisionId ? l : null;
  };

  // Pre-filtro por cliente de la remision (si tiene responsible_id):
  //   - Match exacto por responsible_id
  //   - Fallback por nombre TOLERANTE (clientNameMatches): Siigo trae typos
  //     ("Armotiguadores"), orden distinto y palabras extra — el .includes()
  //     exacto ocultaba la factura correcta (REM-40 ↔ FV-2-299, reporte de
  //     Nico 2026-08-01).
  // El usuario puede activar "showAll" para ver todas si necesita.
  const clientFilteredInvoices = (() => {
    if (showAll || !remision) return invoices;
    const respId = remision.responsible_id;
    const benef = remision.beneficiary?.trim().toLowerCase();
    if (!respId && !benef) return invoices;
    return invoices.filter((inv: any) => {
      if (respId && inv.responsible_id === respId) return true;
      if (benef && inv.counterparty_name?.toLowerCase().includes(benef)) return true;
      if (benef && clientNameMatches(benef, inv.counterparty_name ?? '')) return true;
      return false;
    });
  })();

  // SUGERIDAS: del mismo cliente, valor ≈ al de la remisión (±15%) y fecha
  // igual o posterior al despacho — casi siempre ESA es la factura. Van
  // primero con su estrella; el resto queda por fecha como siempre.
  const esSugerida = (inv: any): boolean => {
    if (remTotal <= 0 || linked.includes(inv.id)) return false;
    if (takenBy(inv.id)) return false; // conciliada con otra remisión: jamás sugerir
    const total = Number(inv.total_amount || 0);
    if (total <= 0) return false;
    const desvio = Math.abs(total - remTotal) / remTotal;
    const fechaOk = !remision?.date || !inv.issue_date || inv.issue_date >= remision.date;
    return desvio <= 0.15 && fechaOk;
  };

  // El buscador manda sobre el pre-filtro de cliente: si Nico tipea "299"
  // busca en TODAS las facturas (número/cliente), no solo en las del cliente
  // de la remisión — el pre-filtro es una ayuda, no una jaula (reporte
  // 2026-08-01: "debería dejar buscar si busco la 299").
  const searchQ = search.trim().toLowerCase();
  const filteredInvoices = (searchQ ? invoices : clientFilteredInvoices)
    .filter((inv: any) => {
      if (!searchQ) return true;
      return (
        inv.invoice_number?.toLowerCase().includes(searchQ) ||
        inv.counterparty_name?.toLowerCase().includes(searchQ) ||
        inv.display_name?.toLowerCase().includes(searchQ)
      );
    })
    // Sin búsqueda, las tomadas por otra remisión NO aparecen. Buscando sí
    // (bloqueadas), para que no vuelvan a ser "inencontrables".
    .filter((inv: any) => (searchQ ? true : !takenBy(inv.id)))
    .sort((a: any, b: any) => {
      const sa = esSugerida(a);
      const sb = esSugerida(b);
      if (sa !== sb) return sa ? -1 : 1;
      if (sa && sb) {
        // Ambas sugeridas: la de valor más cercano primero.
        return Math.abs(Number(a.total_amount || 0) - remTotal) - Math.abs(Number(b.total_amount || 0) - remTotal);
      }
      return String(b.issue_date ?? '').localeCompare(String(a.issue_date ?? ''));
    });

  const handleToggle = async (invoiceId: string) => {
    if (!user?.id) return;
    setSaving(true);
    try {
      if (linked.includes(invoiceId)) {
        // Desvincular
        await (supabase.from('remision_invoices') as any)
          .delete()
          .eq('remision_id', remisionId)
          .eq('invoice_id', invoiceId);
        toast({ title: 'Factura desvinculada' });
      } else {
        // Vincular. UNIQUE constraint en (remision_id, invoice_id) previene
        // duplicados a nivel DB; aca atrapamos el conflict por las dudas.
        const { error } = await (supabase.from('remision_invoices') as any)
          .insert({ remision_id: remisionId, invoice_id: invoiceId, user_id: user.id });
        if (error && error.code !== '23505') throw error;
        toast({ title: 'Factura vinculada correctamente' });
      }
      queryClient.invalidateQueries({ queryKey: ['remision-invoices', remisionId] });
      queryClient.invalidateQueries({ queryKey: ['remision-invoices-map'] });
      queryClient.invalidateQueries({ queryKey: ['remisiones'] });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Vincular facturas a {remisionNumber}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Seleccioná las facturas de venta que respaldan este despacho. Podés vincular más de una.
        </p>

        {linked.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Vinculadas:</span>
            {linked.map((id: string) => {
              const inv = invoices.find((i: any) => i.id === id) as any;
              return inv ? (
                <Badge key={id} variant="secondary" className="gap-1">
                  <CheckCircle className="h-3 w-3 text-green-500" />
                  {inv.invoice_number || inv.display_name}
                  <button onClick={() => handleToggle(id)} className="ml-1 hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ) : null;
            })}
          </div>
        )}

        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por número o cliente..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {(remision?.responsible_id || remision?.beneficiary) && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                {searchQ
                  ? 'Buscando en TODAS las facturas de venta'
                  : showAll
                    ? 'Mostrando TODAS las facturas de venta'
                    : `Filtrando facturas de "${remision.beneficiary || 'cliente de la remisión'}" (${clientFilteredInvoices.length})`}
              </span>
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="text-primary hover:underline"
              >
                {showAll ? 'Solo del cliente' : 'Ver todas'}
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto space-y-1 max-h-80">
          {filteredInvoices.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No hay facturas de venta disponibles.
            </div>
          ) : (
            filteredInvoices.map((inv: any) => {
              const isLinked = linked.includes(inv.id);
              const taken = takenBy(inv.id);
              return (
                <button
                  key={inv.id}
                  onClick={() => { if (!taken) handleToggle(inv.id); }}
                  disabled={saving || !!taken}
                  title={taken ? `Ya conciliada con ${taken.number}. Para usarla acá, primero borrá la unión desde esa remisión.` : undefined}
                  className={`w-full flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                    isLinked
                      ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
                      : taken
                        ? 'border-border opacity-60 cursor-not-allowed'
                        : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <FileText className={`h-4 w-4 shrink-0 ${isLinked ? 'text-green-500' : 'text-muted-foreground'}`} />
                    <div>
                      <p className="text-sm font-medium">{inv.invoice_number || inv.display_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {inv.counterparty_name} · {formatDate(inv.issue_date)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {taken && (
                      <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                        ya en {taken.number}
                      </Badge>
                    )}
                    {esSugerida(inv) && (
                      <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700 bg-amber-50" title={`Valor ≈ al de la remisión (${formatCurrency(remTotal)}) y fecha posterior al despacho`}>
                        ⭐ sugerida
                      </Badge>
                    )}
                    <span className="text-sm font-medium">{formatCurrency(inv.total_amount || 0)}</span>
                    {isLinked && <CheckCircle className="h-4 w-4 text-green-500" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>
            {linked.length > 0 ? `Listo (${linked.length} vinculada${linked.length > 1 ? 's' : ''})` : 'Cerrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
