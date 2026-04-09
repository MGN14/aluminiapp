import { useState, useEffect } from 'react';
import { parseLocalDate } from '@/lib/dateUtils';
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

interface PeriodSelectorProps {
  selectedMonth: number;
  selectedYear: number;
  onPeriodChange: (month: number, year: number) => void;
}

export function PeriodSelector({ selectedMonth, selectedYear, onPeriodChange }: PeriodSelectorProps) {
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAvailableYears();
  }, []);

  const fetchAvailableYears = async () => {
    try {
      // Get years from statements
      const { data: statements } = await supabase
        .from('bank_statements')
        .select('statement_year, uploaded_at')
        .order('uploaded_at', { ascending: false });

      // Get years from transactions as fallback
      const { data: transactions } = await supabase
        .from('transactions')
        .select('date')
        .order('date', { ascending: false });

      const yearsSet = new Set<number>();
      
      // Add years from statements
      statements?.forEach(s => {
        if (s.statement_year) yearsSet.add(s.statement_year);
      });
      
      // Add years from transaction dates
      transactions?.forEach(t => {
        if (t.date) {
          const year = parseLocalDate(t.date).getFullYear();
          if (year >= 2020 && year <= 2030) yearsSet.add(year);
        }
      });

      // If no data, add current year
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

  const handleMonthChange = (value: string) => {
    onPeriodChange(parseInt(value), selectedYear);
  };

  const handleYearChange = (value: string) => {
    onPeriodChange(selectedMonth, parseInt(value));
  };

  const resetToMostRecent = async () => {
    try {
      // Find most recent statement
      const { data: statement } = await supabase
        .from('bank_statements')
        .select('statement_month, statement_year')
        .order('uploaded_at', { ascending: false })
        .limit(1)
        .single();

      if (statement?.statement_month && statement?.statement_year) {
        onPeriodChange(statement.statement_month, statement.statement_year);
      } else {
        // Fallback to most recent transaction date
        const { data: transaction } = await supabase
          .from('transactions')
          .select('date')
          .order('date', { ascending: false })
          .limit(1)
          .single();

        if (transaction?.date) {
          const date = parseLocalDate(transaction.date);
          onPeriodChange(date.getMonth() + 1, date.getFullYear());
        }
      }
    } catch (error) {
      console.error('Error resetting period:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-10 w-32 bg-muted animate-pulse rounded-md" />
        <div className="h-10 w-24 bg-muted animate-pulse rounded-md" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Calendar className="h-4 w-4" />
        <span className="text-sm font-medium">Periodo:</span>
      </div>
      
      <Select value={selectedMonth.toString()} onValueChange={handleMonthChange}>
        <SelectTrigger className="w-32">
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

      <Select value={selectedYear.toString()} onValueChange={handleYearChange}>
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
