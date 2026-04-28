import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

type ToggleControl<V extends string = string> = {
  kind: 'toggle';
  id: string;
  label: string;
  value: V;
  options: ReadonlyArray<{ value: V; label: string; ariaLabel?: string }>;
  onChange: (next: V) => void;
};

type SelectControl<V extends string = string> = {
  kind: 'select';
  id: string;
  label: string;
  value: V;
  options: ReadonlyArray<{ value: V; label: string }>;
  onChange: (next: V) => void;
  width?: number;
};

type SwitchControl = {
  kind: 'switch';
  id: string;
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
};

export type FilterControlSpec = ToggleControl | SelectControl | SwitchControl;

interface ChartFilterBarProps {
  chartId: string;
  controls: FilterControlSpec[];
}

export function useChartFilterParam<V extends string>(
  chartId: string,
  paramKey: string,
  fallback: V,
  allowed?: ReadonlyArray<V>,
): [V, (next: V) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const fullKey = `${chartId}${paramKey[0].toUpperCase()}${paramKey.slice(1)}`;
  const raw = searchParams.get(fullKey) as V | null;
  const value = useMemo<V>(() => {
    if (raw && (!allowed || allowed.includes(raw))) return raw;
    return fallback;
  }, [raw, fallback, allowed]);

  const setValue = useCallback(
    (next: V) => {
      setSearchParams(
        prev => {
          const out = new URLSearchParams(prev);
          if (next === fallback) out.delete(fullKey);
          else out.set(fullKey, next);
          return out;
        },
        { replace: true },
      );
    },
    [setSearchParams, fullKey, fallback],
  );

  return [value, setValue];
}

export function useChartFilterBool(
  chartId: string,
  paramKey: string,
  fallback: boolean,
): [boolean, (next: boolean) => void] {
  const [value, setValue] = useChartFilterParam<'1' | '0'>(
    chartId,
    paramKey,
    fallback ? '1' : '0',
    ['1', '0'],
  );
  return [value === '1', useCallback((next: boolean) => setValue(next ? '1' : '0'), [setValue])];
}

function renderControl(c: FilterControlSpec, dense = false) {
  if (c.kind === 'toggle') {
    return (
      <ToggleGroup
        type="single"
        size="sm"
        value={c.value}
        onValueChange={v => v && c.onChange(v as never)}
        aria-label={c.label}
        className={cn('flex-nowrap justify-start gap-0 rounded-md border bg-background p-0.5', dense && 'w-full')}
      >
        {c.options.map(opt => (
          <ToggleGroupItem
            key={opt.value}
            value={opt.value}
            aria-label={opt.ariaLabel ?? opt.label}
            className="h-7 rounded-[4px] px-2.5 text-xs whitespace-nowrap data-[state=on]:bg-muted data-[state=on]:text-foreground"
          >
            {opt.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    );
  }
  if (c.kind === 'select') {
    return (
      <Select value={c.value} onValueChange={v => c.onChange(v as never)}>
        <SelectTrigger
          aria-label={c.label}
          className="h-8 text-xs"
          style={{ width: dense ? '100%' : c.width ?? 132 }}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {c.options.map(opt => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
      <Switch
        checked={c.value}
        onCheckedChange={c.onChange}
        aria-label={c.label}
        className="data-[state=checked]:bg-primary"
      />
      <span>{c.label}</span>
    </label>
  );
}

export function ChartFilterBar({ chartId, controls }: ChartFilterBarProps) {
  const inlineCapable =
    controls.length <= 3 &&
    controls.every(c => c.kind !== 'select' || c.options.length <= 4);
  const popoverCount = controls.length;

  return (
    <div className="flex items-center gap-2 shrink-0" data-chart-filterbar={chartId}>
      {inlineCapable && (
        <div className="hidden xl:flex items-center gap-2 flex-nowrap">
          {controls.map(c => (
            <div key={c.id} className="flex items-center gap-1.5 flex-nowrap">
              {c.kind === 'switch' && renderControl(c)}
              {c.kind !== 'switch' && (
                <>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground/80 whitespace-nowrap">
                    {c.label}
                  </span>
                  {renderControl(c)}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Filtros de ${chartId}`}
            className={cn(
              'h-8 gap-1.5 rounded-md text-xs font-medium whitespace-nowrap',
              inlineCapable && 'xl:hidden',
            )}
          >
            <Filter className="h-3.5 w-3.5" aria-hidden />
            Filtros
            {popoverCount > 0 && (
              <span className="ml-0.5 rounded-full bg-muted px-1.5 py-px text-[10px] leading-none text-muted-foreground">
                {popoverCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-3" sideOffset={6}>
          <div className="space-y-3">
            {controls.map(c => (
              <div key={c.id} className="space-y-1.5">
                {c.kind !== 'switch' && (
                  <label className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                    {c.label}
                  </label>
                )}
                {renderControl(c, true)}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
