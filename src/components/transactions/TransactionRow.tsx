import { useEffect, useRef, useMemo } from 'react';
import { Transaction, Category, Responsible, SimpleTransactionType, SIMPLE_TYPES, MOVEMENT_NATURES } from '@/types/transaction';
import { parseLocalDate } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';
import { TableCell, TableRow } from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTransactionEdit } from '@/hooks/useTransactionEdit';
import SaveStatusIndicator from './SaveStatusIndicator';
import { SearchableSelect } from './SearchableSelect';
import InvoiceSelector, { InvoiceTag } from './InvoiceSelector';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface TransactionRowProps {
  transaction: Transaction;
  categories: Category[];
  responsibles: Responsible[];
  onViewDetail: (transaction: Transaction) => void;
  onCategoryAdded?: () => void;
  onResponsibleAdded?: () => void;
  onTransactionUpdated?: (transaction: Transaction) => void;
}

function formatCurrency(value: number | null) {
  if (value === null || value === undefined || value === 0) return '—';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function TransactionRow({ 
  transaction, 
  categories, 
  responsibles, 
  onViewDetail,
  onCategoryAdded,
  onResponsibleAdded,
  onTransactionUpdated,
}: TransactionRowProps) {
  const { user } = useAuth();
  
  const { status, errorMessage, updateField, localTransaction } = useTransactionEdit(transaction, {
    debounceMs: 600,
  });

  // Notify parent of optimistic updates so filters (e.g. pending) react instantly
  const prevResponsibleRef = useRef(transaction.responsible_id);
  const prevCategoryRef = useRef(transaction.category_id);
  const prevTypeRef = useRef(transaction.type);

  useEffect(() => {
    const changed =
      localTransaction.responsible_id !== prevResponsibleRef.current ||
      localTransaction.category_id !== prevCategoryRef.current ||
      localTransaction.type !== prevTypeRef.current;

    if (changed) {
      prevResponsibleRef.current = localTransaction.responsible_id;
      prevCategoryRef.current = localTransaction.category_id;
      prevTypeRef.current = localTransaction.type;
      onTransactionUpdated?.(localTransaction);
    }
  }, [localTransaction.responsible_id, localTransaction.category_id, localTransaction.type, onTransactionUpdated, localTransaction]);

  const handleCategoryChange = (categoryId: string | null) => {
    updateField({ category_id: categoryId, category: null });
  };

  const handleTypeChange = (type: SimpleTransactionType) => {
    updateField({ type });
  };

  const handleNatureChange = (nature: string) => {
    updateField({ movement_nature: nature as Transaction['movement_nature'] });
  };

  const handleInvoiceChange = async (
    newInvoiceId: string | null,
    newTags: InvoiceTag[],
    autoMatches?: import('./InvoiceSelector').AutoMatchResult[],
    creditLink?: import('./InvoiceSelector').CreditLinkInfo,
  ) => {
    // Build notes from tags
    const tagMarkers: Record<InvoiceTag, string> = {
      na: '[N/A - Sin factura]',
      iva_favor: '[IVA a favor - Pago DIAN]',
      retefuente: '[Retefuente - Sin factura]',
      anticipo: '[Anticipo]',
    };

    // Clean existing markers from notes
    let cleanNotes = (localTransaction.notes || '')
      .replace(/\[N\/A - Sin factura\]/g, '')
      .replace(/\[IVA a favor - Pago DIAN\]/g, '')
      .replace(/\[Retefuente - Sin factura\]/g, '')
      .replace(/\[Anticipo\]/g, '')
      .replace(/\[Crédito - [^\]]+\]/g, '')
      .trim();

    // Add new markers
    const markers = newTags.map(t => tagMarkers[t]).join('');
    const creditMarker = creditLink ? `[Crédito - ${creditLink.creditName}]` : '';
    const finalNotes = [markers, creditMarker, cleanNotes].filter(Boolean).join('') || null;

    // Si vino un creditLink, también pisamos categoría/responsable con los defaults del crédito
    const fieldUpdate: Record<string, unknown> = {
      invoice_id: newInvoiceId,
      notes: finalNotes,
      has_retefuente: newTags.includes('retefuente'),
    };
    if (creditLink) {
      if (creditLink.defaultCategoryId) fieldUpdate.category_id = creditLink.defaultCategoryId;
      if (creditLink.defaultResponsibleId) fieldUpdate.responsible_id = creditLink.defaultResponsibleId;
    }
    updateField(fieldUpdate);

    // Create auto-match records for excess distribution
    if (autoMatches?.length && user) {
      for (const match of autoMatches) {
        await supabase
          .from('invoice_transaction_matches')
          .insert({
            invoice_id: match.invoiceId,
            transaction_id: localTransaction.id,
            user_id: user.id,
            matched_amount: match.matchedAmount,
            match_type: 'manual',
          });
      }
    }

    // Vincular pago a crédito: insert credit_payment + actualizar status si saldó
    if (creditLink && user) {
      try {
        const { error: cpErr } = await (supabase.from('credit_payments' as never) as any)
          .insert({
            user_id: user.id,
            credit_id: creditLink.creditId,
            payment_date: creditLink.paymentDate,
            amount_paid: creditLink.amountPaid,
            principal_paid: creditLink.principalPaid,
            interest_paid: creditLink.interestPaid,
            is_extra: false,
            notes: `Conciliado desde extracto`,
            transaction_id: localTransaction.id,
          });
        if (cpErr) throw cpErr;

        if (creditLink.newBalance <= 0.5) {
          await (supabase.from('credits' as never) as any)
            .update({ status: 'paid' })
            .eq('id', creditLink.creditId);
        }
      } catch (err) {
        console.error('Error linking credit:', err);
      }
    }
  };

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

  const amountColor = (localTransaction.amount ?? 0) >= 0 ? 'text-success' : 'text-destructive';
  const isReconciled = !!localTransaction.responsible_id;

  // Prepare options for searchable selects
  const categoryOptions = categories
    .filter(c => c.active)
    .map(c => ({ value: c.id, label: c.name }));
  
  const responsibleOptions = responsibles
    .filter(r => r.active)
    .map(r => ({ value: r.id, label: r.name }));

  // Derive invoiceId and tags from transaction data
  const derivedInvoiceId = localTransaction.invoice_id || null;
  const derivedTags = useMemo((): InvoiceTag[] => {
    const t: InvoiceTag[] = [];
    const notes = localTransaction.notes || '';
    if (notes.includes('[N/A - Sin factura]')) t.push('na');
    if (notes.includes('[IVA a favor - Pago DIAN]')) t.push('iva_favor');
    if (notes.includes('[Retefuente - Sin factura]') || localTransaction.has_retefuente) t.push('retefuente');
    if (notes.includes('[Anticipo]')) t.push('anticipo');
    return t;
  }, [localTransaction.notes, localTransaction.has_retefuente]);

  return (
    <TableRow
      className={cn(
        'hover:bg-muted/30 transition-colors',
        !isReconciled && 'bg-warning/5 border-l-2 border-l-warning'
      )}
      style={!isReconciled ? {
        borderLeft: '3px solid oklch(0.65 0.15 65)',
        background: 'oklch(0.65 0.15 65 / 0.03)',
      } : {}}
    >
      <TableCell className="font-medium text-sm w-[72px] relative">
        {format(parseLocalDate(localTransaction.date), 'dd MMM', { locale: es })}
        {/* Feedback del guardado optimista: si falla (red, RLS), el usuario
            se entera acá en vez de creer que quedó conciliado. Overlay
            absoluto para no cambiar la altura de la fila al aparecer. */}
        <div className="absolute left-2 bottom-0.5 pointer-events-auto">
          <SaveStatusIndicator status={status} errorMessage={errorMessage} />
        </div>
      </TableCell>

      <TableCell>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm truncate flex-1 cursor-help">
                {localTransaction.description}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 shrink-0"
                onClick={() => onViewDetail(localTransaction)}
              >
                <Eye className="h-3 w-3" />
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[500px]">
            <p className="text-sm whitespace-pre-wrap">{localTransaction.description}</p>
          </TooltipContent>
        </Tooltip>
      </TableCell>

      <TableCell className={`text-right font-bold text-sm w-[100px] ${amountColor}`}>
        {formatCurrency(localTransaction.amount)}
      </TableCell>

      {/* Simplified Type Selector */}
      <TableCell className="w-[80px]">
        <Select
          value={localTransaction.type || 'egreso'}
          onValueChange={(value) => handleTypeChange(value as SimpleTransactionType)}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SIMPLE_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                <span className={type.color}>{type.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>

      {/* Category */}
      <TableCell className="w-[170px]">
        <SearchableSelect
          options={categoryOptions}
          value={localTransaction.category_id}
          onChange={handleCategoryChange}
          placeholder="Categoría"
          emptyLabel="Sin categoría"
          addLabel="+ Agregar categoría"
          onAdd={handleAddCategory}
          triggerClassName="w-full"
        />
      </TableCell>

      {/* Responsible */}
      <TableCell className="w-[170px]">
        <div className="flex items-center gap-1">
          <SearchableSelect
            options={responsibleOptions}
            value={localTransaction.responsible_id}
            onChange={(value) => {
              updateField({ responsible_id: value });
              // Auto-assign N/A tag when responsible is "Banco"
              const selectedResp = responsibles.find(r => r.id === value);
              if (selectedResp && selectedResp.name.toLowerCase() === 'banco' && !derivedTags.includes('na') && !derivedInvoiceId) {
                handleInvoiceChange(null, [...derivedTags, 'na']);
              }
            }}
            placeholder="Pendiente"
            emptyLabel="Pendiente"
            addLabel="+ Agregar beneficiario"
            onAdd={handleAddResponsible}
            triggerClassName={cn('w-full', !localTransaction.responsible_id && 'border-warning/50 text-warning')}
          />
          {!localTransaction.responsible_id && (
            <span className="shrink-0 text-[10px] text-warning font-medium">⚠</span>
          )}
        </div>
      </TableCell>
      
      {/* #Factura - Invoice Selector */}
      <TableCell className="w-[140px]">
        <InvoiceSelector
          invoiceId={derivedInvoiceId}
          tags={derivedTags}
          transactionType={localTransaction.type || 'egreso'}
          transactionAmount={localTransaction.amount}
          transactionDate={localTransaction.date}
          transactionId={localTransaction.id}
          responsibleId={localTransaction.responsible_id}
          responsibleName={responsibles.find(r => r.id === localTransaction.responsible_id)?.name ?? null}
          onChange={handleInvoiceChange}
        />
      </TableCell>

      {/* Naturaleza del movimiento — operativo vs traspaso/devolución/préstamo/aporte */}
      <TableCell className="w-[120px]">
        <Select
          value={localTransaction.movement_nature ?? 'operativo'}
          onValueChange={handleNatureChange}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MOVEMENT_NATURES.map((n) => (
              <SelectItem key={n.value} value={n.value}>
                <span className="text-xs">{n.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
    </TableRow>
  );
}
