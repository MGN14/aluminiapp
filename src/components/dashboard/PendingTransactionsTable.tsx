import { useMemo, useState } from 'react';
import { parseLocalDate } from '@/lib/dateUtils';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, PartyPopper, Clock, Zap } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { SearchableSelect } from '@/components/transactions/SearchableSelect';
import InvoiceSelector, { InvoiceTag } from '@/components/transactions/InvoiceSelector';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Category, Responsible } from '@/types/transaction';

interface PendingTransaction {
  id: string;
  date: string;
  description: string;
  amount: number | null;
  category_id: string | null;
  category_name: string | null;
  responsible_id: string | null;
  invoice_id: string | null;
  notes: string | null;
  type: string | null;
  /** True si el admin asignó este pago a Cartera Operativa desde Modo Gerencial.
   *  El nombre del beneficiario operativo NO se expone aquí — para verlo hay
   *  que entrar a Modo Gerencial. */
  operative_receivable_assigned?: boolean | null;
}

interface PendingTransactionsTableProps {
  transactions: PendingTransaction[];
  categories: Category[];
  responsibles: Responsible[];
  periodLabel: string;
  onTransactionUpdated: () => void;
  onCategoryAdded?: () => void;
  onResponsibleAdded?: () => void;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

export function PendingTransactionsTable({
  transactions,
  categories,
  responsibles,
  periodLabel,
  onTransactionUpdated,
  onCategoryAdded,
  onResponsibleAdded,
}: PendingTransactionsTableProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  // IDs "pinned" — transacciones que el usuario tocó en esta sesión.
  // Se mantienen VISIBLES en la lista aunque ya no califiquen como
  // pendientes (porque acabás de asignarles beneficiario), para que el
  // usuario pueda terminar de configurar categoría/factura sin que la
  // fila desaparezca de golpe. El set se limpia al unmount (cuando
  // navegás fuera del Dashboard) y vuelve a cero. Bug reportado por Nico:
  // "asigno beneficiario y se va de la lista, pero falta factura/categoría".
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());

  // Filter pending: SIN responsible O pinned (que el user tocó en esta sesión).
  // Sort: pinned arriba (donde el usuario está trabajando), después por fecha
  // ascendente (más viejas primero, para conciliar el backlog en orden).
  // Bug que esto resuelve: cuando el user asignaba beneficiario, la fila se
  // movía hacia abajo en la lista y se perdía visualmente.
  const pendingTransactions = useMemo(() => {
    return transactions
      .filter(tx => !tx.responsible_id || pinnedIds.has(tx.id))
      .sort((a, b) => {
        const aPinned = pinnedIds.has(a.id);
        const bPinned = pinnedIds.has(b.id);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        return parseLocalDate(a.date).getTime() - parseLocalDate(b.date).getTime();
      });
  }, [transactions, pinnedIds]);

  // Helper: una transacción se considera "conciliada" cuando tiene
  // beneficiario, categoría y O bien una factura vinculada O el tag [N/A]
  // explícito (significa "no aplica factura", típico de gastos bancarios).
  function isConciliada(tx: Transaction): boolean {
    if (!tx.responsible_id) return false;
    if (!tx.category_id) return false;
    if (tx.invoice_id) return true;
    return (tx.notes ?? '').includes('[N/A]');
  }

  // Handle category change (does NOT mark as reconciled)
  const handleCategoryChange = async (transactionId: string, categoryId: string | null) => {
    setUpdatingId(transactionId);
    
    try {
      const { error } = await supabase
        .from('transactions')
        .update({ category_id: categoryId, category: null }) // Clear legacy category field
        .eq('id', transactionId);

      if (error) throw error;
      
      // Trigger refetch
      onTransactionUpdated();
    } catch (error) {
      console.error('Error updating category:', error);
      toast({
        title: 'Error',
        description: 'No se pudo actualizar la categoría',
        variant: 'destructive',
      });
    } finally {
      setUpdatingId(null);
    }
  };

  // Handle responsible change (marks as reconciled when set)
  const handleResponsibleChange = async (transactionId: string, responsibleId: string | null) => {
    if (!responsibleId) return;
    
    setUpdatingId(transactionId);
    
    try {
      // Check if responsible is "Banco" to auto-assign N/A tag
      const selectedResp = responsibles.find(r => r.id === responsibleId);
      const isBanco = selectedResp && selectedResp.name.toLowerCase() === 'banco';
      const tx = pendingTransactions.find(t => t.id === transactionId);
      
      const updateData: Record<string, any> = { responsible_id: responsibleId };
      
      if (isBanco && tx && !tx.invoice_id) {
        const currentNotes = tx.notes || '';
        if (!currentNotes.includes('[N/A]')) {
          updateData.notes = ('[N/A]' + (currentNotes ? ' ' + currentNotes : '')).trim();
        }
      }
      
      const { error } = await supabase
        .from('transactions')
        .update(updateData)
        .eq('id', transactionId);

      if (error) throw error;

      // Pin la transacción: se mantiene visible en la lista de pendientes
      // hasta que el usuario navegue fuera. Permite terminar de configurar
      // categoría/factura sin que la fila desaparezca al asignar beneficiario.
      setPinnedIds(prev => new Set([...prev, transactionId]));

      // Toast minimalista: el badge "Conciliada/Falta factura" en la columna
      // Estado ya comunica visualmente qué falta. No hace falta repetirlo.
      // Solo notificamos el caso especial de Banco (auto-N/A) que es el único
      // donde NO queda nada por hacer.
      if (isBanco) {
        toast({ title: 'Asignado a Banco' });
      }
      
      onTransactionUpdated();
    } catch (error) {
      console.error('Error updating responsible:', error);
      toast({
        title: 'Error',
        description: 'No se pudo asignar el beneficiario',
        variant: 'destructive',
      });
    } finally {
      setUpdatingId(null);
    }
  };

  // Handle adding new category
  const handleAddCategory = async (name: string): Promise<string | null> => {
    if (!user) return null;
    
    const { data, error } = await supabase
      .from('categories')
      .insert({ user_id: user.id, name, sort_order: categories.length })
      .select('id')
      .single();
    
    if (error) {
      console.error('Error adding category:', error);
      return null;
    }
    
    onCategoryAdded?.();
    return data.id;
  };

  // Handle adding new responsible
  const handleAddResponsible = async (name: string): Promise<string | null> => {
    if (!user) return null;
    
    const { data, error } = await supabase
      .from('responsibles')
      .insert({ user_id: user.id, name })
      .select('id')
      .single();
    
    if (error) {
      console.error('Error adding responsible:', error);
      return null;
    }
    
    onResponsibleAdded?.();
    return data.id;
  };

  // Prepare category options for the dropdown
  const categoryOptions = useMemo(() => 
    categories
      .filter(c => c.active)
      .map(c => ({ value: c.id, label: c.name })),
    [categories]
  );

  // Prepare responsible options for the dropdown
  const responsibleOptions = useMemo(() => 
    responsibles
      .filter(r => r.active)
      .map(r => ({ value: r.id, label: r.name })),
    [responsibles]
  );

  const pendingCount = pendingTransactions.length;
  const pendingTotal = useMemo(() => 
    pendingTransactions.reduce((sum, tx) => sum + Math.abs(tx.amount ?? 0), 0),
    [pendingTransactions]
  );

  // Parse tags from notes field
  const parseTagsFromNotes = (notes: string | null): InvoiceTag[] => {
    const tags: InvoiceTag[] = [];
    if (!notes) return tags;
    if (notes.includes('[N/A]')) tags.push('na');
    if (notes.includes('[IVA a favor - Pago DIAN]')) tags.push('iva_favor');
    if (notes.includes('[Retefuente - Sin factura]')) tags.push('retefuente');
    if (notes.includes('[Anticipo]')) tags.push('anticipo');
    return tags;
  };

  // Handle invoice/tag changes (and optional credit link)
  const handleInvoiceChange = async (
    transactionId: string,
    invoiceId: string | null,
    tags: InvoiceTag[],
    currentNotes: string | null,
    creditLink?: import('@/components/transactions/InvoiceSelector').CreditLinkInfo,
  ) => {
    setUpdatingId(transactionId);
    try {
      // Build notes with tags
      let cleanNotes = (currentNotes || '')
        .replace(/\[N\/A\]/g, '')
        .replace(/\[IVA a favor - Pago DIAN\]/g, '')
        .replace(/\[Retefuente - Sin factura\]/g, '')
        .replace(/\[Anticipo\]/g, '')
        .replace(/\[Crédito - [^\]]+\]/g, '')
        .trim();
      const tagMarkers: string[] = [];
      if (tags.includes('na')) tagMarkers.push('[N/A]');
      if (tags.includes('iva_favor')) tagMarkers.push('[IVA a favor - Pago DIAN]');
      if (tags.includes('retefuente')) tagMarkers.push('[Retefuente - Sin factura]');
      if (tags.includes('anticipo')) tagMarkers.push('[Anticipo]');
      if (creditLink) tagMarkers.push(`[Crédito - ${creditLink.creditName}]`);
      const newNotes = [...tagMarkers, cleanNotes].filter(Boolean).join(' ').trim() || null;

      // Pisamos categoría/responsable cuando hay creditLink
      const update: Record<string, unknown> = { invoice_id: invoiceId, notes: newNotes };
      if (creditLink) {
        if (creditLink.defaultCategoryId) update.category_id = creditLink.defaultCategoryId;
        if (creditLink.defaultResponsibleId) update.responsible_id = creditLink.defaultResponsibleId;
      }

      const { error } = await supabase
        .from('transactions')
        .update(update)
        .eq('id', transactionId);
      if (error) throw error;

      // Vincular pago a crédito
      if (creditLink) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { error: cpErr } = await (supabase.from('credit_payments' as never) as any)
            .insert({
              user_id: user.id,
              credit_id: creditLink.creditId,
              payment_date: creditLink.paymentDate,
              amount_paid: creditLink.amountPaid,
              principal_paid: creditLink.principalPaid,
              interest_paid: creditLink.interestPaid,
              is_extra: false,
              notes: 'Conciliado desde extracto',
              transaction_id: transactionId,
            });
          if (cpErr) console.error('Error inserting credit_payment:', cpErr);

          if (creditLink.newBalance <= 0.5) {
            await (supabase.from('credits' as never) as any)
              .update({ status: 'paid' })
              .eq('id', creditLink.creditId);
            toast({ title: `Crédito ${creditLink.creditName} saldado 🎉` });
          } else {
            toast({ title: `Pago vinculado a "${creditLink.creditName}"` });
          }
        }
      }

      onTransactionUpdated();
    } catch (error) {
      console.error('Error updating invoice:', error);
      toast({ title: 'Error', description: 'No se pudo actualizar la factura', variant: 'destructive' });
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Total Pendientes ({pendingCount})
          </CardTitle>
          {pendingCount > 0 && (
            <p className="text-sm text-muted-foreground mt-1">
              Monto total: <span className="font-semibold text-foreground">{formatCurrency(pendingTotal)}</span>
            </p>
          )}
        </div>
        <Link to="/transactions">
          <Button variant="outline" size="sm">
            Ver Todas <ExternalLink className="h-4 w-4 ml-2" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        {pendingCount === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <PartyPopper className="h-12 w-12 text-success mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">
              ¡No tienes pendientes por conciliar! 🎉
            </h3>
            <p className="text-muted-foreground text-sm max-w-md">
              Todas tus transacciones tienen un beneficiario asignado. ¡Excelente trabajo!
            </p>
          </div>
        ) : (
          <>
          {/* Mobile: cards apilables (< md) */}
          <div className="md:hidden space-y-3">
            {pendingTransactions.map(tx => {
              const conciliada = isConciliada(tx);
              const tieneRespSinResto = !!tx.responsible_id && !conciliada;
              const cardBg = conciliada
                ? 'bg-success/5 border-success/30'
                : tieneRespSinResto
                  ? 'bg-warning/5 border-warning/30'
                  : 'bg-card border-border';
              return (
                <div
                  key={tx.id}
                  className={`rounded-xl border p-3 ${cardBg} transition-colors`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {parseLocalDate(tx.date).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                        </span>
                        {conciliada ? (
                          <Badge variant="outline" className="bg-success/10 text-success border-success/30 text-[10px] px-2 py-0 h-5">Conciliada</Badge>
                        ) : tieneRespSinResto ? (
                          <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 text-[10px] px-2 py-0 h-5">
                            Falta {!tx.category_id ? 'categoría' : 'factura'}
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-[10px] px-2 py-0 h-5">Pendiente</Badge>
                        )}
                        {tx.operative_receivable_assigned && (
                          <TooltipProvider delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1.5 py-0 h-5 border-[oklch(0.43_0.14_155_/_0.4)] text-[oklch(0.43_0.14_155)] bg-[oklch(0.43_0.14_155_/_0.08)] flex items-center gap-1 cursor-help"
                                >
                                  <Zap className="h-2.5 w-2.5" />
                                  Cazado en operativa
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                Este pago fue asignado a un cliente en Modo Gerencial. Cambiá a Modo Gerencial para ver de quién es.
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                      <p className="text-sm text-foreground line-clamp-2" title={tx.description}>
                        {tx.description}
                      </p>
                    </div>
                    <div className={`text-sm font-semibold whitespace-nowrap ${(tx.amount ?? 0) >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {formatCurrency(tx.amount ?? 0)}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 mt-2">
                    <SearchableSelect
                      options={responsibleOptions}
                      value={tx.responsible_id}
                      onChange={(value) => handleResponsibleChange(tx.id, value)}
                      placeholder="👤 Asignar beneficiario"
                      emptyLabel="Sin asignar"
                      addLabel="+ Agregar beneficiario"
                      onAdd={handleAddResponsible}
                      triggerClassName="w-full h-10 text-sm"
                      disabled={updatingId === tx.id}
                      allowEmpty={false}
                    />
                    <SearchableSelect
                      options={categoryOptions}
                      value={tx.category_id}
                      onChange={(value) => handleCategoryChange(tx.id, value)}
                      placeholder="🏷️ Categoría"
                      emptyLabel="Sin categoría"
                      addLabel="+ Agregar categoría"
                      onAdd={handleAddCategory}
                      triggerClassName="w-full h-10 text-sm"
                      disabled={updatingId === tx.id}
                    />
                    <InvoiceSelector
                      invoiceId={tx.invoice_id}
                      tags={parseTagsFromNotes(tx.notes)}
                      transactionType={tx.type || 'egreso'}
                      transactionAmount={tx.amount}
                      transactionDate={tx.date}
                      transactionId={tx.id}
                      onChange={(invId, tags, _autoMatches, creditLink) => handleInvoiceChange(tx.id, invId, tags, tx.notes, creditLink)}
                      className="w-full"
                    />
                  </div>
                </div>
              );
            })}
            <div className="text-center pt-2 text-muted-foreground text-xs">
              {periodLabel} •{' '}
              <Link to="/transactions" className="text-primary hover:underline">Ir a conciliar →</Link>
            </div>
          </div>

          {/* Desktop: tabla original (≥ md) */}
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Fecha</TableHead>
                  <TableHead className="min-w-[250px]">Descripción</TableHead>
                  <TableHead className="text-right w-32">Monto</TableHead>
                  <TableHead className="w-40">Categoría</TableHead>
                  <TableHead className="w-40">Beneficiario</TableHead>
                  <TableHead className="w-40">#Factura</TableHead>
                  <TableHead className="text-center w-24">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingTransactions.map(tx => {
                  const conciliada = isConciliada(tx);
                  const tieneRespSinResto = !!tx.responsible_id && !conciliada;
                  return (
                  <TableRow
                    key={tx.id}
                    className={
                      conciliada
                        ? 'bg-success/5 border-success/20'
                        : tieneRespSinResto
                          ? 'bg-warning/5'
                          : ''
                    }
                  >
                    <TableCell className="font-mono text-sm">
                      {parseLocalDate(tx.date).toLocaleDateString('es-CO', {
                        day: '2-digit',
                        month: 'short'
                      })}
                    </TableCell>
                    <TableCell className="max-w-[300px]">
                      <span className="block truncate" title={tx.description}>
                        {tx.description}
                      </span>
                    </TableCell>
                    <TableCell className={`text-right font-medium ${(tx.amount ?? 0) >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {formatCurrency(tx.amount ?? 0)}
                    </TableCell>
                    <TableCell>
                      <SearchableSelect
                        options={categoryOptions}
                        value={tx.category_id}
                        onChange={(value) => handleCategoryChange(tx.id, value)}
                        placeholder="Sin categoría"
                        emptyLabel="Sin categoría"
                        addLabel="+ Agregar categoría"
                        onAdd={handleAddCategory}
                        triggerClassName="w-full h-7 text-xs"
                        disabled={updatingId === tx.id}
                      />
                    </TableCell>
                    <TableCell>
                      <SearchableSelect
                        options={responsibleOptions}
                        value={tx.responsible_id}
                        onChange={(value) => handleResponsibleChange(tx.id, value)}
                        placeholder="Sin asignar"
                        emptyLabel="Sin asignar"
                        addLabel="+ Agregar beneficiario"
                        onAdd={handleAddResponsible}
                        triggerClassName="w-full h-7 text-xs"
                        disabled={updatingId === tx.id}
                        allowEmpty={false}
                      />
                    </TableCell>
                    <TableCell>
                      <InvoiceSelector
                        invoiceId={tx.invoice_id}
                        tags={parseTagsFromNotes(tx.notes)}
                        transactionType={tx.type || 'egreso'}
                        transactionAmount={tx.amount}
                        transactionDate={tx.date}
                        transactionId={tx.id}
                        onChange={(invId, tags, _autoMatches, creditLink) => handleInvoiceChange(tx.id, invId, tags, tx.notes, creditLink)}
                        className="min-w-[120px]"
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex flex-col items-center gap-1">
                        {conciliada ? (
                          <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                            Conciliada
                          </Badge>
                        ) : tieneRespSinResto ? (
                          <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
                            Falta {!tx.category_id ? 'categoría' : 'factura'}
                          </Badge>
                        ) : (
                          <Badge variant="destructive">
                            Pendiente
                          </Badge>
                        )}
                        {tx.operative_receivable_assigned && (
                          <TooltipProvider delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className="text-[10px] px-1.5 py-0 h-5 border-[oklch(0.43_0.14_155_/_0.4)] text-[oklch(0.43_0.14_155)] bg-[oklch(0.43_0.14_155_/_0.08)] flex items-center gap-1 cursor-help"
                                >
                                  <Zap className="h-2.5 w-2.5" />
                                  Cazado en operativa
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                Este pago fue asignado a un cliente en Modo Gerencial. Cambiá a Modo Gerencial para ver de quién es.
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="text-center py-4 text-muted-foreground text-sm">
              {periodLabel} •{' '}
              <Link to="/transactions" className="text-primary hover:underline">
                Ir a conciliar →
              </Link>
            </div>
          </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
