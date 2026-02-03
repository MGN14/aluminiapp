import { Transaction, Category, Responsible, SimpleTransactionType, SIMPLE_TYPES } from '@/types/transaction';
import { TableCell, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
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
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface TransactionRowProps {
  transaction: Transaction;
  categories: Category[];
  responsibles: Responsible[];
  onViewDetail: (transaction: Transaction) => void;
  onCategoryAdded?: () => void;
  onResponsibleAdded?: () => void;
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
}: TransactionRowProps) {
  const { user } = useAuth();
  
  const { status, errorMessage, updateField, localTransaction } = useTransactionEdit(transaction, {
    debounceMs: 600,
  });

  const handleTypeChange = (type: SimpleTransactionType) => {
    const updates: Partial<Transaction> = { type };
    
    // Auto-disable retefuente for non-expenses
    if (type !== 'egreso' && localTransaction.has_retefuente) {
      updates.has_retefuente = false;
    }
    
    // Auto-disable IVA for transfers
    if (type === 'transferencia' && localTransaction.has_iva) {
      updates.has_iva = false;
    }
    
    updateField(updates);
  };

  const handleIvaChange = (checked: boolean) => {
    updateField({ has_iva: checked });
  };

  const handleRetefuenteChange = (checked: boolean) => {
    // Retefuente only for expenses
    if (localTransaction.type !== 'egreso' && checked) {
      return;
    }
    updateField({ has_retefuente: checked });
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
  const isEgreso = localTransaction.type === 'egreso';
  const isTransferencia = localTransaction.type === 'transferencia';
  const isSaving = status === 'saving';

  // Prepare options for searchable selects
  const categoryOptions = categories
    .filter(c => c.active)
    .map(c => ({ value: c.id, label: c.name }));
  
  const responsibleOptions = responsibles
    .filter(r => r.active)
    .map(r => ({ value: r.id, label: r.name }));

  const typeConfig = SIMPLE_TYPES.find(t => t.value === localTransaction.type);

  return (
    <TableRow className={`hover:bg-muted/30 transition-colors ${!isReconciled ? 'bg-warning/5' : ''}`}>
      <TableCell className="font-medium text-sm w-[80px]">
        {format(new Date(localTransaction.date), 'dd MMM', { locale: es })}
      </TableCell>
      
      {/* Wider description column */}
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
      
      {/* Simplified Type Selector - only 3 options */}
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
      
      {/* Category with searchable dropdown */}
      <TableCell className="w-[140px]">
        <SearchableSelect
          options={categoryOptions}
          value={localTransaction.category_id}
          onChange={(value) => updateField({ category_id: value, category: null })}
          placeholder="Categoría"
          emptyLabel="Sin categoría"
          addLabel="+ Agregar categoría"
          onAdd={handleAddCategory}
          triggerClassName="w-full"
        />
      </TableCell>
      
      {/* Responsible with searchable dropdown - shows reconciliation status */}
      <TableCell className="w-[140px]">
        <SearchableSelect
          options={responsibleOptions}
          value={localTransaction.responsible_id}
          onChange={(value) => updateField({ responsible_id: value })}
          placeholder="Pendiente"
          emptyLabel="Pendiente"
          addLabel="+ Agregar responsable"
          onAdd={handleAddResponsible}
          triggerClassName={`w-full ${!localTransaction.responsible_id ? 'border-warning/50 text-warning' : ''}`}
        />
      </TableCell>
      
      {/* IVA Checkbox - disabled for transfers */}
      <TableCell className="text-center w-[45px]">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Checkbox
                checked={localTransaction.has_iva}
                onCheckedChange={(checked) => handleIvaChange(checked as boolean)}
                disabled={isTransferencia}
                className={isTransferencia ? 'opacity-30 cursor-not-allowed' : ''}
              />
            </span>
          </TooltipTrigger>
          {isTransferencia && (
            <TooltipContent>
              <p className="text-xs">IVA no aplica a transferencias</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TableCell>
      
      {/* IVA Amount */}
      <TableCell className="text-right text-sm w-[90px] text-muted-foreground">
        {localTransaction.has_iva && localTransaction.iva_amount > 0 
          ? formatCurrency(localTransaction.iva_amount) 
          : '-'}
      </TableCell>
      
      {/* Retefuente Checkbox - only for expenses */}
      <TableCell className="text-center w-[45px]">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Checkbox
                checked={localTransaction.has_retefuente}
                onCheckedChange={(checked) => handleRetefuenteChange(checked as boolean)}
                disabled={!isEgreso}
                className={!isEgreso ? 'opacity-30 cursor-not-allowed' : ''}
              />
            </span>
          </TooltipTrigger>
          {!isEgreso && (
            <TooltipContent>
              <p className="text-xs">Retefuente solo aplica a egresos</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TableCell>
      
      {/* Retefuente Amount */}
      <TableCell className="text-right text-sm w-[90px] text-muted-foreground">
        {localTransaction.has_retefuente && localTransaction.retefuente_amount > 0 
          ? formatCurrency(localTransaction.retefuente_amount) 
          : '-'}
      </TableCell>
    </TableRow>
  );
}
