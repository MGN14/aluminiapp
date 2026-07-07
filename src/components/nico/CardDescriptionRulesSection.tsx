/**
 * Sección "Reglas de tarjeta" dentro del módulo de Reglas de Nico.
 *
 * Reglas INVERSAS: categoría + beneficiario → descripción. Pensadas para los
 * movimientos de tarjeta de crédito que entran sin comercio ("Compra TC *2047").
 * Ej: Impuestos + DIAN → "IMPTO GOBIERNO 4X1000".
 *
 * Al crear una regla se aplica retroactivamente a los movimientos de tarjeta
 * que ya tengan esa combinación asignada; hacia adelante, la fila de
 * Conciliación la aplica en vivo al asignar categoría/beneficiario.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCardDescriptionRules, CardDescriptionRule } from '@/hooks/useCardDescriptionRules';
import { useDescriptionSuggestions } from '@/hooks/useDescriptionSuggestions';
import { Category, Responsible } from '@/types/transaction';
import { ChevronDown, CreditCard, Loader2, Plus, Search, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

// Mismas queryKeys que Conciliación → comparten cache (0 requests extra si
// el usuario ya pasó por esa página).
async function queryCategories(): Promise<Category[]> {
  const { data, error } = await supabase.from('categories').select('*').order('name');
  if (error) throw error;
  return (data as Category[]) || [];
}

async function queryResponsibles(): Promise<Responsible[]> {
  const { data, error } = await supabase.from('responsibles').select('*').order('name');
  if (error) throw error;
  return (data as Responsible[]) || [];
}

const NONE = '_none';

/** Desplegable CERRADO de descripciones existentes en conciliación — la regla
 *  no acepta texto libre a propósito: la descripción resultante tiene que ser
 *  una que ya exista en los extractos (consistencia con reglas normales de
 *  Nico, que matchean por esas mismas descripciones). */
function DescriptionPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { suggestions, isLoading } = useDescriptionSuggestions(open);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q ? suggestions.filter((s) => s.description.toLowerCase().includes(q)) : suggestions;
    return base.slice(0, 50);
  }, [suggestions, search]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(''); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={`h-8 w-full justify-between text-xs font-normal ${!value ? 'text-muted-foreground' : ''}`}
        >
          <span className="truncate">{value || 'Elegir descripción existente…'}</span>
          <ChevronDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[320px]" align="start">
        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Buscar descripción…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 pl-7 text-xs"
              autoFocus
            />
          </div>
        </div>
        <div className="max-h-[240px] overflow-y-auto">
          {isLoading && (
            <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Cargando descripciones…
            </div>
          )}
          {filtered.map((s) => (
            <button
              key={s.description}
              className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left ${s.description === value ? 'bg-muted' : ''}`}
              onClick={() => { onChange(s.description); setOpen(false); }}
            >
              <span className="truncate">{s.description}</span>
              <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums">{s.count}</span>
            </button>
          ))}
          {!isLoading && filtered.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground text-center">
              No hay descripciones que coincidan
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function CardDescriptionRulesSection() {
  const { cardRules, isLoading, createRule, toggleRule, deleteRule, applyRuleToExisting } = useCardDescriptionRules();

  const { data: categories = [] } = useQuery({
    queryKey: ['conciliacion', 'categories'],
    queryFn: queryCategories,
    staleTime: 10 * 60_000,
  });
  const { data: responsibles = [] } = useQuery({
    queryKey: ['conciliacion', 'responsibles'],
    queryFn: queryResponsibles,
    staleTime: 10 * 60_000,
  });

  const [categoryId, setCategoryId] = useState<string>(NONE);
  const [responsibleId, setResponsibleId] = useState<string>(NONE);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? '—';
  const respName = (id: string | null) => responsibles.find((r) => r.id === id)?.name ?? '—';

  const canCreate = description.trim() !== '' && (categoryId !== NONE || responsibleId !== NONE);

  const handleCreate = async () => {
    if (!canCreate) return;
    setSaving(true);
    try {
      const rule = await createRule.mutateAsync({
        category_id: categoryId === NONE ? null : categoryId,
        responsible_id: responsibleId === NONE ? null : responsibleId,
        description: description.trim(),
      });
      // Retroactivo inmediato: renombrar los "Compra TC..." que ya tengan la combinación.
      const renamed = await applyRuleToExisting(rule);
      toast.success(
        renamed > 0
          ? `Regla creada — ${renamed} movimiento${renamed > 1 ? 's' : ''} de tarjeta renombrado${renamed > 1 ? 's' : ''}.`
          : 'Regla creada. Se aplicará al asignar esa combinación en Conciliación.',
      );
      setCategoryId(NONE);
      setResponsibleId(NONE);
      setDescription('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Intenta de nuevo';
      toast.error(
        msg.includes('duplicate') || msg.includes('uniq')
          ? 'Ya existe una regla para esa combinación de categoría y beneficiario.'
          : `No pude crear la regla: ${msg}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const handleApply = async (rule: CardDescriptionRule) => {
    setApplyingId(rule.id);
    try {
      const renamed = await applyRuleToExisting(rule);
      toast[renamed > 0 ? 'success' : 'info'](
        renamed > 0
          ? `${renamed} movimiento${renamed > 1 ? 's' : ''} renombrado${renamed > 1 ? 's' : ''}.`
          : 'No hay movimientos de tarjeta pendientes con esa combinación.',
      );
    } catch (e) {
      toast.error('Error aplicando la regla: ' + (e instanceof Error ? e.message : 'intenta de nuevo'));
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className="space-y-3 pt-6 mt-6 border-t border-border">
      <div className="flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Reglas de tarjeta — descripción automática</h3>
      </div>
      <p className="text-xs text-muted-foreground max-w-2xl">
        Al revés de las reglas normales: cuando asignás esta <strong>categoría + beneficiario</strong> a
        un movimiento de tarjeta (que entra como &laquo;Compra TC *1234&raquo; porque el CSV no trae el
        comercio), la <strong>descripción se reemplaza sola</strong>. Ej: Impuestos + DIAN →
        &laquo;IMPTO GOBIERNO 4X1000&raquo;.
      </p>

      {/* Crear regla */}
      <div className="rounded-xl border border-border bg-card p-3 flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">Categoría</p>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue placeholder="Categoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Cualquiera</SelectItem>
              {categories.filter((c) => c.active).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">Beneficiario</p>
          <Select value={responsibleId} onValueChange={setResponsibleId}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue placeholder="Beneficiario" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Cualquiera</SelectItem>
              {responsibles.filter((r) => r.active).map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 flex-1 min-w-[220px]">
          <p className="text-[11px] text-muted-foreground">Descripción a poner (de tus extractos)</p>
          <DescriptionPicker value={description} onChange={setDescription} />
        </div>
        <Button size="sm" className="h-8 gap-1" onClick={handleCreate} disabled={!canCreate || saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Crear regla
        </Button>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : cardRules.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">Todavía no hay reglas de tarjeta.</p>
      ) : (
        <div className="space-y-2">
          {cardRules.map((rule) => (
            <div
              key={rule.id}
              className={`rounded-xl border p-3 flex items-center justify-between gap-3 flex-wrap ${
                rule.active ? 'border-border bg-card' : 'border-border bg-muted/30 opacity-70'
              }`}
            >
              <div className="flex items-center gap-2 flex-wrap text-xs min-w-0">
                <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">💳 tarjeta</Badge>
                <span className="text-muted-foreground">
                  {catName(rule.category_id)} + {respName(rule.responsible_id)}
                </span>
                <span className="text-muted-foreground">→</span>
                <span className="font-medium text-foreground truncate">«{rule.description}»</span>
                {rule.match_count > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    Aplicada {rule.match_count} {rule.match_count === 1 ? 'vez' : 'veces'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={() => handleApply(rule)}
                  disabled={applyingId === rule.id || !rule.active}
                  title="Renombrar los movimientos de tarjeta ya categorizados con esta combinación"
                >
                  {applyingId === rule.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                  Aplicar a existentes
                </Button>
                <Switch
                  checked={rule.active}
                  onCheckedChange={(v) => toggleRule.mutate({ id: rule.id, active: v })}
                  aria-label="Activar regla de tarjeta"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => deleteRule.mutate(rule.id, {
                    onSuccess: () => toast.success('Regla de tarjeta eliminada'),
                  })}
                  aria-label="Eliminar regla de tarjeta"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
