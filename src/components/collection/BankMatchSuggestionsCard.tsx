// Card: sugerencias de auto-matching banco→factura pendientes de confirmar.
// Aparece en el Módulo de Cobranza cuando hay sugerencias en queue.

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X, Sparkles, Loader2, Zap, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useBankInvoiceMatches } from '@/hooks/useBankInvoiceMatches';

const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

const fmtDate = (iso: string | undefined) => {
  if (!iso) return '—';
  return new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
};

const SIGNAL_LABEL: Record<string, string> = {
  amount_match_exact: '💰 Monto exacto',
  amount_match_exact_total: '💰 Match contra total facturado',
  amount_match_near: '~ Monto cercano (±10%)',
  amount_match_near_total: '~ Total cercano (±10%)',
  ref_in_desc: '📋 Número de factura en descripción',
  client_match_name: '👤 Nombre del cliente en descripción',
  client_match_nit: '🆔 NIT del cliente en descripción',
  date_close: '📅 Fecha cercana a la factura',
  expected_payment_match: '🤝 Coincide con promesa de pago',
};

function signalChips(signals: Record<string, any>) {
  const chips: string[] = [];
  if (signals.amount_match === 'exact') chips.push(SIGNAL_LABEL.amount_match_exact);
  else if (signals.amount_match === 'exact_total') chips.push(SIGNAL_LABEL.amount_match_exact_total);
  else if (signals.amount_match === 'near') chips.push(SIGNAL_LABEL.amount_match_near);
  else if (signals.amount_match === 'near_total') chips.push(SIGNAL_LABEL.amount_match_near_total);
  if (signals.ref_in_desc) chips.push(SIGNAL_LABEL.ref_in_desc);
  if (signals.client_match === 'name') chips.push(SIGNAL_LABEL.client_match_name);
  if (signals.client_match === 'nit') chips.push(SIGNAL_LABEL.client_match_nit);
  if (typeof signals.days_from_issue === 'number' && signals.days_from_issue <= 30) chips.push(SIGNAL_LABEL.date_close);
  if (signals.expected_payment_match) chips.push(SIGNAL_LABEL.expected_payment_match);
  return chips;
}

function confidenceColor(c: number) {
  if (c >= 80) return 'bg-success/15 text-success border-success/30';
  if (c >= 65) return 'bg-warning/15 text-warning border-warning/30';
  return 'bg-orange-500/15 text-orange-600 border-orange-500/30';
}

export default function BankMatchSuggestionsCard() {
  const { pending, isLoading, confirm, reject, runBatch } = useBankInvoiceMatches();
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? pending : pending.slice(0, 5);

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Auto-matching de pagos bancarios
                {pending.length > 0 && (
                  <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
                    {pending.length} pendientes
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                IA detecta qué pago del banco corresponde a qué factura usando monto, cliente, número de factura y fecha.
                Las de alta confianza (≥80) se vinculan solas; las medias (50-79) aparecen acá para que confirmes.
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => runBatch.mutate(1000)}
              disabled={runBatch.isPending}
              className="gap-1.5"
            >
              {runBatch.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {runBatch.isPending ? 'Procesando…' : 'Re-escanear pagos sin vincular'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Cargando sugerencias…
            </div>
          ) : pending.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 px-3 rounded bg-muted/30 border border-dashed border-border">
              ✅ No hay sugerencias pendientes. Cuando lleguen pagos al banco que parezcan corresponder a facturas, aparecen acá.
              <br />
              Tocá <strong>"Re-escanear"</strong> para procesar tu histórico de transacciones sin vincular.
            </p>
          ) : (
            <>
              {visible.map((s) => {
                const chips = signalChips(s.signals);
                return (
                  <div key={s.id} className="border border-border rounded-lg p-3 bg-card hover:bg-muted/20 transition-colors">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={confidenceColor(s.confidence) + ' font-mono'}>
                            {s.confidence}/100
                          </Badge>
                          <span className="text-sm font-medium truncate">
                            {fmtMoney(Math.abs(s.tx_amount ?? 0))}
                          </span>
                          <span className="text-xs text-muted-foreground">→</span>
                          <span className="text-sm font-medium truncate">
                            FV {s.signals.invoice_number ?? '—'} · {s.signals.counterparty_name ?? '—'}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          <p>
                            <strong>Banco:</strong> {fmtDate(s.tx_date)} · {s.tx_description ?? '—'}
                          </p>
                          <p>
                            <strong>Factura:</strong> total {fmtMoney(s.signals.total_amount)} · saldo pendiente {fmtMoney(s.signals.balance_pending)}
                          </p>
                        </div>
                        {chips.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {chips.map((c, i) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                                {c}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              onClick={() => confirm.mutate(s)}
                              disabled={confirm.isPending}
                              className="h-8 gap-1.5"
                            >
                              <Check className="h-3.5 w-3.5" /> Confirmar
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Vincular este pago con esta factura</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => reject.mutate(s.id)}
                              disabled={reject.isPending}
                              className="h-8 text-destructive hover:bg-destructive/10"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Descartar — no son el mismo pago</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                );
              })}
              {pending.length > 5 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAll(s => !s)}
                  className="w-full gap-1.5 text-xs"
                >
                  {showAll
                    ? <><ChevronDown className="h-3.5 w-3.5" /> Mostrar solo 5</>
                    : <><ChevronRight className="h-3.5 w-3.5" /> Mostrar todas ({pending.length})</>}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
