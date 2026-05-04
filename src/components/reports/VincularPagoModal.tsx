import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link2, Loader2, Search, User, Banknote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { parseLocalDate } from '@/lib/dateUtils';
import { toast } from 'sonner';

interface InvoiceTarget {
  id: string;
  invoice_number: string;
  counterparty_name: string | null;
  pending: number;
  total_amount: number;
}

interface SaldoInicialTarget {
  id: string;
  responsible_name: string | null;
  pending: number;
  total_amount: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice?: InvoiceTarget | null;
  saldoInicial?: SaldoInicialTarget | null;
  onSuccess?: () => void;
}

interface UnmatchedTx {
  id: string;
  date: string;
  amount: number;            // absoluto
  remaining: number;         // tx.amount - sum(matched_amount)
  description: string;
  owner: string | null;
  responsible_name?: string | null;
  isSameClient: boolean;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function VincularPagoModal({ open, onOpenChange, invoice, saldoInicial, onSuccess }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [txs, setTxs] = useState<UnmatchedTx[]>([]);
  const [search, setSearch] = useState('');
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);
  const [applyAmount, setApplyAmount] = useState<string>('');

  const mode: 'invoice' | 'saldo_inicial' | null = invoice ? 'invoice' : saldoInicial ? 'saldo_inicial' : null;

  const target = useMemo(() => {
    if (invoice) {
      return {
        title: `factura ${invoice.invoice_number}`,
        clientName: invoice.counterparty_name || '',
        pending: invoice.pending,
        successLabel: invoice.invoice_number,
      };
    }
    if (saldoInicial) {
      return {
        title: `saldo inicial de ${saldoInicial.responsible_name || 'sin nombre'}`,
        clientName: saldoInicial.responsible_name || '',
        pending: saldoInicial.pending,
        successLabel: `saldo inicial de ${saldoInicial.responsible_name || 'sin nombre'}`,
      };
    }
    return null;
  }, [invoice, saldoInicial]);

  const selectedTx = useMemo(
    () => txs.find(t => t.id === selectedTxId) || null,
    [txs, selectedTxId]
  );

  // Load unmatched income transactions + their existing partial matches
  useEffect(() => {
    if (!open || !user || !target) return;
    void loadUnmatched();
    setSelectedTxId(null);
    setApplyAmount('');
    setSearch('');
  }, [open, user?.id, invoice?.id, saldoInicial?.id]);

  const loadUnmatched = async () => {
    if (!user || !target) return;
    setLoading(true);
    try {
      // 1. All income transactions with NO direct invoice link.
      const { data: raw, error } = await supabase
        .from('transactions')
        .select('id, date, amount, description, owner, responsible_id')
        .eq('type', 'ingreso')
        .is('invoice_id', null)
        .is('deleted_at', null)
        .order('date', { ascending: false })
        .limit(500);

      if (error) throw error;

      const txIds = (raw || []).map(t => t.id);

      // 2. Existing partial matches for these transactions — both against
      //    invoices AND against initial balances count toward tx "used up".
      const [invMatchesRes, iniMatchesRes] = txIds.length
        ? await Promise.all([
            supabase
              .from('invoice_transaction_matches')
              .select('transaction_id, matched_amount')
              .in('transaction_id', txIds),
            supabase
              .from('initial_balance_matches' as any)
              .select('transaction_id, matched_amount')
              .in('transaction_id', txIds),
          ])
        : [{ data: [] as any[] }, { data: [] as any[] }];

      const matchedByTx = new Map<string, number>();
      [...(invMatchesRes.data || []), ...(iniMatchesRes.data || [])].forEach((m: any) => {
        const cur = matchedByTx.get(m.transaction_id) || 0;
        matchedByTx.set(m.transaction_id, cur + Math.abs(m.matched_amount ?? 0));
      });

      // 3. Responsible names (clientes) — join responsibles for better match
      const responsibleIds = [...new Set((raw || []).map(t => t.responsible_id).filter(Boolean))];
      const respMap = new Map<string, string>();
      if (responsibleIds.length > 0) {
        const { data: resps } = await supabase
          .from('responsibles')
          .select('id, name')
          .in('id', responsibleIds);
        (resps || []).forEach((r: any) => respMap.set(r.id, r.name));
      }

      const clientName = (target.clientName || '').toLowerCase().trim();

      const enriched: UnmatchedTx[] = (raw || [])
        .map(t => {
          const absAmount = Math.abs(t.amount ?? 0);
          const matched = matchedByTx.get(t.id) || 0;
          const remaining = Math.max(0, absAmount - matched);
          const respName = t.responsible_id ? respMap.get(t.responsible_id) || null : null;

          // "Same client" = cliente name aparece en owner, description, o responsible
          const haystack = `${t.owner || ''} ${t.description || ''} ${respName || ''}`.toLowerCase();
          const isSameClient = clientName.length >= 3 && haystack.includes(clientName.substring(0, Math.min(clientName.length, 12)));

          return {
            id: t.id,
            date: t.date,
            amount: absAmount,
            remaining,
            description: t.description,
            owner: t.owner,
            responsible_name: respName,
            isSameClient,
          };
        })
        .filter(t => t.remaining > 0);

      // Priorizar: mismo cliente primero, luego por fecha desc (ya vienen así)
      enriched.sort((a, b) => {
        if (a.isSameClient && !b.isSameClient) return -1;
        if (!a.isSameClient && b.isSameClient) return 1;
        return 0;
      });

      setTxs(enriched);
    } catch (err) {
      console.error('load unmatched error:', err);
      toast.error('No se pudieron cargar los movimientos');
    } finally {
      setLoading(false);
    }
  };

  const filteredTxs = useMemo(() => {
    if (!search.trim()) return txs;
    const q = search.toLowerCase();
    return txs.filter(t =>
      (t.description || '').toLowerCase().includes(q) ||
      (t.owner || '').toLowerCase().includes(q) ||
      (t.responsible_name || '').toLowerCase().includes(q) ||
      t.date.includes(q) ||
      formatCurrency(t.amount).toLowerCase().includes(q)
    );
  }, [txs, search]);

  const handleSelectTx = (tx: UnmatchedTx) => {
    setSelectedTxId(tx.id);
    // Default: min(tx.remaining, target.pending)
    const defaultApply = Math.min(tx.remaining, target?.pending ?? 0);
    setApplyAmount(String(Math.round(defaultApply)));
  };

  const handleConfirm = async () => {
    if (!user || !target || !selectedTx) return;

    const amt = Number(applyAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Ingresá un monto válido');
      return;
    }
    if (amt > selectedTx.remaining) {
      toast.error(`El monto excede el saldo disponible del movimiento (${formatCurrency(selectedTx.remaining)})`);
      return;
    }
    if (amt > target.pending) {
      toast.error(`El monto excede el saldo pendiente (${formatCurrency(target.pending)})`);
      return;
    }

    setSaving(true);
    try {
      if (mode === 'invoice' && invoice) {
        const { error } = await supabase
          .from('invoice_transaction_matches')
          .insert({
            invoice_id: invoice.id,
            transaction_id: selectedTx.id,
            user_id: user.id,
            matched_amount: amt,
            match_type: 'manual',
          } as any);
        if (error) throw error;
      } else if (mode === 'saldo_inicial' && saldoInicial) {
        const { error } = await supabase
          .from('initial_balance_matches' as any)
          .insert({
            initial_state_detail_id: saldoInicial.id,
            transaction_id: selectedTx.id,
            user_id: user.id,
            matched_amount: amt,
            match_type: 'manual',
          } as any);
        if (error) throw error;
      }

      const leftover = selectedTx.remaining - amt;
      const leftoverMsg = leftover > 0
        ? ` Saldo disponible: ${formatCurrency(leftover)} para otro vínculo.`
        : '';

      toast.success(`Pago vinculado a ${target.successLabel}.${leftoverMsg}`);
      onSuccess?.();
      onOpenChange(false);
    } catch (err: any) {
      console.error('vincular pago error:', err);
      toast.error(err?.message || 'No se pudo vincular el pago');
    } finally {
      setSaving(false);
    }
  };

  if (!target) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-primary" />
            Vincular pago a {target.title}
          </DialogTitle>
          <DialogDescription className="space-y-1">
            {target.clientName && (
              <span className="block">
                Cliente: <strong>{target.clientName}</strong>
              </span>
            )}
            <span className="block">
              Saldo pendiente: <strong className="text-destructive">{formatCurrency(target.pending)}</strong>
            </span>
            <span className="block text-xs">
              Si el movimiento es mayor al saldo, el excedente queda disponible para otros vínculos del mismo cliente.
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-3 py-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por descripción, cliente, fecha o monto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          {/* Tx list */}
          <div className="flex-1 overflow-y-auto border border-border rounded-md">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Cargando movimientos...
              </div>
            ) : filteredTxs.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No hay movimientos bancarios sin vincular.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filteredTxs.map((tx) => {
                  const isSelected = tx.id === selectedTxId;
                  const wasPartiallyMatched = tx.remaining < tx.amount;
                  return (
                    <button
                      key={tx.id}
                      onClick={() => handleSelectTx(tx)}
                      className={cn(
                        'w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors flex items-start gap-3',
                        isSelected && 'bg-primary/10 border-l-2 border-l-primary'
                      )}
                    >
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-success/10 shrink-0 mt-0.5">
                        <Banknote className="h-4 w-4 text-success" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="text-xs text-muted-foreground">
                            {format(parseLocalDate(tx.date), 'dd MMM yyyy', { locale: es })}
                          </span>
                          {tx.isSameClient && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                              <User className="h-2.5 w-2.5" />
                              Mismo cliente
                            </span>
                          )}
                          {wasPartiallyMatched && (
                            <span className="text-[10px] text-warning font-medium">
                              (ya vinculado parcialmente)
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-foreground line-clamp-1">{tx.description}</p>
                        {(tx.owner || tx.responsible_name) && (
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {tx.responsible_name || tx.owner}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold text-success">
                          {formatCurrency(tx.remaining)}
                        </div>
                        {wasPartiallyMatched && (
                          <div className="text-[10px] text-muted-foreground">
                            de {formatCurrency(tx.amount)}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Apply-amount input */}
          {selectedTx && (
            <div className="bg-muted/40 border border-border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label htmlFor="apply-amount" className="text-sm font-medium">
                  Monto a aplicar
                </Label>
                <span className="text-xs text-muted-foreground">
                  Disponible: {formatCurrency(selectedTx.remaining)} · Saldo pendiente: {formatCurrency(target.pending)}
                </span>
              </div>
              <Input
                id="apply-amount"
                type="number"
                min="1"
                step="1"
                value={applyAmount}
                onChange={(e) => setApplyAmount(e.target.value)}
                className="text-right font-mono"
              />
              {Number(applyAmount) > 0 && Number(applyAmount) < selectedTx.remaining && (
                <p className="text-xs text-muted-foreground">
                  Sobran <strong>{formatCurrency(selectedTx.remaining - Number(applyAmount))}</strong> del movimiento,
                  disponibles para vincular a otro saldo del mismo cliente.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedTx || saving || !Number(applyAmount)}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Vinculando...
              </>
            ) : (
              <>
                <Link2 className="h-4 w-4 mr-2" />
                Vincular pago
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
