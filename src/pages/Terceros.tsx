/**
 * TERCEROS — el listado (Nico, 2026-08-06).
 *
 * `responsibles` es la tabla única de terceros: clientes, proveedores,
 * empleados y entidades conviven ahí. El ROL se deriva de lo que cada uno
 * hizo (ver src/lib/terceroProfile.ts) y, desde 2026-11-11, se corrige con un
 * clic en el chip (RolEditable): lo fijado a mano manda.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Loader2, Search, Users, ChevronRight, AlertTriangle, ListFilter } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fetchTerceros, fetchResumenTerceros, indexarResumen, resolverRoles,
  type RolTercero, type RolesResueltos, type Tercero,
} from '@/lib/terceroProfile';
import { RolEditable } from '@/components/terceros/RolTercero';
import TercerosDuplicadosBanner from '@/components/terceros/TercerosDuplicadosBanner';

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
const fmt = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);

type FiltroRol = RolTercero | 'sin_rol';
type Filtro = 'todos' | FiltroRol | 'incompletos';

/** Opciones del filtro de la columna Rol (mismo estado que el segmentado). */
const OPCIONES_ROL: [Filtro, string][] = [
  ['todos', 'Todos'],
  ['cliente', 'Cliente'],
  ['proveedor', 'Proveedor'],
  ['empleado', 'Empleado'],
  ['entidad', 'Entidad'],
  ['sin_rol', 'Sin rol'],
];
const esFiltroRol = (f: Filtro): f is FiltroRol => f !== 'todos' && f !== 'incompletos';

/** El listado, embebible: vive como pestaña dentro de Conciliación bancaria
 *  (pedido de Nico 2026-08-07) y también como página propia /terceros. */
export function TercerosListado() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');

  const { data: terceros = [], isPending } = useQuery({
    queryKey: ['terceros'],
    queryFn: fetchTerceros,
    staleTime: 5 * 60_000,
  });
  // Array plano en la query (el cache persistido es JSON); el índice, al usar.
  const { data: resumenRows } = useQuery({
    queryKey: ['terceros', 'resumen', terceros.length],
    queryFn: () => fetchResumenTerceros(terceros),
    enabled: terceros.length > 0,
    staleTime: 5 * 60_000,
  });
  const resumen = useMemo(() => indexarResumen(resumenRows), [resumenRows]);
  const resumenListo = !!resumenRows;

  // Rol EFECTIVO de cada tercero: lo fijado a mano (de la lista fresca, así un
  // cambio se ve al instante) o lo derivado de su actividad (del resumen).
  const rolesPorId = useMemo(() => {
    const m = new Map<string, RolesResueltos>();
    for (const t of terceros) {
      m.set(t.id, resolverRoles({
        derivados: resumen.get(t.id)?.roles ?? [],
        rolesManual: t.roles_manual,
        clienteManual: t.cliente_manual,
      }));
    }
    return m;
  }, [terceros, resumen]);

  const incompleto = (t: Tercero) => !t.nit || !(t.email || t.phone || t.telefono);
  const cumpleRol = (t: Tercero, f: FiltroRol) => {
    const roles = rolesPorId.get(t.id)?.roles ?? [];
    return f === 'sin_rol' ? roles.length === 0 : roles.includes(f);
  };

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    let arr = terceros.filter((t) => t.active);
    if (s) arr = arr.filter((t) =>
      t.name.toLowerCase().includes(s)
      || (t.nit ?? '').includes(s)
      || (t.razon_social ?? '').toLowerCase().includes(s));
    if (filtro === 'incompletos') arr = arr.filter(incompleto);
    else if (esFiltroRol(filtro)) arr = arr.filter((t) => cumpleRol(t, filtro));
    return arr.sort((a, b) => {
      const ra = resumen.get(a.id); const rb = resumen.get(b.id);
      return (rb?.ultimaActividad ?? '').localeCompare(ra?.ultimaActividad ?? '') || a.name.localeCompare(b.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terceros, q, filtro, resumen, rolesPorId]);

  const conteos = useMemo(() => {
    const c: Record<Filtro, number> = {
      todos: 0, cliente: 0, proveedor: 0, empleado: 0, entidad: 0, sin_rol: 0, incompletos: 0,
    };
    for (const t of terceros) {
      if (!t.active) continue;
      c.todos++;
      const roles = rolesPorId.get(t.id)?.roles ?? [];
      for (const r of roles) c[r]++;
      if (!roles.length) c.sin_rol++;
      if (incompleto(t)) c.incompletos++;
    }
    return c;
  }, [terceros, rolesPorId]);

  const etiquetaRol = OPCIONES_ROL.find(([k]) => k === filtro)?.[1];

  // Para el detector de fichas duplicadas: terceros activos y cuánto se usa
  // cada uno (decide cuál se conserva al unir).
  const activos = useMemo(() => terceros.filter((t) => t.active), [terceros]);
  const actividad = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of activos) {
      const r = resumen.get(t.id);
      m.set(t.id, (r?.movimientos ?? 0) + (r?.facturas ?? 0));
    }
    return m;
  }, [activos, resumen]);

  return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative max-w-xs flex-1 min-w-52">
            <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre o NIT…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-border bg-background" />
          </div>
          <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
            {([
              ['todos', `Todos (${conteos.todos})`],
              ['cliente', `Clientes (${conteos.cliente})`],
              ['proveedor', `Proveedores (${conteos.proveedor})`],
              ['empleado', `Empleados (${conteos.empleado})`],
              ['entidad', `Entidades (${conteos.entidad})`],
              ['incompletos', `Sin datos (${conteos.incompletos})`],
            ] as [Filtro, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setFiltro(k)}
                className={cn('px-2.5 py-1.5 border-r border-border last:border-r-0 transition-colors',
                  filtro === k ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-muted')}>
                {label}
              </button>
            ))}
          </div>
          {filtro !== 'todos' && (
            <span className="text-xs text-muted-foreground">
              Mostrando {fmt(visibles.length)} de {fmt(conteos.todos)}
            </span>
          )}
        </div>

        {/* Fichas que parecen el mismo tercero: unir con un clic (caso Polyacril). */}
        {resumenListo && <TercerosDuplicadosBanner terceros={activos} actividad={actividad} />}

        <Card className="rounded-2xl overflow-hidden">
          <CardContent className="p-0">
            {isPending ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando terceros…
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60">
                    <tr className="text-left">
                      <th className="px-4 py-2.5 font-semibold">Nombre</th>
                      <th className="px-3 py-2.5 font-semibold">
                        {/* Filtro de la columna: el mismo estado que el segmentado de arriba. */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button"
                              className={cn('inline-flex items-center gap-1 rounded -mx-1 px-1 py-0.5 hover:bg-muted transition-colors',
                                esFiltroRol(filtro) && 'text-primary')}
                              title="Filtrar por rol">
                              Rol{esFiltroRol(filtro) ? `: ${etiquetaRol}` : ''}
                              <ListFilter className="h-3.5 w-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-52">
                            <DropdownMenuLabel className="text-xs">Filtrar por rol</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuRadioGroup
                              value={esFiltroRol(filtro) ? filtro : 'todos'}
                              onValueChange={(v) => setFiltro(v as Filtro)}>
                              {OPCIONES_ROL.map(([k, label]) => (
                                <DropdownMenuRadioItem key={k} value={k} className="text-xs">
                                  {label}
                                  <span className="ml-auto pl-3 tabular-nums text-muted-foreground">{fmt(conteos[k])}</span>
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </th>
                      <th className="px-3 py-2.5 font-semibold">NIT</th>
                      <th className="px-3 py-2.5 font-semibold">Contacto</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Movs</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Por cobrar</th>
                      <th className="px-3 py-2.5 font-semibold">Últ. actividad</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                        {terceros.length === 0 ? 'Todavía no hay terceros.' : 'Sin resultados.'}
                      </td></tr>
                    ) : visibles.slice(0, 300).map((t) => {
                      const r = resumen.get(t.id);
                      const rol = rolesPorId.get(t.id);
                      const contacto = [t.email, t.phone ?? t.telefono].filter(Boolean).join(' · ');
                      return (
                        <tr key={t.id}
                          className="border-t border-border/60 hover:bg-muted/40 cursor-pointer"
                          onClick={() => navigate(`/terceros/${t.id}`)}>
                          <td className="px-4 py-2 font-medium">
                            {t.name}
                            {t.razon_social && t.razon_social !== t.name && (
                              <span className="text-muted-foreground ml-1.5 text-xs font-normal">{t.razon_social}</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <RolEditable
                              terceroId={t.id}
                              nombre={t.name}
                              roles={rol?.roles ?? []}
                              derivados={rol?.derivados ?? []}
                              manual={rol?.manual ?? false}
                              cargando={!resumenListo && !rol?.manual}
                            />
                          </td>
                          <td className="px-3 py-2 font-mono">
                            {t.nit ? `${t.nit}${t.dv != null ? `-${t.dv}` : ''}` : (
                              <span className="text-amber-600 inline-flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" /> falta
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground truncate max-w-[220px]">
                            {contacto || <span className="text-amber-600">sin contacto</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(r?.movimientos ?? 0)}</td>
                          <td className={cn('px-3 py-2 text-right tabular-nums',
                            (r?.pendienteCobrar ?? 0) > 0 ? 'text-destructive font-medium' : 'text-muted-foreground')}>
                            {(r?.pendienteCobrar ?? 0) > 0 ? fmtCOP(r!.pendienteCobrar) : '—'}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground tabular-nums">{r?.ultimaActividad ?? '—'}</td>
                          <td className="px-2 py-2"><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {visibles.length > 300 && (
                  <p className="px-4 py-2 text-xs text-muted-foreground">
                    Mostrando 300 de {visibles.length} — usá el buscador.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
  );
}

/** Página propia /terceros — el mismo listado con su cabecera. */
export default function Terceros() {
  return (
    <AppLayout>
      <div className="max-w-full mx-auto space-y-4 px-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" /> Terceros
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Clientes, proveedores, empleados y entidades. El rol sale de lo que cada uno hizo;
            si está mal, corregilo con un clic en el chip.
          </p>
        </div>
        <TercerosListado />
      </div>
    </AppLayout>
  );
}
