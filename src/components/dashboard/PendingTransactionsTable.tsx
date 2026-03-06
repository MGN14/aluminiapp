import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, PartyPopper, Clock } from 'lucide-react';
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
  // Track removed transaction IDs for optimistic removal
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  // Filter only pending transactions (no responsible assigned)
  // Also exclude optimistically removed transactions
  const pendingTransactions = useMemo(() => {
    return transactions
      .filter(tx => !tx.responsible_id && !removedIds.has(tx.id))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); // ASC by date (oldest first)
  }, [transactions, removedIds]);

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
    if (!responsibleId) return; // Only process when setting a responsible
    
    setUpdatingId(transactionId);
    
    try {
      const { error } = await supabase
        .from('transactions')
        .update({ responsible_id: responsibleId })
        .eq('id', transactionId);

      if (error) throw error;
      
      // Optimistic removal - remove from local view immediately
      setRemovedIds(prev => new Set([...prev, transactionId]));
      
      // Show success toast
      toast({
        title: 'Conciliado ✅',
        description: 'Transacción asignada correctamente',
      });
      
      // Trigger refetch to update metrics
      onTransactionUpdated();
    } catch (error) {
      console.error('Error updating responsible:', error);
      toast({
        title: 'Error',
        description: 'No se pudo asignar el responsable',
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

  // Handle invoice/tag changes
  const handleInvoiceChange = async (transactionId: string, invoiceId: string | null, tags: InvoiceTag[], currentNotes: string | null) => {
    setUpdatingId(transactionId);
    try {
      // Build notes with tags
      let cleanNotes = (currentNotes || '')
        .replace(/\[N\/A\]/g, '')
        .replace(/\[IVA a favor - Pago DIAN\]/g, '')
        .replace(/\[Retefuente - Sin factura\]/g, '')
        .replace(/\[Anticipo\]/g, '')
        .trim();
      const tagMarkers: string[] = [];
      if (tags.includes('na')) tagMarkers.push('[N/A]');
      if (tags.includes('iva_favor')) tagMarkers.push('[IVA a favor - Pago DIAN]');
      if (tags.includes('retefuente')) tagMarkers.push('[Retefuente - Sin factura]');
      if (tags.includes('anticipo')) tagMarkers.push('[Anticipo]');
      const newNotes = [...tagMarkers, cleanNotes].filter(Boolean).join(' ').trim() || null;

      const { error } = await supabase
        .from('transactions')
        .update({ invoice_id: invoiceId, notes: newNotes })
        .eq('id', transactionId);

      if (error) throw error;
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
              Todas tus transacciones tienen un responsable asignado. ¡Excelente trabajo!
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Fecha</TableHead>
                  <TableHead className="min-w-[250px]">Descripción</TableHead>
                  <TableHead className="text-right w-32">Monto</TableHead>
                  <TableHead className="w-40">Categoría</TableHead>
                  <TableHead className="w-40">Responsable</TableHead>
                  <TableHead className="w-40">#Factura</TableHead>
                  <TableHead className="text-center w-24">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingTransactions.map(tx => (
                  <TableRow key={tx.id}>
                    <TableCell className="font-mono text-sm">
                      {new Date(tx.date).toLocaleDateString('es-CO', {
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
                        addLabel="+ Agregar responsable"
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
                        transactionId={tx.id}
                        onChange={(invId, tags) => handleInvoiceChange(tx.id, invId, tags, tx.notes)}
                        className="min-w-[120px]"
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="destructive">
                        Pendiente
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="text-center py-4 text-muted-foreground text-sm">
              {periodLabel} •{' '}
              <Link to="/transactions" className="text-primary hover:underline">
                Ir a conciliar →
              </Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
