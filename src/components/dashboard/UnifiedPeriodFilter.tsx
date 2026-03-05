import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar, RefreshCw } from 'lucide-react';
import { MONTH_NAMES } from '@/types/transaction';

export type PeriodType = 'month' | 'quarter' | 'year';

export interface PeriodSelection {
  type: PeriodType;
  month: number; // 1-12
  quarter: number; // 1-4
  year: number;
}

interface UnifiedPeriodFilterProps {
  selection: PeriodSelection;
  onSelectionChange: (selection: PeriodSelection) => void;
}

const QUARTERS = [
  { value: 1, label: 'Q1 (Ene-Mar)' },
  { value: 2, label: 'Q2 (Abr-Jun)' },
  { value: 3, label: 'Q3 (Jul-Sep)' },
  { value: 4, label: 'Q4 (Oct-Dic)' },
];

export function UnifiedPeriodFilter({ selection, onSelectionChange }: UnifiedPeriodFilterProps) {
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAvailableYears();
  }, []);

  const fetchAvailableYears = async () => {
    try {
      const { data: statements } = await supabase
        .from('bank_statements')
        .select('statement_year')
        .order('statement_year', { ascending: false });

      const { data: transactions } = await supabase
        .from('transactions')
        .select('date')
        .order('date', { ascending: false });

      const yearsSet = new Set<number>();
      
      statements?.forEach(s => {
        if (s.statement_year) yearsSet.add(s.statement_year);
      });
      
      transactions?.forEach(t => {
        if (t.date) {
          const year = new Date(t.date).getFullYear();
          if (year >= 2020 && year <= 2030) yearsSet.add(year);
        }
      });

      if (yearsSet.size === 0) {
        yearsSet.add(new Date().getFullYear());
      }

      const sortedYears = Array.from(yearsSet).sort((a, b) => b - a);
      setAvailableYears(sortedYears);
    } catch (error) {
      console.error('Error fetching available years:', error);
      setAvailableYears([new Date().getFullYear()]);
    } finally {
      setLoading(false);
    }
  };

  const handleTypeChange = (type: PeriodType) => {
    onSelectionChange({ ...selection, type });
  };

  const handleMonthChange = (value: string) => {
    onSelectionChange({ ...selection, month: parseInt(value) });
  };

  const handleQuarterChange = (value: string) => {
    onSelectionChange({ ...selection, quarter: parseInt(value) });
  };

  const handleYearChange = (value: string) => {
    onSelectionChange({ ...selection, year: parseInt(value) });
  };

  const resetToMostRecent = async () => {
    try {
      const { data: statement } = await supabase
        .from('bank_statements')
        .select('statement_month, statement_year')
        .order('uploaded_at', { ascending: false })
        .limit(1)
        .single();

      if (statement?.statement_month && statement?.statement_year) {
        onSelectionChange({
          type: 'quarter',
          month: statement.statement_month,
          quarter: Math.ceil(statement.statement_month / 3),
          year: statement.statement_year,
        });
      } else {
        const { data: transaction } = await supabase
          .from('transactions')
          .select('date')
          .order('date', { ascending: false })
          .limit(1)
          .single();

        if (transaction?.date) {
          const date = new Date(transaction.date);
          const month = date.getMonth() + 1;
          onSelectionChange({
            type: 'quarter',
            month,
            quarter: Math.ceil(month / 3),
            year: date.getFullYear(),
          });
        }
      }
    } catch (error) {
      console.error('Error resetting period:', error);
    }
  };

  // Get period label for display
  const periodLabel = useMemo(() => {
    switch (selection.type) {
      case 'month':
        return `${MONTH_NAMES[selection.month - 1]} ${selection.year}`;
      case 'quarter':
        return `${QUARTERS.find(q => q.value === selection.quarter)?.label.split(' ')[0]} ${selection.year}`;
      case 'year':
        return `${selection.year}`;
      default:
        return '';
    }
  }, [selection]);

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-9 w-64 bg-muted animate-pulse rounded-md" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Calendar className="h-4 w-4" />
        <span className="text-sm font-medium">Periodo:</span>
      </div>
      
      {/* Period Type Selector */}
      <div className="inline-flex rounded-md border border-input bg-background">
        <Button
          variant={selection.type === 'month' ? 'default' : 'ghost'}
          size="sm"
          className="rounded-r-none border-r"
          onClick={() => handleTypeChange('month')}
        >
          Mes
        </Button>
        <Button
          variant={selection.type === 'quarter' ? 'default' : 'ghost'}
          size="sm"
          className="rounded-none border-r"
          onClick={() => handleTypeChange('quarter')}
        >
          Trimestre
        </Button>
        <Button
          variant={selection.type === 'year' ? 'default' : 'ghost'}
          size="sm"
          className="rounded-l-none"
          onClick={() => handleTypeChange('year')}
        >
          Año
        </Button>
      </div>

      {/* Dynamic Sub-selector based on type */}
      {selection.type === 'month' && (
        <Select value={selection.month.toString()} onValueChange={handleMonthChange}>
          <SelectTrigger className="w-28">
            <SelectValue placeholder="Mes" />
          </SelectTrigger>
          <SelectContent>
            {MONTH_NAMES.map((name, index) => (
              <SelectItem key={index + 1} value={(index + 1).toString()}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {selection.type === 'quarter' && (
        <Select value={selection.quarter.toString()} onValueChange={handleQuarterChange}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Trimestre" />
          </SelectTrigger>
          <SelectContent>
            {QUARTERS.map(q => (
              <SelectItem key={q.value} value={q.value.toString()}>
                {q.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Year Selector - always visible */}
      <Select value={selection.year.toString()} onValueChange={handleYearChange}>
        <SelectTrigger className="w-24">
          <SelectValue placeholder="Año" />
        </SelectTrigger>
        <SelectContent>
          {availableYears.map(year => (
            <SelectItem key={year} value={year.toString()}>
              {year}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="ghost"
        size="sm"
        onClick={resetToMostRecent}
        className="text-muted-foreground hover:text-foreground"
        title="Ir al periodo más reciente"
      >
        <RefreshCw className="h-4 w-4" />
      </Button>
    </div>
  );
}

// Helper to get date range from period selection
export function getPeriodDateRange(selection: PeriodSelection): { start: Date; end: Date; label: string } {
  const { type, month, quarter, year } = selection;

  switch (type) {
    case 'month': {
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0, 23, 59, 59);
      return { start, end, label: `${MONTH_NAMES[month - 1]} ${year}` };
    }
    case 'quarter': {
      const startMonth = (quarter - 1) * 3;
      const start = new Date(year, startMonth, 1);
      const end = new Date(year, startMonth + 3, 0, 23, 59, 59);
      const quarterLabels = ['Ene-Mar', 'Abr-Jun', 'Jul-Sep', 'Oct-Dic'];
      return { start, end, label: `Q${quarter} (${quarterLabels[quarter - 1]}) ${year}` };
    }
    case 'year': {
      const start = new Date(year, 0, 1);
      const end = new Date(year, 11, 31, 23, 59, 59);
      return { start, end, label: `${year}` };
    }
  }
}
