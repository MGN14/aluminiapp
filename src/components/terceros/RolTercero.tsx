/**
 * ROL DE UN TERCERO — chips + editor de un clic.
 *
 * Pedido de Nico (2026-11-11, con la captura del listado): "que pueda cambiar
 * ahí mismo el rol de cada tercero, haciendo clic en Proveedor y poderlo
 * cambiar a las categorías existentes".
 *
 * El rol sigue saliendo de la actividad (derivarRoles). Este editor solo lo
 * CORRIGE: lo que se fija acá se guarda en responsibles.roles_manual y manda
 * sobre lo derivado en el listado, la ficha y el selector de beneficiario de
 * las filas Ventas de Conciliación. "Volver a automático" lo borra.
 *
 * Se usa dentro de filas clicables (el listado navega a la ficha al hacer
 * clic en la fila): el trigger y el contenido frenan la propagación — los
 * eventos de React burbujean a través del portal del Popover.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Pencil, Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ROLES_TERCERO, ROL_LABEL, saveRolesTercero, type RolTercero, type Tercero,
} from '@/lib/terceroProfile';

const ROL_STYLE: Record<RolTercero, string> = {
  cliente: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
  proveedor: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900',
  empleado: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900',
  entidad: 'bg-muted text-muted-foreground border-border',
};

const lista = (roles: RolTercero[]) => roles.map((r) => ROL_LABEL[r]).join(' + ');

/** Chips de solo lectura. `manual` agrega el pin de "fijado a mano". */
export function RolChips({ roles, manual = false, vacio = 'sin rol' }: {
  roles: RolTercero[];
  manual?: boolean;
  vacio?: string;
}) {
  if (!roles.length) return <span className="text-xs text-muted-foreground">{vacio}</span>;
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {roles.map((r) => (
        <span key={r} className={cn('rounded border px-1.5 py-px text-xs font-medium', ROL_STYLE[r])}>
          {ROL_LABEL[r]}
        </span>
      ))}
      {manual && <Pin className="h-3 w-3 text-muted-foreground" aria-label="fijado a mano" />}
    </span>
  );
}

export interface RolEditableProps {
  terceroId: string;
  nombre: string;
  /** Roles efectivos (lo fijado a mano si hay, si no lo derivado). */
  roles: RolTercero[];
  /** Lo que diría la actividad sola. */
  derivados: RolTercero[];
  /** true = hoy está fijado a mano. */
  manual: boolean;
  /** El resumen de actividad todavía no llegó: no mostrar "sin rol" de mentira. */
  cargando?: boolean;
}

/** Chip clicable que abre el editor de roles. */
export function RolEditable({ terceroId, nombre, roles, derivados, manual, cargando = false }: RolEditableProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<RolTercero[]>(roles);

  const guardar = useMutation({
    mutationFn: (nuevos: RolTercero[] | null) => saveRolesTercero(terceroId, nuevos),
    onSuccess: (limpio) => {
      // El listado se ve al instante: el rol manual se resuelve al pintar contra esta lista.
      qc.setQueryData<Tercero[]>(['terceros'], (prev) => prev?.map((t) => (t.id === terceroId
        ? { ...t, roles_manual: limpio, cliente_manual: limpio?.includes('cliente') ?? false }
        : t)));
      qc.invalidateQueries({ queryKey: ['terceros'], exact: true });
      qc.invalidateQueries({ queryKey: ['terceros', 'perfil'] });
      // El selector de beneficiario de Ventas lee el rol manual.
      qc.invalidateQueries({ queryKey: ['conciliacion'] });
      setOpen(false);
      toast({
        title: limpio ? `${nombre}: ${lista(limpio)}` : `${nombre}: rol automático`,
        description: limpio
          ? 'Fijado a mano. Manda en Terceros y en el selector de Ventas de Conciliación.'
          : `Vuelve a salir de su actividad${derivados.length ? `: ${lista(derivados)}` : ' (hoy no tiene rol)'}.`,
      });
    },
    onError: (e) => {
      const msg = (e as Error).message ?? '';
      toast({
        title: 'No se pudo cambiar el rol',
        description: /roles_manual/.test(msg)
          ? 'Falta aplicar en Supabase la migración de roles (20261111130000). Aplicala en el SQL Editor y volvé a intentar.'
          : msg,
        variant: 'destructive',
      });
    },
  });

  const mismaSeleccion = sel.length === roles.length && sel.every((r) => roles.includes(r));
  // Sin nada fijado, guardar vacío no cambia nada; fijado, guardar lo mismo tampoco.
  const sinCambio = manual ? mismaSeleccion : sel.length === 0;

  const toggle = (r: RolTercero, marcado: boolean) =>
    setSel((prev) => (marcado ? ROLES_TERCERO.filter((x) => x === r || prev.includes(x)) : prev.filter((x) => x !== r)));

  const titulo = manual
    ? `Rol fijado a mano${derivados.length ? ` (automático sería: ${lista(derivados)})` : ''} — clic para cambiar`
    : 'Rol automático: sale de su actividad — clic para corregirlo';

  return (
    <Popover open={open} onOpenChange={(o) => { if (o) setSel(roles); setOpen(o); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={titulo}
          aria-label={`Cambiar el rol de ${nombre}`}
          className="group inline-flex items-center gap-1 rounded-md -mx-1 px-1 py-0.5 text-left hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
        >
          {cargando
            ? <span className="text-xs text-muted-foreground">…</span>
            : <RolChips roles={roles} manual={manual} vacio="sin rol" />}
          <Pencil className="h-3 w-3 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold leading-tight truncate">Rol de {nombre}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
          Marcá uno o varios. Lo que fijés acá manda sobre lo automático.
        </p>

        <div className="mt-2.5 space-y-0.5">
          {ROLES_TERCERO.map((r) => {
            const id = `rol-${terceroId}-${r}`;
            return (
              <label key={r} htmlFor={id}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted cursor-pointer">
                <Checkbox id={id} checked={sel.includes(r)} onCheckedChange={(v) => toggle(r, v === true)} />
                <span className={cn('rounded border px-1.5 py-px text-xs font-medium', ROL_STYLE[r])}>{ROL_LABEL[r]}</span>
                {derivados.includes(r) && (
                  <span className="ml-auto text-xs text-muted-foreground">por actividad</span>
                )}
              </label>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground mt-2 leading-snug">
          Automático: {derivados.length ? lista(derivados) : 'sin rol (no hay actividad que lo diga)'}
        </p>

        <div className="mt-3 flex items-center justify-between gap-2">
          {manual ? (
            <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs"
              disabled={guardar.isPending} onClick={() => guardar.mutate(null)}>
              Volver a automático
            </Button>
          ) : <span />}
          <Button type="button" size="sm" className="h-8 text-xs"
            disabled={guardar.isPending || sinCambio}
            onClick={() => guardar.mutate(sel.length ? sel : null)}>
            {guardar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Guardar'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
