import { useState } from 'react';
import { Transaction, CATEGORIES } from '@/types/transaction';
import { TableCell, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface TransactionRowProps {
  transaction: Transaction;
  onUpdate: (id: string, updates: Partial<Transaction>) => Promise<void>;
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

export default function TransactionRow({ transaction, onUpdate }: TransactionRowProps) {
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

  return (
    <TableRow className={`hover:bg-muted/30 ${isUpdating ? 'opacity-50' : ''}`}>
      <TableCell className="font-medium text-sm w-[90px]">
        {format(new Date(transaction.date), 'dd MMM', { locale: es })}
      </TableCell>
      
      <TableCell className="max-w-[200px]">
        <Input
          value={transaction.description}
          onChange={(e) => handleUpdate({ description: e.target.value })}
          className="h-8 text-sm border-transparent hover:border-border focus:border-border"
        />
      </TableCell>
      
      <TableCell className={`text-right font-medium text-sm w-[120px] ${amountColor}`}>
        {formatCurrency(transaction.amount)}
      </TableCell>
      
      <TableCell className="w-[140px]">
        <Select
          value={transaction.category || ''}
          onValueChange={(value) => handleUpdate({ category: value })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Categoría" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                {cat.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      
      <TableCell className="w-[120px]">
        <Input
          value={transaction.owner || ''}
          onChange={(e) => handleUpdate({ owner: e.target.value })}
          placeholder="Responsable"
          className="h-8 text-xs border-transparent hover:border-border focus:border-border"
        />
      </TableCell>
      
      <TableCell className="text-center w-[60px]">
        <Checkbox
          checked={transaction.reconciled}
          onCheckedChange={(checked) => handleUpdate({ reconciled: checked as boolean })}
        />
      </TableCell>
      
      <TableCell className="text-center w-[50px]">
        <Checkbox
          checked={transaction.has_vat}
          onCheckedChange={(checked) => handleUpdate({ has_vat: checked as boolean })}
        />
      </TableCell>
      
      <TableCell className="text-right text-sm w-[80px]">
        {transaction.has_vat ? `${transaction.vat_percentage}%` : '-'}
      </TableCell>
      
      <TableCell className="text-right text-sm w-[100px]">
        {transaction.has_vat ? formatCurrency(transaction.vat_amount) : '-'}
      </TableCell>
      
      <TableCell className="w-[100px]">
        <Input
          type="number"
          value={transaction.withholding || ''}
          onChange={(e) => handleUpdate({ withholding: e.target.value ? Number(e.target.value) : null })}
          placeholder="0"
          className="h-8 text-xs border-transparent hover:border-border focus:border-border text-right"
        />
      </TableCell>
      
      <TableCell className="text-center w-[60px]">
        <Checkbox
          checked={transaction.affects_dian}
          onCheckedChange={(checked) => handleUpdate({ affects_dian: checked as boolean })}
        />
      </TableCell>
    </TableRow>
  );
}
