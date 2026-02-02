import { useState } from 'react';
import { Transaction, Category, Responsible } from '@/types/transaction';
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

  const amountColor = (transaction.amount ?? 0) >= 0 ? 'text-success' : 'text-destructive';
  const isReconciled = !!transaction.responsible_id;

  return (
    <TableRow className={`hover:bg-muted/30 ${isUpdating ? 'opacity-50' : ''} ${!isReconciled ? 'bg-destructive/5' : ''}`}>
      <TableCell className="font-medium text-sm w-[80px]">
        {format(new Date(transaction.date), 'dd MMM', { locale: es })}
      </TableCell>
      
      <TableCell className="min-w-[250px] max-w-[400px]">
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
      
      <TableCell className={`text-right font-medium text-sm w-[110px] ${amountColor}`}>
        {formatCurrency(transaction.amount)}
      </TableCell>
      
      <TableCell className="w-[130px]">
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
      
      <TableCell className="w-[130px]">
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
      
      <TableCell className="text-center w-[45px]">
        <Checkbox
          checked={transaction.has_iva}
          onCheckedChange={(checked) => {
            const hasIva = checked as boolean;
            const ivaAmount = hasIva ? Math.abs(transaction.amount ?? 0) * 0.10 : 0;
            handleUpdate({ has_iva: hasIva, iva_amount: ivaAmount });
          }}
        />
      </TableCell>
      
      <TableCell className="text-right text-xs w-[80px] text-muted-foreground">
        {transaction.iva_amount > 0 ? formatCurrency(transaction.iva_amount) : '-'}
      </TableCell>
      
      <TableCell className="text-center w-[45px]">
        <Checkbox
          checked={transaction.has_retefuente}
          onCheckedChange={(checked) => {
            const hasRete = checked as boolean;
            const amount = transaction.amount ?? 0;
            // Retefuente solo aplica a egresos (monto negativo)
            const reteAmount = hasRete && amount < 0 ? Math.abs(amount) * 0.025 : 0;
            handleUpdate({ has_retefuente: hasRete, retefuente_amount: reteAmount });
          }}
        />
      </TableCell>
      
      <TableCell className="text-right text-xs w-[80px] text-muted-foreground">
        {transaction.retefuente_amount > 0 ? formatCurrency(transaction.retefuente_amount) : '-'}
      </TableCell>
    </TableRow>
  );
}
