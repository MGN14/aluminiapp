import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CalendarIcon,
  CheckCircle2,
  Circle,
  Filter,
  ArrowDown,
  ArrowUp,
  X,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Category, Responsible } from '@/types/transaction';

export type EstadoFilter = 'todas' | 'pendientes' | 'conciliadas';
export type TipoFilter = 'todos' | 'ingresos' | 'egresos';
export type SortOrder = 'asc' | 'desc';

export interface TransactionFilterState {
  estado: EstadoFilter;
  tipo: TipoFilter;
  categoryId: string | null;
  responsibleId: string | null;
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  sortOrder: SortOrder;
  amountSortOrder: SortOrder | null;
}

interface TransactionFiltersProps {
  filters: TransactionFilterState;
  onFiltersChange: (filters: TransactionFilterState) => void;
  counts: {
    total: number;
    pendientes: number;
    conciliadas: number;
  };
  categories: Category[];
  responsibles: Responsible[];
}

export const defaultFilters: TransactionFilterState = {
  estado: 'todas',
  tipo: 'todos',
  categoryId: null,
  responsibleId: null,
  dateFrom: undefined,
  dateTo: undefined,
  sortOrder: 'asc',
  amountSortOrder: null,
};

export default function TransactionFilters({ filters, onFiltersChange, counts, categories, responsibles }: TransactionFiltersProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);

  const update = (partial: Partial<TransactionFilterState>) => {
    onFiltersChange({ ...filters, ...partial });
  };

  const hasActiveFilters =
    filters.estado !== 'todas' ||
    filters.tipo !== 'todos' ||
    filters.categoryId !== null ||
    filters.responsibleId !== null ||
    filters.dateFrom !== undefined ||
    filters.dateTo !== undefined;

  const clearFilters = () => {
    onFiltersChange({ ...defaultFilters, sortOrder: filters.sortOrder });
  };

  // Quick date helpers
  const setCurrentMonth = () => {
    const now = new Date();
    update({ dateFrom: startOfMonth(now), dateTo: endOfMonth(now) });
  };

  const setPreviousMonth = () => {
    const prev = subMonths(new Date(), 1);
    update({ dateFrom: startOfMonth(prev), dateTo: endOfMonth(prev) });
  };

  const clearDates = () => {
    update({ dateFrom: undefined, dateTo: undefined });
  };

  const activeCategories = categories.filter(c => c.active);

  return (
    <div className="space-y-3">
      {/* Filter Row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-4 w-4 text-muted-foreground shrink-0" />

        {/* Estado filter */}
        <div className="flex items-center gap-1">
          <Button
            variant={filters.estado === 'todas' ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => update({ estado: 'todas' })}
          >
            Todas ({counts.total})
          </Button>
          <Button
            variant={filters.estado === 'pendientes' ? 'default' : 'outline'}
            size="sm"
            className={cn(
              'h-7 text-xs gap-1',
              filters.estado !== 'pendientes' && counts.pendientes > 0 && 'border-warning/50 text-warning hover:bg-warning/10'
            )}
            onClick={() => update({ estado: 'pendientes' })}
          >
            <Circle className="h-3 w-3" />
            Pendientes ({counts.pendientes})
          </Button>
          <Button
            variant={filters.estado === 'conciliadas' ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => update({ estado: 'conciliadas' })}
          >
            <CheckCircle2 className="h-3 w-3" />
            Conciliadas ({counts.conciliadas})
          </Button>
        </div>

        <Separator orientation="vertical" className="h-5" />

        {/* Tipo filter */}
        <div className="flex items-center gap-1">
          <Button
            variant={filters.tipo === 'todos' ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => update({ tipo: 'todos' })}
          >
            Todos
          </Button>
          <Button
            variant={filters.tipo === 'ingresos' ? 'default' : 'outline'}
            size="sm"
            className={cn('h-7 text-xs', filters.tipo !== 'ingresos' && 'text-success hover:bg-success/10')}
            onClick={() => update({ tipo: 'ingresos' })}
          >
            Ingresos
          </Button>
          <Button
            variant={filters.tipo === 'egresos' ? 'default' : 'outline'}
            size="sm"
            className={cn('h-7 text-xs', filters.tipo !== 'egresos' && 'text-destructive hover:bg-destructive/10')}
            onClick={() => update({ tipo: 'egresos' })}
          >
            Egresos
          </Button>
        </div>

        <Separator orientation="vertical" className="h-5" />

        {/* Category filter */}
        {activeCategories.length > 0 && (
          <>
            <Select
              value={filters.categoryId ?? '_all'}
              onValueChange={(val) => update({ categoryId: val === '_all' ? null : val })}
            >
              <SelectTrigger className={cn(
                'h-7 w-[150px] text-xs',
                filters.categoryId && 'border-primary text-primary'
              )}>
                <SelectValue placeholder="Categoría" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">Todas las categorías</SelectItem>
                {activeCategories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Separator orientation="vertical" className="h-5" />
          </>
        )}

        {/* Date filter */}
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                'h-7 text-xs gap-1',
                (filters.dateFrom || filters.dateTo) && 'border-primary text-primary'
              )}
            >
              <CalendarIcon className="h-3 w-3" />
              {filters.dateFrom && filters.dateTo
                ? `${format(filters.dateFrom, 'dd MMM', { locale: es })} - ${format(filters.dateTo, 'dd MMM', { locale: es })}`
                : 'Fecha'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3" align="start">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="text-xs" onClick={setCurrentMonth}>
                  Mes actual
                </Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={setPreviousMonth}>
                  Mes anterior
                </Button>
                {(filters.dateFrom || filters.dateTo) && (
                  <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={clearDates}>
                    Limpiar
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Desde</p>
                  <Calendar
                    mode="single"
                    selected={filters.dateFrom}
                    onSelect={(date) => update({ dateFrom: date || undefined })}
                    locale={es}
                    className="rounded-md border"
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Hasta</p>
                  <Calendar
                    mode="single"
                    selected={filters.dateTo}
                    onSelect={(date) => update({ dateTo: date || undefined })}
                    locale={es}
                    className="rounded-md border"
                  />
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <Separator orientation="vertical" className="h-5" />

        {/* Amount sort toggle */}
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-7 text-xs gap-1',
            filters.amountSortOrder !== null && 'border-primary text-primary'
          )}
          onClick={() => {
            const next = filters.amountSortOrder === null
              ? 'desc'
              : filters.amountSortOrder === 'desc'
                ? 'asc'
                : null;
            update({ amountSortOrder: next as SortOrder | null });
          }}
        >
          {filters.amountSortOrder === 'desc' ? (
            <>
              <ArrowDown className="h-3 w-3" />
              Mayor → Menor
            </>
          ) : filters.amountSortOrder === 'asc' ? (
            <>
              <ArrowUp className="h-3 w-3" />
              Menor → Mayor
            </>
          ) : (
            <>💰 Monto</>
          )}
        </Button>

        <Separator orientation="vertical" className="h-5" />

        {/* Date sort toggle */}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => update({ sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc' })}
        >
          {filters.sortOrder === 'asc' ? (
            <>
              <ArrowUp className="h-3 w-3" />
              Antiguas → Recientes
            </>
          ) : (
            <>
              <ArrowDown className="h-3 w-3" />
              Recientes → Antiguas
            </>
          )}
        </Button>

        {/* Clear filters */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1 text-muted-foreground"
            onClick={clearFilters}
          >
            <X className="h-3 w-3" />
            Limpiar filtros
          </Button>
        )}
      </div>
    </div>
  );
}
