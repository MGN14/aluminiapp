// Modal para vincular UNA transacción bancaria a UNA factura.
//
// Es el flujo inverso al VincularPagoModal existente: ahí partís de una
// factura y buscás la transacción que la pagó. Acá partís de la transacción
// (un pago en banco) y buscás qué factura la cubre. Útil cuando estás
// revisando la Relación de Pagos y ves un movimiento sin vincular.
//
// Comportamiento:
//   - Carga facturas pendientes (status='confirmed') del tipo correspondiente
//     (venta si la tx es ingreso, compra si es egreso).
//   - Prioriza las del mismo cliente (matchea por responsible_id si la
//     transacción ya tiene responsible asignado).
//   - Permite buscar por número de factura o nombre de cliente.
//   - Al confirmar: UPDATE transactions SET invoice_id = X.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Link2, Search, Receipt, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface InvoiceCandidate {
  id: string;
  invoice_number: string;
  counterparty_name: string | null;
  issue_date: string;
  due_date: string | null;
  total_amount: number;
  type: 'venta' | 'compra';
  responsible_id: string | null;
}

interface TxToLink {
  id: string;          // transaction id
  date: string;
  description: string;
  amount: number;      // absoluto
  type: 'ingreso' | 'egreso';
  counterparty: string | null;
  responsibleId: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tx: TxToLink | null;
  onSuccess?: () => void;
}

function formatCOP(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function VincularFacturaTxModal({ open, onOpenChange, tx, onSuccess }: Props) {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState<InvoiceCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  // Reset al abrir/cerrar
  useEffect(() => {
    if (open) {
      setSearch('');
      setSelectedInvoiceId(null);
    }
  }, [open]);

  // Cargar facturas candidatas
  useEffect(() => {
    if (!open || !user || !tx) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const targetType = tx.type === 'ingreso' ? 'venta' : 'compra';
        // Solo facturas del último 1.5 años para no traer histórico viejo
        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - 18);
        const cutoff = cutoffDate.toISOString().slice(0, 10);

        const { data } = await supabase
          .from('invoices')
          .select('id, invoice_number, counterparty_name, issue_date, due_date, total_amount, type, responsible_id')
          .eq('user_id', user.id)
          .eq('type', targetType)
          .eq('status', 'confirmed')
          .gte('issue_date', cutoff)
          .order('issue_date', { ascending: false })
          .limit(200);
        if (!cancelled) {
          setInvoices((data ?? []) as any);
        }
      } catch (err) {
        console.error('Error loading invoices:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, user, tx]);

  // Filtrar y ordenar: facturas del mismo cliente arriba, después por fecha
  const filteredInvoices = useMemo(() => {
    if (!tx) return [];
    const q = search.trim().toLowerCase();
    let list = invoices;
    if (q) {
      list = list.filter(i =>
        (i.invoice_number ?? '').toLowerCase().includes(q) ||
        (i.counterparty_name ?? '').toLowerCase().includes(q),
      );
    }
    // Heurística: facturas del mismo cliente primero
    return [...list].sort((a, b) => {
      const aMatchesResp = tx.responsibleId && a.responsible_id === tx.responsibleId;
      const bMatchesResp = tx.responsibleId && b.responsible_id === tx.responsibleId;
      if (aMatchesResp && !bMatchesResp) return -1;
      if (!aMatchesResp && bMatchesResp) return 1;
      // Si counterparty matchea por nombre
      const txCounter = (tx.counterparty ?? '').toLowerCase();
      const aMatchesName = txCounter && (a.counterparty_name ?? '').toLowerCase().includes(txCounter);
      const bMatchesName = txCounter && (b.counterparty_name ?? '').toLowerCase().includes(txCounter);
      if (aMatchesName && !bMatchesName) return -1;
      if (!aMatchesName && bMatchesName) return 1;
      // Por fecha desc
      return b.issue_date.localeCompare(a.issue_date);
    });
  }, [invoices, search, tx]);

  // Heurística para destacar facturas con monto similar al de la transacción
  const txAmount = tx?.amount ?? 0;
  const isAmountSimilar = (invAmount: number) => {
    if (!txAmount) return false;
    const diff = Math.abs(invAmount - txAmount) / txAmount;
    return diff <= 0.05; // 5% tolerancia
  };

  const handleSave = async () => {
    if (!selectedInvoiceId || !tx || !user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('transactions')
        .update({ invoice_id: selectedInvoiceId })
        .eq('id', tx.id)
        .eq('user_id', user.id);
      if (error) throw error;
      const inv = invoices.find(i => i.id === selectedInvoiceId);
      toast.success(`Vinculado a factura #${inv?.invoice_number ?? ''}`);
      onSuccess?.();
      onOpenChange(false);
    } catch (err: any) {
      console.error('Error linking:', err);
      toast.error(err?.message || 'No pudimos vincular. Probá de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  if (!tx) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Vincular a factura</DialogTitle>
          <DialogDescription>
            Asociá este {tx.type === 'ingreso' ? 'cobro' : 'pago'} con una factura{' '}
            {tx.type === 'ingreso' ? 'de venta' : 'de compra'}.
          </DialogDescription>
        </DialogHeader>

        {/* Resumen de la transacción */}
        <div className="rounded-md border bg-muted/40 p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium truncate">{tx.description}</p>
            <p className={`text-sm font-bold tabular-nums ${tx.type === 'ingreso' ? 'text-success' : 'text-destructive'}`}>
              {tx.type === 'ingreso' ? '+' : '−'}{formatCOP(tx.amount)}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{formatDate(tx.date)}</span>
            {tx.counterparty && <span>Beneficiario: {tx.counterparty}</span>}
          </div>
        </div>

        {/* Buscador */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por número de factura o cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Lista de facturas */}
        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {loading ? (
            <div className="py-8 flex items-center justify-center text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Cargando facturas…</span>
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No hay facturas {tx.type === 'ingreso' ? 'de venta' : 'de compra'} confirmadas que coincidan.
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredInvoices.map((inv) => {
                const isSelected = inv.id === selectedInvoiceId;
                const matchesAmount = isAmountSimilar(Number(inv.total_amount));
                const matchesResp = tx.responsibleId && inv.responsible_id === tx.responsibleId;
                return (
                  <button
                    key={inv.id}
                    type="button"
                    onClick={() => setSelectedInvoiceId(inv.id)}
                    className={cn(
                      "w-full text-left rounded-md border p-3 transition-colors",
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50 hover:bg-muted/40",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">#{inv.invoice_number}</span>
                          {matchesResp && (
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-success/15 text-success font-semibold">
                              Mismo cliente
                            </span>
                          )}
                          {matchesAmount && (
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary font-semibold">
                              Monto coincide
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {inv.counterparty_name ?? 'Sin contraparte'}
                        </p>
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1">
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(inv.issue_date)}
                          </span>
                          {inv.due_date && (
                            <span>Vence: {formatDate(inv.due_date)}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold tabular-nums">{formatCOP(Number(inv.total_amount))}</p>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                          Total
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!selectedInvoiceId || saving} className="gap-2">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Vinculando…</> : <><Link2 className="h-4 w-4" /> Vincular</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
