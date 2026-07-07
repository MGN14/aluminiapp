/**
 * CardDescriptionEditor — SOLO para movimientos de tarjeta de crédito.
 *
 * El CSV de tarjeta de Bancolombia no trae el comercio: todas las compras
 * entran como "Compra TC *2047" y el auxiliar no sabe qué es cada una. Este
 * lápiz en la celda de Descripción permite reemplazarla: un desplegable con
 * las descripciones ya existentes en los extractos del usuario (para reusar
 * y mantener consistencia con las reglas de Nico) + texto libre.
 *
 * La línea original del CSV queda intacta en transactions.raw_line (visible
 * en el detalle), así que reemplazar la descripción no pierde auditoría.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Pencil, Search, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDescriptionSuggestions } from '@/hooks/useDescriptionSuggestions';

interface Props {
  currentDescription: string;
  onPick: (description: string) => void;
}

export default function CardDescriptionEditor({ currentDescription, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { suggestions, isLoading } = useDescriptionSuggestions(open);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setSearch('');
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? suggestions.filter((s) => s.description.toLowerCase().includes(q))
      : suggestions;
    return base.slice(0, 50);
  }, [suggestions, search]);

  const freeText = search.trim();
  const freeTextIsNew = freeText !== '' &&
    !filtered.some((s) => s.description.toLowerCase() === freeText.toLowerCase());

  const pick = (description: string) => {
    if (description && description !== currentDescription) onPick(description);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-primary"
          title="Reemplazar descripción (compra de tarjeta)"
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[300px]" align="start">
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="Buscar o escribir descripción…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && freeText) pick(freeText);
              }}
              className="h-7 pl-7 text-xs"
            />
          </div>
        </div>

        <div className="max-h-[240px] overflow-y-auto">
          {/* Texto libre — Enter o click. Primero, para que "escribo y Enter"
              sea el camino rápido del auxiliar. */}
          {freeTextIsNew && (
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left text-primary"
              onClick={() => pick(freeText)}
            >
              <Check className="h-3 w-3 shrink-0" />
              <span className="truncate">Usar «{freeText}»</span>
            </button>
          )}

          {isLoading && (
            <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Cargando descripciones…
            </div>
          )}

          {filtered.map((s) => (
            <button
              key={s.description}
              className={cn(
                'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left',
                s.description === currentDescription && 'bg-muted',
              )}
              onClick={() => pick(s.description)}
            >
              <span className="truncate">{s.description}</span>
              <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums">{s.count}</span>
            </button>
          ))}

          {!isLoading && filtered.length === 0 && !freeTextIsNew && (
            <div className="px-3 py-2 text-xs text-muted-foreground text-center">
              Escribí la descripción y apretá Enter
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
