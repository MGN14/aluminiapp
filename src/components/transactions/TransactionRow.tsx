import { Transaction, Category, Responsible, TransactionType, OperationalType } from '@/types/transaction';
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
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useViewMode } from '@/contexts/ViewModeContext';
import { OPERATIONAL_TYPES, getDefaultOperationalType } from '@/lib/operationalTypes';
import { useTransactionEdit } from '@/hooks/useTransactionEdit';
import SaveStatusIndicator from './SaveStatusIndicator';

interface TransactionRowProps {
  transaction: Transaction;
  categories: Category[];
  responsibles: Responsible[];
  onViewDetail: (transaction: Transaction) => void;
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
  onViewDetail 
}: TransactionRowProps) {
  const { isAdvancedMode } = useViewMode();
  
  const { status, errorMessage, updateField, localTransaction } = useTransactionEdit(transaction, {
    debounceMs: 600,
  });

  const handleTransactionTypeChange = (type: TransactionType) => {
    const updates: Partial<Transaction> = { 
      transaction_type: type,
      operational_type: getDefaultOperationalType(type) as OperationalType,
    };
    
    if (type === 'venta' && localTransaction.has_retefuente) {
      updates.has_retefuente = false;
    }
    
    updateField(updates);
  };

  const handleOperationalTypeChange = (opType: OperationalType) => {
    updateField({ operational_type: opType });
  };

  const handleIvaChange = (checked: boolean) => {
    updateField({ has_iva: checked });
  };

  const handleRetefuenteChange = (checked: boolean) => {
    if (localTransaction.transaction_type === 'venta' && checked) {
      return;
    }
    updateField({ has_retefuente: checked });
  };

  const amountColor = (localTransaction.amount ?? 0) >= 0 ? 'text-success' : 'text-destructive';
  const isReconciled = !!localTransaction.responsible_id;
  const isVenta = localTransaction.transaction_type === 'venta';
  const isSaving = status === 'saving';

  return (
    <TableRow className={`hover:bg-muted/30 transition-colors ${isSaving ? 'bg-muted/20' : ''} ${!isReconciled ? 'bg-destructive/5' : ''}`}>
      <TableCell className="font-medium text-sm w-[80px]">
        {format(new Date(localTransaction.date), 'dd MMM', { locale: es })}
      </TableCell>
      
      <TableCell className="min-w-[200px] max-w-[350px]">
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
          <TooltipContent side="top" className="max-w-[400px]">
            <p className="text-sm">{localTransaction.description}</p>
          </TooltipContent>
        </Tooltip>
      </TableCell>
      
      <TableCell className={`text-right font-medium text-sm w-[100px] ${amountColor}`}>
        {formatCurrency(localTransaction.amount)}
      </TableCell>
      
      {/* Operational Type Selector */}
      <TableCell className="w-[130px]">
        <Select
          value={localTransaction.operational_type || 'otros'}
          onValueChange={(value) => handleOperationalTypeChange(value as OperationalType)}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPERATIONAL_TYPES.map((opType) => (
              <SelectItem key={opType.value} value={opType.value}>
                <span className={opType.color}>{opType.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      
      <TableCell className="w-[120px]">
        <Select
          value={localTransaction.category_id || localTransaction.category || ''}
          onValueChange={(value) => updateField({ category_id: value, category: null })}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="Categoría" />
          </SelectTrigger>
          <SelectContent>
            {categories.filter(c => c.active).map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      
      <TableCell className="w-[120px]">
        <Select
          value={localTransaction.responsible_id || '__none__'}
          onValueChange={(value) => updateField({ responsible_id: value === '__none__' ? null : value })}
        >
          <SelectTrigger className={`h-7 text-xs ${!localTransaction.responsible_id ? 'border-destructive/50' : ''}`}>
            <SelectValue placeholder="Sin asignar" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Sin asignar</SelectItem>
            {responsibles.filter(r => r.active).map((resp) => (
              <SelectItem key={resp.id} value={resp.id}>
                {resp.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      
      {/* IVA Checkbox */}
      <TableCell className="text-center w-[40px]">
        <Checkbox
          checked={localTransaction.has_iva}
          onCheckedChange={(checked) => handleIvaChange(checked as boolean)}
        />
      </TableCell>
      
      {/* IVA Type Badge - Only visible in Advanced Mode */}
      {isAdvancedMode && (
        <TableCell className="text-center w-[55px]">
          {localTransaction.has_iva && localTransaction.iva_type && (
            <Badge 
              variant="outline" 
              className={`text-[10px] px-1 ${
                localTransaction.iva_type === 'debito' 
                  ? 'border-warning text-warning' 
                  : 'border-success text-success'
              }`}
            >
              {localTransaction.iva_type === 'debito' ? 'Déb' : 'Cré'}
            </Badge>
          )}
        </TableCell>
      )}
      
      {/* IVA Amount */}
      <TableCell className="text-right text-xs w-[75px] text-muted-foreground">
        {localTransaction.iva_amount > 0 ? formatCurrency(localTransaction.iva_amount) : '-'}
      </TableCell>
      
      {/* Retefuente Checkbox - only enabled for compras */}
      <TableCell className="text-center w-[40px]">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Checkbox
                checked={localTransaction.has_retefuente}
                onCheckedChange={(checked) => handleRetefuenteChange(checked as boolean)}
                disabled={isVenta}
                className={isVenta ? 'opacity-30 cursor-not-allowed' : ''}
              />
            </span>
          </TooltipTrigger>
          {isVenta && (
            <TooltipContent>
              <p className="text-xs">Retefuente solo aplica a compras</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TableCell>
      
      {/* Retefuente Amount */}
      <TableCell className="text-right text-xs w-[75px] text-muted-foreground">
        {localTransaction.retefuente_amount > 0 ? formatCurrency(localTransaction.retefuente_amount) : '-'}
      </TableCell>

      {/* Save Status Indicator */}
      <TableCell className="w-[80px]">
        <SaveStatusIndicator status={status} errorMessage={errorMessage} />
      </TableCell>
    </TableRow>
  );
}
