/**
 * TERCEROS — el listado (Nico, 2026-08-06).
 *
 * `responsibles` es la tabla única de terceros: clientes, proveedores,
 * empleados y entidades conviven ahí. El ROL se deriva de lo que cada uno
 * hizo (ver src/lib/terceroProfile.ts), no se digita.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Search, Users, ChevronRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fetchTerceros, fetchResumenTerceros, type RolTercero, type ResumenTercero, type Tercero,
} from '@/lib/terceroProfile';

const fmtCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
const fmt = (n: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n);

const ROL_STYLE: Record<RolTercero, string> = {
  cliente: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
  proveedor: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900',
  empleado: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900',
  entidad: 'bg-muted text-muted-foreground border-border',
};

export function RolChips({ roles }: { roles: RolTercero[] }) {
  if (!roles.length) return <span className="text-[10px] text-muted-foreground">sin actividad</span>;
  return (
    <span className="inline-flex gap-1 flex-wrap">
      {roles.map((r) => (
        <span key={r} className={cn('rounded border px-1.5 py-px text-[10px] font-medium capitalize', ROL_STYLE[r])}>
          {r}
        </span>
      ))}
    </span>
  );
}

type Filtro = 'todos' | RolTercero | 'incompletos';

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
  const { data: resumen } = useQuery({
    queryKey: ['terceros', 'resumen', terceros.length],
    queryFn: () => fetchResumenTerceros(terceros),
    enabled: terceros.length > 0,
    staleTime: 5 * 60_000,
  });

  const incompleto = (t: Tercero) => !t.nit || !(t.email || t.phone || t.telefono);

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    let arr = terceros.filter((t) => t.active);
    if (s) arr = arr.filter((t) =>
      t.name.toLowerCase().includes(s)
      || (t.nit ?? '').includes(s)
      || (t.razon_social ?? '').toLowerCase().includes(s));
    if (filtro === 'incompletos') arr = arr.filter(incompleto);
    else if (filtro !== 'todos') arr = arr.filter((t) => resumen?.get(t.id)?.roles.includes(filtro));
    return arr.sort((a, b) => {
      const ra = resumen?.get(a.id); const rb = resumen?.get(b.id);
      return (rb?.ultimaActividad ?? '').localeCompare(ra?.ultimaActividad ?? '') || a.name.localeCompare(b.name);
    });
  }, [terceros, q, filtro, resumen]);

  const conteos = useMemo(() => {
    const c = { cliente: 0, proveedor: 0, empleado: 0, entidad: 0, incompletos: 0 };
    for (const t of terceros) {
      if (!t.active) continue;
      for (const r of resumen?.get(t.id)?.roles ?? []) c[r]++;
      if (incompleto(t)) c.incompletos++;
    }
    return c;
  }, [terceros, resumen]);

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
              ['todos', `Todos (${visibles.length})`],
              ['cliente', `Clientes (${conteos.cliente})`],
              ['proveedor', `Proveedores (${conteos.proveedor})`],
              ['empleado', `Empleados (${conteos.empleado})`],
              ['incompletos', `Sin datos (${conteos.incompletos})`],
            ] as [Filtro, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setFiltro(k)}
                className={cn('px-2.5 py-1.5 border-r border-border last:border-r-0 transition-colors',
                  filtro === k ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-muted')}>
                {label}
              </button>
            ))}
          </div>
        </div>

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
                      <th className="px-3 py-2.5 font-semibold">Rol</th>
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
                      const r = resumen?.get(t.id);
                      const contacto = [t.email, t.phone ?? t.telefono].filter(Boolean).join(' · ');
                      return (
                        <tr key={t.id}
                          className="border-t border-border/60 hover:bg-muted/40 cursor-pointer"
                          onClick={() => navigate(`/terceros/${t.id}`)}>
                          <td className="px-4 py-2 font-medium">
                            {t.name}
                            {t.razon_social && t.razon_social !== t.name && (
                              <span className="text-muted-foreground ml-1.5 text-[10px]">{t.razon_social}</span>
                            )}
                          </td>
                          <td className="px-3 py-2"><RolChips roles={r?.roles ?? []} /></td>
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
                  <p className="px-4 py-2 text-[11px] text-muted-foreground">
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
            Clientes, proveedores, empleados y entidades. El rol sale de lo que cada uno hizo —
            no hay que clasificarlos a mano.
          </p>
        </div>
        <TercerosListado />
      </div>
    </AppLayout>
  );
}
