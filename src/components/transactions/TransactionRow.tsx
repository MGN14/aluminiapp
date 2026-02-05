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
  reteicaRate?: number;
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
  reteicaRate = 0,
  onViewDetail,
  onCategoryAdded,
  onResponsibleAdded,
}: TransactionRowProps) {
  const { user } = useAuth();
  
  const { status, errorMessage, updateField, localTransaction } = useTransactionEdit(transaction, {
    debounceMs: 600,
    reteicaRate,
  });

  // Helper to check if a category is "Ventas" by name
  const isSalesCategory = (categoryId: string | null): boolean => {
    if (!categoryId) return false;
    const category = categories.find(c => c.id === categoryId);
    return category?.name?.toLowerCase() === 'ventas';
  };

  const handleCategoryChange = (categoryId: string | null) => {
    const updates: Partial<Transaction> = { category_id: categoryId, category: null };
    
    // Auto-enable taxes for "Ventas" category
    if (isSalesCategory(categoryId)) {
      updates.has_iva = true;
      // Only enable ReteICA if rate is configured and transaction is income
      if (reteicaRate > 0 && localTransaction.type === 'ingreso') {
        updates.has_reteica = true;
      }
    } else {
      // When leaving "Ventas" category, disable IVA and ReteICA
      if (isSalesCategory(localTransaction.category_id)) {
        updates.has_iva = false;
        updates.has_reteica = false;
      }
    }
    
    updateField(updates);
  };

  const handleTypeChange = (type: SimpleTransactionType) => {
    const updates: Partial<Transaction> = { type };
    
    // Auto-disable ReteICA when changing from income to other types
    if (type !== 'ingreso' && localTransaction.has_reteica) {
      updates.has_reteica = false;
    }
    
    // Auto-disable retefuente for non-expenses
    if (type !== 'egreso' && localTransaction.has_retefuente) {
      updates.has_retefuente = false;
    }
    
    // Auto-disable IVA for transfers
    if (type === 'transferencia') {
      updates.has_iva = false;
    }
    
    // If changing to income and category is "Ventas", enable taxes
    if (type === 'ingreso' && isSalesCategory(localTransaction.category_id)) {
      updates.has_iva = true;
      if (reteicaRate > 0) {
        updates.has_reteica = true;
      }
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

  const handleReteicaChange = (checked: boolean) => {
    // ReteICA only for income
    if (localTransaction.type !== 'ingreso' && checked) {
      return;
    }
    updateField({ has_reteica: checked });
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
  const isIngreso = localTransaction.type === 'ingreso';
  const isTransferencia = localTransaction.type === 'transferencia';
  const isSaving = status === 'saving';
  const hasReteicaConfigured = reteicaRate > 0;

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
          onChange={handleCategoryChange}
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
      
      {/* ReteICA Checkbox - only for income */}
      <TableCell className="text-center w-[45px]">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Checkbox
                checked={localTransaction.has_reteica}
                onCheckedChange={(checked) => handleReteicaChange(checked as boolean)}
                disabled={!isIngreso || !hasReteicaConfigured}
                className={(!isIngreso || !hasReteicaConfigured) ? 'opacity-30 cursor-not-allowed' : ''}
              />
            </span>
          </TooltipTrigger>
          {!isIngreso && (
            <TooltipContent>
              <p className="text-xs">ReteICA solo aplica a ingresos</p>
            </TooltipContent>
          )}
          {isIngreso && !hasReteicaConfigured && (
            <TooltipContent>
              <p className="text-xs">Configura la tasa de ReteICA en Ajustes</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TableCell>
      
      {/* ReteICA Amount */}
      <TableCell className="text-right text-sm w-[90px] text-muted-foreground">
        {localTransaction.has_reteica && localTransaction.reteica_amount > 0 
          ? formatCurrency(localTransaction.reteica_amount) 
          : '-'}
      </TableCell>
    </TableRow>
  );
}
