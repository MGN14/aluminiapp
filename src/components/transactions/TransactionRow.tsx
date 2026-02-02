import { useState } from 'react';
import { Transaction, Category, Responsible, TransactionType } from '@/types/transaction';
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
import { Eye, ShoppingCart, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TransactionRowProps {
  transaction: Transaction;
  categories: Category[];
  responsibles: Responsible[];
  onUpdate: (id: string, updates: Partial<Transaction>) => Promise<void>;
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
  onUpdate,
  onViewDetail 
}: TransactionRowProps) {
  const [isUpdating, setIsUpdating] = useState(false);

  const handleUpdate = async (updates: Partial<Transaction>) => {
    setIsUpdating(true);
    try {
      await onUpdate(transaction.id, updates);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleTransactionTypeChange = (type: TransactionType) => {
    // When changing type, also update IVA and Retefuente flags based on new logic
    const updates: Partial<Transaction> = { transaction_type: type };
    
    // If retefuente is enabled and changing to venta, disable it (retefuente only for compras)
    if (type === 'venta' && transaction.has_retefuente) {
      updates.has_retefuente = false;
    }
    
    handleUpdate(updates);
  };

  const handleIvaChange = (checked: boolean) => {
    // The trigger will calculate iva_amount and iva_type automatically
    handleUpdate({ has_iva: checked });
  };

  const handleRetefuenteChange = (checked: boolean) => {
    // Retefuente only applies to compras - the trigger handles the calculation
    if (transaction.transaction_type === 'venta' && checked) {
      // Don't allow enabling retefuente for ventas
      return;
    }
    handleUpdate({ has_retefuente: checked });
  };

  const amountColor = (transaction.amount ?? 0) >= 0 ? 'text-success' : 'text-destructive';
  const isReconciled = !!transaction.responsible_id;
  const isVenta = transaction.transaction_type === 'venta';

  return (
    <TableRow className={`hover:bg-muted/30 ${isUpdating ? 'opacity-50' : ''} ${!isReconciled ? 'bg-destructive/5' : ''}`}>
      <TableCell className="font-medium text-sm w-[80px]">
        {format(new Date(transaction.date), 'dd MMM', { locale: es })}
      </TableCell>
      
      <TableCell className="min-w-[200px] max-w-[350px]">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2">
              <span className="text-sm truncate flex-1 cursor-help">
                {transaction.description}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 shrink-0"
                onClick={() => onViewDetail(transaction)}
              >
                <Eye className="h-3 w-3" />
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[400px]">
            <p className="text-sm">{transaction.description}</p>
          </TooltipContent>
        </Tooltip>
      </TableCell>
      
      <TableCell className={`text-right font-medium text-sm w-[100px] ${amountColor}`}>
        {formatCurrency(transaction.amount)}
      </TableCell>
      
      {/* Transaction Type Selector */}
      <TableCell className="w-[90px]">
        <Select
          value={transaction.transaction_type || 'compra'}
          onValueChange={(value) => handleTransactionTypeChange(value as TransactionType)}
        >
          <SelectTrigger className={`h-7 text-xs ${isVenta ? 'border-success/50' : 'border-destructive/50'}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="compra">
              <div className="flex items-center gap-1">
                <ShoppingCart className="h-3 w-3" />
                <span>Compra</span>
              </div>
            </SelectItem>
            <SelectItem value="venta">
              <div className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                <span>Venta</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      
      <TableCell className="w-[120px]">
        <Select
          value={transaction.category_id || transaction.category || ''}
          onValueChange={(value) => handleUpdate({ category_id: value, category: null })}
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
          value={transaction.responsible_id || '__none__'}
          onValueChange={(value) => handleUpdate({ responsible_id: value === '__none__' ? null : value })}
        >
          <SelectTrigger className={`h-7 text-xs ${!transaction.responsible_id ? 'border-destructive/50' : ''}`}>
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
          checked={transaction.has_iva}
          onCheckedChange={(checked) => handleIvaChange(checked as boolean)}
        />
      </TableCell>
      
      {/* IVA Type Badge */}
      <TableCell className="text-center w-[55px]">
        {transaction.has_iva && transaction.iva_type && (
          <Badge 
            variant="outline" 
            className={`text-[10px] px-1 ${
              transaction.iva_type === 'debito' 
                ? 'border-warning text-warning' 
                : 'border-success text-success'
            }`}
          >
            {transaction.iva_type === 'debito' ? 'Déb' : 'Cré'}
          </Badge>
        )}
      </TableCell>
      
      {/* IVA Amount */}
      <TableCell className="text-right text-xs w-[75px] text-muted-foreground">
        {transaction.iva_amount > 0 ? formatCurrency(transaction.iva_amount) : '-'}
      </TableCell>
      
      {/* Retefuente Checkbox - only enabled for compras */}
      <TableCell className="text-center w-[40px]">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Checkbox
                checked={transaction.has_retefuente}
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
        {transaction.retefuente_amount > 0 ? formatCurrency(transaction.retefuente_amount) : '-'}
      </TableCell>
    </TableRow>
  );
}
