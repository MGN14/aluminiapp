import { useEffect, useRef } from 'react';
import { Transaction, Category, Responsible, SimpleTransactionType, SIMPLE_TYPES } from '@/types/transaction';
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
import { SearchableSelect } from './SearchableSelect';
import InvoiceSelector from './InvoiceSelector';
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
  if (value === null || value === undefined) return '-';
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

  const handleInvoiceChange = (invoiceId: string | null) => {
    // Store 'N/A' as null with a notes marker, or store the actual invoice_id
    if (invoiceId === 'N/A') {
      updateField({ notes: '[N/A - Sin factura]' } as any);
    } else {
      updateField({ notes: invoiceId ? null : localTransaction.notes } as any);
    }
    // We need to update invoice_id directly
    if (invoiceId && invoiceId !== 'N/A') {
      supabase
        .from('transactions')
        .update({ invoice_id: invoiceId })
        .eq('id', localTransaction.id)
        .then(() => {
          onTransactionUpdated?.({ ...localTransaction, invoice_id: invoiceId } as any);
        });
    } else {
      supabase
        .from('transactions')
        .update({ invoice_id: null })
        .eq('id', localTransaction.id)
        .then(() => {
          onTransactionUpdated?.({ ...localTransaction, invoice_id: null } as any);
        });
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

  // Determine invoice display value
  const invoiceValue = (localTransaction as any).invoice_id || 
    (localTransaction.notes === '[N/A - Sin factura]' ? 'N/A' : null);

  return (
    <TableRow className={cn(
      'hover:bg-muted/30 transition-colors',
      !isReconciled && 'bg-warning/5 border-l-2 border-l-warning'
    )}>
      <TableCell className="font-medium text-sm w-[80px]">
        {format(new Date(localTransaction.date), 'dd MMM', { locale: es })}
      </TableCell>
      
      <TableCell className="min-w-[300px] max-w-[450px]">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2">
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
      
      <TableCell className={`text-right font-bold text-sm w-[110px] ${amountColor}`}>
        {formatCurrency(localTransaction.amount)}
      </TableCell>
      
      {/* Simplified Type Selector */}
      <TableCell className="w-[110px]">
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
      <TableCell className="w-[140px]">
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
      <TableCell className="w-[140px]">
        <div className="flex items-center gap-1">
          <SearchableSelect
            options={responsibleOptions}
            value={localTransaction.responsible_id}
            onChange={(value) => updateField({ responsible_id: value })}
            placeholder="Pendiente"
            emptyLabel="Pendiente"
            addLabel="+ Agregar responsable"
            onAdd={handleAddResponsible}
            triggerClassName={cn('w-full', !localTransaction.responsible_id && 'border-warning/50 text-warning')}
          />
          {!localTransaction.responsible_id && (
            <span className="shrink-0 text-[10px] text-warning font-medium">⚠</span>
          )}
        </div>
      </TableCell>
      
      {/* #Factura - Invoice Selector */}
      <TableCell className="w-[160px]">
        <InvoiceSelector
          value={invoiceValue}
          transactionType={localTransaction.type || 'egreso'}
          onChange={handleInvoiceChange}
        />
      </TableCell>
    </TableRow>
  );
}
