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
  Search,
  X,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Category, Responsible } from '@/types/transaction';
import DescriptionSearch, { DescriptionOption } from './DescriptionSearch';

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
  /** Búsqueda libre por descripción (substring case-insensitive). */
  descSearch: string;
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
  descriptionOptions: DescriptionOption[];
  /** El selector de extracto vive en el padre (arriba del banner), pero para el
   *  usuario es UN filtro más: si está activo, "Limpiar filtros" también lo
   *  resetea y el botón aparece aunque sea lo único filtrando. */
  statementFilterActive?: boolean;
  statementFilterLabel?: string;
  onClearStatementFilter?: () => void;
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
  descSearch: '',
};

export default function TransactionFilters({ filters, onFiltersChange, counts, categories, responsibles, descriptionOptions, statementFilterActive, statementFilterLabel, onClearStatementFilter }: TransactionFiltersProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);

  const update = (partial: Partial<TransactionFilterState>) => {
    onFiltersChange({ ...filters, ...partial });
  };

  const hasActiveFilters =
    filters.estado !== 'todas' ||
    filters.tipo !== 'todos' ||
    filters.categoryId !== null ||
    filters.responsibleId !== null ||
    (filters.descSearch ?? '').trim() !== '' ||
    filters.dateFrom !== undefined ||
    filters.dateTo !== undefined ||
    !!statementFilterActive;

  const clearFilters = () => {
    onFiltersChange({ ...defaultFilters, sortOrder: filters.sortOrder });
    onClearStatementFilter?.();
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
  const activeResponsibles = responsibles.filter(r => r.active);

  return (
    <div className="space-y-3">
      {/* Búsqueda por descripción — dropdown de descripciones parseadas + texto libre */}
      <div className="flex items-center gap-2">
        <DescriptionSearch
          value={filters.descSearch ?? ''}
          onChange={(v) => update({ descSearch: v })}
          options={descriptionOptions}
        />
      </div>

      {/* Filter Row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-4 w-4 text-muted-foreground shrink-0" />

        {/* Estado filter */}
        <div style={{display:'flex',background:'#fff',border:'1.5px solid rgba(0,0,0,0.07)',borderRadius:10,padding:3,gap:1,fontFamily:'inherit'}}>
          <button
            type="button"
            onClick={() => update({ estado: 'todas' })}
            style={{
              padding:'5px 12px', borderRadius:7, fontSize:12, fontWeight:500, border:'none', cursor:'pointer', fontFamily:'inherit',
              background: filters.estado === 'todas' ? '#1d1d1f' : 'transparent',
              color: filters.estado === 'todas' ? '#fff' : '#6e6e73',
            }}
          >
            Todas ({counts.total})
          </button>
          <button
            type="button"
            onClick={() => update({ estado: 'pendientes' })}
            style={{
              padding:'5px 12px', borderRadius:7, fontSize:12, fontWeight:500, border:'none', cursor:'pointer', fontFamily:'inherit',
              background: filters.estado === 'pendientes' ? 'oklch(0.65 0.15 65)' : 'transparent',
              color: filters.estado === 'pendientes' ? '#fff' : '#6e6e73',
            }}
          >
            Pendientes ({counts.pendientes})
          </button>
          <button
            type="button"
            onClick={() => update({ estado: 'conciliadas' })}
            style={{
              padding:'5px 12px', borderRadius:7, fontSize:12, fontWeight:500, border:'none', cursor:'pointer', fontFamily:'inherit',
              background: filters.estado === 'conciliadas' ? 'oklch(0.43 0.14 155)' : 'transparent',
              color: filters.estado === 'conciliadas' ? '#fff' : '#6e6e73',
            }}
          >
            Conciliadas ({counts.conciliadas})
          </button>
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
                <SelectItem value="_all">Categorías</SelectItem>
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

        {/* Responsible filter */}
        {activeResponsibles.length > 0 && (
          <>
            <Select
              value={filters.responsibleId ?? '_all'}
              onValueChange={(val) => update({ responsibleId: val === '_all' ? null : val })}
            >
              <SelectTrigger className={cn(
                'h-7 w-[150px] text-xs',
                filters.responsibleId && 'border-primary text-primary'
              )}>
                <SelectValue placeholder="Beneficiario" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">Beneficiarios</SelectItem>
                {activeResponsibles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
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

        {/* Sort por Monto y Fecha movido a los headers de la tabla
            (clickeable directamente desde la columna). */}

        {/* Extracto activo — el selector vive arriba del banner y no se leía
            como filtro: el chip lo hace visible y quitable desde acá. */}
        {statementFilterActive && (
          <Badge
            variant="outline"
            className="h-7 gap-1 text-xs font-normal border-primary/40 text-primary max-w-[240px] cursor-pointer hover:bg-primary/5"
            onClick={onClearStatementFilter}
            title="Quitar filtro de extracto"
          >
            <span className="truncate">{statementFilterLabel ?? 'Extracto filtrado'}</span>
            <X className="h-3 w-3 shrink-0" />
          </Badge>
        )}

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
