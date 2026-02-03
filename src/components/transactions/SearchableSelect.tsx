import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ChevronDown, Plus, Search, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: SelectOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  emptyLabel?: string;
  addLabel?: string;
  onAdd?: (name: string) => Promise<string | null>; // Returns new ID or null on error
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  allowEmpty?: boolean;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Seleccionar...',
  emptyLabel = 'Sin selección',
  addLabel = 'Agregar',
  onAdd,
  className,
  triggerClassName,
  disabled,
  allowEmpty = true,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [addingLoading, setAddingLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find(o => o.value === value);
  
  const filteredOptions = options.filter(o => 
    o.label.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
    if (!open) {
      setSearch('');
      setAdding(false);
      setNewName('');
    }
  }, [open]);

  const handleSelect = (optValue: string | null) => {
    onChange(optValue);
    setOpen(false);
  };

  const handleAdd = async () => {
    if (!newName.trim() || !onAdd) return;
    
    setAddingLoading(true);
    try {
      const newId = await onAdd(newName.trim());
      if (newId) {
        onChange(newId);
        setOpen(false);
      }
    } finally {
      setAddingLoading(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'h-7 justify-between text-xs font-normal',
            !value && 'text-muted-foreground',
            triggerClassName
          )}
          disabled={disabled}
        >
          <span className="truncate">
            {selectedOption?.label || placeholder}
          </span>
          <ChevronDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('p-0 w-[200px]', className)} align="start">
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 pl-7 text-xs"
            />
          </div>
        </div>
        
        <div className="max-h-[200px] overflow-y-auto">
          {allowEmpty && (
            <button
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left',
                !value && 'bg-muted'
              )}
              onClick={() => handleSelect(null)}
            >
              <span className="w-3">{!value && <Check className="h-3 w-3" />}</span>
              <span className="text-muted-foreground">{emptyLabel}</span>
            </button>
          )}
          
          {filteredOptions.map((option) => (
            <button
              key={option.value}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left',
                value === option.value && 'bg-muted'
              )}
              onClick={() => handleSelect(option.value)}
            >
              <span className="w-3">
                {value === option.value && <Check className="h-3 w-3" />}
              </span>
              <span className="truncate">{option.label}</span>
            </button>
          ))}
          
          {filteredOptions.length === 0 && !adding && (
            <div className="px-3 py-2 text-xs text-muted-foreground text-center">
              No encontrado
            </div>
          )}
        </div>

        {/* Add new option */}
        {onAdd && (
          <div className="border-t border-border p-2">
            {adding ? (
              <div className="flex gap-1">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nombre..."
                  className="h-7 text-xs flex-1"
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  autoFocus
                />
                <Button
                  size="sm"
                  className="h-7 px-2"
                  onClick={handleAdd}
                  disabled={!newName.trim() || addingLoading}
                >
                  {addingLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                </Button>
              </div>
            ) : (
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted rounded transition-colors text-primary"
                onClick={() => setAdding(true)}
              >
                <Plus className="h-3 w-3" />
                <span>{addLabel}</span>
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
